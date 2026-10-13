import {describe,it,expect} from 'vitest';
import {readMonsterSpells} from '../src/formats/monsterSpells';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {creatureMagic} from '../src/game/creatureMagic';
import {spawnCreature,updateCreature,type CreatureWorld} from '../src/game/creatures';
import {parseSpells} from '../src/formats/spells';
import {always,fakeCreature,textLevel} from './helpers/level';
import {file,record} from './helpers/spells';

// Small synthetic executable containing just the independently verified layout.
const animations=0x4274f;
function image(){
 const b=new Uint8Array(animations+16);
 b.set(new TextEncoder().encode('exp_ab.cfa\0'),0x3f508);
 b.set([1,1,0,1,0,1,1,1,1,6],animations-0x45);
 b.set([16,28,255,28,255,35,42,16,28,6,12,20,28,32,63],animations-0x3b);
 b.set([11,12,0,14,0,16,17,18,19,19],animations-0x2c);
 return b;
}
const assignments=[
 [5,[12],6],[11,[16],6],[12,[63],5],[15,[16],11],[16,[28],12],
 [18,[28],14],[20,[35],16],[21,[42],17],[22,[16],18],[23,[28],19],
 [24,[6,12,20,28,32,63],19],
] as [number,number[],number][];

describe('native monster spell initialization',()=>{
 it('decodes all eleven casters, all thirteen noncasters and separate spell levels',()=>{
  const lists=readMonsterSpells(image(),animations)!;expect(lists).toHaveLength(24);
  for(const [id,spells,spellLevel] of assignments)expect(lists[id-1]).toEqual({spells,spellLevel});
  expect(lists.filter(l=>!l.spells.length)).toHaveLength(13);
 });
 it('reads altered native spell choices, and rejects unsupported or malformed data',()=>{
  const b=image();b[animations-0x3b+3]=33;expect(readMonsterSpells(b,animations)![17].spells).toEqual([33]);
  b[animations-0x3b+3]=255;expect(readMonsterSpells(b,animations)).toBeUndefined();
  expect(readMonsterSpells(new Uint8Array(10),5)).toBeUndefined();
  const bad=image();bad[animations-0x45+9]=8;expect(readMonsterSpells(bad,animations)).toBeUndefined();
 });
});

function spell(index:number){
 const s=parseSpells(file(record({name:`Probe ${index}`,target:2,effects:[4],cost:1000,params:[[1,1,0,0,0,0]]})))[0];
 s.index=index;return s;
}
function encounter(id:number){
 const profile=readMonsterSpells(image(),animations)![id-1];
 const info=fakeCreature({id,health:[100,100],...profile});
 const d=new Dungeon(textLevel(['##########','#@.......#','##########'],{creatures:[{type:0,x:6.5,y:1.5}]}),
  {creatures:[info],weapons:[]},always(0),{...DEFAULT_HERO,health:100},profile.spells.map(spell));
 d.creatures[0].state='chase';return d;
}

describe('monster spell behavior',()=>{
 it.each(assignments)('monster %i casts its native spell at its casting level without a finite mana requirement',(id,spells,level)=>{
  const d=encounter(id),c=d.creatures[0];creatureMagic(c).magicka=0;
  d.update(.01,IDLE_INPUT);expect(d.bolts).toHaveLength(1);
  expect(d.bolts[0].spell.index).toBe(spells[0]);expect(d.bolts[0].level).toBe(level);expect(d.bolts[0].source).toBe(c);
  expect(creatureMagic(c).magicka).toBe(0);
 });
 it.each([5,11,16,18,21])('invisibility hides the player from caster %i',id=>{
  const d=encounter(id);d.practiceMode=true;d.applyPracticeEffect('invisibility');d.update(.01,IDLE_INPUT);
  expect(d.bolts).toHaveLength(0);
 });
 it.each([12,15,20,22,23,24])('caster %i detects and casts at invisible players',id=>{
  const d=encounter(id);d.practiceMode=true;d.applyPracticeEffect('invisibility');d.update(.01,IDLE_INPUT);
  expect(d.bolts).toHaveLength(1);
 });
 it('Medusa waits while the player is paralyzed and casts once paralysis expires',()=>{
  const d=encounter(21);d.practiceMode=true;d.applyPracticeEffect('paralysis');d.update(.01,IDLE_INPUT);
  expect(d.bolts).toHaveLength(0);d.clearPracticeEffects();d.update(.01,IDLE_INPUT);expect(d.bolts).toHaveLength(1);
 });
 it.each(['silenced','paralyzed','wall','melee'] as const)('prevents ranged casting when %s',condition=>{
  const d=encounter(11),c=d.creatures[0];
  if(condition==='silenced')creatureMagic(c).silencedUntil=100;
  if(condition==='paralyzed')c.paralysed=100;
  if(condition==='wall')d.level.cells[14].kind='wall';
  if(condition==='melee')c.x=2;
  d.update(.01,IDLE_INPUT);expect(d.bolts).toHaveLength(0);
 });
 it('launches from the monster and aims down toward a sneaking player',()=>{
  const d=encounter(11);d.creatures[0].collisionHeight=1.2;
  d.update(.01,{...IDLE_INPUT,sneaking:true});
  const b=d.bolts[0];expect(b.z).toBeGreaterThan(.6);expect(b.dz).toBeLessThan(0);
 });
 it('a monster bolt passing above the player does not hit their horizontal footprint',()=>{
  const d=encounter(11);d.level.height=3;d.update(.01,IDLE_INPUT);
  const b=d.bolts[0];Object.assign(b,{x:d.player.x+.3,y:d.player.y,z:1.2,dx:-1,dy:0,dz:0});
  d.creatures[0].paralysed=100;d.update(.01,IDLE_INPUT);
  expect(d.bolts).toContain(b);expect(d.events.some(e=>e.type==='hurt')).toBe(false);
 });
});

describe('native invisibility sensing in melee AI',()=>{
 it.each([1,5,11,12,15,20,22,23,24])('monster %i respects the sensing exceptions',id=>{
  const c=spawnCreature(0,fakeCreature({id}),4,1.5,always(0)),level=textLevel(['########','#@.....#','########']);
  const w:CreatureWorld={level,openDoors:new Set(),player:{x:1.5,y:1.5,level:1},invisible:true,sneaking:false,now:0,random:always(0),creatures:[c]};
  updateCreature(c,w,.01);
  expect(c.state==='chase').toBe([12,15,20,22,23,24].includes(id));
  w.nonTarget=true;updateCreature(c,w,.01);expect(c.state).not.toBe('chase');
 });
});
