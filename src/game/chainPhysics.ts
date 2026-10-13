/** Fixed-step constrained particles: the chain retains momentum when its anchor moves. */
export type Vec3 = [number, number, number];
export interface ChainContact {
  point: Vec3;
  normal: Vec3;
}
/** An authored outward bias complements gravity and constrained momentum. */
export interface ChainGuide {direction:Vec3;strength:number;damping:number;}
export type ChainCollider = (point: Vec3, radius: number) => ChainContact | undefined;
const STEP = 1 / 120;
export interface ChainOptions {
  damping?: number;
  headInverseMass?: number;
  linkRadius?: number;
}
export class ChainPhysics {
  readonly points: Vec3[] = [];
  readonly previous: Vec3[] = [];
  private accumulator = 0;
  private anchor: Vec3 = [0, 0, 0];
  private lastAnchor: Vec3 = [0, 0, 0];
  constructor(
    readonly lengths: readonly number[],
    readonly headRadius = 0.11,
    readonly options: ChainOptions = {},
  ) {
    this.reset([0, 0, 0]);
  }
  reset(anchor: Vec3, direction: Vec3 = [0, -1, 0]): void {
    this.points.length = this.previous.length = 0;
    this.anchor = [...anchor];
    this.lastAnchor = [...anchor];
    this.accumulator = 0;
    let distance = 0;
    for (let i = 0; i <= this.lengths.length; i++) {
      if (i) distance += this.lengths[i - 1];
      const p: Vec3 = [anchor[0] + direction[0] * distance, anchor[1] + direction[1] * distance, anchor[2] + direction[2] * distance];
      this.points.push(p);
      this.previous.push([...p]);
    }
  }
  update(dt: number, anchor: Vec3, gravity: Vec3 = [0, -9.81, 0], collide?: ChainCollider, guide?: ChainGuide): void {
    if (!Number.isFinite(dt) || dt < 0 || anchor.some((x) => !Number.isFinite(x))) return;
    // A teleport should not launch the head through the scene.
    if (Math.hypot(...anchor.map((v, i) => v - this.anchor[i])) > 1.5) {
      this.reset(anchor);
      return;
    }
    this.lastAnchor = [...this.anchor];
    this.anchor = [...anchor];
    this.accumulator += Math.min(dt, 0.1);
    const steps = Math.floor((this.accumulator + 1e-10) / STEP);
    this.accumulator -= steps * STEP;
    for (let tick = 0; tick < steps; tick++) {
      const f = (tick + 1) / steps,
        pin: Vec3 = this.anchor.map((v, i) => this.lastAnchor[i] + (v - this.lastAnchor[i]) * f) as Vec3;
      let reach=0;
      for (let i = 1; i < this.points.length; i++) {
        reach+=this.lengths[i-1];
        const p = this.points[i],
          old = this.previous[i],
          before: [number, number, number] = [...p];
        const retention = Math.exp(-((this.options.damping ?? 4)+(guide?.damping??0)) * STEP);
        for (let k = 0; k < 3; k++) {
          const steer=guide?(pin[k]+guide.direction[k]*reach-p[k])*guide.strength:0;
          p[k] += (p[k] - old[k]) * retention + (gravity[k]+steer) * STEP * STEP;
        }
        this.previous[i] = before;
      }
      this.points[0] = pin;
      this.previous[0] = [...pin];
      for (let pass = 0; pass < 64; pass++) {
        this.points[0] = [...pin];
        for (let i = 1; i < this.points.length; i++) {
          const a = this.points[i - 1],
            b = this.points[i],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            dz = b[2] - a[2],
            distance = Math.hypot(dx, dy, dz) || 1e-9,
            error = (distance - this.lengths[i - 1]) / distance;
          const wa = i === 1 ? 0 : 1,
            wb = i === this.lengths.length ? (this.options.headInverseMass ?? 0.04) : 1,
            sum = wa + wb;
          for (let k = 0; k < 3; k++) {
            const d = b[k] - a[k];
            a[k] += (d * error * wa) / sum;
            b[k] -= (d * error * wb) / sum;
          }
        }
        if (collide)
          for (let i = 1; i < this.points.length; i++) {
            const hit = collide(this.points[i], i === this.lengths.length ? this.headRadius : (this.options.linkRadius ?? 0.024));
            if (!hit) continue;
            const velocity = this.points[i].map((v, k) => v - this.previous[i][k]),
              vn = velocity.reduce((s, v, k) => s + v * hit.normal[k], 0);
            this.points[i] = [...hit.point];
            // Inelastic contact: discard inward velocity, retain some sliding motion.
            this.previous[i] = hit.point.map((v, k) => v - (velocity[k] - Math.min(0, vn) * hit.normal[k]) * 0.4) as Vec3;
          }
      }
      if(guide){
        // Finish the guided chain from its pin. Keep constraint corrections out of
        // next tick's velocity so a fast anchor move cannot build an elastic recoil.
        for(let i=1;i<this.points.length;i++){
          const a=this.points[i-1],before=[...this.points[i]];
          for(let pass=0;pass<12;pass++){
            const delta=this.points[i].map((v,k)=>v-a[k]),distance=Math.hypot(...delta)||1e-9;
            this.points[i]=a.map((v,k)=>v+delta[k]*this.lengths[i-1]/distance) as Vec3;
            const hit=collide?.(this.points[i],i===this.lengths.length?this.headRadius:(this.options.linkRadius??.024));
            if(!hit)break;this.points[i]=[...hit.point];
          }
          const axis=this.points[i].map((v,k)=>v-a[k]),length=Math.hypot(...axis)||1e-9,velocity=before.map((v,k)=>v-this.previous[i][k]);
          const radial=velocity.reduce((sum,v,k)=>sum+v*axis[k]/length,0);
          // Retain damped swing momentum, discarding velocity that stretches a link.
          this.previous[i]=this.points[i].map((v,k)=>v-(velocity[k]-radial*axis[k]/length)*.85) as Vec3;
        }
      }
    }
  }
}
