import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {weaponAttackPose,weaponAttackClip,weaponAttackSpeed} from '../src/render/weaponMotion';
import {poseQuaternion} from '../src/render/weaponAnimation';
import {blendRotationContinuous} from '../src/render/weaponMotionRuntime';
import {DynamicRope} from '../src/render/steelWeaponRig';

describe('continuous attack recovery',()=>{
 for(let type=0;type<16;type++)it(`joins every normal/power and reversed attack continuously for weapon ${type}`,()=>{
  for(const kind of ['right','chop','thrust'] as const)for(const power of [false,true])for(const sweepDirection of [undefined,-1,1] as const){
   const c=weaponAttackClip(type,kind,power),speed=weaponAttackSpeed(type),duration=c.duration/speed;let elapsed=0;
   for(let i=0;i<c.segments.length-1;i++){
    elapsed+=c.segments[i][1]-c.segments[i][0];const time=elapsed/speed,s={kind,power,sweepDirection,duration,struck:false};
    const before=weaponAttackPose(type,{...s,time:time-1e-7}),at=weaponAttackPose(type,{...s,time}),after=weaponAttackPose(type,{...s,time:time+1e-7});
    for(const p of [at,after]){expect(new THREE.Vector3(...before.position).distanceTo(new THREE.Vector3(...p.position))).toBeLessThan(1e-5);expect(poseQuaternion(before).angleTo(poseQuaternion(p))).toBeLessThan(1e-4);}
   }
  }
 });
 it('does not change rotation paths when a mirrored fade crosses a half turn',()=>{
  const base=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),ref=new THREE.Quaternion().setFromAxisAngle(axis,Math.PI-.05);
  const before=blendRotationContinuous(base,new THREE.Quaternion().setFromAxisAngle(axis,Math.PI-1e-6),.6,ref),after=blendRotationContinuous(base,new THREE.Quaternion().setFromAxisAngle(axis,Math.PI+1e-6),.6,ref);
  expect(before.angleTo(after)).toBeLessThan(2e-6);
 });
 for(const type of [12,14])it(`removes the reversed power-recovery half turn for weapon ${type}`,()=>{
  const c=weaponAttackClip(type,'right',true),duration=c.duration/weaponAttackSpeed(type);let previous:THREE.Quaternion|undefined,maxStep=0;
  for(let i=2040;i<=2400;i++){const q=poseQuaternion(weaponAttackPose(type,{kind:'right',power:true,sweepDirection:1,time:duration*i/2400,duration,struck:false}));if(previous)maxStep=Math.max(maxStep,previous.angleTo(q));previous=q;}
  expect(maxStep).toBeLessThan(.06);
 });
});

describe('bow string and serving follow the nock',()=>{
 for(const centred of [false,true])it(`keeps the ${centred?'serving wrap':'main string'} centre ring on the nock throughout draw/recoil`,()=>{
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(),new THREE.MeshBasicMaterial()),rope=new DynamicRope(mesh,.001,-.026,.026,[.2,.2,.1,.5],centred);
  for(const phase of [0,.1,.5,1,.8,0]){
   const lower=new THREE.Vector3(-.02,-.6,.01),middle=new THREE.Vector3(.05*phase,.2*phase,.04+.5*phase),upper=new THREE.Vector3(.02,.6,.01);
   rope.update(lower,middle,upper);const p=rope.geometry.attributes.position,normal=rope.geometry.attributes.normal,centre=new THREE.Vector3();
   for(let j=0;j<6;j++)centre.add(new THREE.Vector3().fromBufferAttribute(p,16*7+j));centre.divideScalar(6);expect(centre.distanceTo(middle)).toBeLessThan(1e-7);
   for(let i=0;i<p.count;i++){expect([p.getX(i),p.getY(i),p.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i)].every(Number.isFinite)).toBe(true);expect(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))).toBeCloseTo(1,5);}
  }
  rope.dispose();mesh.material.dispose();
 });
});
