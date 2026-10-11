/**
 * What the player has seen of a level, for the map screen and the minimap.
 * Rays go out all around the player; every cell they cross within sight is
 * marked seen, and so is the wall, closed door or gate that stops them.
 */
import { isSeeThrough, type Level } from './level';

/** How far the player sees in the dark, in voxels; the fog ends a little further. */
export const SIGHT_RANGE = 6;

export class Exploration {
  /** 1 for each cell seen, by cell index. */
  readonly seen: Uint8Array;
  /** Goes up whenever a cell is first seen, so maps know to redraw. */
  version = 0;

  constructor(private readonly level: Level) {
    this.seen = new Uint8Array(level.width * level.depth);
  }

  has(cell: number): boolean {
    return this.seen[cell] === 1;
  }

  /** Marks what can be seen from (x, y); returns how many cells were new. */
  look(x: number, y: number, openDoors: Set<number>, range = SIGHT_RANGE, rays = 160): number {
    let added = this.mark(Math.floor(x), Math.floor(y));
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2;
      added += this.cast(x, y, Math.cos(a), Math.sin(a), range, openDoors);
    }
    if (added) this.version++;
    return added;
  }

  /** Walks one ray cell by cell (Amanatides and Woo) until something blocks it or it runs out. */
  private cast(x: number, y: number, dx: number, dy: number, range: number, openDoors: Set<number>): number {
    const { width, depth, cells } = this.level;
    let cx = Math.floor(x);
    let cy = Math.floor(y);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
    let tMaxX = dx === 0 ? Infinity : (dx > 0 ? cx + 1 - x : x - cx) * tDeltaX;
    let tMaxY = dy === 0 ? Infinity : (dy > 0 ? cy + 1 - y : y - cy) * tDeltaY;
    let added = 0;
    for (;;) {
      let t: number;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        cy += stepY;
      }
      if (t > range || cx < 0 || cy < 0 || cx >= width || cy >= depth) return added;
      added += this.mark(cx, cy);
      const i = cy * width + cx;
      if (!isSeeThrough(cells[i], openDoors, i)) return added;
    }
  }

  private mark(cx: number, cy: number): number {
    const { width, depth } = this.level;
    if (cx < 0 || cy < 0 || cx >= width || cy >= depth) return 0;
    const i = cy * width + cx;
    if (this.seen[i]) return 0;
    this.seen[i] = 1;
    return 1;
  }
}
