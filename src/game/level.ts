/**
 * Turns a parsed MIF level + its INF into a renderer-agnostic voxel level.
 *
 * MAP1 voxel encoding (per community docs / OpenTESArena):
 *   0x0000               empty
 *   hi == lo, bit15 = 0  solid wall, texture hi
 *   hi != lo, bit15 = 0  raised platform: side = BOXSIDE[v & 0x0F],
 *                        cap = BOXCAP[(v >> 4) & 0x0F]
 *   0x8xxx               flat (sprite), index v & 0xFF into @FLATS
 *   0x9xxx               transparent wall (bars), texture v & 0xFF
 *   0xAxxx               edge wall (fence), texture v & 0xFF
 *   0xBxxx               door, texture v & 0x3F
 *   0xDxxx               diagonal wall, texture v & 0xFF
 * Wall texture numbers count the floor textures first: number n is wall
 * texture n - 1 - (number of floor textures, SET frames included).
 * FLOR voxel: floor texture index hi byte; 0x0C/0x0D/0x0E are dry, wet and
 * lava chasms. The low byte, when set, puts @FLATS entry (low - 1) there.
 *
 * Flats tagged "*ITEM n" in the INF are items (keys, treasure) or, from 32
 * on, creatures; see items below. A key's number comes from the "+n" text
 * of the trigger on its cell, and opens the LOCK whose level is n.
 *
 * Orientation: Arena's grids run from east to west along a row (column 0 is
 * the east edge) and from north to south down the rows. START.MIF's own
 * directions agree ("go west, then south" leads to higher columns, then
 * higher rows), as do OpenTESArena's axes. Drawn as stored, the world would
 * be a mirror image, so the level is flipped east-west here: in a Level, +x
 * is east and +y is south.
 */
import type { MifFile, MifLevel } from '../formats/mif';
import { expandTextures, roleTexture, type InfFile } from '../formats/inf';

export type CellKind = 'empty' | 'wall' | 'door' | 'raised' | 'transparent' | 'diagonal';
export type ChasmKind = 'dry' | 'wet' | 'lava';

export interface Cell {
  kind: CellKind;
  /** Index into Level.wallTextures for walls, doors, transparent and diagonal walls, and raised sides. */
  wallTex: number;
  /** Index into Level.floorTextures. */
  floorTex: number;
  chasm?: ChasmKind;
  /** Raised platform top, as a fraction of the room height. */
  raisedHeight?: number;
  /** Raised platform cap texture: index into floorTextures or wallTextures, see capIsWall. */
  capTex?: number;
  capIsWall?: boolean;
  /** Diagonal walls run either from (0,0) to (1,1) or from (1,0) to (0,1) of the cell. */
  diagonalFlip?: boolean;
  /** A door you can see through (bars). */
  seeThrough?: boolean;
  /** A wall that leads out of the level: the INF's LEVELUP (e.g. the Shift Gate) or LEVELDOWN. */
  exit?: 'up' | 'down';
}

export interface LevelFlat {
  x: number;
  y: number;
  /** Sprite file from @FLATS, e.g. "BARREL.IMG". */
  name: string;
  /** Vertical offset in Arena units from the INF (negative is up). */
  yOffset?: number;
  /** Height of the floor it stands on, as a fraction of the room height (raised platforms). */
  base?: number;
}

export type ItemKind = 'key' | 'corpse' | 'equipment' | 'treasure' | 'chest';

export interface LevelItem extends LevelFlat {
  kind: ItemKind;
  /** For keys: the lock level they open. */
  key?: number;
}

export interface CreatureSpawn {
  x: number;
  y: number;
  /** Index into the game's creature table: 0 rat, 1 goblin, ... */
  type: number;
}

export interface LevelTrigger {
  x: number;
  y: number;
  text?: string;
  /** Shown only the first time ("~" texts). */
  once?: boolean;
  /** Sound file to play, e.g. "DRIP1.VOC". */
  sound?: string;
}

export interface Level {
  name: string;
  width: number;
  depth: number;
  /** Room height in voxel widths (1 = cubic voxels). */
  height: number;
  cells: Cell[];
  wallTextures: Array<{ file: string; frame: number }>;
  floorTextures: Array<{ file: string; frame: number }>;
  chasmTextures: Partial<Record<ChasmKind, number>>;
  /** Index into floorTextures used for the whole ceiling. */
  ceilingTex: number;
  /** Decoration that can't be picked up. */
  flats: LevelFlat[];
  items: LevelItem[];
  creatures: CreatureSpawn[];
  /** Lock level by cell index, for locked doors. */
  locks: Map<number, number>;
  triggers: LevelTrigger[];
  start: { x: number; y: number };
}

const CHASM_IDS: Record<number, ChasmKind> = { 0x0c: 'dry', 0x0d: 'wet', 0x0e: 'lava' };
const DEFAULT_CEILING = 100;
const ITEM_KINDS: Record<number, ItemKind> = { 1: 'key', 2: 'corpse', 3: 'equipment', 4: 'treasure', 5: 'treasure', 6: 'treasure', 7: 'chest', 8: 'chest' };
/** "*ITEM 32" is the first creature. */
export const FIRST_CREATURE_ITEM = 32;

export function buildLevel(mif: MifFile, levelIndex: number, inf: InfFile): Level {
  const ml: MifLevel = mif.levels[levelIndex];
  if (!ml) throw new Error(`Level ${levelIndex} does not exist`);
  const { width, depth } = mif;
  const wallTextures = expandTextures(inf.walls);
  const floorTextures = expandTextures(inf.floors);
  const clampWall = (i: number) => Math.min(Math.max(i, 0), Math.max(wallTextures.length - 1, 0));
  const clampFloor = (i: number) => Math.min(Math.max(i, 0), Math.max(floorTextures.length - 1, 0));
  /** Wall texture numbers in MAP1 count the floor textures first. */
  const wallTex = (n: number) => clampWall(n - 1 - floorTextures.length);
  const tagged = (tag: string) => new Set((inf.roles[tag] ?? []).flatMap((r) => Array.from({ length: r.texture.frames }, (_, f) => r.index + f)));
  const seeThrough = tagged('TRANS');
  const exitUp = tagged('LEVELUP');
  const exitDown = tagged('LEVELDOWN');

  const chasmTextures: Level['chasmTextures'] = {};
  for (const [kind, tag] of [['dry', 'DRYCHASM'], ['wet', 'WETCHASM'], ['lava', 'LAVACHASM']] as const) {
    const r = roleTexture(inf, tag);
    if (r) chasmTextures[kind] = r.index;
  }

  const cells: Cell[] = new Array(width * depth);
  /** Column in the level for a MIF column (see Orientation above). */
  const east = (x: number) => width - 1 - x;
  const placed: Array<{ x: number; y: number; flat: number }> = [];

  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = ml.map1[i];
      const f = ml.flor[i];
      const floorId = f >> 8;
      const cell: Cell = { kind: 'empty', wallTex: 0, floorTex: clampFloor(floorId) };
      const chasm = CHASM_IDS[floorId];
      if (chasm) cell.chasm = chasm;
      if (f & 0xff) placed.push({ x, y, flat: (f & 0xff) - 1 });

      const hi = v >> 8;
      const lo = v & 0xff;
      if (v === 0) {
        // empty
      } else if ((v & 0x8000) === 0) {
        if (hi === lo) {
          cell.kind = 'wall';
          cell.wallTex = wallTex(hi);
          if (exitUp.has(cell.wallTex)) cell.exit = 'up';
          else if (exitDown.has(cell.wallTex)) cell.exit = 'down';
        } else {
          cell.kind = 'raised';
          const side = roleTexture(inf, 'BOXSIDE', v & 0x0f);
          const cap = roleTexture(inf, 'BOXCAP', (v >> 4) & 0x0f);
          cell.wallTex = clampWall(side?.index ?? 0);
          if (cap) {
            cell.capIsWall = inf.walls.includes(cap.texture);
            cell.capTex = cap.index;
          }
          // The exact height encoding is not confirmed yet; treat the high byte as Arena units out of 128.
          cell.raisedHeight = Math.min(1, Math.max(0.1, (hi & 0x7f) / 128));
        }
      } else {
        switch (hi >> 4) {
          case 0x8:
            placed.push({ x, y, flat: lo });
            break;
          case 0x9:
          case 0xa:
            cell.kind = 'transparent';
            cell.wallTex = wallTex(lo);
            break;
          case 0xb:
            cell.kind = 'door';
            cell.wallTex = wallTex(v & 0x3f);
            if (seeThrough.has(cell.wallTex)) cell.seeThrough = true;
            break;
          case 0xd:
            cell.kind = 'diagonal';
            cell.wallTex = wallTex(lo);
            // Mirroring the grid swaps which corners a diagonal joins.
            cell.diagonalFlip = (v & 0x0100) === 0;
            break;
          default:
            break;
        }
      }
      cells[y * width + east(x)] = cell;
    }
  }

  const triggers: LevelTrigger[] = [];
  /** Key numbers from "+n" texts, by MIF cell. */
  const keyAt = new Map<number, number>();
  for (const t of ml.triggers) {
    const raw = inf.texts[t.textIndex];
    const key = raw === undefined ? undefined : /^\+(\d+)/.exec(raw.trim());
    if (key) keyAt.set(t.y * width + t.x, parseInt(key[1], 10));
    const trigger: LevelTrigger = { x: east(t.x), y: t.y };
    if (raw && !key) {
      trigger.text = raw.replace(/^~/, '').trim();
      if (raw.startsWith('~')) trigger.once = true;
    }
    const sound = inf.sounds[t.soundIndex];
    if (sound) trigger.sound = sound;
    if (trigger.text || trigger.sound) triggers.push(trigger);
  }

  const flats: LevelFlat[] = [];
  const items: LevelItem[] = [];
  const creatures: CreatureSpawn[] = [];
  for (const p of placed) {
    const def = inf.flats[p.flat];
    if (!def) continue;
    const at = { x: east(p.x) + 0.5, y: p.y + 0.5 };
    if (def.item !== undefined && def.item >= FIRST_CREATURE_ITEM) {
      creatures.push({ ...at, type: def.item - FIRST_CREATURE_ITEM });
      continue;
    }
    const flat: LevelFlat = { ...at, name: def.name, yOffset: def.yOffset };
    const under = cells[p.y * width + east(p.x)];
    if (under.kind === 'raised') flat.base = under.raisedHeight;
    const kind = def.item === undefined ? undefined : ITEM_KINDS[def.item];
    if (!kind) flats.push(flat);
    else {
      const item: LevelItem = { ...flat, kind };
      const key = keyAt.get(p.y * width + p.x);
      if (kind === 'key') item.key = key ?? 0;
      items.push(item);
    }
  }

  const locks = new Map<number, number>();
  for (const l of ml.locks) locks.set(l.y * width + east(l.x), l.level);

  const startPoint = mif.startPoints[0];
  const start = startPoint ? { x: width - startPoint.x, y: startPoint.y } : findOpenCell(cells, width, depth);

  // The INF has no separate ceiling texture for most dungeons; use the most common floor.
  const floorCounts = new Map<number, number>();
  for (const c of cells) if (c.kind !== 'wall' && !c.chasm) floorCounts.set(c.floorTex, (floorCounts.get(c.floorTex) ?? 0) + 1);
  let ceilingTex = 0;
  let best = -1;
  for (const [tex, n] of floorCounts) if (n > best) [ceilingTex, best] = [tex, n];

  return {
    name: ml.name,
    width,
    depth,
    height: (inf.ceilingHeight ?? DEFAULT_CEILING) / DEFAULT_CEILING,
    cells,
    wallTextures,
    floorTextures,
    chasmTextures,
    ceilingTex,
    flats,
    items,
    creatures,
    locks,
    triggers,
    start,
  };
}

/** True when the player cannot stand in this cell. */
export function isBlocking(cell: Cell | undefined, openDoors?: Set<number>, index?: number): boolean {
  if (!cell) return true;
  switch (cell.kind) {
    case 'wall':
    case 'transparent':
    case 'diagonal':
      return true;
    case 'door':
      return !(openDoors && index !== undefined && openDoors.has(index));
    case 'raised':
      return (cell.raisedHeight ?? 1) > 0.35;
    default:
      return false;
  }
}

/** True when nothing in the cell blocks sight: open floor, raised steps, open doors. */
export function isSeeThrough(cell: Cell | undefined, openDoors?: Set<number>, index?: number): boolean {
  if (!cell) return false;
  if (cell.kind === 'door') return !!cell.seeThrough || (!!openDoors && index !== undefined && openDoors.has(index));
  return cell.kind === 'empty' || cell.kind === 'raised' || cell.kind === 'transparent';
}

function findOpenCell(cells: Cell[], width: number, depth: number): { x: number; y: number } {
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    if (cells[y * width + x].kind === 'empty' && !cells[y * width + x].chasm) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: width / 2, y: depth / 2 };
}
