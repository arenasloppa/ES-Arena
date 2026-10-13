import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {hideWeaponTail} from '../src/render/weaponFraming';
import {battleAxeMotionSource as source} from '../src/render/battleAxeMotion';
import fixtures from './fixtures/battle-axe-motion-reference.json';
import {weaponSizeReferences as sizes} from '../src/render/weaponModelSizing';
import {battleAxeAttack,battleAxeAttackClip,sampleBattleAxeMotion,AXE_WEAPON_FOV} from '../src/render/battleAxeMotion';
import {animatedGrip,poseQuaternion} from '../src/render/weaponAnimation';
import {STEEL_WEAPON_DEFINITIONS as defs} from '../src/render/steelWeaponDefinitions';
import {SteelWeaponRig} from '../src/render/steelWeaponRig';
import {fitWeaponModel,type WeaponSizeFit} from '../src/render/weaponModelSizing';
import {weaponPlaybackRate} from '../src/game/weaponPlayback';
import {weaponReadyPose} from '../src/render/weaponMotion';
const rate=weaponPlaybackRate(15);
import {steelAttackDuration,steelImpactAt} from '../src/game/weaponHandling';
describe('local first-person battle axe with attack playback tuning',()=>{
  it('matches independently extracted full skeleton and animated Camera samples',()=>{
    expect(source.sourceSha256).toBe('0d3b4b29797879d0491fd3d061db7a71094d2f7154470678f3096cf235f6bb15');
    expect(AXE_WEAPON_FOV).toBe(60);
    for(const f of fixtures){const p=sampleBattleAxeMotion(f.time);expect(new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...f.cameraRelative))).toBeLessThan(1e-9);expect(poseQuaternion(p).angleTo(new THREE.Quaternion(...f.quaternion).normalize())).toBeLessThan(1e-6);}
  });
  it('keeps the slower damage clock and bounds the subtle axe attack edits',()=>{
    for(const kind of ['right','left','chop','thrust'])for(const power of [false,true]){
      const c=battleAxeAttackClip(kind,power),w={type:15,material:1,cif:'AXE.CIF',name:'Steel Battle Axe',damage:[1,4] as [number,number]};
      expect(steelAttackDuration(w,power,kind)).toBe(c.duration/rate);expect(steelImpactAt(w,power,kind)*steelAttackDuration(w,power,kind)).toBeCloseTo(c.hit/rate,12);
      let elapsed=0;
      for(const [start,end]of c.segments){for(const f of [.001,.2,.5,.999]){const s={kind:kind as 'right',power,time:(elapsed+(end-start)*f)/rate,duration:c.duration/rate,hitAt:c.hit/c.duration,struck:false};if(elapsed>0&&(end-start)*f<Math.min(.10*rate,(end-start)*.35))continue;const actual=battleAxeAttack(s),expected=sampleBattleAxeMotion(start+(end-start)*f);expect(new THREE.Vector3(...actual.position).distanceTo(new THREE.Vector3(...expected.position))).toBeLessThan(.06);expect(poseQuaternion(actual).angleTo(poseQuaternion(expected))).toBeLessThan(.1);}elapsed+=end-start;}
    }
    expect(battleAxeAttackClip().duration).toBeCloseTo(2/3,4);
    expect(battleAxeAttackClip('right',true).duration).toBeCloseTo(16/15,4);
  });
  it('preserves axe socket rotation while framing its handle below the screen',()=>{
    const def=defs[15],model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(.2,1,.05),new THREE.MeshBasicMaterial()));
    const rig=new SteelWeaponRig(model,def,new THREE.Scene());
    for(const aspect of [.7,4/3,16/9,21/9])for(const power of [false,true]){
      const c=battleAxeAttackClip('right',power),s={kind:'right' as const,time:c.hit*.8,duration:c.duration,hitAt:c.hit/c.duration,power,struck:false},expected=battleAxeAttack(s);
      rig.viewportAspect=aspect;rig.impact('stone',expected);rig.update(s,true,150,1,0,true,undefined,{yaw:2,pitch:1},true);
      expect(rig.pivot.position.distanceTo(new THREE.Vector3(...hideWeaponTail(expected,(rig as unknown as {tailPoints:THREE.Vector3[]}).tailPoints,60).position))).toBeLessThan(1e-10);expect(rig.pivot.quaternion.angleTo(poseQuaternion(expected))).toBeLessThan(1e-7);
      expect(animatedGrip(def,s,true,100,1,1,99)).toEqual(expected);
    }
    expect(animatedGrip(def,undefined,false,100,1,1,2)).toEqual(weaponReadyPose(15,2));rig.dispose();
  });
  it('matches original lengths/origins without stretching our unique model proportions',()=>{
    for(const def of defs){
      const model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(.2,1,.1),new THREE.MeshBasicMaterial()));
      const fitted=fitWeaponModel(model,def),fit=fitted.userData.weaponSize as WeaponSizeFit,box=new THREE.Box3().setFromObject(fitted),ref=sizes[def.key as keyof typeof sizes];
      expect(box.min.y).toBeCloseTo(ref.bounds[1][0],10);expect(box.max.y).toBeCloseTo(ref.bounds[1][1],10);
      expect((box.max.x-box.min.x)/(box.max.y-box.min.y)).toBeCloseTo(.2,7);expect(fit.exactEquivalent).toBe(def.type!==12);
      expect(fit.grip[1]).toBeCloseTo(def.grip[1]*fit.scale+fit.offset[1],10);
    }
  });
});
