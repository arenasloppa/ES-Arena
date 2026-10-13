import {describe,it,expect} from 'vitest';
import {weaponModelDefinition,weaponModelKey,weaponModelPath,SILVER_DAGGER} from '../src/render/weaponModelDefinitions';
import {steelAttackDuration,steelImpactAt} from '../src/game/weaponHandling';
import {weaponAttackClip,weaponAttackSpeed} from '../src/render/weaponMotion';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {itemKey} from '../src/game/items';
import {textLevel} from './helpers/level';
const click={...IDLE_INPUT,attack:{held:false,pressed:true,released:true}};
describe('finished Silver dagger in the shared test/game renderer',()=>{
 it('uses a distinct material asset and leaves unfinished Silver families on their original sprites',()=>{
  const silver=weaponModelDefinition({type:1,material:2})!,steel=weaponModelDefinition({type:1,material:1})!;
  expect(silver).toBe(SILVER_DAGGER);expect(weaponModelKey(silver)).not.toBe(weaponModelKey(steel));expect(weaponModelPath(silver)).toBe('models/weapons/silver/dagger.glb');expect(weaponModelPath(steel)).toBe('models/weapons/steel/dagger.glb');
  for(let type=0;type<18;type++)if(type!==1)expect(weaponModelDefinition({type,material:2})).toBeUndefined();
 });
 it('uses first-person dagger hit/recovery timing while preserving the real Silver inventory material and block action',()=>{
  const d=new Dungeon(textLevel(['#####','#@..#','#####']),undefined),item=d.inventory.add({kind:'weapon',name:'Silver Dagger',type:1,material:2,damage:[2,5],twoHanded:false,weight:1,value:20});d.use(itemKey(item));
  expect(d.stats.weapon.material).toBe(2);d.update(.01,click);const s=d.swing!,c=weaponAttackClip(1,s.kind,s.power),speed=weaponAttackSpeed(1);
  expect(s.duration).toBeCloseTo(c.duration/speed,12);expect(s.hitAt! * s.duration).toBeCloseTo(c.hit/speed,12);
  d.meleeTerrainContact({fraction:.1,point:[2,.5,1.5],normal:[-1,0,0],material:'stone'},s);expect(s.struck).toBe(true);expect(d.events.some(e=>e.type==='weaponImpact')).toBe(true);
  for(let i=0;i<120;i++)d.update(1/120,IDLE_INPUT);d.update(.01,{...IDLE_INPUT,block:true});expect(d.blocking).toBe(true);expect(d.stats.weapon.material).toBe(2);
 });
 it('uses the same unmodified dagger clips for normal and power attacks, keeping other Silver weapons on legacy timing',()=>{
  const w={type:1,material:2,name:'Silver Dagger',cif:'DAGGER.CIF',damage:[2,5] as [number,number]};
  for(const power of [false,true])for(const kind of ['right','chop','thrust']){const c=weaponAttackClip(1,kind,power);expect(steelAttackDuration(w,power,kind)).toBeCloseTo(c.duration/weaponAttackSpeed(1),12);expect(steelImpactAt(w,power,kind)).toBeCloseTo(c.hit/c.duration,12);}
  expect(steelAttackDuration({...w,type:13},false)).toBe(.4);expect(steelAttackDuration({...w,type:13},true)).toBe(.6);
 });
});
