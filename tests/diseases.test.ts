import {describe,it,expect} from 'vitest';
import {readDiseaseTables, type DiseaseTables} from '../src/formats/diseases';
import {diseaseFrom,infectDisease,DISEASE_DAY} from '../src/game/diseases';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {always,fakeCreature,textLevel} from './helpers/level';
const tables:DiseaseTables={diseases:[
 {id:10,name:'Test chronic disease',damage:[2,2],attributes:[0,8,8],temporary:false},
 {id:17,name:'Test temporary disease',damage:[1,1],attributes:[0],temporary:true},
],carriers:[{creature:1,diseases:[10]},{creature:22,diseases:[17]}]};
const image=()=>{const b=new Uint8Array(0x44600);const put=(at:number,s:string)=>{b.set(new TextEncoder().encode(s+'\0'),at);};put(0x3f508,'exp_ab.cfa');
 const names=Array.from({length:17},(_,i)=>i===0?'Witch Pox':`Disease ${i}`);put(0x36fd8,names.join('\0'));
 let at=0x3a032;for(let i=0;i<17;i++){b.set([0,8,255],at);at+=3;b.set([1,2],0x445bc+i*2);}b.set([17,22,26],0x445e8);b.set([1,10,13,22],0x43cbb);b.set([10,255,11,255,12,255,13,255],0x43cc7);return b;};
function dungeon(){const d=new Dungeon(textLevel(['#####','#@..#','#####']),{creatures:[],weapons:[],diseases:tables},always(0),{...DEFAULT_HERO,attributes:Array(8).fill(50)});return d;}
describe('original disease tables and player effects',()=>{
 it('reads all 17 names, slots, ranges, temporary flags and carriers, rejects unverified layouts',()=>{
  const parsed=readDiseaseTables(image())!;expect(parsed.diseases).toHaveLength(17);expect(parsed.carriers.map(c=>c.creature)).toEqual([1,10,13,22]);expect(parsed.diseases.filter(d=>d.temporary).map(d=>d.id)).toEqual([17,22,26]);expect(parsed.diseases[0]).toMatchObject({name:'Witch Pox',attributes:[0,8],damage:[1,2]});
  expect(readDiseaseTables(new Uint8Array(50))).toBeUndefined();const bad=image();bad[0x445bc]=99;expect(readDiseaseTables(bad)).toBeUndefined();
 });
 it('checks the original special gate, poison save and Barbarian immunity including vampire hardcoded chance',()=>{
  const rat=fakeCreature({id:1,special:5}),vampire=fakeCreature({id:22,special:-2});
  expect(diseaseFrom(rat,tables,50,16,always(0))?.id).toBe(10);
  expect(diseaseFrom(rat,tables,50,15,always(0))).toBeUndefined();
  expect(diseaseFrom(rat,tables,0,16,always(0))).toBeUndefined();
  expect(diseaseFrom(rat,tables,50,16,always(.06))).toBeUndefined();
  expect(diseaseFrom(vampire,tables,50,16,always(.05))?.id).toBe(17);
 });
 it('rolls one loss per slot and uses a minute then daily ticks, 3–18 game days for temporary disease',()=>{
  const state=infectDisease(tables.diseases[0],100,always(0));expect(state.next).toBe(160);expect(state.until).toBeUndefined();expect(state.losses[8]).toBe(2);
  expect(infectDisease(tables.diseases[1],100,always(0)).until).toBe(100+3*DISEASE_DAY);
  expect(infectDisease(tables.diseases[1],100,always(.999)).until).toBe(100+18*DISEASE_DAY);
 });
 it('shows persistent disease, applies cumulative loss and retains it after a cure; never stacks diseases',()=>{
  const d=dungeon(),hp=d.stats.health;expect(d.infect(10)).toBe(true);expect(d.infect(17)).toBe(false);
  expect(d.statusEffects().find(e=>e.id==='disease')).toMatchObject({icon:'witch-pox',dispelType:'disease',remaining:undefined});
  d.clock=59;d.update(0,IDLE_INPUT);expect(d.stats.health).toBe(hp);
  d.clock=60;d.update(0,IDLE_INPUT);expect(d.stats.health).toBe(hp-2);expect(d.attributeBonus()[0]).toBe(-2*100/256);
  d.clock+=DISEASE_DAY;d.update(0,IDLE_INPUT);expect(d.stats.health).toBe(hp-4);expect(d.attributeBonus()[0]).toBe(-4*100/256);
  d.cureDisease();expect(d.statusEffects().some(e=>e.id==='disease')).toBe(false);expect(d.attributeBonus()[0]).toBe(-4*100/256);
  d.clock+=DISEASE_DAY;d.update(0,IDLE_INPUT);expect(d.stats.health).toBe(hp-4);
 });
 it('counts down actual game-clock expiry and cures temporary disease without faking a permanent timer',()=>{
  const d=dungeon();d.infect(17);expect(d.statusEffects().find(e=>e.id==='disease')?.remaining).toBeGreaterThan(19000);
  d.clock=3*DISEASE_DAY;d.update(0,IDLE_INPUT);expect(d.statusEffects().some(e=>e.id==='disease')).toBe(false);
 });
 it('keeps practice immortal while allowing disease icons and attribute effects',()=>{
  const d=dungeon();d.practiceMode=true;d.stats.health=1;d.infect(10);d.clock=20*DISEASE_DAY;d.update(0,IDLE_INPUT);expect(d.outcome).toBeUndefined();expect(d.stats.health).toBe(d.stats.maxHealth);expect(d.statusEffects().some(e=>e.id==='disease')).toBe(true);
 });
});
