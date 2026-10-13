import {describe,expect,it} from 'vitest';
import {parseSpells,type SpellRecord} from '../src/formats/spells';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {creatureMagic,creatureAttribute} from '../src/game/creatureMagic';
import {castable,describe as describeSpell,spellKey} from '../src/game/magic';
import {TestArea} from '../src/game/testArea';
import {MapView} from '../src/render/mapView';
import {buildLevelScene} from '../src/render/levelScene';
import {always,fakeCreature,textLevel} from './helpers/level';
import {record,file} from './helpers/spells';

// Deliberately synthetic records: no original game files required by the suite.
function spell(effect:number,sub=0,target=0,params=[100,0,1,0,1,2],attribute=0):SpellRecord {
 return parseSpells(file(record({name:`Probe ${effect}/${sub}`,effects:[effect],subs:[sub],attributes:[attribute],target,params:[params],cost:1})))[0];
}
const info=fakeCreature({health:[100,100],damage:[10,10],attributes:Array(8).fill(128)});
function dungeon(rows=['########','#@.....#','########'],creatures=false,spells:SpellRecord[]=[]){
 const d=new Dungeon(textLevel(rows,{creatures:creatures?[{type:0,x:3.5,y:1.5}]:[]}),{creatures:[info],weapons:[]},always(0),{...DEFAULT_HERO,health:100,magicka:2000},spells);
 d.player.yaw=0;if(d.creatures[0])d.creatures[0].paralysed=1000;return d;
}
function tick(d:Dungeon,seconds:number){for(let t=0;t<seconds-1e-9;t+=.05)d.update(.05,IDLE_INPUT);}
function hit(d:Dungeon,s:SpellRecord){expect(d.cast(s)).toBe(true);tick(d,.4);}

describe('complete spell effects',()=>{
 it.each([[4,0],[4,1],[4,2],[1,0],[1,1],[1,2],[12,0],[12,1],[12,2],[12,3],[13,0],[13,1],[0,0],[0,1],[0,2],[0,3],[0,4],[2,0],[2,1],[2,2],[6,0],[6,1],[3,0],[3,1],[3,2],[3,3],[5,0],[9,0],[10,0],[11,4],[15,0],[16,0],[17,0],[18,0],[19,0],[20,0],[21,0],[22,0],[23,0],[24,0]])('supports implemented effect %i/%i',(effect,sub)=>{
  const s=spell(effect,sub);expect(castable(s)).toBe(true);expect(describeSpell(s,1)[0]).not.toBeUndefined();
 });
 it.each([1,2])('damage pool %i drains the intended resource, without dealing health damage',pool=>{
  const d=dungeon(undefined,true),c=d.creatures[0],state=creatureMagic(c),before=pool===1?state.stamina:state.magicka;
  hit(d,spell(4,pool,2,[15,15,0,0,0,0]));
  expect(c.health).toBe(100);expect(pool===1?state.stamina:state.magicka).toBeGreaterThanOrEqual(before-15);expect(pool===1?state.stamina:state.magicka).toBeLessThanOrEqual(before-14.6);
 });
 it('transfers fatigue separately from health',()=>{
  const d=dungeon(undefined,true),c=d.creatures[0],state=creatureMagic(c);d.stats.stamina=0;
  hit(d,spell(13,1,2,[12,0,0,0,1,2],49));
  expect(c.health).toBe(100);expect(state.stamina).toBeLessThan(state.maxStamina);expect(d.stats.stamina).toBeGreaterThanOrEqual(12);
 });
 it('transfers only health actually remaining on the target',()=>{
  const d=dungeon(undefined,true);d.creatures[0].health=4;d.stats.health=20;
  hit(d,spell(13,1,2,[50,0,0,0,1,2],48));
  expect(d.creatures[0].health).toBe(0);expect(d.stats.health).toBeCloseTo(24,0);
 });
 it('Strength Leech changes the target and caster attribute, then expires',()=>{
  const d=dungeon(undefined,true),c=d.creatures[0],before=creatureAttribute(c,0);
  hit(d,spell(13,0,2,[10,0,0,0,1,1],128));
  expect(creatureAttribute(c,0)).toBeCloseTo(before-10);expect(d.attributeBonus()[0]).toBe(10);
  tick(d,6);expect(creatureAttribute(c,0)).toBeCloseTo(before);expect(d.attributeBonus()[0]).toBe(0);
 });
 it('native Fortify sub 4 raises Speed rather than Strength',()=>{
  const d=dungeon();expect(d.cast(spell(11,4,0,[10,1,0,0,1,2]))).toBe(true);
  expect(d.attributeBonus()[0]).toBe(0);expect(d.attributeBonus()[4]).toBe(10);
 });
 it('drained attributes recover in steps and cease at expiry',()=>{
  const d=dungeon(undefined,true),c=d.creatures[0],before=creatureAttribute(c,0);
  hit(d,spell(9,0,2,[10,2,0,0,1,2]));expect(creatureAttribute(c,0)).toBeCloseTo(before-10);
  tick(d,5);expect(creatureAttribute(c,0)).toBeCloseTo(before-8);
  tick(d,5);expect(creatureAttribute(c,0)).toBeCloseTo(before);
 });
 it.each([[0,[0,3,4,5]],[3,[1,2,6,7]]] as [number,number[]][])('cause subtype %i changes only its native attribute group',(sub,affected)=>{
  const d=dungeon(undefined,true),c=d.creatures[0],before=Array.from({length:8},(_,i)=>creatureAttribute(c,i));
  hit(d,spell(0,sub,2,[100,0,3,0,1,2]));
  for(let i=0;i<8;i++)expect(creatureAttribute(c,i)).toBeCloseTo(before[i]-(affected.includes(i)?3:0));
 });
 it('silence prevents a monster casting until it expires',()=>{
  const fire=spell(4,0,2,[4,4,0,0,0,0]);fire.index=16;
  const d=dungeon(undefined,true,[fire]),c=d.creatures[0];c.info={...c.info,id:11,spells:[16],spellLevel:6};
  hit(d,spell(21,0,2,[100,0,1,0,1,1]));c.paralysed=0;c.state='chase';c.x=6;
  tick(d,1);expect(d.bolts).toHaveLength(0);
  for(let i=0;i<110;i++){c.x=6;c.state='chase';d.update(.05,IDLE_INPUT);}expect(creatureMagic(c).nextCast).toBeGreaterThan(d.time);
 });
 it.each([1,2])('continuous damage affects pool %i at its scheduled tick',pool=>{
  const d=dungeon(undefined,true),c=d.creatures[0],state=creatureMagic(c),before=pool===1?state.stamina:state.magicka;
  hit(d,spell(1,pool,2,[40,40,0,0,0,6]));tick(d,24);expect(pool===1?state.stamina:state.magicka).toBeCloseTo(before);
  tick(d,1);expect(pool===1?state.stamina:state.magicka).toBeLessThan(before-38);expect(c.health).toBe(100);
 });
 it('elemental immunity prevents elemental damage, not a resource transfer',()=>{
  const d=dungeon(undefined,true),c=d.creatures[0];c.info={...c.info,flags:4};
  hit(d,spell(4,0,2,[20,20,0,0,0,0]));expect(c.health).toBe(100);
  tick(d,1);hit(d,spell(13,1,2,[10,0,0,0,1,2],48));expect(c.health).toBe(90);
 });
});

describe('player spell defenses',()=>{
 const attack=spell(4,0,2,[10,10,0,0,0,0]);
 it.each([22,23,24])('ward %i has an actual defensive effect and expires',effect=>{
  const d=dungeon(undefined,true),c=d.creatures[0];d.stats.magicka=100;
  expect(d.cast(spell(effect))).toBe(true);const health=d.stats.health,magicka=d.stats.magicka;
  d.receiveSpell(attack,1,c);expect(d.stats.health).toBe(health);
  if(effect===22)expect(d.stats.magicka).toBe(magicka+1);
  if(effect===23)expect(c.health).toBe(90);
  expect(d.statusEffects().some(e=>e.id===`ward-${effect}-0`)).toBe(true);
  tick(d,11);d.receiveSpell(attack,1,c);expect(d.stats.health).toBeLessThan(health);
 });
 it('resistance rolls once for each incoming elemental spell',()=>{
  const d=dungeon();expect(d.cast(spell(10,0,0,[50,0,1,0,1,2]))).toBe(true);
  // First draw fails the ward. Subsequent zero rolls are saves, not a second ward check.
  let rolls=0;(d as unknown as {random:()=>number}).random=()=>rolls++===0?.75:.99;
  d.receiveSpell(attack,1);expect(d.stats.health).toBeLessThan(d.stats.maxHealth);
 });
 it('incoming silence blocks casting and cures leave unrelated drain intact',()=>{
  const d=dungeon();d.receiveSpell(spell(21,0,2),1);expect(d.cast(spell(12,1))).toBe(false);
  tick(d,11);expect(d.cast(spell(12,1))).toBe(true);
  d.receiveSpell(spell(9,0,2,[10,0,0,0,1,2]),1);
  d.receiveSpell(spell(0,3,2,[100,0,3,0,1,2]),1);tick(d,1);
  expect(d.cast(spell(3,3))).toBe(true);expect(d.attributeBonus()[0]).toBe(-10);expect(d.attributeBonus()[1]).toBe(0);
 });
 it('Free Action can be used while paralyzed',()=>{
  const d=dungeon();d.practiceMode=true;d.applyPracticeEffect('paralysis');
  const free=spell(3,2);expect(d.paralysed).toBe(true);expect(d.canCast(free)).toBe(true);
  expect(d.cast(free)).toBe(true);expect(d.paralysed).toBe(false);
 });
 it('Heal spell points replenishes mana instead of fatigue',()=>{
  const d=dungeon();d.stats.magicka=5;d.stats.stamina=10;
  expect(d.cast(spell(12,2,0,[20,20,0,0,0,0]))).toBe(true);expect(d.stats.magicka).toBe(24);expect(d.stats.stamina).toBe(10);
 });
});

describe('utility and terrain spells',()=>{
 it('Wanderlight travels independently, stops at walls and expires without hurting creatures',()=>{
  const d=dungeon(undefined,true),light=spell(17,0,0,[5,0,0,0,0,1]);light.flags=128;
  expect(d.cast(light)).toBe(true);expect(d.bolts).toHaveLength(1);const from=d.bolts[0].x;
  expect(d.lightReach).toBeGreaterThan(1);tick(d,1);
  expect(d.bolts[0].x).toBeGreaterThan(from);expect(d.bolts[0].stopped).toBe(true);expect(d.creatures[0].health).toBe(100);
  tick(d,5);expect(d.bolts).toHaveLength(0);expect(d.lightReach).toBe(1);
 });
 it('disease deterioration continues every round and is removed at expiry',()=>{
  const d=dungeon(undefined,true),c=d.creatures[0],before=creatureAttribute(c,0);
  hit(d,spell(0,0,2,[100,0,2,1,1,3]));expect(creatureAttribute(c,0)).toBeCloseTo(before-2);
  tick(d,5);expect(creatureAttribute(c,0)).toBeCloseTo(before-4);
  tick(d,11);expect(creatureAttribute(c,0)).toBeCloseTo(before);
 });
 it('Wizard Lock closes and magically locks a door until expiry, and Open releases it',()=>{
  const d=dungeon(['#####','#@D.#','#####']);expect(d.cast(spell(18))).toBe(true);expect(d.locked(7)).toBe(true);
  d.activate();expect(d.doors.get(7)?.target).toBe(0);tick(d,1);
  expect(d.cast(spell(19))).toBe(true);expect(d.locked(7)).toBe(false);expect(d.doors.get(7)?.target).toBe(1);
  const other=dungeon(['#####','#@D.#','#####']);other.cast(spell(18,0,0,[100,0,1,0,1,1]));tick(other,6);expect(other.locked(7)).toBe(false);
 });
 it('levitation crosses a pit without falling or spending swimming stamina',()=>{
  const d=dungeon(['########','#@OOOO.#','########']);d.cast(spell(16,0,0,[1,0,0,0,1,0]));
  for(let i=0;i<30;i++)d.update(.05,{...IDLE_INPUT,forward:1});
  expect(d.player.x).toBeGreaterThan(3);expect(d.player.z).toBe(0);expect(d.swimming).toBe(false);
  tick(d,5);expect(d.player.z).toBeLessThan(0);
 });
 it.each([[2,1,'wall',undefined],[6,1,'empty','dry']] as const)('terrain effect %i/%i changes collision and emits a render refresh',(effect,sub,kind,chasm)=>{
  const d=dungeon(['#######','#.....#','#@....#','#.....#','#######']);const s=spell(effect,sub,effect===6?255:0,[2,0,0,0,0,0]);
  expect(d.cast(s)).toBe(true);const target=d.target();expect(target?.kind).toBe('spellTerrain');d.activate();
  expect(d.level.cells[target!.id].kind).toBe(kind);expect(d.level.cells[target!.id].chasm).toBe(chasm);expect(d.events.some(e=>e.type==='terrainChanged')).toBe(true);
  expect(d.events.some(e=>e.type==='notify'&&e.text.endsWith('1 sections left'))).toBe(true);
 });
 it('Passwall removes an interior wall but preserves the world boundary',()=>{
  const d=dungeon(['#######','#.....#','#@.#..#','#.....#','#######']);
  expect(d.cast(spell(6,0,255,[3,0,0,0,0,0]))).toBe(true);d.activate();expect(d.level.cells[17].kind).toBe('empty');
  d.activate();expect(d.level.cells[20].kind).toBe('wall');expect(d.target()?.note).toBe('2 sections left');
 });
 it('terrain changes cannot bury a monster, item or trigger',()=>{
  const d=dungeon(['#######','#.....#','#@....#','#.....#','#######']);d.level.triggers.push({x:3,y:2,text:'Quest'});
  d.cast(spell(2,1,0,[2,0,0,0,0,0]));d.activate();expect(d.level.cells[17].kind).toBe('empty');
 });
 it('terrain rendering rebuilds the terrain meshes and retains the same doors',async()=>{
  const level=textLevel(['#####','#@D.#','#####']);const provider={tile:async()=>undefined,sprite:async()=>undefined,liquid:async()=>[]};
  const scene=await buildLevelScene(level,provider),door=scene.doors.get(7),before=scene.group.children.length;
  level.cells[6].chasm='dry';await scene.refreshTerrain!();expect(scene.doors.get(7)).toBe(door);expect(scene.group.children).toContain(door!.mesh);expect(scene.group.children.length).toBeGreaterThanOrEqual(before);
 });
 it('the map refreshes terrain spells even when exploration and door state are unchanged',async()=>{
  const d=dungeon(['#######','#.....#','#@....#','#.....#','#######']);
  const provider={tile:async()=>undefined,sprite:async()=>undefined,liquid:async()=>[]};
  const scene=await buildLevelScene(d.level,provider),map=new MapView(d,scene.material);
  await map.open();const terrain=map.scene.children[0],before=terrain.children[0],seen=d.explored.version;
  d.cast(spell(6,1,255,[1,0,0,0,0,0]));d.activate();expect(d.explored.version).toBe(seen);
  await map.open();expect(terrain.children[0]).not.toBe(before);map.dispose();
 });
 it('practice learns every supplied spell and keeps it affordable after equipment refresh',()=>{
  const spells=Array.from({length:64},(_,index)=>({...spell(12,1),index,cost:1000+index})),d=dungeon(undefined,false,spells);
  const ordinary=dungeon(undefined,false,spells);expect(ordinary.spellbook.length).toBeLessThan(64);
  new TestArea(d,[],[]);expect(d.spellbook).toHaveLength(64);expect(d.stats.magicka).toBeGreaterThanOrEqual(1063);
  d.cast(spell(11,4,0,[10,0,0,0,1,2]));expect(d.stats.maxMagicka).toBeGreaterThanOrEqual(1063);
  expect(d.assignHotbar(6,spellKey(spells[63]))).toBe(true);
 });
});
