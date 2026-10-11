/**
 * First-person movement on the voxel grid. Pure logic (no Three.js) so it
 * can be unit tested. Positions are in voxel units: x along MIF columns,
 * y along MIF rows.
 */
import { blockedFor, cellIndex } from './grid';
import type { Level } from './level';

export { cellIndex };

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
  /** Multiplies the speed: quicker characters move faster. */
  pace?: number;
}

/** Something round the player can't walk through, such as a creature. */
export interface Body {
  x: number;
  y: number;
  r: number;
}

export const PLAYER_RADIUS = 0.2;
const WALK_SPEED = 2.2; // voxels per second
const RUN_FACTOR = 1.9;

export function blockedAt(level: Level, x: number, y: number, openDoors: Set<number>): boolean {
  return blockedFor(level, x, y, PLAYER_RADIUS, openDoors);
}

/** True when moving from (x0, y0) to (x1, y1) pushes further into a body. */
function bumps(bodies: Body[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (const b of bodies) {
    const reach = b.r + PLAYER_RADIUS;
    const after = Math.hypot(b.x - x1, b.y - y1);
    if (after < reach && after < Math.hypot(b.x - x0, b.y - y0)) return true;
  }
  return false;
}

/** Moves the player, sliding along walls (and around bodies) one axis at a time. */
export function step(level: Level, p: PlayerState, input: MoveInput, dt: number, openDoors: Set<number>, bodies: Body[] = []): void {
  const speed = WALK_SPEED * (input.run ? RUN_FACTOR : 1) * (input.pace ?? 1) * dt;
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
  if (!blockedAt(level, p.x + dx, p.y, openDoors) && !bumps(bodies, p.x, p.y, p.x + dx, p.y)) p.x += dx;
  if (!blockedAt(level, p.x, p.y + dy, openDoors) && !bumps(bodies, p.x, p.y, p.x, p.y + dy)) p.y += dy;
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

/** A hop off the floor; height is above the floor, in room-height units like the level. */
export interface Jump {
  height: number;
  speed: number;
}

/** Starts a jump that peaks at `apex` halfway through `duration` seconds; false if already in the air. */
export function startJump(j: Jump, apex: number, duration: number): boolean {
  if (j.height > 0 || j.speed !== 0) return false;
  j.speed = (4 * apex) / duration;
  return true;
}

export function stepJump(j: Jump, apex: number, duration: number, dt: number): void {
  if (j.height <= 0 && j.speed === 0) return;
  j.speed -= ((8 * apex) / (duration * duration)) * dt;
  j.height += j.speed * dt;
  if (j.height <= 0) {
    j.height = 0;
    j.speed = 0;
  }
}
