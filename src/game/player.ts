/**
 * First-person movement on the voxel grid. Pure logic (no Three.js) so it
 * can be unit tested. Positions are in voxel units: x along MIF columns,
 * y along MIF rows; z is the height of the feet in world units (see
 * level.ts), 0 on the floor.
 *
 * As in Arena (OpenTESArena's reading of it): a step of up to 32 Arena
 * units is walked up, anything taller needs a jump (30 units up: 10, 8, 6,
 * 4 and 2 a frame); the player stands on raised platforms and walks under
 * those high enough; water and pits are dropped into and can't be walked
 * out of, only climbed out of (see dungeon.ts).
 */
import { blockedFor, cellIndex } from './grid';
import { ARENA_HEIGHT, floorHeight, isBlocking, PLAYER_HEIGHT, STEP_HEIGHT, type Cell, type Level } from './level';

export { cellIndex };

export interface PlayerState {
  x: number;
  y: number;
  /** Radians; 0 looks along +x, positive turns toward +y. */
  yaw: number;
  pitch: number;
  /** Height of the feet above the floor, in world units; 0 when unset. */
  z?: number;
  /** Upward speed while in the air. */
  vz?: number;
}

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1, positive = right
  run: boolean;
  /** Multiplies the speed: quicker characters move faster, swimmers slower. */
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
/** How high a jump goes: 30 Arena units. */
export const JUMP_HEIGHT = 30 * ARENA_HEIGHT;
/** Seconds from leaving the floor to landing back on it after a jump. */
export const JUMP_TIME = 0.55;
const GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);
/** A little leeway when comparing heights. */
const EPSILON = 0.002;

export function blockedAt(level: Level, x: number, y: number, openDoors: Set<number>): boolean {
  return blockedFor(level, x, y, PLAYER_RADIUS, openDoors);
}

/** True while the player is down in a chasm (water, lava or a pit), below the floor around it. */
export function inChasm(level: Level, p: PlayerState): boolean {
  const cell = level.cells[cellIndex(level, p.x, p.y)];
  return !!cell?.chasm && (p.z ?? 0) < -EPSILON;
}

/**
 * True when a player with feet at z can't be in the cell: walls and the
 * like, platforms too high to step onto that leave no room beneath, and
 * from down in a chasm any cell that isn't one (it must be climbed out of).
 */
function blocksPlayer(level: Level, cell: Cell | undefined, index: number, z: number, openDoors: Set<number>, fromChasm: boolean): boolean {
  if (!cell) return true;
  if (cell.kind === 'raised') {
    if (fromChasm) return true;
    const bottom = cell.raisedBottom ?? 0;
    const top = cell.raisedTop ?? level.height;
    return top > z + STEP_HEIGHT + EPSILON && bottom < z + PLAYER_HEIGHT;
  }
  if (isBlocking(cell, openDoors, index)) return true;
  return fromChasm && !cell.chasm;
}

export function playerBlocked(level: Level, x: number, y: number, z: number, openDoors: Set<number>, fromChasm = false): boolean {
  const r = PLAYER_RADIUS;
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    const i = cellIndex(level, x + dx, y + dy);
    if (i < 0 || blocksPlayer(level, level.cells[i], i, z, openDoors, fromChasm)) return true;
  }
  return false;
}

/**
 * After dropping into water or a pit, moves the player in from its edge if
 * they hang over the floor beside it, which they couldn't then move from at
 * all (the drop comes when most of them is over the hole, the walls feel
 * all of them). Returns true when it moved them.
 */
export function keepInChasm(level: Level, p: PlayerState, openDoors: Set<number>): boolean {
  if (!inChasm(level, p) || !playerBlocked(level, p.x, p.y, p.z ?? 0, openDoors, true)) return false;
  const r = PLAYER_RADIUS + EPSILON;
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  p.x = Math.min(Math.max(p.x, cx + r), cx + 1 - r);
  p.y = Math.min(Math.max(p.y, cy + r), cy + 1 - r);
  return true;
}

/** The floor under the player: the highest floor beneath any part of them that they can stand on from where they are. */
export function groundUnder(level: Level, p: PlayerState): number {
  const z = p.z ?? 0;
  const r = PLAYER_RADIUS * 0.7;
  let ground = -Infinity;
  for (const [dx, dy] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
    const cell = level.cells[cellIndex(level, p.x + dx, p.y + dy)];
    const h = floorHeight(cell, level);
    // A floor above the head (the underside of a floating platform) isn't stood on.
    if (h <= z + STEP_HEIGHT + EPSILON) ground = Math.max(ground, h);
  }
  return ground === -Infinity ? 0 : ground;
}

/**
 * Moves the feet up or down: up onto a step, or falling to the floor under
 * gravity. Returns how far the player fell when they land, 0 otherwise.
 */
export function settle(level: Level, p: PlayerState, dt: number): number {
  const ground = groundUnder(level, p);
  let z = p.z ?? 0;
  let vz = p.vz ?? 0;
  let fell = 0;
  if (z <= ground + EPSILON && vz <= 0) {
    z = ground;
    vz = 0;
  } else {
    const before = z;
    vz -= GRAVITY * dt;
    z += vz * dt;
    if (z <= ground) {
      fell = Math.max(0, before - ground);
      z = ground;
      vz = 0;
    }
  }
  p.z = z;
  p.vz = vz;
  return fell;
}

/** Leaves the floor in a jump; false when already in the air. */
export function jump(level: Level, p: PlayerState): boolean {
  if (airborne(level, p)) return false;
  p.vz = (4 * JUMP_HEIGHT) / JUMP_TIME;
  return true;
}

/** True while in the air. */
export function airborne(level: Level, p: PlayerState): boolean {
  return (p.vz ?? 0) !== 0 || (p.z ?? 0) > groundUnder(level, p) + EPSILON;
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
  const z = p.z ?? 0;
  const fromChasm = inChasm(level, p);
  if (!playerBlocked(level, p.x + dx, p.y, z, openDoors, fromChasm) && !bumps(bodies, p.x, p.y, p.x + dx, p.y)) p.x += dx;
  if (!playerBlocked(level, p.x, p.y + dy, z, openDoors, fromChasm) && !bumps(bodies, p.x, p.y, p.x, p.y + dy)) p.y += dy;
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
