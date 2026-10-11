/**
 * Creatures and what they do each moment. Pure logic (no Three.js) so it
 * can be unit tested; the renderer asks creatureFrame() which sprite to draw.
 *
 * A creature stands about, looks around and wanders to nearby cells. Once
 * it sees the player it gives chase: straight at them in the open, the
 * shortest way round corners otherwise. A player who sneaks is seen only
 * from close by, and then only bit by bit, as in Skyrim: slowly from behind
 * the creature, quickly in front of it. In reach it swings, and it gives up
 * when it has not seen the player for a while. Hurting a creature always
 * makes it chase, and a bash knocks it back out of its swing. Dying plays
 * the death frames and leaves a body, unless the creature has none (ghosts).
 *
 * Arena's creature sprites: in each of the five view files, frames 0-5 walk,
 * 6 and 7 look left and right, and 8 on (in the front view at least) attack.
 * The sixth file is the death: two frames of falling, then the body.
 */
import type { CreatureInfo } from '../formats/exe';
import { creatureHitChance, roll } from './combat';
import { blockedFor, cellIndex, lineOfSight, nextStep } from './grid';
import { isBlocking, type Level } from './level';

export type CreatureState = 'idle' | 'look' | 'wander' | 'chase' | 'attack' | 'dying' | 'dead';

export interface Creature {
  id: number;
  info: CreatureInfo;
  x: number;
  y: number;
  /** Radians, like the player's yaw: 0 faces +x (east). */
  facing: number;
  health: number;
  maxHealth: number;
  state: CreatureState;
  /** Seconds since the state began. */
  time: number;
  /** How long the current idle or look lasts. */
  span: number;
  /** Walk cycle position, in frames. */
  stride: number;
  /** Where the creature is walking to. */
  goal?: { x: number; y: number };
  /** Seconds before it may swing again. */
  cooldown: number;
  /** Seconds since it last saw the player. */
  unseen: number;
  /** Set once the current swing has landed or missed. */
  struck: boolean;
  /** Seconds since it was last hurt. */
  hurt: number;
  /** When (world seconds) a chase re-plans its route round corners. */
  replan: number;
  /** How close a calm creature is to noticing a sneaking player, 0 to 1. */
  awareness: number;
}

export interface CreatureWorld {
  level: Level;
  openDoors: Set<number>;
  player: { x: number; y: number; level: number };
  /** Sneaking players are noticed from closer. */
  sneaking: boolean;
  /** Seconds of game time. */
  now: number;
  random: () => number;
  /** Every creature, to keep out of each other's way. */
  creatures: Creature[];
}

export interface CreatureEvents {
  /** Spotted the player and starts the chase. */
  notice?(c: Creature): void;
  /** Starts a swing. */
  swing?(c: Creature): void;
  /** The swing lands for `damage`, or misses (0). */
  strike?(c: Creature, damage: number): void;
}

export const CREATURE_RADIUS = 0.25;
/** Closest a creature comes to the player's centre. */
const PERSONAL_SPACE = 0.55;
const SIGHT = 7;
/** A sneaking player is seen only this close, and not at once. */
export const SNEAK_SIGHT = 4.5;
/** Awareness gained per second at the edge of SNEAK_SIGHT and, added, right next to the creature. */
const NOTICE_FAR = 0.35;
const NOTICE_NEAR = 1.6;
/** Behind a creature (past this angle from where it faces), a sneaking player is noticed this much slower. */
const BEHIND = (100 * Math.PI) / 180;
const BEHIND_FACTOR = 0.35;
/** Awareness lost per second while the creature cannot see the player. */
const FORGET = 0.25;
const REACH = 1.05;
const WANDER_SPEED = 0.9;
const CHASE_SPEED = 1.7;
export const ATTACK_TIME = 0.7;
const STRIKE_AT = 0.4;
const GIVE_UP = 8;
const DYING_TIME = 0.5;
const STAGGER_TIME = 0.8;
/** How far a bash shoves a creature back. */
const SHOVE = 0.35;
/** Walk frames per voxel walked. */
const STRIDE = 5;

export function spawnCreature(id: number, info: CreatureInfo, x: number, y: number, random: () => number): Creature {
  const health = roll(random, info.health[0], info.health[1]);
  return {
    id,
    info,
    x,
    y,
    facing: random() * Math.PI * 2,
    health,
    maxHealth: health,
    state: 'idle',
    time: 0,
    span: 1 + random() * 3,
    stride: 0,
    cooldown: 0,
    unseen: Infinity,
    struck: false,
    hurt: Infinity,
    replan: 0,
    awareness: 0,
  };
}

export const isAlive = (c: Creature) => c.state !== 'dying' && c.state !== 'dead';

/** Going about its business, unaware of the player. */
export const isCalm = (c: Creature) => c.state === 'idle' || c.state === 'look' || c.state === 'wander';

function setState(c: Creature, state: CreatureState, span = 0): void {
  c.state = state;
  c.time = 0;
  c.span = span;
}

/** Cells creatures won't walk into: pits and lava. */
function avoids(level: Level, cell: number): boolean {
  const chasm = level.cells[cell]?.chasm;
  return chasm === 'dry' || chasm === 'lava';
}

function canSee(c: Creature, w: CreatureWorld, range: number): boolean {
  const d = Math.hypot(w.player.x - c.x, w.player.y - c.y);
  return d <= range && lineOfSight(w.level, c.x, c.y, w.player.x, w.player.y, w.openDoors);
}

export function updateCreature(c: Creature, w: CreatureWorld, dt: number, events: CreatureEvents = {}): void {
  c.time += dt;
  c.hurt += dt;
  c.cooldown = Math.max(0, c.cooldown - dt);
  if (c.state === 'dead') return;
  if (c.state === 'dying') {
    if (c.time >= DYING_TIME) setState(c, 'dead');
    return;
  }

  const dist = Math.hypot(w.player.x - c.x, w.player.y - c.y);
  if (isCalm(c)) {
    if (!w.sneaking && canSee(c, w, SIGHT)) c.awareness = 1;
    else if (w.sneaking && canSee(c, w, SNEAK_SIGHT)) {
      let rate = NOTICE_FAR + NOTICE_NEAR * (1 - dist / SNEAK_SIGHT);
      const toPlayer = Math.atan2(w.player.y - c.y, w.player.x - c.x) - c.facing;
      if (Math.abs(Math.atan2(Math.sin(toPlayer), Math.cos(toPlayer))) > BEHIND) rate *= BEHIND_FACTOR;
      c.awareness = Math.min(1, c.awareness + rate * dt);
    } else c.awareness = Math.max(0, c.awareness - FORGET * dt);
    if (c.awareness >= 1) {
      alert(c, w);
      events.notice?.(c);
    }
  }

  switch (c.state) {
    case 'idle':
      if (c.time >= c.span) {
        if (w.random() < 0.35) setState(c, 'look', 1.2);
        else wanderSomewhere(c, w);
      }
      break;
    case 'look':
      if (c.time >= c.span) setState(c, 'idle', 1.5 + w.random() * 3);
      break;
    case 'wander': {
      const goal = c.goal;
      if (!goal || c.time > 6 || !moveToward(c, goal.x, goal.y, WANDER_SPEED, dt, w)) setState(c, 'idle', 1.5 + w.random() * 3);
      break;
    }
    case 'chase': {
      const sees = canSee(c, w, SIGHT * 1.5);
      c.unseen = sees ? 0 : c.unseen + dt;
      if (c.unseen > GIVE_UP) {
        setState(c, 'idle', 2);
        break;
      }
      if (dist <= REACH && sees) {
        c.facing = Math.atan2(w.player.y - c.y, w.player.x - c.x);
        if (c.cooldown <= 0) {
          setState(c, 'attack');
          c.struck = false;
          events.swing?.(c);
        }
        break;
      }
      const arrived = c.goal && Math.hypot(c.goal.x - c.x, c.goal.y - c.y) < 0.1;
      if (sees) c.goal = { x: w.player.x, y: w.player.y };
      else if (w.now >= c.replan || !c.goal || arrived) {
        c.replan = w.now + 0.4;
        const step = nextStep(w.level, cellIndex(w.level, c.x, c.y), cellIndex(w.level, w.player.x, w.player.y), (i) => !isBlocking(w.level.cells[i], w.openDoors, i) && !avoids(w.level, i));
        if (step !== undefined) c.goal = { x: (step % w.level.width) + 0.5, y: Math.floor(step / w.level.width) + 0.5 };
      }
      if (c.goal) moveToward(c, c.goal.x, c.goal.y, CHASE_SPEED, dt, w);
      break;
    }
    case 'attack':
      c.facing = Math.atan2(w.player.y - c.y, w.player.x - c.x);
      if (!c.struck && c.time >= STRIKE_AT) {
        c.struck = true;
        const lands = dist <= REACH + 0.35 && w.random() < creatureHitChance(c.info.level, w.player.level);
        events.strike?.(c, lands ? roll(w.random, c.info.damage[0], c.info.damage[1]) : 0);
      }
      if (c.time >= ATTACK_TIME) {
        setState(c, 'chase');
        c.cooldown = 0.5 + w.random() * 0.9;
      }
      break;
  }
}

function alert(c: Creature, w: CreatureWorld): void {
  setState(c, 'chase');
  c.unseen = 0;
  c.awareness = 1;
  c.goal = { x: w.player.x, y: w.player.y };
}

/**
 * Hurts a creature; returns true when the blow kills it. A staggering blow
 * (a power attack) also stops a swing that has not landed yet.
 */
export function hurtCreature(c: Creature, damage: number, w: CreatureWorld, stagger = false): boolean {
  if (!isAlive(c)) return false;
  c.health -= damage;
  c.hurt = 0;
  if (c.health <= 0) {
    c.health = 0;
    setState(c, 'dying');
    return true;
  }
  if (stagger && c.state === 'attack' && !c.struck) {
    setState(c, 'chase');
    c.cooldown = STAGGER_TIME;
  } else if (c.state !== 'attack' && c.state !== 'chase') alert(c, w);
  c.unseen = 0;
  return false;
}

/**
 * A bash: knocks the creature back a little from `from` and out of a swing
 * that has not landed yet, and makes it wait before swinging again.
 */
export function staggerCreature(c: Creature, w: CreatureWorld, from: { x: number; y: number }): void {
  if (!isAlive(c)) return;
  if (c.state !== 'chase' && c.state !== 'attack') alert(c, w);
  else if (c.state === 'attack' && !c.struck) setState(c, 'chase');
  c.cooldown = Math.max(c.cooldown, STAGGER_TIME);
  c.unseen = 0;
  const d = Math.hypot(c.x - from.x, c.y - from.y) || 1;
  const nx = c.x + ((c.x - from.x) / d) * SHOVE;
  const ny = c.y + ((c.y - from.y) / d) * SHOVE;
  const avoid = (i: number) => avoids(w.level, i);
  if (!blockedFor(w.level, nx, c.y, CREATURE_RADIUS, w.openDoors, avoid)) c.x = nx;
  if (!blockedFor(w.level, c.x, ny, CREATURE_RADIUS, w.openDoors, avoid)) c.y = ny;
}

function wanderSomewhere(c: Creature, w: CreatureWorld): void {
  const { level } = w;
  let cell = cellIndex(level, c.x, c.y);
  // A short random walk of one or two cells.
  for (let steps = 1 + Math.floor(w.random() * 2); steps > 0; steps--) {
    const options = [cell - level.width, cell + level.width, cell - 1, cell + 1].filter(
      (n) => n >= 0 && n < level.cells.length && !isBlocking(level.cells[n], w.openDoors, n) && !avoids(level, n),
    );
    if (!options.length) break;
    cell = options[Math.floor(w.random() * options.length)];
  }
  c.goal = { x: (cell % level.width) + 0.2 + w.random() * 0.6, y: Math.floor(cell / level.width) + 0.2 + w.random() * 0.6 };
  setState(c, 'wander');
}

/**
 * Walks toward a point, sliding along walls, keeping out of other creatures
 * and the player. Returns false once there (or stuck against something).
 */
function moveToward(c: Creature, gx: number, gy: number, speed: number, dt: number, w: CreatureWorld): boolean {
  const dx = gx - c.x;
  const dy = gy - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return false;
  c.facing = Math.atan2(dy, dx);
  const stepLen = Math.min(d, speed * dt);
  let mx = (dx / d) * stepLen;
  let my = (dy / d) * stepLen;
  // Keep a little apart from the others.
  for (const o of w.creatures) {
    if (o === c || !isAlive(o)) continue;
    const ox = c.x - o.x;
    const oy = c.y - o.y;
    const od = Math.hypot(ox, oy);
    if (od > 0 && od < CREATURE_RADIUS * 2) {
      mx += (ox / od) * stepLen * 0.5;
      my += (oy / od) * stepLen * 0.5;
    }
  }
  const avoid = (i: number) => avoids(w.level, i);
  const free = (x: number, y: number) => {
    if (blockedFor(w.level, x, y, CREATURE_RADIUS, w.openDoors, avoid)) return false;
    const pd = Math.hypot(w.player.x - x, w.player.y - y);
    return pd >= PERSONAL_SPACE || pd >= Math.hypot(w.player.x - c.x, w.player.y - c.y);
  };
  const x0 = c.x;
  const y0 = c.y;
  if (free(c.x + mx, c.y)) c.x += mx;
  if (free(c.x, c.y + my)) c.y += my;
  const moved = Math.hypot(c.x - x0, c.y - y0);
  c.stride += moved * STRIDE;
  return moved > stepLen * 0.1;
}

/** Which sprite to draw: a frame of the view files, or of the death file. */
export function creatureFrame(c: Creature, attackFrames: number): { death: boolean; frame: number } {
  switch (c.state) {
    case 'dying':
      return { death: true, frame: Math.min(1, Math.floor((c.time / DYING_TIME) * 2)) };
    case 'dead':
      return { death: true, frame: 2 };
    case 'attack': {
      if (attackFrames <= 0) return { death: false, frame: 0 };
      const f = Math.min(attackFrames - 1, Math.floor((c.time / ATTACK_TIME) * attackFrames));
      return { death: false, frame: 8 + f };
    }
    case 'look':
      return { death: false, frame: [6, 0, 7, 0][Math.floor((c.time / c.span) * 4) % 4] };
    case 'wander':
    case 'chase':
      return { death: false, frame: Math.floor(c.stride) % 6 };
    default:
      return { death: false, frame: 0 };
  }
}

/**
 * Which of the five view files shows a creature facing `facing` to a viewer
 * looking from (vx, vy): 0 front, 1 front-side, 2 side, 3 back-side, 4 back.
 * The views between are mirrored when the creature faces the viewer's right.
 * The front and back views never are: a creature coming straight at the
 * viewer is a hair to one side or the other from one moment to the next,
 * and would flip back and forth.
 */
export function viewAngle(cx: number, cy: number, facing: number, vx: number, vy: number): { file: number; mirror: boolean } {
  const toViewer = Math.atan2(vy - cy, vx - cx);
  let rel = facing - toViewer;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // -PI..PI; 0 = facing the viewer
  const sector = Math.round(Math.abs(rel) / (Math.PI / 4)); // 0..4
  return { file: sector, mirror: sector > 0 && sector < 4 && rel < 0 };
}
