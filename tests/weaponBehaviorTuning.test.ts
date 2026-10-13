import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {projectile,stepProjectile,segmentBox,METRES_TO_WORLD,type SurfaceMaterial} from '../src/game/projectilePhysics';
import {ChainPhysics,type Vec3} from '../src/game/chainPhysics';
import {guardGrip,shoveGrip,poseQuaternion} from '../src/render/weaponAnimation';
import {STEEL_WEAPON_DEFINITIONS as defs} from '../src/render/steelWeaponDefinitions';
import {weaponReadyPose} from '../src/render/weaponMotion';

const walls=(material:SurfaceMaterial)=>(from:Vec3,to:Vec3)=>{
  const hits=[{min:[1,-1,-2] as Vec3,max:[1.01,2,2] as Vec3}, {min:[-4,-.1,-4] as Vec3,max:[4,0,4] as Vec3}];
  let best:ReturnType<typeof segmentBox>;
  for(const box of hits){const hit=segmentBox(from,to,box.min,box.max);if(hit&&(!best||hit.fraction<best.fraction))best=hit;}
  return best?{...best,point:from.map((v,k)=>v+(to[k]-v)*best!.fraction) as Vec3,material}:undefined;
};
describe('gentle recoverable arrow impacts',()=>{
  for(const material of ['metal','stone'] as const)it(`pings off ${material} and drops within a metre instead of flying back`,()=>{
    for(const lateral of [0,3]){
      const p=projectile([.8,1.6*METRES_TO_WORLD,0],[45*METRES_TO_WORLD,0,lateral*METRES_TO_WORLD]);
      stepProjectile(p,1/60,walls(material));
      expect(p.bounces).toBe(1);expect(p.velocity[0]).toBeLessThan(0);
      expect(Math.hypot(p.velocity[0],p.velocity[2])/METRES_TO_WORLD).toBeLessThanOrEqual(.801);
      expect(Math.abs(p.angularSpeed)).toBeLessThanOrEqual(.7);
      for(let i=0;i<360;i++)stepProjectile(p,1/120,walls(material));
      expect(p.phase).toBe('resting');expect(Math.hypot(p.position[0]-1,p.position[2])/METRES_TO_WORLD).toBeLessThan(1);
    }
  });
  it('still embeds in wood and soft terrain',()=>{
    for(const material of ['wood','soft'] as const){const p=projectile([.8,.5,0],[45*METRES_TO_WORLD,0,0]);stepProjectile(p,1/60,walls(material));expect(p.phase).toBe('embedded');}
  });
});
describe('weapon facing and guards',()=>{
  it('gives bows the broadsword block angle and preserves that facing through a shove',()=>{
    for(const type of [16,17]){
      const guard=guardGrip(defs[type]),q=poseQuaternion(guard),shaft=new THREE.Vector3(0,1,0).applyQuaternion(q);
      expect(q.angleTo(poseQuaternion(guardGrip(defs[3])))).toBeLessThan(1e-7);expect(shaft.y).toBeGreaterThan(.6);
      const shove=shoveGrip(defs[type],{kind:'thrust',bash:true,power:false,struck:false,time:.15,duration:.3});
      expect(shove.rotation).toEqual(guard.rotation);
      expect(shove.position[2]).toBeLessThan(guard.position[2]);
    }
  });
  it('blocks with the battle axe broadside in the same orientation as the hammer',()=>{
    const axe=guardGrip(defs[15]),hammer=guardGrip(defs[13]);expect(axe.rotation).toEqual(hammer.rotation);
    const face=new THREE.Vector3(0,0,1).applyQuaternion(poseQuaternion(axe));expect(Math.abs(face.z)).toBeGreaterThan(.9);
  });
  it('fits the katana convex cutting side outward at ready and block',()=>{
    const def=defs[9];expect(def.edgeAxis).toBe(-1);
    const edge=new THREE.Vector3(-1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
    for(const pose of [weaponReadyPose(9),guardGrip(def)])expect(edge.clone().applyQuaternion(poseQuaternion(pose)).z).toBeLessThan(0);
  });
});
describe('controlled outward flail chain',()=>{
  it('damps reverse motion while keeping an outward bias and stable link lengths',()=>{
    const lengths=[.0427,.0628,.0628,.0628,.0628,.0628,.0427,.106],chain=new ChainPhysics(lengths,.11,{damping:9});
    chain.reset([0,0,0]);
    for(let i=0;i<600;i++){
      const t=i/120,anchor:[number,number,number]=[t<1?Math.sin(t*Math.PI*2)*.18:0,0,0],drive=t<1?Math.sin(t*Math.PI):0;
      const direction=new THREE.Vector3(0,-.92+.57*drive,-.39-.55*drive).normalize().toArray() as Vec3;
      chain.update(1/120,anchor,[0,-9.81,0],(point,radius)=>point[2]>-radius*.6?{point:[point[0],point[1],-radius*.6],normal:[0,0,-1]}:undefined,{direction,strength:32,damping:8});
      expect(chain.points.flat().every(Number.isFinite)).toBe(true);
      expect(chain.points.at(-1)![2]).toBeLessThanOrEqual(-.066+1e-8);
      for(let j=1;j<chain.points.length;j++)expect(Math.abs(Math.hypot(...chain.points[j].map((v,k)=>v-chain.points[j-1][k]))-lengths[j-1])).toBeLessThan(.008);
    }
    expect(Math.abs(chain.points.at(-1)![0])).toBeLessThan(.01);
    expect(Math.hypot(...chain.points.at(-1)!.map((v,k)=>v-chain.previous.at(-1)![k]))*120).toBeLessThan(.01);
  });
});
