import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import fixtures from './fixtures/weapon-motion-reference.json';
import {weaponMotionSource as source} from '../src/render/weaponMotion';
import {sampleWeaponMotion,weaponAttackPose,weaponAttackClip,weaponAttackSpeed,weaponMotionProfile,weaponReadyPose,bowMotionState,bowAttachmentPose,bowReleaseTiming,BOW_MOTION_MARKERS} from '../src/render/weaponMotion';
import {animatedGrip,guardGrip,poseQuaternion} from '../src/render/weaponAnimation';
import {STEEL_WEAPON_DEFINITIONS as defs} from '../src/render/steelWeaponDefinitions';
import {SteelWeaponRig} from '../src/render/steelWeaponRig';
import {steelAttackDuration,steelImpactAt} from '../src/game/weaponHandling';
import {fitWeaponModel} from '../src/render/weaponModelSizing';
import {hideWeaponTail} from '../src/render/weaponFraming';
import {ChainPhysics} from '../src/game/chainPhysics';
describe('first-person controller playback at the local attack rate',()=>{
 it('matches the independently evaluated full original skeleton across every source family',()=>{
  expect(source.sourceSha256).toBe('0d3b4b29797879d0491fd3d061db7a71094d2f7154470678f3096cf235f6bb15');
  for(const f of fixtures){const p=sampleWeaponMotion(f.time);expect(new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...f.cameraRelative))).toBeLessThan(1e-9);expect(poseQuaternion(p).angleTo(new THREE.Quaternion(...f.quaternion).normalize())).toBeLessThan(1e-6);}
 });
 it('keeps damage markers synchronized while bounding the subtle pose edits for every melee weapon',()=>{
  for(const d of defs.slice(0,16))for(const kind of ['right','chop','thrust'] as const)for(const power of [false,true]){
   const c=weaponAttackClip(d.type,kind,power),speed=weaponAttackSpeed(d.type),w={type:d.type,material:1,cif:'SWORD.CIF',name:d.name,damage:[1,4] as [number,number]};
   expect(steelAttackDuration(w,power,kind)).toBeCloseTo(c.duration/speed,12);expect(steelImpactAt(w,power,kind)*steelAttackDuration(w,power,kind)).toBeCloseTo(c.hit/speed,12);
   /* Flail overhead power chops intentionally raise the ball above the anchor. */if(d.type===12&&kind==='chop'&&power)continue;let elapsed=0;for(const [a,b] of c.segments){for(const u of [.01,.4,.99]){const s={kind,power,time:(elapsed+(b-a)*u)/speed,duration:c.duration/speed,struck:false};const expected=sampleWeaponMotion(a+(b-a)*u),actual=weaponAttackPose(d.type,s);const phase=s.time*speed/c.duration;if(d.twoHanded&&d.type!==13&&(phase<.12||phase>.85))continue;/* Recovery joins deliberately carry the outgoing pose for at most .1 seconds. */if(elapsed>0&&(b-a)*u<Math.min(.10*speed,(b-a)*.35))continue;expect(new THREE.Vector3(...actual.position).distanceTo(new THREE.Vector3(...expected.position))).toBeLessThan(.06+Math.abs(weaponMotionProfile(d.type).idleMotion?.offset[1]??0)+Math.abs(weaponMotionProfile(d.type).viewOffset?.[2]??0));expect(poseQuaternion(actual).angleTo(poseQuaternion(expected))).toBeLessThan(.15);}elapsed+=b-a;}
  }
 });
 it('keeps socket rotations and hit response unchanged while hiding melee handle ends',()=>{
  for(const type of [0,1,3,6,7,8,9,10,11,13,14]){
   const d=defs[type],model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(.1,1,.1),new THREE.MeshBasicMaterial()));const rig=new SteelWeaponRig(model,d,new THREE.Scene());
   const c=weaponAttackClip(type,'chop',true),s={kind:'chop' as const,time:c.hit*.7/weaponAttackSpeed(type),duration:c.duration,power:true,struck:false},expected=weaponAttackPose(type,s);
   for(const aspect of [.7,4/3,16/9,21/9]){rig.viewportAspect=aspect;rig.impact('stone',expected);rig.update(s,true,50,1,0,true,undefined,{yaw:2,pitch:1},true);const framed=d.style!=='bow'?hideWeaponTail(expected,(rig as unknown as {tailPoints:THREE.Vector3[]}).tailPoints,60,aspect,(rig as unknown as {visibilityPoints:THREE.Vector3[]}).visibilityPoints).position:expected.position;rig.pivot.position.toArray().forEach((v,i)=>expect(v).toBeCloseTo(framed[i],12));expect(rig.pivot.quaternion.angleTo(poseQuaternion(expected))).toBeLessThan(1e-7);}
   expect(animatedGrip(d,undefined,false,0,1,1,2)).toEqual(weaponReadyPose(type,2));rig.dispose();
  }
 });
 it('aligns the authored bow curve to the source while preserving the animation socket',()=>{
  for(const type of [16,17]){
   const m=new THREE.Group(),grip=new THREE.Mesh(new THREE.BoxGeometry(.02,.1,.02),new THREE.MeshBasicMaterial()),tip=new THREE.Mesh(new THREE.BoxGeometry(.01,.01,.01),new THREE.MeshBasicMaterial());grip.position.x=-.15;tip.position.set(.1,.6,0);m.add(grip,tip);const fit=fitWeaponModel(m,defs[type]);fit.updateMatrixWorld(true);expect(tip.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(grip.getWorldPosition(new THREE.Vector3()).x);expect(fit.userData.weaponSize.grip[0]).toBeCloseTo(grip.getWorldPosition(new THREE.Vector3()).x,8);
   const p=weaponReadyPose(type),q=poseQuaternion(p),forward=new THREE.Vector3(1,0,0).applyQuaternion(q);expect(forward.z).toBeLessThan(0);
  }
 });
 it('fits saber and dai-katana cutting edges to the source forward axis',()=>{
  for(const type of [4,10]){const m=new THREE.Group();m.add(new THREE.Mesh(new THREE.BoxGeometry(.05,1,.02),new THREE.MeshBasicMaterial()));const fit=fitWeaponModel(m,defs[type]);fit.updateMatrixWorld(true);const forward=new THREE.Vector3(defs[type].edgeAxis,0,0).applyQuaternion(m.quaternion).applyQuaternion(poseQuaternion(weaponReadyPose(type)));expect(forward.z).toBeLessThan(0);}
 });
 it('provides an angled held block for every weapon without changing its source attack',()=>{
  for(const d of defs.slice(0,18)){const block=guardGrip(d),axis=new THREE.Vector3(0,1,0).applyQuaternion(poseQuaternion(block));expect(axis.x).toBeLessThan(d.style==='bow'?-.15:-.6);expect(axis.y).toBeGreaterThan(.5);expect(block.position[2]).toBeLessThan(-.3);expect(animatedGrip(d,undefined,true,0,0)).toEqual(block);const s={kind:'right' as const,time:.1,duration:1,power:false,struck:false};expect(animatedGrip(d,s,true,0,0)).toEqual(weaponAttackPose(d.type,s));}
 });
 it('keeps the original bow attach, held draw, release and follow timestamps',()=>{
  for(const type of [16,17]){
   const draw=(time:number)=>({kind:'shoot' as const,time,duration:Infinity,power:false,struck:false});
   expect(bowMotionState(type,draw(.1)).attached).toBe(false);expect(bowMotionState(type,draw(.3)).attached).toBe(true);
   expect(bowMotionState(type,draw(10)).sourceTime).toBe(BOW_MOTION_MARKERS['shoot max attack']);
   const release=bowReleaseTiming(type,10),s={...draw(0),bowReleaseSource:release.start};expect(release.strength).toBe(1);
   expect(bowMotionState(type,{...s,time:release.hit+.001}).attached).toBe(false);
   expect(bowMotionState(type,{...s,time:release.duration}).sourceTime).toBeCloseTo(BOW_MOTION_MARKERS['shoot follow stop'],10);
   const a=bowAttachmentPose(type,draw(1.3)),b=bowAttachmentPose(type,draw(10));expect(a.arrowPosition.toArray().every(Number.isFinite)).toBe(true);expect(b.arrowRotation.length()).toBeCloseTo(1,8);expect(b.draw).toBeCloseTo(1,5);
  }
 });
});
describe('heavy flail ring-down',()=>{
 it('settles substantially faster than the former tennis-ball-like chain without stretching',()=>{
  const lengths=[.0427,.0628,.0628,.0628,.0628,.0628,.0427,.106];
  const heavy=new ChainPhysics(lengths),old=new ChainPhysics(lengths,.11,{damping:-120*Math.log(.997),headInverseMass:.12});
  for(const c of [heavy,old])c.reset([0,0,0],[1,0,0]);
  const motion=[0,0];for(let tick=0;tick<480;tick++)for(const [i,c]of [heavy,old].entries()){const before=[...c.points.at(-1)!];c.update(1/120,[0,0,0]);if(tick>=360)motion[i]+=Math.hypot(...c.points.at(-1)!.map((v,k)=>v-before[k]));}
  expect(motion[0]).toBeLessThan(motion[1]*.2);
  expect(Math.abs(heavy.points.at(-1)![0])).toBeLessThan(.02);
  for(let i=1;i<heavy.points.length;i++)expect(Math.abs(Math.hypot(...heavy.points[i].map((v,k)=>v-heavy.points[i-1][k]))-lengths[i-1])).toBeLessThan(.006);
 });
});
