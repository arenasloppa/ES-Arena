/**
 * First-person movement on the voxel grid. Pure logic (no Three.js) so it
 * can be unit tested. Positions are in voxel units: x along MIF columns,
 * y along MIF rows.
 */
import { isBlocking, type Level } from './level';

export interface PlayerState {
  x: number;
  y: number;
  /** Radians; 0 looks along +x, positive turns toward +y. */
  yaw: number;
  pitch: number;
}

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1, positive = right
  run: boolean;
}

export const PLAYER_RADIUS = 0.2;
const WALK_SPEED = 2.2; // voxels per second
const RUN_FACTOR = 1.9;

export function cellIndex(level: Level, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= level.width || cy >= level.depth) return -1;
  return cy * level.width + cx;
}

export function blockedAt(level: Level, x: number, y: number, openDoors: Set<number>): boolean {
  const r = PLAYER_RADIUS;
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    const i = cellIndex(level, x + dx, y + dy);
    if (i < 0 || isBlocking(level.cells[i], openDoors, i)) return true;
  }
  return false;
}

/** Moves the player, sliding along walls one axis at a time. */
export function step(level: Level, p: PlayerState, input: MoveInput, dt: number, openDoors: Set<number>): void {
  const speed = WALK_SPEED * (input.run ? RUN_FACTOR : 1) * dt;
  const fx = Math.cos(p.yaw);
  const fy = Math.sin(p.yaw);
  // Right-hand vector, perpendicular to forward.
  const rx = -fy;
  const ry = fx;
  let dx = (fx * input.forward + rx * input.strafe) * speed;
  let dy = (fy * input.forward + ry * input.strafe) * speed;
  const len = Math.hypot(dx, dy);
  if (len > speed && len > 0) {
    dx = (dx / len) * speed;
    dy = (dy / len) * speed;
  }
  if (!blockedAt(level, p.x + dx, p.y, openDoors)) p.x += dx;
  if (!blockedAt(level, p.x, p.y + dy, openDoors)) p.y += dy;
}

/** Returns the index of the first door cell within reach in front of the player, if any. */
export function doorInFront(level: Level, p: PlayerState, reach = 1.4): number | undefined {
  const fx = Math.cos(p.yaw);
  const fy = Math.sin(p.yaw);
  for (let t = 0.1; t <= reach; t += 0.05) {
    const i = cellIndex(level, p.x + fx * t, p.y + fy * t);
    if (i < 0) return undefined;
    const c = level.cells[i];
    if (c.kind === 'door') return i;
    if (c.kind === 'wall' || c.kind === 'transparent' || c.kind === 'diagonal') return undefined;
  }
  return undefined;
}
