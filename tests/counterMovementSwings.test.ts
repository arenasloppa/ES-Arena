import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {itemKey} from '../src/game/items';
import {textLevel} from './helpers/level';
import {weaponAttackClip,weaponAttackPose,weaponAttackSpeed} from '../src/render/weaponMotion';
import {poseQuaternion} from '../src/render/weaponAnimation';
import {weaponSizeReferences} from '../src/render/weaponModelSizing';
import {STEEL_WEAPON_DEFINITIONS as defs} from '../src/render/steelWeaponDefinitions';
function armed(type:number,material=1){
  const d=new Dungeon(textLevel(['############','#..........#','#....@.....#','#..........#','############']),undefined);
  const w=d.inventory.add({kind:'weapon',name:'Test',type,material,damage:[2,4],twoHanded:defs[type].twoHanded,weight:2,value:1});d.use(itemKey(w));return d;
}
describe('swings counter lateral movement',()=>{
  for(const strafe of [-1,1])for(const power of [false,true])it(`counter-swings with strafe ${strafe}, power ${power}`,()=>{
    for(let type=0;type<16;type++){
      const d=armed(type),input={...IDLE_INPUT,strafe,attack:{held:power,pressed:true,released:!power}};
      d.update(.001,input);
      if(power)for(let i=0;i<60;i++)d.update(1/120,{...input,attack:{held:true,pressed:false,released:false}});
      const s=d.swing!;expect(s).toBeDefined();expect(s.power).toBe(power);
      if(type===0&&power){expect(s.kind).toBe('thrust');expect(s.sweepDirection).toBeUndefined();continue;}
      expect(s.kind).toBe(strafe<0?'right':'left');expect(s.sweepDirection).toBe(-strafe);
      const c=weaponAttackClip(type,s.kind,power),speed=weaponAttackSpeed(type),tipY=weaponSizeReferences[defs[type].key].bounds[1][1];
      const x=(time:number)=>{const p=weaponAttackPose(type,{...s,time});return new THREE.Vector3(0,tipY,0).applyQuaternion(poseQuaternion(p)).x+p.position[0];};
      const dx=x((c.hit+c.duration*.025)/speed)-x((c.hit-c.duration*.025)/speed);
      expect(Math.sign(dx)).toBe(-strafe);
      expect(s.duration).toBeCloseTo(c.duration/speed,12);expect(s.hitAt!*s.duration).toBeCloseTo(c.hit/speed,12);
      for(const time of [0,s.duration]){
        const changed=weaponAttackPose(type,{...s,time}),base=weaponAttackPose(type,{...s,time,sweepDirection:undefined});
        expect(changed.position).toEqual(base.position);expect(poseQuaternion(changed).angleTo(poseQuaternion(base))).toBeLessThan(1e-7);
      }
      const hit=weaponAttackPose(type,{...s,time:c.hit/speed}),base=weaponAttackPose(type,{...s,time:c.hit/speed,sweepDirection:undefined});
      const edge=new THREE.Vector3(1,0,0);expect(edge.clone().applyQuaternion(poseQuaternion(hit)).z).toBeCloseTo(edge.clone().applyQuaternion(poseQuaternion(base)).z,10);
    }
  });
  it('applies to the silver dagger and retains the stationary combo and guard shove',()=>{
    const silver=armed(1,2);silver.update(.001,{...IDLE_INPUT,strafe:1,attack:{held:false,pressed:true,released:true}});expect(silver.swing?.sweepDirection).toBe(-1);
    const still=armed(3);still.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:true,released:true}});expect(still.swing?.kind).toBe('right');expect(still.swing?.sweepDirection).toBeUndefined();
    const block=armed(3);block.update(.001,{...IDLE_INPUT,block:true,strafe:1,attack:{held:false,pressed:true,released:true}});expect(block.swing?.bash).toBe(true);expect(block.swing?.sweepDirection).toBeUndefined();
  });
});
