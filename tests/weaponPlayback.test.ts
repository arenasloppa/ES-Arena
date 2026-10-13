import {describe,it,expect} from 'vitest';
import {weaponPlaybackRate} from '../src/game/weaponPlayback';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {itemKey,makeSteelArrows} from '../src/game/items';
import {textLevel} from './helpers/level';
import {weaponAttackClip,weaponMotionProfile,bowMotionState,BOW_MOTION_MARKERS} from '../src/render/weaponMotion';

function equipped(type:number,material=1) {
  const d=new Dungeon(textLevel(['########','#@.....#','#......#','########']),undefined);
  const item=d.inventory.add({kind:'weapon',name:'Test weapon',type,material,damage:[2,4],twoHanded:type>=9,weight:1,value:1});
  d.use(itemKey(item));return d;
}
function advance(d:Dungeon,seconds:number,input=IDLE_INPUT) {
  for(let t=0;t<seconds-1e-10;t+=1/120)d.update(Math.min(1/120,seconds-t),input);
}
const click={...IDLE_INPUT,attack:{held:false,pressed:true,released:true}};

describe('slower attacks in actual gameplay',()=>{
  it('slows dagger attacks by ten percent without changing other family rates',()=>{
    expect(weaponPlaybackRate(1)).toBeCloseTo(.8*.9,12);
    expect(weaponPlaybackRate(3)).toBe(.70);expect(weaponPlaybackRate(13)).toBe(.48);
  });
  for(const [type,material] of [[1,1],[13,1],[15,1],[1,2]])for(const power of [false,true])
    it(`keeps ${material}:${type} ${power?'power':'normal'} damage and recovery on the slowed visual clock`,()=>{
      const d=equipped(type,material);
      if(power){d.update(.001,{...IDLE_INPUT,attack:{held:true,pressed:true,released:false}});advance(d,.5,{...IDLE_INPUT,attack:{held:true,pressed:false,released:false}});}
      else d.update(.001,click);
      const s=d.swing!;expect(s).toBeDefined();expect(s.power).toBe(power);
      const c=weaponAttackClip(type,s.kind,power),originalSpeed=weaponMotionProfile(type).speed;
      expect(s.duration).toBeCloseTo(c.duration/originalSpeed/weaponPlaybackRate(type),12);
      const originalHit=c.hit/originalSpeed,slowedHit=originalHit/weaponPlaybackRate(type);
      // The former hit time must no longer deal damage early.
      advance(d,originalHit-s.time);expect(s.struck).toBe(false);
      advance(d,slowedHit-s.time-.0001);expect(s.struck).toBe(false);
      d.update(.0002,IDLE_INPUT);expect(s.struck).toBe(true);
      advance(d,s.duration-s.time-.0001);expect(d.swing).toBe(s);
      d.update(.0002,IDLE_INPUT);expect(d.swing).toBeUndefined();
    });

  for(const type of [16,17])it(`keeps bow ${type} arrow attached until the slowed release marker`,()=>{
    const d=equipped(type);d.inventory.add(makeSteelArrows(2));
    d.update(.001,{...IDLE_INPUT,attack:{held:true,pressed:true,released:false}});
    advance(d,2,{...IDLE_INPUT,attack:{held:true,pressed:false,released:false}});
    expect(bowMotionState(type,d.swing).sourceTime).toBe(BOW_MOTION_MARKERS['shoot max attack']);
    d.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:false,released:true}});
    const s=d.swing!,hit=s.duration*s.hitAt!;
    advance(d,hit-.0001);expect(d.arrows).toHaveLength(0);expect(bowMotionState(type,s).attached).toBe(true);
    d.update(.0002,IDLE_INPUT);expect(d.arrows).toHaveLength(1);expect(bowMotionState(type,s).attached).toBe(false);expect(d.inventory.steelArrowCount()).toBe(1);
  });
});
