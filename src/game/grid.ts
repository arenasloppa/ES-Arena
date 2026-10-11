/**
 * Grid queries shared by the player, the creatures and the map: who can
 * stand where, what can be seen from where, and the way from one cell to
 * another. Pure logic, positions in voxel units.
 */
import { isBlocking, isSeeThrough, type Level } from './level';

export function cellIndex(level: Level, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= level.width || cy >= level.depth) return -1;
  return cy * level.width + cx;
}

/** True when a body of radius r centred at (x, y) would overlap something solid. */
export function blockedFor(level: Level, x: number, y: number, r: number, openDoors: Set<number>, avoid?: (cell: number) => boolean): boolean {
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    const i = cellIndex(level, x + dx, y + dy);
    if (i < 0 || isBlocking(level.cells[i], openDoors, i) || avoid?.(i)) return true;
  }
  return false;
}

/** True when nothing solid stands between the two points (open doors and bars don't block sight). */
export function lineOfSight(level: Level, x0: number, y0: number, x1: number, y1: number, openDoors: Set<number>): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / 0.2);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const i = cellIndex(level, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    if (i < 0 || !isSeeThrough(level.cells[i], openDoors, i)) return false;
  }
  return true;
}

/**
 * Breadth-first search from one cell to another over cells `walkable` allows,
 * looking at no more than `limit` cells. Returns the first cell to step to,
 * the goal itself when it is next door, or undefined when there is no way.
 */
export function nextStep(level: Level, from: number, to: number, walkable: (cell: number) => boolean, limit = 600): number | undefined {
  if (from === to) return to;
  const { width } = level;
  const cameFrom = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length && cameFrom.size < limit; head++) {
    const c = queue[head];
    const x = c % width;
    for (const n of [c - width, c + width, x > 0 ? c - 1 : -1, x < width - 1 ? c + 1 : -1]) {
      if (n < 0 || n >= level.cells.length || cameFrom.has(n)) continue;
      if (n !== to && !walkable(n)) continue;
      cameFrom.set(n, c);
      if (n === to) {
        let step = n;
        while (cameFrom.get(step) !== from) step = cameFrom.get(step)!;
        return step;
      }
      queue.push(n);
    }
  }
  return undefined;
}
