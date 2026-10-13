import * as THREE from 'three';
import type { WeaponSizeFit } from './weaponModelSizing';
import {bowAttachmentPose,bowMorphSamples,WEAPON_MOTION_FOV,type LookPose,type WeaponMovement} from './weaponMotion';
import { ChainPhysics, type Vec3, type ChainContact } from '../game/chainPhysics';
import { METRES_TO_WORLD, type ProjectileHit, type SurfaceMaterial } from '../game/projectilePhysics';
import type { Swing } from '../game/dungeon';
import { animatedGrip, guardGrip, shoveGrip, poseQuaternion, type GripPose } from './weaponAnimation';
import {flailSwingGuide} from './flailSwingGuide';
import {WeaponPressMotion} from './weaponPressMotion';
import {hideWeaponTail} from './weaponFraming';
import { steelWeapons, type SteelWeaponDefinition } from './steelWeaponAssets';

export interface WeaponEnvironment {
  toWorld(point: THREE.Vector3): Vec3;
  toView(point: Vec3): THREE.Vector3;
  sweep(from: Vec3, to: Vec3): ProjectileHit | undefined;
  sphere(point: Vec3, radius: number): ChainContact | undefined;
  contact?(hit: ProjectileHit, swing: Swing): void;
}
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (a: Vec3) => new THREE.Vector3(...a);
function originalGroup(model: THREE.Group): THREE.Object3D {
  let found: THREE.Object3D = model;
  model.traverse((o) => {
    if (o.userData.attachmentCenter || o.userData.stringEndpoints) found = o;
  });
  return found;
}

export class DynamicRope {
  readonly geometry: THREE.CylinderGeometry;
  private readonly source: Float32Array;
  constructor(
    readonly mesh: THREE.Mesh,
    readonly radius: number,
    readonly lo: number,
    readonly hi: number,
    rect: [number, number, number, number],
    private readonly centred = false,
  ) {
    this.geometry = new THREE.CylinderGeometry(radius, radius, hi - lo, 6, 32, false);
    this.source = new Float32Array(this.geometry.attributes.position.array);
    const uv = this.geometry.attributes.uv,
      p = this.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + rect[2] * uv.getX(i), rect[1] + rect[3] * (p.getY(i) / (hi - lo) + 0.5));
    mesh.geometry = this.geometry;
  }
  update(lower: THREE.Vector3, middle: THREE.Vector3, upper: THREE.Vector3): void {
    const positions = this.geometry.attributes.position,
      normal = this.geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      const x = this.source[i * 3],
        z = this.source[i * 3 + 2],
        u = this.source[i * 3 + 1] / (this.hi-this.lo) + .5,
        y = this.centred ? middle.y+this.source[i*3+1] : u<=.5 ? THREE.MathUtils.lerp(lower.y,middle.y,u*2) : THREE.MathUtils.lerp(middle.y,upper.y,(u-.5)*2);
      const lowerSide = y <= middle.y,
        a = lowerSide ? lower : middle,
        b = lowerSide ? middle : upper,
        f = (y - a.y) / (b.y - a.y),
        cx = a.x + (b.x - a.x) * f,
        cz = a.z + (b.z - a.z) * f;
      const tangent = b.clone().sub(a).normalize(),
        out = new THREE.Vector3(0, 0, 1).cross(tangent).normalize(),
        side = tangent.clone().cross(out).normalize();
      const point = new THREE.Vector3(cx, y, cz).addScaledVector(out, x).addScaledVector(side, z);
      positions.setXYZ(i, point.x, point.y, point.z);
      const n = out.multiplyScalar(x).addScaledVector(side, z).normalize();
      if (Math.hypot(x, z) > 1e-8) normal.setXYZ(i, n.x, n.y, n.z);
      else {const sign=this.source[i*3+1]>0?1:-1;normal.setXYZ(i,tangent.x*sign,tangent.y*sign,tangent.z*sign);}
    }
    positions.needsUpdate = true;
    normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
  dispose(): void {
    this.geometry.dispose();
  }
}

class BowRig {
  private readonly arrowHeight = 0;
  private readonly arrowSide = .034;
  private arrow: THREE.Group | undefined;
  private arrowBaseY = -.39;
  private readonly bowType: number;
  private readonly ropes: DynamicRope[] = [];
  private readonly endMorphs: Array<{draw:THREE.Vector3;recoil:THREE.Vector3}>;
  private readonly fittedBounds: THREE.Box3;
  private readonly deform: Array<{
    geometry: THREE.BufferGeometry;
    rest: Float32Array;
    draw: Float32Array;
    recoil: Float32Array;
  }> = [];
  private readonly ends: THREE.Vector3[];
  private readonly model: THREE.Object3D;
  private alive = true;
  constructor(model: THREE.Group, definition: SteelWeaponDefinition) {
    this.bowType = definition.type;
    this.fittedBounds=new THREE.Box3().setFromObject(model);
    this.model = originalGroup(model);
    this.ends = (this.model.userData.stringEndpoints as Vec3[]).map(v3);
    const samples=bowMorphSamples(definition.type),sourceBox=new THREE.Box3().setFromPoints(samples.map(v=>new THREE.Vector3(...v.base))),sourceSize=sourceBox.getSize(new THREE.Vector3()),size=this.fittedBounds.getSize(new THREE.Vector3());
    const nearest=(point:THREE.Vector3)=>{const n=point.clone().sub(this.fittedBounds.min).divide(size);return samples.reduce((best,s)=>new THREE.Vector3(...s.base).sub(sourceBox.min).divide(sourceSize).distanceToSquared(n)<new THREE.Vector3(...best.base).sub(sourceBox.min).divide(sourceSize).distanceToSquared(n)?s:best);};
    this.model.updateWorldMatrix(true,false);const inverse=new THREE.Matrix3().setFromMatrix4(this.model.matrixWorld.clone().invert());
    this.endMorphs=this.ends.map(p=>{const s=nearest(this.model.localToWorld(p.clone()));return{draw:new THREE.Vector3(...s.draw).applyMatrix3(inverse),recoil:new THREE.Vector3(...s.recoil).applyMatrix3(inverse)};});
    const long = definition.type === 17;
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (/Taut_.*(String|Bowstring)/.test(o.name)) {
        this.ropes.push(
          new DynamicRope(
            o,
            long ? 0.001 : 0.00085,
            this.ends[0].y,
            this.ends[1].y,
            long ? [0.972, 0.035, 0.004, 0.89] : [0.97, 0.045, 0.004, 0.88],
          ),
        );
      } else if (/Serving/.test(o.name)) {
        this.ropes.push(
          new DynamicRope(o, long ? 0.00155 : 0.00135, this.arrowHeight - 0.026, this.arrowHeight + 0.026, long ? [0.84, 0.62, 0.014, 0.073] : [0.86, 0.4, 0.016, 0.1], true),
        );
      } else if (/Stave|Nock|Recurve_Tips|String_Loops|Bowstring_Loops/.test(o.name)) {
        o.geometry = o.geometry.clone();
        const rest=new Float32Array(o.geometry.attributes.position.array),draw=new Float32Array(rest.length),recoil=new Float32Array(rest.length),samples=bowMorphSamples(definition.type);
        const box=this.fittedBounds,size=box.getSize(new THREE.Vector3());
        const sourceBox=new THREE.Box3().setFromPoints(samples.map(v=>new THREE.Vector3(...v.base))),sourceSize=sourceBox.getSize(new THREE.Vector3());
        o.updateWorldMatrix(true,false);
        for(let i=0;i<rest.length/3;i++){
          const point=new THREE.Vector3().fromArray(rest,i*3).applyMatrix4(o.matrixWorld),normal=point.clone().sub(box.min).divide(size);
          let best=samples[0],distance=Infinity;
          for(const sample of samples){const candidate=new THREE.Vector3(...sample.base).sub(sourceBox.min).divide(sourceSize),d=candidate.distanceToSquared(normal);if(d<distance){distance=d;best=sample;}}
          const inverse=new THREE.Matrix3().setFromMatrix4(o.matrixWorld.clone().invert());draw.set(new THREE.Vector3(...best.draw).applyMatrix3(inverse).toArray(),i*3);recoil.set(new THREE.Vector3(...best.recoil).applyMatrix3(inverse).toArray(),i*3);
        }
        this.deform.push({geometry:o.geometry,rest,draw,recoil});
      }
    });
    void steelWeapons
      .arrow()
      .then((arrow) => {
        if (!this.alive) return;
        this.arrow = arrow;
        const bounds = new THREE.Box3().setFromObject(arrow);
        this.arrowBaseY = bounds.min.y;
        model.add(arrow);
      })
      .catch((e) => console.warn('Could not load the Steel bow arrow:', e));
  }
  update(swing: Swing | undefined, arrowReady: boolean): void {
    const controls=bowAttachmentPose(this.bowType,swing);
    if(this.arrow){this.arrow.visible=arrowReady&&controls.attached;this.arrow.position.copy(controls.arrowPosition);this.arrow.quaternion.copy(controls.arrowRotation);this.arrow.updateWorldMatrix(true,false);}
    // Transfer the source morph displacements to our distinct mesh. No invented bend/recoil curves.
    for(const {geometry,rest,draw,recoil}of this.deform){const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setXYZ(i,rest[i*3]+draw[i*3]*controls.draw+recoil[i*3]*controls.recoil,rest[i*3+1]+draw[i*3+1]*controls.draw+recoil[i*3+1]*controls.recoil,rest[i*3+2]+draw[i*3+2]*controls.draw+recoil[i*3+2]*controls.recoil);p.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();}
    const end=(i:number)=>this.ends[i].clone().addScaledVector(this.endMorphs[i].draw,controls.draw).addScaledVector(this.endMorphs[i].recoil,controls.recoil);
    const lower=end(0),upper=end(1),middle=lower.clone().lerp(upper,(this.arrowHeight-lower.y)/(upper.y-lower.y));
    if(this.arrow&&controls.attached)middle.copy(this.model.worldToLocal(this.arrow.localToWorld(new THREE.Vector3(0,this.arrowBaseY,0))));
    else middle.z=this.arrowSide;
    for(const rope of this.ropes)rope.update(lower,middle,upper);
  }

  dispose(): void {
    this.alive = false;
    this.ropes.forEach((r) => r.dispose());
    this.deform.forEach((d) => d.geometry.dispose());
  }
}

class FlailRig {
  readonly physics: ChainPhysics;
  private readonly sizeScale: number;
  private readonly source: THREE.Object3D;
  private readonly anchor: THREE.Vector3;
  private readonly links: THREE.Mesh[] = [];
  private readonly head = new THREE.Group();
  private readonly owned: THREE.BufferGeometry[] = [];
  private started = false;
  private viewAnchor?:THREE.Vector3;
  private viewRotation?:THREE.Quaternion;
  constructor(
    model: THREE.Group,
    readonly scene: THREE.Scene,
  ) {
    this.sizeScale = (model.userData.weaponSize as WeaponSizeFit | undefined)?.scale ?? 1;
    this.physics = new ChainPhysics([.0427,.0628,.0628,.0628,.0628,.0628,.0427,.106].map(v=>v*this.sizeScale), .11*this.sizeScale, {linkRadius:.024*this.sizeScale,damping:9});
    this.head.scale.setScalar(this.sizeScale);
    this.source = originalGroup(model);
    const data = this.source.userData;
    this.anchor = new THREE.Vector3(...(data.attachmentCenter as Vec3));
    const chain = model.getObjectByName('Six_Interlocked_Oval_Chain_Links') as THREE.Mesh,
      geometry = chain.geometry.index ? chain.geometry.toNonIndexed() : chain.geometry,
      n = geometry.attributes.position.count / 6;
    chain.visible = false;
    for (let j = 0; j < 6; j++) {
      const g = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(geometry.attributes))
        g.setAttribute(
          name,
          new THREE.BufferAttribute(new Float32Array(a.array.slice(j * n * a.itemSize, (j + 1) * n * a.itemSize)), a.itemSize),
        );
      g.computeBoundingBox();
      const center = g.boundingBox!.getCenter(new THREE.Vector3());
      g.translate(-center.x, -center.y, -center.z);
      const link = new THREE.Mesh(g, chain.material);
      link.scale.setScalar(this.sizeScale);
      this.links.push(link);
      this.owned.push(g);
      scene.add(link);
    }
    const headCenter = new THREE.Vector3(this.anchor.x, (data.headEyeY as number) - 0.106, 0);
    for (const name of ['Head_Attachment_Eye', 'Hammered_Faceted_Steel_Head', 'Twelve_Broad_Pyramid_Teeth', 'Solid_Head_Eye_Neck']) {
      const object = model.getObjectByName(name)!;
      object.removeFromParent();
      object.position.sub(headCenter);
      this.head.add(object);
    }
    scene.add(this.head);
  }
  controlHandle(pivot:THREE.Group,dt:number):void {
    // Bound abrupt attachment/shaft changes before they reach the heavy chain.
    if(this.viewRotation)pivot.quaternion.copy(this.viewRotation.clone().rotateTowards(pivot.quaternion,Math.max(0,dt)*6));
    this.viewRotation=pivot.quaternion.clone();pivot.updateMatrixWorld(true);
    const anchor=this.source.localToWorld(this.anchor.clone()),target=anchor.clone();target.z=Math.min(target.z,-.24);
    if(this.viewAnchor){const delta=target.clone().sub(this.viewAnchor),limit=Math.max(0,dt)*3.5;if(delta.length()>limit)target.copy(this.viewAnchor).add(delta.setLength(limit));}
    pivot.position.add(target.clone().sub(anchor));pivot.updateMatrixWorld(true);this.viewAnchor=target;
  }
  rememberHandleAnchor(): void {
    this.viewAnchor=this.source.localToWorld(this.anchor.clone());
  }
  update(dt: number, environment?: WeaponEnvironment, swing?:Swing): void {
    const toPhysics = (point: THREE.Vector3) => (environment ? v3(environment.toWorld(point)).divideScalar(METRES_TO_WORLD) : point);
    const toView = (point: Vec3) => (environment ? environment.toView(point.map((v) => v * METRES_TO_WORLD) as Vec3) : v3(point));
    const anchorView=this.source.localToWorld(this.anchor.clone()),anchor = toPhysics(anchorView);
    const guide=flailSwingGuide(swing),guideView=new THREE.Vector3(...guide.direction);
    const guideDirection=toPhysics(guideView).sub(toPhysics(new THREE.Vector3())).normalize().toArray() as Vec3;
    if (!this.started) {
      this.physics.reset(anchor.toArray());
      this.started = true;
    }
    const transform = this.source.matrixWorld;
    const handlePoint = (y: number) =>
      toPhysics(
        new THREE.Vector3(-0.215 + Math.sin((70 * Math.PI) / 180) * y, 0.065 + Math.cos((70 * Math.PI) / 180) * y, 0).applyMatrix4(
          transform,
        ),
      );
    const a = handlePoint(-0.354),
      b = handlePoint(0.485),
      shaft = b.clone().sub(a),
      length = shaft.lengthSq();
    this.physics.update(dt, anchor.toArray(), [0, -9.81, 0], (point, radius) => {
      const view = toView(point), safeZ = Math.min(-.18-radius,anchorView.z-radius*.6);
      if (view.z > safeZ) {
        view.z = safeZ;
        const corrected = toPhysics(view),
          outward = toPhysics(new THREE.Vector3(0, 0, -1)).sub(toPhysics(new THREE.Vector3())).normalize();
        return { point: corrected.toArray(), normal: outward.toArray() };
      }
      const p = v3(point),
        f = THREE.MathUtils.clamp(p.clone().sub(a).dot(shaft) / length, 0, 1),
        closest = a.clone().addScaledVector(shaft, f),
        away = p.clone().sub(closest),
        distance = away.length(),
        min = radius + 0.026*this.sizeScale;
      if (distance > 1e-7 && distance < min && p.distanceTo(anchor) > 0.075*this.sizeScale) {
        const normal = away.divideScalar(distance);
        return {
          point: closest.addScaledVector(normal, min).toArray(),
          normal: normal.toArray(),
        };
      }
      if (environment) {
        const world = point.map((v) => v * METRES_TO_WORLD) as Vec3,
          contact = environment.sphere(world, radius * METRES_TO_WORLD);
        if (contact)
          return {
            point: contact.point.map((v) => v / METRES_TO_WORLD) as Vec3,
            normal: contact.normal,
          };
      }
      return undefined;
    },{...guide,direction:guideDirection});
    this.links.forEach((mesh, i) => {
      const previous = toView(this.physics.points[i]),
        next = toView(this.physics.points[i + 2]);
      mesh.position.copy(toView(this.physics.points[i + 1]));
      mesh.quaternion.setFromUnitVectors(UP, previous.sub(next).normalize());
    });
    const end = this.physics.points.length - 1;
    this.head.position.copy(toView(this.physics.points[end]));
    this.head.quaternion.setFromUnitVectors(
      UP,
      toView(this.physics.points[end - 1])
        .sub(toView(this.physics.points[end]))
        .normalize(),
    );
  }
  headPoint(): THREE.Vector3 {
    return this.head.position.clone();
  }
  dispose(): void {
    this.links.forEach((l) => l.removeFromParent());
    this.head.removeFromParent();
    this.owned.forEach((g) => g.dispose());
  }
}

export class SteelWeaponRig {
  private previousWalked = 0;
  private movementClock = 0;
  private movementMode: WeaponMovement | undefined;

  private animationClock = 0;
  private readonly pressMotion = new WeaponPressMotion();
  private blockAmount = 0;
  private readonly visibilityPoints: THREE.Vector3[] = [];
  readonly pivot = new THREE.Group();
  viewportAspect=16/9;
  private readonly normalized = new THREE.Group();
  private bow: BowRig | undefined;
  private flail: FlailRig | undefined;
  private swing: Swing | undefined;
  private lastTip: Vec3 | undefined;
  private hitThisSwing = false;
  private readonly strikePoint = new THREE.Vector3();
  private readonly tailPoints: THREE.Vector3[] = [];
  constructor(
    readonly model: THREE.Group,
    readonly definition: SteelWeaponDefinition,
    readonly scene: THREE.Scene,
  ) {
    const fit = model.userData.weaponSize as WeaponSizeFit | undefined;
    // The flail was authored with a tilted shaft. Correct the asset's local axes;
    // all animation socket transforms remain untouched. Other meshes use source axes/origins.
    if (definition.style === 'flail') {
      model.position.sub(new THREE.Vector3(...(fit?.grip ?? definition.grip)));
      this.normalized.rotation.z=definition.axisRoll;
    }
    this.normalized.add(model);
    this.pivot.add(this.normalized);
    scene.add(this.pivot);
    this.pivot.updateMatrixWorld(true);
    let highest = -Infinity;
    const points: THREE.Vector3[] = [], visibilityCandidates: THREE.Vector3[] = [];
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const positions = o.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
        points.push(point.clone());
        if (definition.style !== 'flail' || /Handle|Grip|Socket/.test(o.name) && !/Eye/.test(o.name)) visibilityCandidates.push(point.clone());
        if (point.y > highest) {
          highest = point.y;
          this.strikePoint.copy(point);
        }
      }
    });
    const visibilityTop = Math.max(...visibilityCandidates.map(p=>p.y));
    const upper = visibilityCandidates.filter(p => p.y > Math.max(.02, visibilityTop * .20));
    const step = Math.max(1, Math.floor(upper.length / 160));
    this.visibilityPoints.push(...upper.filter((_,i)=>i%step===0));
    const bottom = Math.min(...points.map(p => p.y));
    // Only the end of the grip/haft/limb needs to stay outside the frame. Preserve the authored mesh.
    this.tailPoints.push(...points.filter(p => p.y <= bottom + .008));
    if (definition.style === 'bow') this.bow = new BowRig(model, definition);
    if (definition.style === 'flail') this.flail = new FlailRig(model, scene);
  }
  impact(_material:SurfaceMaterial,_pose:GripPose,_bash=false):void {
    // Gameplay supplies terrain feedback; never deform or freeze the source pose.
  }
  update(
    swing: Swing | undefined,
    guard: boolean,
    walked: number,
    lowered: number,
    dt: number,
    arrowReady = true,
    environment?: WeaponEnvironment,
    _look?: LookPose,
    sneaking = false,
    charging = false,
  ): void {
    if (swing !== this.swing) {
      this.swing = swing;
      this.lastTip = undefined;
      this.hitThisSwing = false;
    }
    this.animationClock += dt;
    const distance = Math.abs(walked-this.previousWalked);this.previousWalked=walked;
    const mode:WeaponMovement|undefined = distance>1e-6 ? sneaking?'sneak':dt>0&&distance/dt>2?'run':'walk' : undefined;
    if(mode!==this.movementMode){this.movementMode=mode;this.movementClock=0;}else this.movementClock+=dt;
    const fittedGrip=this.definition.style==='flail'?[0,0,0] as [number,number,number]:(this.model.userData.weaponSize as WeaponSizeFit|undefined)?.grip;
    const pose=swing?.bash?shoveGrip(this.definition,swing,fittedGrip):animatedGrip(this.definition,swing,false,walked,lowered,Number(sneaking),mode&&this.definition.type!==15?this.movementClock:this.animationClock,mode,this.animationClock);
    this.pivot.position.fromArray(pose.position);
    this.pivot.quaternion.copy(poseQuaternion(pose));
    this.pressMotion.update(charging&&!guard&&!swing&&this.definition.style!=='bow',dt);
    this.pressMotion.apply(this.pivot.position,this.pivot.quaternion);
    // A bash begins and ends in guard: retain it when gameplay clears the swing.
    if(swing)this.blockAmount=swing.bash?1:0;
    else this.blockAmount=THREE.MathUtils.clamp(this.blockAmount+(guard?1:-1)*dt/.18,0,1);
    if(this.blockAmount>0&&!swing){const fit=this.model.userData.weaponSize as WeaponSizeFit|undefined,block=guardGrip(this.definition,this.definition.style==='flail'?[0,0,0]:fit?.grip);this.pivot.position.lerp(new THREE.Vector3(...block.position),this.blockAmount);this.pivot.quaternion.slerp(poseQuaternion(block),this.blockAmount);}
    this.pivot.updateMatrixWorld(true);
    this.bow?.update(swing,arrowReady);
    this.pivot.updateMatrixWorld(true);
    this.flail?.controlHandle(this.pivot,dt);
    if(this.definition.style!=='bow'){
      const e=new THREE.Euler().setFromQuaternion(this.pivot.quaternion,'YXZ');
      const framed=hideWeaponTail({position:this.pivot.position.toArray(),rotation:[e.x,e.y,e.z]},this.tailPoints,WEAPON_MOTION_FOV,this.viewportAspect,this.visibilityPoints);
      this.pivot.position.fromArray(framed.position);
    }
    this.pivot.updateMatrixWorld(true);
    this.flail?.rememberHandleAnchor();
    this.flail?.update(dt, environment,swing);
    if (swing && swing.kind !== 'shoot' && environment && !this.hitThisSwing) {
      const point = this.flail ? this.flail.headPoint() : this.pivot.localToWorld(this.strikePoint.clone()),
        tip = environment.toWorld(point),
        t = swing.time / swing.duration;
      if (this.lastTip && t > (swing.hitAt ?? .5) - .16 && t < (swing.hitAt ?? .5) + .18) {
        const hit = environment.sweep(this.lastTip, tip);
        if (hit && hit.material !== 'soft') {
          this.impact(hit.material, pose, !!swing.bash);
          this.hitThisSwing = true;
          environment.contact?.(hit, swing);
        }
      }
      this.lastTip = tip;
    }
  }
  terrainImpact(material: SurfaceMaterial, bash = false): void {
    this.impact(material, animatedGrip(this.definition, this.swing, false, 0, 0), bash);
  }
  dispose(): void {
    this.pivot.removeFromParent();
    this.bow?.dispose();
    this.flail?.dispose();
  }
}
