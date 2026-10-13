import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {hideWeaponTail} from '../src/render/weaponFraming';
import {WalkingCameraMotion} from '../src/game/walkingCamera';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {itemKey} from '../src/game/items';
import {textLevel} from './helpers/level';
import {guardGrip,shoveGrip,poseQuaternion} from '../src/render/weaponAnimation';
import {STEEL_WEAPON_DEFINITIONS as defs} from '../src/render/steelWeaponDefinitions';
import {SteelWeaponRig} from '../src/render/steelWeaponRig';
import {fitWeaponModel} from '../src/render/weaponModelSizing';
import {weaponReadyPose,weaponAttackPose,weaponAttackSpeed,weaponAttackClip} from '../src/render/weaponMotion';

const walking={grounded:true,sprinting:false,sneaking:false,aiming:false};
describe('walking camera movement',()=>{
  it('is bounded, agrees across frame rates and smoothly settles when stopped',()=>{
    const a=new WalkingCameraMotion(),b=new WalkingCameraMotion();
    for(let i=1;i<=120;i++)a.update(1/60,i*2.2/60,walking);
    for(let i=1;i<=240;i++)b.update(1/120,i*2.2/120,walking);
    for(const key of ['side','lift','roll'] as const)expect(a.value[key]).toBeCloseTo(b.value[key],9);
    expect(Math.abs(a.value.side)).toBeLessThan(.0046);expect(Math.abs(a.value.lift)).toBeLessThan(.0061);expect(Math.abs(a.value.roll)).toBeLessThan(.0051);
    const frozen={...a.value};a.update(0,4.4,walking);expect(a.value).toEqual(frozen);
    for(let i=0;i<120;i++)a.update(1/60,4.4,walking);
    expect(Math.max(...Object.values(a.value).map(Math.abs))).toBeLessThan(1e-8);
  });
  it('softens while aiming/sneaking and does not bob in mid-air',()=>{
    const normal=new WalkingCameraMotion(),aim=new WalkingCameraMotion(),sneak=new WalkingCameraMotion(),air=new WalkingCameraMotion();
    for(let i=1;i<=120;i++){
      const distance=i*.015;
      normal.update(1/60,distance,walking);aim.update(1/60,distance,{...walking,aiming:true});sneak.update(1/60,distance,{...walking,sneaking:true});air.update(1/60,distance,{...walking,grounded:false});
    }
    expect(Math.abs(aim.value.roll)).toBeLessThan(Math.abs(normal.value.roll)*.36);
    expect(Math.abs(sneak.value.roll)).toBeLessThan(Math.abs(normal.value.roll)*.41);
    expect(air.value).toEqual({side:0,lift:0,roll:0});
  });
});
describe('staff power thrust and weapon shove',()=>{
  for(const [forward,strafe] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])it(`uses a staff thrust with movement ${forward},${strafe}`,()=>{
    const d=new Dungeon(textLevel(['############','#@.........#','#..........#','############']),undefined);
    const item=d.inventory.add({kind:'weapon',name:'Steel Staff',type:0,material:1,damage:[2,4],twoHanded:true,weight:3,value:1});d.use(itemKey(item));
    d.update(.001,{...IDLE_INPUT,forward,strafe,attack:{held:true,pressed:true,released:false}});
    for(let i=0;i<60;i++)d.update(1/120,{...IDLE_INPUT,forward,strafe,attack:{held:true,pressed:false,released:false}});
    expect(d.swing?.power).toBe(true);expect(d.swing?.kind).toBe('thrust');
    expect(weaponAttackClip(0,'chop',true).group).toContain('thrust');
  });
  it('keeps every shove on its block orientation, pushes forward at impact and returns to guard',()=>{
    for(const def of defs.slice(0,18)){
      const grip:[number,number,number]=[.02,-.2,.005],base=guardGrip(def,grip),s={kind:'thrust' as const,bash:true,power:false,struck:false,time:0,duration:.3};
      expect(shoveGrip(def,s,grip)).toEqual(base);
      const hit=shoveGrip(def,{...s,time:.15},grip);expect(hit.position[2]).toBeLessThan(base.position[2]-.1);expect(hit.rotation).toEqual(base.rotation);
      expect(shoveGrip(def,{...s,time:.3},grip)).toEqual(base);
    }
  });
  it('shares the hammer hand position across other two-handed guards and points cutting edges outward',()=>{
    const hammer=guardGrip(defs[13]);
    for(const def of defs.slice(0,16)){
      const pose=guardGrip(def);
      if(def.twoHanded&&def.type!==15&&def.type!==14)expect(pose.position).toEqual(hammer.position);
      if(def.edgeAxis&&def.type!==15){
        const facing=def.modelFacingYaw??(def.edgeAxis===-1?Math.PI:0);
        const edge=new THREE.Vector3(def.edgeAxis,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),facing).applyQuaternion(poseQuaternion(pose));
        expect(edge.z).toBeLessThan(-.999);
      }
    }
  });
});

describe('two-handed ready placement',()=>{
  it('shares the hammer angle and position at rest and while walking, without applying it to bows',()=>{
    for(const clock of [0,.3,2,7])for(const movement of [undefined,'walk','sneak','run'] as const){
      const hammer=weaponReadyPose(13,clock,movement,clock);
      for(const def of defs.slice(0,16).filter(d=>d.twoHanded))expect(weaponReadyPose(def.type,clock,movement,clock)).toEqual(hammer);
      for(const type of [16,17])expect(weaponReadyPose(type,clock,movement,clock)).not.toEqual(hammer);
    }
  });
  it('starts and finishes each two-handed attack at the shared ready stance',()=>{
    for(const def of defs.slice(0,16).filter(d=>d.twoHanded&&d.type!==13))for(const kind of ['right','chop','thrust'] as const)for(const power of [false,true]){
      const clip=weaponAttackClip(def.type,kind,power),duration=clip.duration/weaponAttackSpeed(def.type),ready=weaponReadyPose(def.type,0,undefined,2);
      for(const time of [0,duration]){
        const pose=weaponAttackPose(def.type,{kind,power,time,duration,struck:false},2);
        expect(pose.position).toEqual(ready.position);expect(poseQuaternion(pose).angleTo(poseQuaternion(ready))).toBeLessThan(1e-7);
      }
    }
  });
});

describe('held guard after a shove',()=>{
  it('returns directly to the fitted block without dropping to idle and raising again',()=>{
    for(const def of defs.slice(0,16).filter(d=>d.style!=='flail')){
      const model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(.1,1,.03),new THREE.MeshBasicMaterial()));
      const fitted=fitWeaponModel(model,def),rig=new SteelWeaponRig(fitted,def,new THREE.Scene()),block=guardGrip(def,fitted.userData.weaponSize.grip);
      rig.update(undefined,true,0,0,.2);
      const shove={kind:'thrust' as const,bash:true,power:false,struck:false,time:0,duration:.3};
      for(const time of [0,.1,.15,.2,.29,.3])rig.update({...shove,time},false,0,0,1/60);
      const end=rig.pivot.position.clone(),expectedBlock=def.style!=='bow'?hideWeaponTail(block,(rig as unknown as {tailPoints:THREE.Vector3[]}).tailPoints,60,rig.viewportAspect,(rig as unknown as {visibilityPoints:THREE.Vector3[]}).visibilityPoints):block;
      rig.update(undefined,true,0,0,1/60);
      expect(rig.pivot.position.distanceTo(end)).toBeLessThan(1e-10);
      expect(rig.pivot.position.distanceTo(new THREE.Vector3(...expectedBlock.position))).toBeLessThan(1e-10);
      expect(rig.pivot.quaternion.angleTo(poseQuaternion(block))).toBeLessThan(1e-7);
      // Releasing the block lowers it gradually instead of snapping to idle.
      rig.update(undefined,false,0,0,1/60);
      expect(rig.pivot.position.distanceTo(end)).toBeGreaterThan(0);
      expect(rig.pivot.position.distanceTo(end)).toBeLessThan(.1);
      rig.dispose();
    }
  });
});
