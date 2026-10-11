/**
 * Turns a parsed MIF level + its INF into a renderer-agnostic voxel level.
 *
 * MAP1 voxel encoding (as OpenTESArena's MapGeneration.cpp reads it):
 *   0x0000               empty
 *   hi == lo, bit15 = 0  solid wall, texture hi
 *   hi != lo, bit15 = 0  raised platform: side = BOXSIDE[v & 0x0F],
 *                        top = BOXCAP[(v >> 4) & 0x0F], bottom the ceiling's
 *                        texture; its bottom sits at heights[hi & 7] and it is
 *                        thicknesses[(hi >> 3) & 15] thick (Arena units, from
 *                        the game's program), times the INF's box scale / 256
 *   0x8xxx               flat (sprite), index v & 0xFF into @FLATS
 *   0x9xxx               see-through block (bars, arches), texture v & 0xFF;
 *                        bit 0x0100 set means it can be walked through
 *   0xAxxx               edge (fence): one face on the side (v >> 6) & 3
 *                        names (north, west, south, east), texture v & 0x3F,
 *                        raised ((v >> 9) & 7) * 8 units; solid with 0x0100
 *   0xBxxx               door, texture v & 0x3F; (v >> 6) & 3 is how it opens:
 *                        swinging, sliding, raising (or splitting)
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
 *
 * Heights: a voxel is 128 Arena units wide, and heights are in the same
 * units drawn 1.2 times taller, as Arena's tall screen pixels showed them
 * (ARENA_HEIGHT world units each). Rooms are the INF's *CEILING height
 * tall, 100 units when it gives none; without a *CEILING texture the
 * ceiling uses the first floor texture, as OpenTESArena does.
 */
import type { RaisedPlatforms } from '../formats/exe';
import type { MifFile, MifLevel } from '../formats/mif';
import { expandTextures, roleTexture, type InfFile } from '../formats/inf';

export type CellKind = 'empty' | 'wall' | 'door' | 'raised' | 'transparent' | 'diagonal' | 'edge';
export type DoorKind = 'swinging' | 'sliding' | 'raising' | 'splitting';
export type Side = 'north' | 'east' | 'south' | 'west';

/** World units per Arena unit of height: 128 units across a voxel, and Arena's pixels 1.2 times taller than wide. */
export const ARENA_HEIGHT = 1.2 / 128;
/** Room height in Arena units when the INF doesn't say. */
export const DEFAULT_CEILING_UNITS = 100;
export type ChasmKind = 'dry' | 'wet' | 'lava';

export interface Cell {
  kind: CellKind;
  /** Index into Level.wallTextures for walls, doors, transparent and diagonal walls, and raised sides. */
  wallTex: number;
  /** Index into Level.floorTextures. */
  floorTex: number;
  chasm?: ChasmKind;
  /** Raised platform: where it starts and ends above the floor, in world units. */
  raisedBottom?: number;
  raisedTop?: number;
  /** Raised platform cap texture: index into floorTextures or wallTextures, see capIsWall. */
  capTex?: number;
  capIsWall?: boolean;
  /** Diagonal walls run either from (0,0) to (1,1) or from (1,0) to (0,1) of the cell. */
  diagonalFlip?: boolean;
  /** A door you can see through (bars). */
  seeThrough?: boolean;
  /** How a door opens. */
  door?: DoorKind;
  /** A see-through block (arch, bars) that can be walked through. */
  passable?: boolean;
  /** An edge (fence): the side its face is on, how far up it starts (world units), and whether it stops you. */
  edge?: { side: Side; lift: number; solid: boolean };
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
  /** Height of the floor it stands on, in world units (raised platforms). */
  base?: number;
  /** From the INF's F: and S: modifiers: it stops you, it is drawn larger, it hangs from the ceiling, the light it gives. */
  solid?: boolean;
  scale?: number;
  ceiling?: boolean;
  seeThrough?: boolean;
  puddle?: boolean;
  light?: number;
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
const ITEM_KINDS: Record<number, ItemKind> = { 1: 'key', 2: 'corpse', 3: 'equipment', 4: 'treasure', 5: 'treasure', 6: 'treasure', 7: 'chest', 8: 'chest' };
/** "*ITEM 32" is the first creature. */
export const FIRST_CREATURE_ITEM = 32;

/**
 * `platforms` are the game's raised platform tables; without them platforms
 * are given even steps of thickness from the floor.
 */
export function buildLevel(mif: MifFile, levelIndex: number, inf: InfFile, platforms?: RaisedPlatforms): Level {
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
          const bottom = platforms ? platforms.heights[hi & 7] : 0;
          const thickness = (platforms ? platforms.thicknesses[(hi >> 3) & 15] : (((hi >> 3) & 15) + 1) * 6.25) * ((inf.boxScale ?? 256) / 256);
          const room = inf.ceilingHeight ?? DEFAULT_CEILING_UNITS;
          cell.raisedBottom = Math.min(bottom, room) * ARENA_HEIGHT;
          cell.raisedTop = Math.min(bottom + thickness, room) * ARENA_HEIGHT;
        }
      } else {
        switch (hi >> 4) {
          case 0x8:
            placed.push({ x, y, flat: lo });
            break;
          case 0x9:
            cell.kind = 'transparent';
            cell.wallTex = wallTex(lo);
            if (v & 0x0100) cell.passable = true;
            break;
          case 0xa: {
            cell.kind = 'edge';
            cell.wallTex = wallTex(v & 0x3f);
            // Mirroring the grid east-west swaps the east and west faces.
            const side = (['north', 'east', 'south', 'west'] as const)[(v >> 6) & 3];
            cell.edge = { side, lift: ((v >> 9) & 7) * 8 * ARENA_HEIGHT, solid: (v & 0x0100) !== 0 };
            break;
          }
          case 0xb:
            cell.kind = 'door';
            cell.wallTex = wallTex(v & 0x3f);
            cell.door = (['swinging', 'sliding', 'raising', 'splitting'] as const)[(v >> 6) & 3];
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
    for (const key of ['solid', 'scale', 'ceiling', 'seeThrough', 'puddle', 'light'] as const) if (def[key] !== undefined) (flat as unknown as Record<string, unknown>)[key] = def[key];
    const under = cells[p.y * width + east(p.x)];
    if (under.kind === 'raised' && !under.raisedBottom) flat.base = under.raisedTop;
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

  const ceilingTex = clampFloor(inf.ceilingTexture ?? 0);

  return {
    name: ml.name,
    width,
    depth,
    height: (inf.ceilingHeight ?? DEFAULT_CEILING_UNITS) * ARENA_HEIGHT,
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

/** How high a step can be walked up without jumping: a quarter of a voxel, as OpenTESArena has it. */
export const STEP_HEIGHT = 32 * ARENA_HEIGHT;
/** How tall the player stands, to the top of the head: 61 Arena units (the eye is at 60). */
export const PLAYER_HEIGHT = 61 * ARENA_HEIGHT;

/**
 * True when nothing standing on the floor can be in this cell: walls,
 * closed doors, bars and arches that can't be walked through, solid fences,
 * and raised platforms too high to step onto that don't leave room beneath.
 * The player's own movement looks at platform heights itself (player.ts).
 */
export function isBlocking(cell: Cell | undefined, openDoors?: Set<number>, index?: number): boolean {
  if (!cell) return true;
  switch (cell.kind) {
    case 'wall':
    case 'diagonal':
      return true;
    case 'transparent':
      return !cell.passable;
    case 'edge':
      return !!cell.edge?.solid;
    case 'door':
      return !(openDoors && index !== undefined && openDoors.has(index));
    case 'raised':
      return (cell.raisedTop ?? 0) > STEP_HEIGHT && (cell.raisedBottom ?? 0) < PLAYER_HEIGHT;
    default:
      return false;
  }
}

/** Height of the floor in a cell: a platform's top when it can be stood on, below the floor for pits and water. */
export function floorHeight(cell: Cell | undefined, level: Pick<Level, 'height'>): number {
  if (!cell) return 0;
  if (cell.kind === 'raised' && !cell.raisedBottom) return cell.raisedTop ?? 0;
  if (cell.chasm) return chasmFloor(cell.chasm, level.height);
  return 0;
}

/**
 * How far below the floor the player is in a chasm, from OpenTESArena's
 * values for the original: swimming in a dungeon's water or lava puts the
 * eye 25 units lower; a dry pit is a whole room deep.
 */
export function chasmFloor(kind: ChasmKind, roomHeight: number): number {
  return kind === 'dry' ? -roomHeight : -25 * ARENA_HEIGHT;
}

/** True when nothing in the cell blocks sight: open floor, platforms, bars and arches, fences, open doors. */
export function isSeeThrough(cell: Cell | undefined, openDoors?: Set<number>, index?: number): boolean {
  if (!cell) return false;
  if (cell.kind === 'door') return !!cell.seeThrough || (!!openDoors && index !== undefined && openDoors.has(index));
  return cell.kind === 'empty' || cell.kind === 'raised' || cell.kind === 'transparent' || cell.kind === 'edge';
}

function findOpenCell(cells: Cell[], width: number, depth: number): { x: number; y: number } {
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    if (cells[y * width + x].kind === 'empty' && !cells[y * width + x].chasm) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: width / 2, y: depth / 2 };
}
