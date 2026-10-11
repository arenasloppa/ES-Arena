/**
 * Builds raw quad lists for a level, grouped by texture. Kept free of WebGL
 * so it can be unit tested; levelScene.ts turns the groups into meshes.
 *
 * World axes: X = MIF column, Z = MIF row, Y = up. One voxel is 1x1 wide
 * and Level.height tall.
 */
import { chasmFloor, type Cell, type DoorKind, type Level, type Side } from '../game/level';

/** "wall:3", "floor:1", "glass:8" (index 0 transparent) or "liquid:wet" (animated chasm surface). */
export type TextureKey = string;

export interface QuadBatch {
  positions: number[];
  uvs: number[];
  indices: number[];
}

export interface DoorGeometry {
  cellIndex: number;
  x: number;
  y: number;
  key: TextureKey;
  /** Every face of the door that is not against a wall, in one batch. */
  batch: QuadBatch;
  /** The same faces one by one, for a door that swings. */
  panels: DoorPanel[];
  /** How it opens, and for sliding doors the way it goes: along x (true) or y. */
  kind: DoorKind;
  alongX: boolean;
}

/**
 * One face of a swinging door and the corner it turns on. As in Arena, each
 * face is hinged at its left end as seen from outside and swings in, away
 * from whoever opens it, until it lies along the side of the doorway.
 */
export interface DoorPanel {
  batch: QuadBatch;
  hinge: { x: number; z: number };
  /** The way the face looks out of the door, shut: Arena draws a face only to someone on that side. */
  normal: { x: number; z: number };
}

/** How far a swinging face's hinge sits from the corner, so the open face lies just off the wall instead of in it. */
const HINGE_GAP = 0.01;

export interface LevelGeometry {
  batches: Map<TextureKey, QuadBatch>;
  doors: DoorGeometry[];
}

type V3 = [number, number, number];

const SIDES: Array<{ dx: number; dy: number; normal: V3 }> = [
  { dx: 0, dy: -1, normal: [0, 0, -1] },
  { dx: 1, dy: 0, normal: [1, 0, 0] },
  { dx: 0, dy: 1, normal: [0, 0, 1] },
  { dx: -1, dy: 0, normal: [-1, 0, 0] },
];

/** Where a chasm's surface is drawn: a dry pit's floor, or the top of the water or lava. */
export function chasmDepth(cell: Cell, height: number): number {
  return cell.chasm ? chasmFloor(cell.chasm, height) : 0;
}

const SIDE_NORMALS: Record<Side, V3> = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0] };

export function buildLevelGeometry(level: Level): LevelGeometry {
  const batches = new Map<TextureKey, QuadBatch>();
  const batch = (key: TextureKey) => {
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { positions: [], uvs: [], indices: [] }));
    return b;
  };
  const doors: DoorGeometry[] = [];
  const { width, depth, height: h, cells } = level;
  const at = (x: number, y: number): Cell | undefined =>
    x < 0 || y < 0 || x >= width || y >= depth ? undefined : cells[y * width + x];
  const solid = (c: Cell | undefined) => !c || c.kind === 'wall';

  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = cells[i];
      const wallKey = `wall:${c.wallTex}`;

      if (c.kind === 'wall') {
        // Beside water or a pit the wall stands at the floor's level; below it are the chasm's own sides.
        for (const s of SIDES) {
          if (!solid(at(x + s.dx, y + s.dy))) sideFace(batch(wallKey), x, y, s.normal, 0, h);
        }
        continue;
      }

      // Floor (or chasm surface) and ceiling.
      if (c.chasm) {
        const tex = level.chasmTextures[c.chasm];
        const key = tex !== undefined ? `wall:${tex}` : `floor:${c.floorTex}`;
        const d = chasmDepth(c, h);
        horizontal(batch(c.chasm === 'dry' ? key : `liquid:${c.chasm}`), x, y, d, true);
        // Its sides show the top of the chasm's wall texture, as deep as it is: Arena's water and lava
        // textures are stone above the waterline and black below, a pit's the whole height of a room.
        // As in Arena they are drawn on every side but another chasm's, so a wall that comes down
        // into the water shows the chasm's stone below the floor's level, not its own.
        for (const s of SIDES) {
          if (!at(x + s.dx, y + s.dy)?.chasm) sideFace(batch(key), x, y, s.normal, d, 0, true, 1, false, 1 + d / h);
        }
      } else if (c.kind !== 'raised') {
        horizontal(batch(`floor:${c.floorTex}`), x, y, 0, true);
      }
      horizontal(batch(`floor:${level.ceilingTex}`), x, y, h, false);

      switch (c.kind) {
        case 'raised': {
          const bottom = c.raisedBottom ?? 0;
          const top = Math.max(bottom, c.raisedTop ?? h);
          for (const s of SIDES) {
            if (!solid(at(x + s.dx, y + s.dy))) sideFace(batch(wallKey), x, y, s.normal, bottom, top, false, (top - bottom) / h);
          }
          const capKey = c.capTex === undefined ? wallKey : `${c.capIsWall ? 'wall' : 'floor'}:${c.capTex}`;
          horizontal(batch(capKey), x, y, top, true);
          // A platform off the floor shows its underside, in the ceiling's texture, and the floor beneath.
          if (bottom > 0) {
            horizontal(batch(`floor:${level.ceilingTex}`), x, y, bottom, false);
            horizontal(batch(`floor:${c.floorTex}`), x, y, 0, true);
          }
          break;
        }
        case 'edge': {
          const e = c.edge!;
          sideFace(batch(`glass:${c.wallTex}`), x, y, SIDE_NORMALS[e.side], e.lift, Math.min(h, e.lift + h), false, 1, true);
          break;
        }
        case 'transparent':
          for (const s of SIDES) sideFace(batch(`glass:${c.wallTex}`), x, y, s.normal, 0, h);
          break;
        case 'diagonal':
          diagonal(batch(wallKey), x, y, h, !!c.diagonalFlip);
          break;
        case 'door': {
          const b: QuadBatch = { positions: [], uvs: [], indices: [] };
          const panels: DoorPanel[] = [];
          // Faces against a wall are never seen, and would flicker through a barred door.
          for (const s of SIDES) {
            if (solid(at(x + s.dx, y + s.dy))) continue;
            sideFace(b, x, y, s.normal, 0, h);
            const panel: QuadBatch = { positions: [], uvs: [], indices: [] };
            const [nx, , nz] = s.normal;
            // The face's left end seen from outside is its centre less half its rightward direction (nz, -nx).
            const hx = x + 0.5 + nx * 0.5 - nz * 0.5;
            const hz = y + 0.5 + nz * 0.5 + nx * 0.5;
            const gap: V3 = [nz * HINGE_GAP, 0, -nx * HINGE_GAP];
            sideFace(panel, x, y, s.normal, 0, h);
            for (let k = 0; k < panel.positions.length; k += 3) {
              panel.positions[k] += gap[0];
              panel.positions[k + 2] += gap[2];
            }
            panels.push({ batch: panel, hinge: { x: hx + gap[0], z: hz + gap[2] }, normal: { x: nx, z: nz } });
          }
          // A sliding door goes into the walls beside it.
          const alongX = solid(at(x - 1, y)) || solid(at(x + 1, y));
          doors.push({ cellIndex: i, x, y, key: c.seeThrough ? `glass:${c.wallTex}` : wallKey, batch: b, panels, kind: c.door ?? 'raising', alongX });
          break;
        }
        default:
          break;
      }
    }
  }
  return { batches, doors };
}

function quad(b: QuadBatch, bl: V3, br: V3, tr: V3, tl: V3, uv: [number, number, number, number]) {
  const base = b.positions.length / 3;
  b.positions.push(...bl, ...br, ...tr, ...tl);
  const [u0, v0, u1, v1] = uv;
  b.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
  b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * A vertical face on the side of cell (x, y) given by its outward normal,
 * spanning y0..y1 vertically. vTop < 1 shows only the lower part of the
 * tile, so short faces (platform sides) are not squashed; vBottom > 0 only
 * the upper part.
 */
function sideFace(b: QuadBatch, x: number, y: number, n: V3, y0: number, y1: number, inward = false, vTop = 1, inset = false, vBottom = 0) {
  // An inset face sits just inside the cell's edge (fences), not on it.
  const out = inset ? 0.49 : 0.5;
  const cx = x + 0.5 + n[0] * out;
  const cz = y + 0.5 + n[2] * out;
  // Viewer looks along -n; their right is (-n) x up = (n.z, 0, -n.x).
  let rx = n[2];
  let rz = -n[0];
  if (inward) {
    rx = -rx;
    rz = -rz;
  }
  quad(
    b,
    [cx - rx * 0.5, y0, cz - rz * 0.5],
    [cx + rx * 0.5, y0, cz + rz * 0.5],
    [cx + rx * 0.5, y1, cz + rz * 0.5],
    [cx - rx * 0.5, y1, cz - rz * 0.5],
    [0, vBottom, 1, vTop],
  );
}

function horizontal(b: QuadBatch, x: number, y: number, at: number, up: boolean) {
  if (up) quad(b, [x, at, y + 1], [x + 1, at, y + 1], [x + 1, at, y], [x, at, y], [0, 0, 1, 1]);
  else quad(b, [x, at, y], [x + 1, at, y], [x + 1, at, y + 1], [x, at, y + 1], [0, 0, 1, 1]);
}

function diagonal(b: QuadBatch, x: number, y: number, h: number, flip: boolean) {
  const a: V3 = flip ? [x + 1, 0, y] : [x, 0, y];
  const c: V3 = flip ? [x, 0, y + 1] : [x + 1, 0, y + 1];
  quad(b, a, c, [c[0], h, c[2]], [a[0], h, a[2]], [0, 0, 1, 1]);
}
