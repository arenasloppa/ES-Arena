/**
 * Turns a parsed MIF level + its INF into a renderer-agnostic voxel level.
 *
 * MAP1 voxel encoding (per community docs / OpenTESArena):
 *   0x0000               empty
 *   hi == lo, bit15 = 0  solid wall, wall texture index hi - 1
 *   hi != lo, bit15 = 0  raised platform: side = BOXSIDE[v & 0x0F],
 *                        cap = BOXCAP[(v >> 4) & 0x0F]
 *   0x8xxx               flat (sprite), index v & 0xFF into @FLATS
 *   0x9xxx               transparent wall (bars), texture (v & 0xFF) - 1
 *   0xAxxx               edge wall (fence), texture (v & 0xFF) - 1
 *   0xBxxx               door, texture (v & 0x3F) - 1
 *   0xDxxx               diagonal wall, texture (v & 0xFF) - 1
 * FLOR voxel: floor texture index hi byte; 0x0C/0x0D/0x0E are dry, wet and
 * lava chasms; the low byte can hold a flat index as well.
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
}

export interface LevelFlat {
  x: number;
  y: number;
  /** Sprite file from @FLATS, e.g. "BARREL.IMG". */
  name: string;
  /** Vertical offset in Arena units from the INF (negative is up). */
  yOffset?: number;
}

export interface LevelTrigger {
  x: number;
  y: number;
  text?: string;
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
  flats: LevelFlat[];
  triggers: LevelTrigger[];
  start: { x: number; y: number };
}

const CHASM_IDS: Record<number, ChasmKind> = { 0x0c: 'dry', 0x0d: 'wet', 0x0e: 'lava' };
const DEFAULT_CEILING = 100;

export function buildLevel(mif: MifFile, levelIndex: number, inf: InfFile): Level {
  const ml: MifLevel = mif.levels[levelIndex];
  if (!ml) throw new Error(`Level ${levelIndex} does not exist`);
  const { width, depth } = mif;
  const wallTextures = expandTextures(inf.walls);
  const floorTextures = expandTextures(inf.floors);
  const clampWall = (i: number) => Math.min(Math.max(i, 0), Math.max(wallTextures.length - 1, 0));
  const clampFloor = (i: number) => Math.min(Math.max(i, 0), Math.max(floorTextures.length - 1, 0));

  const chasmTextures: Level['chasmTextures'] = {};
  for (const [kind, tag] of [['dry', 'DRYCHASM'], ['wet', 'WETCHASM'], ['lava', 'LAVACHASM']] as const) {
    const r = roleTexture(inf, tag);
    if (r) chasmTextures[kind] = r.index;
  }

  const cells: Cell[] = [];
  const flats: LevelFlat[] = [];

  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = ml.map1[i];
      const f = ml.flor[i];
      const floorId = f >> 8;
      const cell: Cell = { kind: 'empty', wallTex: 0, floorTex: clampFloor(floorId) };
      const chasm = CHASM_IDS[floorId];
      if (chasm) cell.chasm = chasm;

      const hi = v >> 8;
      const lo = v & 0xff;
      if (v === 0) {
        // empty
      } else if ((v & 0x8000) === 0) {
        if (hi === lo) {
          cell.kind = 'wall';
          cell.wallTex = clampWall(hi - 1);
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
          case 0x8: {
            const flat = inf.flats[lo];
            if (flat) flats.push({ x: x + 0.5, y: y + 0.5, name: flat.name, yOffset: flat.yOffset });
            break;
          }
          case 0x9:
          case 0xa:
            cell.kind = 'transparent';
            cell.wallTex = clampWall(lo - 1);
            break;
          case 0xb:
            cell.kind = 'door';
            cell.wallTex = clampWall((v & 0x3f) - 1);
            break;
          case 0xd:
            cell.kind = 'diagonal';
            cell.wallTex = clampWall(lo - 1);
            cell.diagonalFlip = (v & 0x0100) !== 0;
            break;
          default:
            break;
        }
      }
      cells.push(cell);
    }
  }

  const triggers: LevelTrigger[] = ml.triggers.map((t) => {
    const raw = inf.texts[t.textIndex];
    const text = raw && !raw.startsWith('+') ? raw.replace(/^~/, '').trim() : undefined;
    return { x: t.x, y: t.y, text };
  });

  const start = mif.startPoints[0] ?? findOpenCell(cells, width, depth);

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

function findOpenCell(cells: Cell[], width: number, depth: number): { x: number; y: number } {
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    if (cells[y * width + x].kind === 'empty' && !cells[y * width + x].chasm) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: width / 2, y: depth / 2 };
}
