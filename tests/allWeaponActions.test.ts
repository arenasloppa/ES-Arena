import {describe,it,expect} from 'vitest';
import {Dungeon,IDLE_INPUT,type DungeonInput} from '../src/game/dungeon';
import {itemKey,makeSteelArrows} from '../src/game/items';
import {TEST_WEAPON_DEFINITIONS} from '../src/render/weaponModelDefinitions';
import {playerEyeOffset} from '../src/game/playerView';
import {textLevel} from './helpers/level';
const click={...IDLE_INPUT,attack:{held:false,pressed:true,released:true}};
function armed(def:typeof TEST_WEAPON_DEFINITIONS[number]){
 const level=textLevel(['####################','#..................#','#........@.........#','#..................#','####################']);
 const d=new Dungeon(level,undefined);const item=d.inventory.add({kind:'weapon',name:def.name,type:def.type,material:def.material??1,damage:[2,4],twoHanded:def.twoHanded,weight:2,value:10});d.use(itemKey(item));d.player.yaw=0;return d;
}
function advance(d:Dungeon,seconds:number,input:DungeonInput=IDLE_INPUT){for(let t=0;t<seconds-1e-10;t+=1/120)d.update(Math.min(1/120,seconds-t),input);}
for(const def of TEST_WEAPON_DEFINITIONS){
 describe(`${def.material??1}:${def.name} actions`,()=>{
  if(def.style!=='bow')for(const power of [false,true])it(`${power?'power hold':'normal tap'} completes once and recovers for the next attack`,()=>{
   const d=armed(def),press={...IDLE_INPUT,attack:{held:true,pressed:true,released:false}},hold={...press,attack:{held:true,pressed:false,released:false}};
   if(power){d.update(.001,press);advance(d,.34,hold);}else d.update(.001,click);
   const s=d.swing!;expect(s).toBeDefined();expect(s.power).toBe(power);expect(s.duration).toBeGreaterThan(0);expect(s.hitAt).toBeGreaterThan(0);expect(s.hitAt).toBeLessThan(1);
   const beforeStamina=d.stats.stamina;advance(d,s.duration+.1,power?hold:IDLE_INPUT);expect(s.struck).toBe(true);expect(d.swing).toBeUndefined();
   expect(d.events.filter(e=>e.type==='swing')).toHaveLength(1);expect(d.events.filter(e=>e.type==='sound'&&e.name==='SWISH.VOC')).toHaveLength(1);
   d.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:false,released:true}});d.update(.001,click);expect(d.swing?.power).toBe(false);expect(d.events.filter(e=>e.type==='swing')).toHaveLength(2);expect(Number.isFinite(beforeStamina)).toBe(true);
  });
  it('holds guard, shoves once and smoothly returns to a held guard without consuming ammunition',()=>{
   const d=armed(def);d.inventory.add(makeSteelArrows(3));d.update(.01,{...IDLE_INPUT,block:true});expect(d.blocking).toBe(true);
   const before=d.inventory.steelArrowCount();d.update(.001,{...click,block:true});const s=d.swing!;expect(s?.bash).toBe(true);
   advance(d,.4,{...IDLE_INPUT,block:true,attack:{held:true,pressed:false,released:false}});expect(s.struck).toBe(true);expect(d.swing).toBeUndefined();expect(d.blocking).toBe(true);expect(d.events.filter(e=>e.type==='swing')).toHaveLength(1);expect(d.inventory.steelArrowCount()).toBe(before);
   d.update(.01,IDLE_INPUT);expect(d.blocking).toBe(false);
  });
  if(def.style==='bow')for(const sneaking of [false,true])for(const charged of [false,true])it(`${sneaking?'crouched':'standing'} ${charged?'charged':'quick'} shot follows aim and spends exactly one arrow`,()=>{
   const d=armed(def);d.inventory.add(makeSteelArrows(3));d.player.yaw=.1;d.player.pitch=.12;d.viewEyeOffset=playerEyeOffset(sneaking)+.002;d.viewSideOffset=.003;
   const press={...IDLE_INPUT,sneaking,attack:{held:true,pressed:true,released:false}},hold={...press,attack:{held:true,pressed:false,released:false}},released={...IDLE_INPUT,sneaking,attack:{held:false,pressed:false,released:true}};
   d.update(.001,press);advance(d,charged?2:.2,hold);expect(d.arrows).toHaveLength(0);expect(d.inventory.steelArrowCount()).toBe(3);d.update(.001,released);
   for(let i=0;i<240&&!d.arrows.length;i++)d.update(1/120,{...IDLE_INPUT,sneaking});
   expect(d.arrows).toHaveLength(1);expect(d.inventory.steelArrowCount()).toBe(2);expect(d.arrows[0].sneak).toBe(sneaking);const p=d.arrows[0].projectile!,v=p.velocity,speed=Math.hypot(...v),aim=[Math.cos(.1)*Math.cos(.12),Math.sin(.12),Math.sin(.1)*Math.cos(.12)];
   expect(v.reduce((dot,value,i)=>dot+value/speed*aim[i],0)).toBeGreaterThan(.999);expect(Math.abs(p.position[1]-d.viewEyeOffset!)).toBeLessThan(.04);expect(d.events.filter(e=>e.type==='sound'&&e.name==='ARROWFR.VOC')).toHaveLength(1);
  });
 });
}
