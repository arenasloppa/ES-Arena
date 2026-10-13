/** Ballistic Steel arrows, with swept impacts and recoverable world states. */
import type { Vec3 } from './chainPhysics';
import {STANDING_EYE} from './playerView';
export type SurfaceMaterial = 'stone' | 'metal' | 'wood' | 'soft';
export type ProjectilePhase = 'flying' | 'resting' | 'embedded' | 'recovered';
/** Arena's eye is 60/128 voxels. 1.6 m eye height gives the model-to-world scale. */
export const METRES_TO_WORLD = STANDING_EYE / 1.6;
/** Tuned for a gentler game flight arc; terrain collision and recovery remain physical. */
export const ARROW_GRAVITY = 9.81 * METRES_TO_WORLD * .55;
export const STEEL_ARROW_SPEED = 45 * METRES_TO_WORLD;
export interface Projectile {
  position: Vec3;
  velocity: Vec3;
  direction: Vec3;
  phase: ProjectilePhase;
  age: number;
  travelled: number;
  bounces: number;
  spin: number;
  angularSpeed: number;
  hitCreature?: number;
}
export interface ProjectileHit {
  fraction: number;
  point: Vec3;
  normal: Vec3;
  material: SurfaceMaterial;
  creature?: number;
}
export type ProjectileSweep = (from: Vec3, to: Vec3) => ProjectileHit | undefined;
export function projectile(position: Vec3, velocity: Vec3): Projectile {
  return {
    position: [...position],
    velocity: [...velocity],
    direction: unit(velocity),
    phase: 'flying',
    age: 0,
    travelled: 0,
    bounces: 0,
    spin: 0,
    angularSpeed: 0,
  };
}
function unit(v: Vec3): Vec3 {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n) as Vec3;
}
export function stepProjectile(p: Projectile, dt: number, sweep: ProjectileSweep, impact?: (hit: ProjectileHit) => void): void {
  if (p.phase !== 'flying' || !Number.isFinite(dt) || dt <= 0) return;
  // Substeps limit curved-path error; each straight segment itself is swept.
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-8 && p.phase === 'flying') {
    const step = Math.min(remaining, 1 / 120),
      old: [number, number, number] = [...p.position],
      to: Vec3 = [
        old[0] + p.velocity[0] * step,
        old[1] + p.velocity[1] * step - 0.5 * ARROW_GRAVITY * step * step,
        old[2] + p.velocity[2] * step,
      ];
    const hit = sweep(old, to),
      share = hit ? Math.max(0, Math.min(1, hit.fraction)) : 1,
      elapsed = step * share;
    p.age += elapsed;
    p.velocity[1] -= ARROW_GRAVITY * elapsed;
    p.travelled += Math.hypot(...to.map((v, k) => (v - old[k]) * share));
    p.spin += p.angularSpeed * elapsed;
    p.angularSpeed *= Math.exp(-1.2 * elapsed);
    if (!hit) {
      p.position = to;
      p.direction = unit(p.velocity);
      remaining -= step;
      continue;
    }
    p.position = [...hit.point];
    p.direction = unit(p.velocity);
    impact?.(hit);
    if (hit.creature !== undefined || hit.material === 'wood' || hit.material === 'soft') {
      p.phase = 'embedded';
      p.hitCreature = hit.creature;
      p.position = p.position.map((v, k) => v + p.direction[k] * 0.006) as Vec3;
      p.velocity = [0, 0, 0];
      break;
    }
    const normalSpeed = p.velocity.reduce((sum, v, k) => sum + v * hit.normal[k], 0),
      bounce = hit.material === 'metal' ? .08 : .06;
    // A small ping, not another flight across the room: discard most impact energy.
    p.velocity = p.velocity.map((v, k) => (v-normalSpeed*hit.normal[k])*.12-Math.min(0,normalSpeed)*bounce*hit.normal[k]) as Vec3;
    const horizontal=Math.hypot(p.velocity[0],p.velocity[2]),limit=(hit.material==='metal'?.8:.55)*METRES_TO_WORLD;
    if(horizontal>limit){p.velocity[0]*=limit/horizontal;p.velocity[2]*=limit/horizontal;}
    p.velocity[1]=Math.min(p.velocity[1],.25*METRES_TO_WORLD);
    p.bounces++;
    p.angularSpeed = Math.sign(normalSpeed)*Math.min(Math.abs(normalSpeed)*.08,.7);
    p.position = p.position.map((v, k) => v + hit.normal[k] * 0.0015) as Vec3;
    if (Math.hypot(...p.velocity) < .25*METRES_TO_WORLD || p.bounces > 8) {
      if (hit.normal[1] > 0.65) {
        p.phase = 'resting';
        p.velocity = [0, 0, 0];
        p.position[1] += 0.005;
        p.direction = unit([p.direction[0] || 1, 0, p.direction[2]]);
        p.spin = 0;
        break;
      }
      p.velocity = [0, Math.min(-0.2, p.velocity[1]), 0];
    }
    p.direction = unit(p.velocity);
    remaining -= Math.max(elapsed, 1e-5);
  }
}

/** Segment against an expanded axis-aligned box. Returns the first outward face normal. */
export function segmentBox(from: Vec3, to: Vec3, min: Vec3, max: Vec3): { fraction: number; normal: Vec3 } | undefined {
  let enter = 0,
    leave = 1;
  let normal: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const d = to[k] - from[k];
    if (Math.abs(d) < 1e-10) {
      if (from[k] < min[k] || from[k] > max[k]) return;
      continue;
    }
    const a = (min[k] - from[k]) / d,
      b = (max[k] - from[k]) / d,
      near = Math.min(a, b),
      far = Math.max(a, b);
    if (near >= enter) {
      enter = near;
      normal = [0, 0, 0];
      normal[k] = d > 0 ? -1 : 1;
    }
    leave = Math.min(leave, far);
    if (enter > leave) return;
  }
  if (enter < 0 || enter > 1 || leave < 0 || normal.every((v) => v === 0)) return;
  return { fraction: enter, normal };
}
