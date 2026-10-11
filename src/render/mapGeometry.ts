/**
 * The explored part of a level for the 3D map: floors, water and the walls
 * around them, as in the dungeon but with no ceiling and every wall cut
 * down to the same low height with a dark top, so the rooms can be seen
 * from above. Faces are shaded by the way they face, as if lit from the
 * north-west, so walls stand out from floors. Kept free of WebGL so it can
 * be unit tested; mapView.ts turns the groups into meshes.
 */
import type { Cell, Level } from '../game/level';
import type { TextureKey } from './levelGeometry';

export interface ShadedBatch {
  positions: number[];
  uvs: number[];
  /** RGB per vertex, 0 to 1. */
  colors: number[];
  indices: number[];
}

/** Texture key for the dark tops of cut-down walls. */
export const CAP_KEY = 'cap';

type V3 = [number, number, number];

/** A cell's four sides: north, east, south, west. */
const SIDES: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** Brightness of an upright face that looks toward (dx, dy), lit from the north-west. */
function shadeFor(dx: number, dy: number): number {
  if (dy < 0) return 1;
  if (dx < 0) return 0.86;
  if (dx > 0) return 0.72;
  return 0.62;
}
const FLOOR_SHADE = 0.8;
const LIQUID_DEPTH = 0.06;
const PIT_DEPTH = 0.3;

export function buildMapGeometry(level: Level, seen: (cell: number) => boolean, openDoors: Set<number>, wallHeight: number): Map<TextureKey, ShadedBatch> {
  const batches = new Map<TextureKey, ShadedBatch>();
  const batch = (key: TextureKey) => {
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { positions: [], uvs: [], colors: [], indices: [] }));
    return b;
  };
  const { width, depth, cells } = level;
  const at = (x: number, y: number): Cell | undefined => (x < 0 || y < 0 || x >= width || y >= depth ? undefined : cells[y * width + x]);
  const capped = new Set<number>();
  const vTop = Math.min(1, wallHeight / level.height);
  /** A cut-down block filling cell (x, y): sides toward open cells, and its top. */
  const block = (x: number, y: number, key: TextureKey, height: number) => {
    for (const s of SIDES) {
      const n = at(x + s.dx, y + s.dy);
      if (n && !isSolid(n, openDoors, (y + s.dy) * width + x + s.dx)) side(batch(key), x, y, s.dx, s.dy, 0, height, shadeFor(s.dx, s.dy), height / level.height);
    }
    flat(batch(CAP_KEY), x, y, height, 1);
  };

  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = cells[i];
      if (!seen(i) || isSolid(c, openDoors, i)) continue;

      if (c.chasm) {
        const tex = level.chasmTextures[c.chasm];
        const key = tex !== undefined ? `wall:${tex}` : `floor:${c.floorTex}`;
        const d = c.chasm === 'dry' ? -PIT_DEPTH : -LIQUID_DEPTH;
        flat(batch(c.chasm === 'dry' ? key : `liquid:${c.chasm}`), x, y, d, c.chasm === 'dry' ? 0.45 : 1);
        for (const s of SIDES) {
          const n = at(x + s.dx, y + s.dy);
          if (n && !n.chasm) side(batch(key), x, y, s.dx, s.dy, d, 0, shadeFor(-s.dx, -s.dy) * 0.6, -d / level.height, true);
        }
      } else if (c.kind === 'raised') {
        const top = Math.min((c.raisedHeight ?? 1) * level.height, wallHeight);
        for (const s of SIDES) side(batch(`wall:${c.wallTex}`), x, y, s.dx, s.dy, 0, top, shadeFor(s.dx, s.dy), top / level.height);
        const capKey = c.capTex === undefined ? `wall:${c.wallTex}` : `${c.capIsWall ? 'wall' : 'floor'}:${c.capTex}`;
        flat(batch(capKey), x, y, top, 1);
      } else {
        flat(batch(`floor:${c.floorTex}`), x, y, 0, FLOOR_SHADE);
      }

      // The walls, closed doors and bars around this open cell.
      for (const s of SIDES) {
        const nx = x + s.dx;
        const ny = y + s.dy;
        const n = at(nx, ny);
        const ni = ny * width + nx;
        if (!n || !isSolid(n, openDoors, ni)) continue;
        if (n.kind === 'wall') {
          // Seen from this cell: the face of the wall toward it, then the wall's top.
          side(batch(`wall:${n.wallTex}`), x, y, s.dx, s.dy, 0, wallHeight, shadeFor(-s.dx, -s.dy), vTop, true);
          if (!capped.has(ni)) {
            capped.add(ni);
            flat(batch(CAP_KEY), nx, ny, wallHeight, 1);
          }
        } else if (!capped.has(ni)) {
          capped.add(ni);
          block(nx, ny, n.kind === 'door' && n.seeThrough ? `glass:${n.wallTex}` : `wall:${n.wallTex}`, wallHeight);
        }
      }
    }
  }
  return batches;
}

/** Cells drawn as cut-down blocks: walls, closed doors, bars and diagonal walls. */
function isSolid(c: Cell, openDoors: Set<number>, i: number): boolean {
  if (c.kind === 'door') return !openDoors.has(i);
  return c.kind === 'wall' || c.kind === 'transparent' || c.kind === 'diagonal';
}

function quad(b: ShadedBatch, corners: [V3, V3, V3, V3], uv: [number, number, number, number], shade: number) {
  const base = b.positions.length / 3;
  for (const c of corners) b.positions.push(...c);
  const [u0, v0, u1, v1] = uv;
  b.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
  for (let k = 0; k < 4; k++) b.colors.push(shade, shade, shade);
  b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A floor-like square over cell (x, y) at height h, facing up. */
function flat(b: ShadedBatch, x: number, y: number, h: number, shade: number) {
  quad(b, [[x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y], [x, h, y]], [0, 0, 1, 1], shade);
}

/**
 * An upright face on the (dx, dy) edge of cell (x, y) from height y0 to y1,
 * facing out of the cell, or into it when `inward`.
 */
function side(b: ShadedBatch, x: number, y: number, dx: number, dy: number, y0: number, y1: number, shade: number, vTop: number, inward = false) {
  const cx = x + 0.5 + dx * 0.5;
  const cz = y + 0.5 + dy * 0.5;
  // Looking at the face from outside, its right-hand edge is along (dy, -dx).
  let rx = dy;
  let rz = -dx;
  if (inward) {
    rx = -rx;
    rz = -rz;
  }
  quad(
    b,
    [
      [cx - rx * 0.5, y0, cz - rz * 0.5],
      [cx + rx * 0.5, y0, cz + rz * 0.5],
      [cx + rx * 0.5, y1, cz + rz * 0.5],
      [cx - rx * 0.5, y1, cz - rz * 0.5],
    ],
    [0, 0, 1, vTop],
    shade,
  );
}
