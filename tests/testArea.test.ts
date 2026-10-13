import {describe,it,expect} from 'vitest';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {TestArea} from '../src/game/testArea';
import {steelTestRoom} from '../src/game/steelTestRoom';
import {fakeCreature,textLevel} from './helpers/level';
import {STEEL_WEAPON_DEFINITIONS} from '../src/render/steelWeaponDefinitions';
import {TEST_WEAPON_DEFINITIONS} from '../src/render/weaponModelDefinitions';
import {isAlive} from '../src/game/creatures';
import {itemKey} from '../src/game/items';
const creatures=[fakeCreature({name:'Rat'}),fakeCreature({name:'Goblin'})];
const weapons=STEEL_WEAPON_DEFINITIONS.slice(0,18).map(d=>({name:d.name,damage:[2,5] as [number,number],twoHanded:d.twoHanded,weight:2,price:10}));
function practice(){const d=new Dungeon(steelTestRoom(),undefined),area=new TestArea(d,creatures,weapons);return{d,area};}
describe('main-game Test Area',()=>{
 it('fills a separate inventory with every finished model and arrows, all equippable',()=>{
  const {d}=practice();expect(d.practiceMode).toBe(true);expect(d.stats.weapon.type).toBe(3);expect(d.inventory.steelArrowCount()).toBe(200);
  for(const def of TEST_WEAPON_DEFINITIONS){const item=d.inventory.items.find(i=>i.kind==='weapon'&&i.type===def.type&&i.material===(def.material??1))!;expect(item).toBeDefined();d.use(itemKey(item));expect(d.stats.weapon).toMatchObject({type:def.type,material:def.material??1});}
  expect(d.inventory.weight()).toBeLessThan(d.hero.carry);
  const normal=new Dungeon(steelTestRoom(),undefined);expect(normal.practiceMode).toBe(false);expect(normal.inventory.items.filter(i=>i.kind==='weapon').length).toBeLessThan(19);
 });
 it('starts one rat, waits after its death, then advances to the goblin',()=>{
  const {d,area}=practice();expect(d.creatures).toHaveLength(1);expect(d.creatures[0].info).toBe(creatures[0]);
  const c=d.creatures[0];c.state='dead';c.health=0;area.update(.01);expect(d.creatures.filter(isAlive)).toHaveLength(0);d.time+=1.4;area.update(.1);expect(d.creatures.filter(isAlive)).toHaveLength(0);d.time+=.11;area.update(.11);expect(d.creatures.filter(isAlive)).toHaveLength(1);expect(d.events.filter(e=>e.type==='spawned')).toHaveLength(1);expect(d.creatures.find(isAlive)?.info).toBe(creatures[1]);
 });
 it('can replenish indefinitely with unique ids and bounded corpses, and freezes when paused',()=>{
  const {d,area}=practice(),ids=new Set(d.creatures.map(c=>c.id));
  for(let round=0;round<50;round++){
   for(const c of d.creatures){c.health=0;c.state='dead';}
   area.update(.01);const before=d.creatures.length;area.update(0);expect(d.creatures.length).toBe(before);
   d.time+=5.1;area.update(.1);expect(d.creatures.filter(isAlive)).toHaveLength(1);expect(d.creatures).toHaveLength(1);
   for(const c of d.creatures){expect(ids.has(c.id)).toBe(false);ids.add(c.id);}
   d.events.length=0;
  }
  expect(ids.size).toBe(51);
 });
 it('cannot die even from lethal damage, without making ordinary runs immortal',()=>{
  const {d}=practice();const damage=d as unknown as {hurtPlayer(n:number):boolean;burn(n:number):void;die():void};damage.hurtPlayer(100000);damage.burn(100000);damage.die();expect(d.stats.health).toBe(d.stats.maxHealth);expect(d.outcome).toBeUndefined();expect(d.events.some(e=>e.type==='died')).toBe(false);
  d.stats.stamina=0;d.update(.001,IDLE_INPUT);expect(d.stats.stamina).toBe(d.stats.maxStamina);
  const normal=new Dungeon(textLevel(['###','#@#','###']),undefined);(normal as unknown as {burn(n:number):void}).burn(100000);expect(normal.outcome).toBe('dead');
 });
});

import {TEST_BUFFS,TEST_DEBUFFS} from '../src/game/testEffects';
import {DEFAULT_HERO} from '../src/game/combat';
import {file,record} from './helpers/spells';
import {parseSpells} from '../src/formats/spells';
function effectsPractice(){
 const diseases={diseases:Array.from({length:17},(_,i)=>({id:i+10,name:`Disease ${i}`,damage:[1,1] as [number,number],attributes:[0],temporary:[17,22,26].includes(i+10)})),carriers:[]};
 const d=new Dungeon(steelTestRoom(),{creatures:[],weapons,diseases},()=>0,{...DEFAULT_HERO,magicka:100,regainsMagicka:false});
 const area=new TestArea(d,creatures,weapons,'effects');return{d,area};
}
describe('Testing sections',()=>{
 it('provides every weapon type in all eight materials, separate from normal inventory',()=>{
  const {d}=practice();expect(d.inventory.items.filter(i=>i.kind==='weapon')).toHaveLength(18*8);
  for(let material=0;material<8;material++)for(let type=0;type<18;type++){
   const item=d.inventory.items.find(i=>i.kind==='weapon'&&i.type===type&&i.material===material)!;
   expect(item).toBeDefined();expect(d.use(itemKey(item))).toMatch(/equipped/);expect(d.stats.weapon).toMatchObject({type,material});
  }
 });
 it('keeps Effect Testing free of monsters and stacks independent buffs and debuffs; repeats refresh',()=>{
  const {d,area}=effectsPractice();expect(d.creatures).toHaveLength(0);
  for(let i=0;i<TEST_BUFFS.length;i++)area.addBuff();
  area.addDebuff();area.addDebuff();area.addDebuff();
  expect(d.statusEffects().filter(e=>e.kind==='buff')).toHaveLength(TEST_BUFFS.length);
  expect(d.statusEffects().filter(e=>e.kind==='debuff').map(e=>e.id)).toEqual(expect.arrayContaining(['poison','paralysis','silence']));
  expect(d.invisible).toBe(true);expect(d.lightReach).toBe(3);expect(d.shield).toBe(60);expect(d.attributeBonus()[0]).toBe(10);
  const fortified=d.statusEffects().filter(e=>e.icon==='fortify');for(let i=0;i<6;i++)area.addBuff();expect(d.statusEffects().filter(e=>e.icon==='fortify')).toHaveLength(fortified.length);
 });
 it('silences real casting, drains spell points, inhibits movement and expires independently',()=>{
  const {d}=effectsPractice(),spell=parseSpells(file(record({name:'Test light',target:0,effects:[17],params:[[1,0,0,0,0,1]],cost:0})))[0];
  expect(d.cast(spell)).toBe(true);d.update(1,IDLE_INPUT);d.applyPracticeEffect('silence',3);expect(d.cast(spell)).toBe(false);
  d.applyPracticeEffect('drain',10);d.applyPracticeEffect('paralysis',3);
  const x=d.player.x, mana=d.stats.magicka;
  d.update(2,{...IDLE_INPUT,forward:1});expect(d.player.x).toBe(x);expect(d.stats.magicka).toBe(mana-2);
  d.update(2,IDLE_INPUT);expect(d.paralysed).toBe(false);expect(d.statusEffects().some(e=>e.id==='silence')).toBe(false);expect(d.statusEffects().some(e=>e.id==='drain')).toBe(true);
 });
 it('automatically cycles all current buffs and debuffs, can stop each cycle, and freezes with pause',()=>{
  const {d,area}=effectsPractice();area.update(0);expect(d.statusEffects()).toHaveLength(0);
  for(let i=0;i<TEST_DEBUFFS.length;i++){d.time+=8;area.update(.1);}
  expect(area.nextDebuffName).toBe(TEST_DEBUFFS[0].name);expect(d.creatures).toHaveLength(0);
  const next=area.nextBuffName;area.toggleAutoBuffs();d.time+=8;area.update(.1);expect(area.nextBuffName).toBe(next);
  area.clearEffects();expect(d.statusEffects()).toHaveLength(0);expect(d.attributeBonus()).toEqual(Array(8).fill(0));expect(d.stats.magicka).toBe(d.stats.maxMagicka);
  d.time+=8;area.update(.1);expect(d.statusEffects()).toHaveLength(0);expect(area.autoBuffs||area.autoDebuffs).toBe(false);
 });
 it('shows only one disease at once while allowing other effects to coexist; untimed diseases stay untimed',()=>{
  const {d}=effectsPractice();d.applyPracticeEffect('poison');d.applyPracticeEffect('disease:10');d.applyPracticeEffect('disease:11');
  expect(d.statusEffects().filter(e=>e.id==='disease')).toHaveLength(1);expect(d.statusEffects().find(e=>e.id==='disease')).toMatchObject({name:'Disease 1',remaining:undefined});expect(d.statusEffects().some(e=>e.id==='poison')).toBe(true);
 });
 it('does not expose effect probes in normal gameplay',()=>{
  const d=new Dungeon(steelTestRoom(),undefined);expect(d.applyPracticeEffect('poison')).toBe(false);d.clearPracticeEffects();expect(d.statusEffects()).toHaveLength(0);
 });
 it('logs one concise notice per added effect, with what it does and no duplicate disease line',()=>{
  const {d,area}=effectsPractice();d.events.length=0;
  area.addBuff();area.addDebuff();d.applyPracticeEffect('disease:10');
  const notes=d.events.flatMap(e=>e.type==='notify'?[e.text]:[]);
  expect(notes).toEqual(['You gained Shield (Absorbs 60 points of incoming damage)','You have contracted Poison (Deals damage every 2 seconds)','You have contracted Disease 0 (Reduces Strength over time)']);
 });

});
