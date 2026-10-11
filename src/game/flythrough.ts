/**
 * The film behind the main menu: a slow flight through a dungeon, one shot
 * at a time, past its creatures going about their business. Shots glide
 * down corridors and over water, sweep across rooms, close in on a creature
 * or look up at one from the floor, and now and then one turns and comes for
 * the camera. They dissolve into each other, and dip to black now and then,
 * as a film's opening might. Every shot is planned from the level itself,
 * its corridors, rooms, water and creatures, so it suits any map. Pure logic
 * (no Three.js) so it can be unit tested; render/film.ts draws it.
 */
import { isAlive, updateCreature, type Creature, type CreatureWorld } from './creatures';
import { ARENA_HEIGHT, chasmFloor, type Level } from './level';

/** Where the camera is and where it looks; x and y across the map, z up from the floor. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

export type ShotKind = 'glide' | 'water' | 'approach' | 'low' | 'charge' | 'pan';

export interface Shot {
  kind: ShotKind;
  /** Seconds. */
  duration: number;
  /** How it starts: dissolving out of the shot before, or out of black. */
  opening: 'dissolve' | 'black';
  /** The creature the shot is about; in a charge, it comes for the camera. */
  subject?: Creature;
  /** The camera `t` seconds into the shot. */
  pose(t: number): Pose;
}

/** Seconds two shots overlap as one dissolves into the next. */
export const DISSOLVE = 1.6;
/** Seconds of fading down to black at the end of a shot, and up out of it at the start of the next. */
export const DIP = 0.9;
/** Seconds the very first shot takes to come up out of black. */
export const FIRST_FADE = 2.2;

const EYE = 60 * ARENA_HEIGHT;
/** Where the camera looks on a creature: about its middle. */
const BODY = 30 * ARENA_HEIGHT;
const GLIDE_SPEED = 1.1;
const WATER_SPEED = 0.8;
const LOOK_AHEAD = 1.8;
/** How close a shot comes to its creature. */
const NEAREST = 1.7;
/** How fast the camera backs away from a charging creature, which is faster. */
const RETREAT = 0.45;
/** The order shots come in, round and round: creatures every other shot or so. */
const PATTERN: ShotKind[] = ['glide', 'approach', 'water', 'low', 'glide', 'charge', 'pan', 'approach', 'glide', 'low'];
/** Every so many shots, a dip to black instead of a dissolve. */
const DIP_EVERY = 5;

type Random = () => number;

/** Plans the shots, one after another. */
export class Director {
  private turn = 0;
  private count = 0;
  /** Creatures shown lately, so the film goes round them all. */
  private readonly shown: Creature[] = [];
  private lastKind: ShotKind | undefined;

  constructor(
    private readonly level: Level,
    private readonly creatures: Creature[],
    private readonly random: Random = Math.random,
  ) {}

  /** The next shot. The first comes out of black, as does one after a creature has charged. */
  next(): Shot {
    const opening: Shot['opening'] = this.count === 0 || this.lastKind === 'charge' || this.count % DIP_EVERY === 0 ? 'black' : 'dissolve';
    let shot: Omit<Shot, 'opening'> | undefined;
    for (let tries = 0; tries < PATTERN.length && !shot; tries++) {
      const kind = PATTERN[this.turn++ % PATTERN.length];
      shot = this.plan(kind);
    }
    shot ??= this.plan('glide') ?? this.plan('pan') ?? still(this.level);
    this.count++;
    this.lastKind = shot.kind;
    if (shot.subject) {
      this.shown.push(shot.subject);
      if (this.shown.length > Math.max(1, Math.floor(this.creatures.length / 2))) this.shown.shift();
    }
    return { ...shot, opening };
  }

  private plan(kind: ShotKind): Omit<Shot, 'opening'> | undefined {
    switch (kind) {
      case 'glide':
        return this.glide();
      case 'water':
        return this.water();
      case 'pan':
        return this.pan();
      default:
        return this.creatureShot(kind);
    }
  }

  // ---- The level ----

  private cell(x: number, y: number) {
    const { width, depth, cells } = this.level;
    return x < 0 || y < 0 || x >= width || y >= depth ? undefined : cells[Math.floor(y) * width + Math.floor(x)];
  }

  /** The camera can be here: open floor, or over water or a pit. Doors, platforms and bars are left alone. */
  private air(x: number, y: number): boolean {
    return this.cell(x, y)?.kind === 'empty';
  }

  private floor(x: number, y: number): boolean {
    const c = this.cell(x, y);
    return c?.kind === 'empty' && !c.chasm;
  }

  private wet(x: number, y: number): boolean {
    const c = this.cell(x, y);
    return c?.kind === 'empty' && c.chasm === 'wet';
  }

  /** Every point on the way from a to b is somewhere the camera can be. */
  private clear(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.15);
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      if (!this.air(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  /** Cells where `ok` holds, in no order. */
  private cells(ok: (x: number, y: number) => boolean): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let y = 0; y < this.level.depth; y++) for (let x = 0; x < this.level.width; x++) if (ok(x, y)) out.push([x, y]);
    return out;
  }

  private pick<T>(list: T[]): T | undefined {
    return list.length ? list[Math.floor(this.random() * list.length)] : undefined;
  }

  /**
   * A walk of up to `length` cells where `ok` holds, from a random one: on
   * straight ahead mostly, never back on itself. The longest of a few tries.
   */
  private walk(ok: (x: number, y: number) => boolean, length: number): Array<[number, number]> {
    const starts = this.cells(ok);
    let best: Array<[number, number]> = [];
    for (let attempt = 0; attempt < 12 && starts.length; attempt++) {
      const start = this.pick(starts)!;
      const path: Array<[number, number]> = [start];
      const seen = new Set([`${start[0]},${start[1]}`]);
      let dir: [number, number] | undefined;
      while (path.length < length) {
        const [x, y] = path[path.length - 1];
        const options = DIRECTIONS.filter(([dx, dy]) => ok(x + dx, y + dy) && !seen.has(`${x + dx},${y + dy}`));
        if (!options.length) break;
        const ahead = dir && options.find(([dx, dy]) => dx === dir![0] && dy === dir![1]);
        dir = ahead && this.random() < 0.75 ? ahead : this.pick(options)!;
        path.push([x + dir[0], y + dir[1]]);
        seen.add(`${x + dir[0]},${y + dir[1]}`);
      }
      if (path.length > best.length) best = path;
      if (best.length >= length) break;
    }
    return best;
  }

  /** How far one can see from (x, y) at `angle` before something is in the way, up to `most`. */
  private reach(x: number, y: number, angle: number, most = 12): number {
    let d = 0;
    while (d < most && this.air(x + Math.cos(angle) * (d + 0.2), y + Math.sin(angle) * (d + 0.2))) d += 0.2;
    return d;
  }

  // ---- Shots ----

  /** No creature stands within a cell or so of (x, y), to be flown into. */
  private unoccupied(x: number, y: number): boolean {
    return !this.creatures.some((c) => isAlive(c) && Math.abs(c.x - x - 0.5) < 1.6 && Math.abs(c.y - y - 0.5) < 1.6);
  }

  /** Down corridors and through rooms, mostly at eye height, now and then from up by the ceiling. */
  private glide(): Omit<Shot, 'opening'> | undefined {
    const path = this.walk((x, y) => this.floor(x, y) && this.unoccupied(x, y), 12);
    if (path.length < 6) return undefined;
    const curve = new Curve(path.map(([x, y]) => [x + 0.5, y + 0.5]));
    const high = this.random() < 0.3;
    const z = high ? this.level.height * 0.82 : EYE + (this.random() - 0.5) * 0.08;
    const lookZ = high ? EYE * 0.7 : z - 0.03;
    const duration = clamp(curve.length / GLIDE_SPEED, 5, 8);
    const speed = Math.min(GLIDE_SPEED, curve.length / duration);
    return {
      kind: 'glide',
      duration,
      pose: (t) => {
        const [x, y] = curve.at(speed * t);
        const [lx, ly] = curve.at(speed * t + LOOK_AHEAD);
        return { x, y, z, lookX: lx, lookY: ly, lookZ };
      },
    };
  }

  /** Low over the water, as a swimmer sees it. */
  private water(): Omit<Shot, 'opening'> | undefined {
    const path = this.walk((x, y) => this.wet(x, y) && this.unoccupied(x, y), 9);
    if (path.length < 4) return undefined;
    const curve = new Curve(path.map(([x, y]) => [x + 0.5, y + 0.5]));
    const z = chasmFloor('wet', this.level.height) + 0.1;
    const duration = clamp(curve.length / WATER_SPEED, 4.5, 7);
    const speed = Math.min(WATER_SPEED, curve.length / duration);
    return {
      kind: 'water',
      duration,
      pose: (t) => {
        const [x, y] = curve.at(speed * t);
        const [lx, ly] = curve.at(speed * t + LOOK_AHEAD);
        return { x, y, z, lookX: lx, lookY: ly, lookZ: z + 0.04 };
      },
    };
  }

  /** From the middle of a room, a slow turn across it. */
  private pan(): Omit<Shot, 'opening'> | undefined {
    const rooms = shuffle(
      this.cells((x, y) => this.floor(x, y) && this.unoccupied(x, y) && AROUND.filter(([dx, dy]) => this.air(x + dx, y + dy)).length >= 7),
      this.random,
    );
    for (const [cx, cy] of rooms.slice(0, 20)) {
      const x = cx + 0.5;
      const y = cy + 0.5;
      // Turn across the way that sees furthest, so long as the view is never up against a wall.
      let middle = 0;
      let furthest = -1;
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        const r = this.reach(x, y, angle);
        if (r > furthest) [middle, furthest] = [angle, r];
      }
      const sweep = (70 + this.random() * 40) * (Math.PI / 180) * (this.random() < 0.5 ? 1 : -1);
      let open = true;
      for (let k = 0; k <= 8 && open; k++) open = this.reach(x, y, middle - sweep / 2 + (sweep * k) / 8) >= 2.2;
      if (!open) continue;
      return this.sweep(x, y, middle, sweep);
    }
    return undefined;
  }

  private sweep(x: number, y: number, middle: number, sweep: number): Omit<Shot, 'opening'> {
    const drift = Math.min(0.4, Math.max(0, this.reach(x, y, middle) - 0.6));
    const duration = 7;
    return {
      kind: 'pan',
      duration,
      pose: (t) => {
        const p = ease(t / duration);
        const angle = middle - sweep / 2 + sweep * p;
        const px = x + Math.cos(middle) * drift * p;
        const py = y + Math.sin(middle) * drift * p;
        return { x: px, y: py, z: EYE, lookX: px + Math.cos(angle) * 3, lookY: py + Math.sin(angle) * 3, lookZ: EYE - 0.05 };
      },
    };
  }

  /**
   * A shot of one creature: closing in on it (approach), looking up at it
   * from the floor while drifting sideways (low), or backing away as it
   * comes for the camera (charge).
   */
  private creatureShot(kind: ShotKind): Omit<Shot, 'opening'> | undefined {
    // Those not shown lately first.
    const alive = this.creatures.filter(isAlive);
    const order = [...shuffle(alive.filter((c) => !this.shown.includes(c)), this.random), ...shuffle(this.shown.filter(isAlive), this.random)];
    for (const c of order.slice(0, 16)) {
      const shot = kind === 'approach' ? this.approach(c) : kind === 'low' ? this.low(c) : this.charge(c);
      if (shot) return shot;
    }
    return undefined;
  }

  /** Spots from `near` to `far` away from the creature with a clear line to it, nearest the middle of that span first. */
  private spotsFacing(c: Creature, near: number, far: number): Array<{ x: number; y: number; d: number }> {
    const spots: Array<{ x: number; y: number; d: number }> = [];
    const r = Math.ceil(far);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(c.x) + dx + 0.5;
        const y = Math.floor(c.y) + dy + 0.5;
        const d = Math.hypot(x - c.x, y - c.y);
        if (d < near || d > far || !this.floor(x, y) || !this.clear(x, y, c.x, c.y)) continue;
        spots.push({ x, y, d });
      }
    }
    return shuffle(spots, this.random);
  }

  private approach(c: Creature): Omit<Shot, 'opening'> | undefined {
    const spot = this.spotsFacing(c, 3.2, 5.5)[0];
    if (!spot) return undefined;
    const ux = (c.x - spot.x) / spot.d;
    const uy = (c.y - spot.y) / spot.d;
    const duration = 6.5;
    return {
      kind: 'approach',
      duration,
      subject: c,
      pose: (t) => {
        // Closing in, but never nearer than NEAREST to where the creature is now.
        const travel = Math.min(ease(t / duration) * (spot.d - NEAREST), Math.hypot(c.x - spot.x, c.y - spot.y) - NEAREST);
        const x = spot.x + ux * Math.max(0, travel);
        const y = spot.y + uy * Math.max(0, travel);
        return { x, y, z: EYE, lookX: c.x, lookY: c.y, lookZ: BODY + 0.08 };
      },
    };
  }

  private low(c: Creature): Omit<Shot, 'opening'> | undefined {
    for (const spot of this.spotsFacing(c, 1.9, 3.2)) {
      // Drifting across the line to the creature, half a cell each way.
      const sx = -(c.y - spot.y) / spot.d;
      const sy = (c.x - spot.x) / spot.d;
      const a = { x: spot.x - sx * 0.45, y: spot.y - sy * 0.45 };
      const b = { x: spot.x + sx * 0.45, y: spot.y + sy * 0.45 };
      if (!this.clear(a.x, a.y, b.x, b.y) || !this.clear(a.x, a.y, c.x, c.y) || !this.clear(b.x, b.y, c.x, c.y)) continue;
      const duration = 6;
      return {
        kind: 'low',
        duration,
        subject: c,
        pose: (t) => {
          const p = ease(t / duration);
          return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, z: 12 * ARENA_HEIGHT, lookX: c.x, lookY: c.y, lookZ: BODY };
        },
      };
    }
    return undefined;
  }

  private charge(c: Creature): Omit<Shot, 'opening'> | undefined {
    const duration = 5.5;
    const back = RETREAT * duration;
    for (const spot of this.spotsFacing(c, 3.2, 5)) {
      // Room behind the camera to back away into.
      const ux = (spot.x - c.x) / spot.d;
      const uy = (spot.y - c.y) / spot.d;
      if (!this.clear(spot.x, spot.y, spot.x + ux * (back + 0.3), spot.y + uy * (back + 0.3))) continue;
      return {
        kind: 'charge',
        duration,
        subject: c,
        pose: (t) => {
          const s = RETREAT * t * Math.min(1, t / 1.5);
          const x = spot.x + ux * s;
          const y = spot.y + uy * s;
          return { x, y, z: EYE, lookX: c.x, lookY: c.y, lookZ: BODY + 0.08 };
        },
      };
    }
    return undefined;
  }
}

/** For a level with nowhere to fly: a look from where the player starts. */
function still(level: Level): Omit<Shot, 'opening'> {
  const { x, y } = level.start;
  return { kind: 'pan', duration: 8, pose: (t) => ({ x, y, z: EYE, lookX: x + Math.cos(t * 0.1), lookY: y + Math.sin(t * 0.1), lookZ: EYE }) };
}

/** What the film shows at a moment: the shot on screen, the one dissolving away under it, and how dark it is. */
export interface FilmFrame {
  current: { shot: Shot; t: number };
  /** The shot before, while it dissolves away: `weight` is how much of it still shows, 1 to 0. */
  fading?: { shot: Shot; t: number; weight: number };
  /** 0 clear to 1 black. */
  black: number;
}

/**
 * Runs the shots one after another and keeps the creatures going: each goes
 * about its business without noticing the camera, except the one in a
 * charge, which sees it and comes for it.
 */
export class Film {
  time = 0;
  private current: { shot: Shot; start: number };
  private fading: { shot: Shot; start: number } | undefined;
  private upcoming: Shot;

  constructor(
    private readonly director: Director,
    private readonly level: Level,
    private readonly creatures: Creature[],
    private readonly random: Random = Math.random,
  ) {
    this.current = { shot: director.next(), start: 0 };
    this.upcoming = director.next();
  }

  /** Moves the film on by `dt` seconds. */
  advance(dt: number): FilmFrame {
    this.time += dt;
    const { shot, start } = this.current;
    const t = this.time - start;
    const next = this.upcoming;
    const cut = next.opening === 'dissolve' ? shot.duration - DISSOLVE : shot.duration;
    if (t >= cut) {
      if (shot.kind === 'charge' && shot.subject) calm(shot.subject);
      this.fading = next.opening === 'dissolve' ? this.current : undefined;
      this.current = { shot: next, start: start + cut };
      this.upcoming = this.director.next();
    }
    if (this.fading && this.time - this.fading.start >= this.fading.shot.duration) {
      if (this.fading.shot.kind === 'charge' && this.fading.shot.subject) calm(this.fading.shot.subject);
      this.fading = undefined;
    }
    this.act(dt);
    return this.frame();
  }

  /** What to draw now, without moving on. */
  frame(): FilmFrame {
    const cur = { shot: this.current.shot, t: this.time - this.current.start };
    let black = 0;
    if (this.time < FIRST_FADE) black = 1 - smooth(this.time / FIRST_FADE);
    else if (cur.shot.opening === 'black' && cur.t < DIP) black = 1 - smooth(cur.t / DIP);
    if (this.upcoming.opening === 'black' && cur.t > cur.shot.duration - DIP) black = Math.max(black, smooth((cur.t - (cur.shot.duration - DIP)) / DIP));
    const fading = this.fading && { shot: this.fading.shot, t: this.time - this.fading.start, weight: 1 - smooth(Math.min(1, cur.t / DISSOLVE)) };
    return { current: cur, fading, black };
  }

  /** The creatures carry on, the one charging included. */
  private act(dt: number): void {
    const cur = this.current;
    const pose = cur.shot.pose(this.time - cur.start);
    const world = (invisible: boolean): CreatureWorld => ({
      level: this.level,
      openDoors: NO_DOORS,
      player: { x: pose.x, y: pose.y, level: 1 },
      sneaking: false,
      invisible,
      now: this.time,
      random: this.random,
      creatures: this.creatures,
    });
    const unseen = world(true);
    const seen = world(false);
    const charging = cur.shot.kind === 'charge' ? cur.shot.subject : undefined;
    for (const c of this.creatures) updateCreature(c, c === charging ? seen : unseen, dt);
  }
}

const NO_DOORS = new Set<number>();

/** Back to its business, after a charge. */
function calm(c: Creature): void {
  if (!isAlive(c)) return;
  Object.assign(c, { state: 'idle', time: 0, span: 1.5, awareness: 0, goal: undefined, unseen: Infinity });
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const AROUND: Array<[number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * A smooth path through points (a Catmull-Rom spline), walked by distance:
 * at(s) is the point s along it, and past either end it carries straight on.
 */
export class Curve {
  readonly length: number;
  private readonly samples: Array<[number, number]> = [];
  private readonly distances: number[] = [];

  constructor(points: Array<[number, number]>) {
    const p = points.length > 1 ? points : [points[0], [points[0][0] + 1e-3, points[0][1]] as [number, number]];
    const at = (i: number) => p[Math.max(0, Math.min(p.length - 1, i))];
    let total = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      for (let k = i === 0 ? 0 : 1; k <= 16; k++) {
        const s = k / 16;
        const s2 = s * s;
        const s3 = s2 * s;
        const point: [number, number] = [0, 1].map(
          (j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * s + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * s2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * s3),
        ) as [number, number];
        const last = this.samples[this.samples.length - 1];
        if (last) total += Math.hypot(point[0] - last[0], point[1] - last[1]);
        this.samples.push(point);
        this.distances.push(total);
      }
    }
    this.length = total;
  }

  at(s: number): [number, number] {
    const n = this.samples.length;
    if (s <= 0) return this.beyond(0, 1, s);
    if (s >= this.length) return this.beyond(n - 1, n - 2, s - this.length);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.distances[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = this.distances[hi] - this.distances[lo] || 1;
    const f = (s - this.distances[lo]) / span;
    const [a, b] = [this.samples[lo], this.samples[hi]];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  /** Straight on out of the end sample `from`, away from its neighbour `before`, by `extra`. */
  private beyond(from: number, before: number, extra: number): [number, number] {
    const a = this.samples[from];
    const b = this.samples[before];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const k = Math.abs(extra) / d;
    return [a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k];
  }
}

/** Slow in, slow out. */
function ease(p: number): number {
  const q = clamp(p, 0, 1);
  return q * q * (3 - 2 * q);
}

const smooth = ease;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function shuffle<T>(list: T[], random: Random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
