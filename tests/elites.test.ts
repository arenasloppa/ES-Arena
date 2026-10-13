import {describe,it,expect} from 'vitest';
import {makeElite,rollEliteAffixes,eliteResistance,creatureName,eliteDescription,ELITE_AFFIXES,CHAMPIONS,ELITE_AURAS} from '../src/game/elites';
import {spawnCreature,updateCreature,paralyseCreature,type CreatureWorld} from '../src/game/creatures';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {TestArea} from '../src/game/testArea';
import {parseSpells} from '../src/formats/spells';
import {always,fakeCreature,textLevel} from './helpers/level';
import {file,record} from './helpers/spells';
const info=fakeCreature({id:2,name:'Goblin',health:[10,10],damage:[10,10],level:10,agility:100,attributes:[100,100,100,100,100,100,100,100]});
const level=()=>textLevel(['############','#..........#','#..........#','#.@........#','#..........#','#..........#','############'],{creatures:[{type:0,x:5.5,y:3.5}]});
function room(){return new Dungeon(level(),{creatures:[info],weapons:[{name:'Staff',damage:[2,2],twoHanded:true}]},always(.01),{...DEFAULT_HERO,health:100,magicka:100});}
function world(){const l=level();return {level:l,openDoors:new Set<number>(),player:{x:2.5,y:3.5,level:1},sneaking:false,now:0,random:always(.01),creatures:[]} satisfies CreatureWorld;}
function controls(d:Dungeon){return d as unknown as {updateElite(c:typeof d.creatures[0]):void;eliteHit(c:typeof d.creatures[0],n:number):void;eliteStruck(c:typeof d.creatures[0]):void;eliteDeath(c:typeof d.creatures[0]):void;hurtByMagic(c:typeof d.creatures[0],n:number,kind?:string,periodic?:boolean,sound?:boolean,credited?:boolean):void;updateCreatureCasting(c:typeof d.creatures[0]):boolean;updateCreatures(dt:number,sneak:boolean):void;elitePack(c:typeof d.creatures[0]):void};}

describe('elite generation and native base preservation',()=>{
 it('supports all champion variants, retains native assets and never mutates shared tables',()=>{
  const before=JSON.stringify(info),health=[3,.75,3,3,6];
  for(const [i,kind]of CHAMPIONS.entries()){
   const c=spawnCreature(i,info,5.5,3.5,always(.01));makeElite(c,'champion',always(.01),{champion:kind});
   expect(c.maxHealth).toBe(Math.round(10*health[i]));expect(c.info.level).toBe(12);expect(c.experienceValue).toBe((info.experience+info.experiencePerHealth*10)*(kind==='berserker'?5:3));expect(c.info.animation).toBe(info.animation);expect(c.info.sound).toBe(info.sound);expect(creatureName(c)).not.toBe(info.name);
  }
  expect(JSON.stringify(info)).toBe(before);
 });
 it('excludes unsupported volleys and duplicate affixes, scales affix counts and protects bosses',()=>{
  for(const level of [1,10,20]){
   const c=spawnCreature(0,{...info,level},5,3,always(.01)),affixes=rollEliteAffixes(c,always(.99));expect(affixes).toHaveLength(level<10?1:level<20?2:3);expect(new Set(affixes).size).toBe(affixes.length);expect(affixes).not.toContain('volley');
  }
  const boss=spawnCreature(0,{...info,boss:true},5,3,always(.01));makeElite(boss,'unique',always(.01));expect(boss.elite).toBeUndefined();expect(boss.info).toBeDefined();
  expect(ELITE_AFFIXES).toHaveLength(13);expect(ELITE_AURAS).toHaveLength(7);
 });
 it('applies strength, elemental wards, physical resistance and movement to actual combat',()=>{
  const d=room(),c=d.creatures[0];makeElite(c,'unique',always(.01),{affixes:['strong','stonehide','flame']});expect(c.info.damage).toEqual([24,24]);expect(c.maxHealth).toBe(40);expect(c.info.level).toBe(13);
  expect(eliteResistance(c,20,'fire')).toBe(5);expect(eliteResistance(c,20,'physical')).toBe(10);controls(d).hurtByMagic(c,20,'fire');expect(c.health).toBe(35);
  expect(eliteDescription(c)).toContain('Giant Strength');expect(eliteDescription(c)).toContain('Stonehide');
  const w=world(),normal=spawnCreature(1,info,6,3.5,always(.01)),fast=spawnCreature(2,info,6,3.5,always(.01));makeElite(fast,'unique',always(.01),{affixes:['swift']});
  normal.state=fast.state='chase';normal.unseen=fast.unseen=0;updateCreature(normal,w,.1);updateCreature(fast,w,.1);expect(6-fast.x).toBeCloseTo(2*(6-normal.x));
 });
 it('chills leaders instead of freezing, but minions retain ordinary paralysis',()=>{
  const w=world(),c=spawnCreature(0,info,5,3,always(.01));makeElite(c,'unique',always(.01),{affixes:[]});paralyseCreature(c,8,w);expect(c.paralysed).toBe(0);expect(c.elite?.chilledUntil).toBe(8);
  const minion=spawnCreature(1,info,5,3,always(.01));makeElite(minion,'minion',always(.01));paralyseCreature(minion,8,w);expect(minion.paralysed).toBe(8);
 });
 it('builds packs on valid open ground with distinct actor IDs and leaves unselected actors unchanged',()=>{
  const d=room(),base=d.creatures[0].info;controls(d).elitePack(d.creatures[0]);expect(d.creatures.length).toBe(2);expect(d.creatures.every(c=>c.elite?.tier==='champion')).toBe(true);expect(new Set(d.creatures.map(c=>c.id)).size).toBe(2);expect(base).toBe(info);
  for(const c of d.creatures)expect(d.level.cells[Math.floor(c.y)*d.level.width+Math.floor(c.x)].kind).toBe('empty');
  const normal=room();normal.enableRandomLoot();expect(normal.creatures[0].info).toBe(info);expect(normal.creatures[0].elite).toBeUndefined();
 });
});

describe('elite combat abilities',()=>{
 it('applies elemental hits, curable hex vulnerability and real magicka theft',()=>{
  const d=room(),c=d.creatures[0];makeElite(c,'unique',always(.01),{affixes:['flame','frost','siphon','curse']});const hp=d.stats.health,mp=d.stats.magicka;controls(d).eliteHit(c,10);
  expect(d.stats.health).toBeLessThan(hp);expect(d.stats.magicka).toBeLessThan(mp);expect(d.statusEffects().some(e=>e.id==='elite-chill')).toBe(true);expect(d.statusEffects().some(e=>e.id==='elite-hex'&&e.dispelType==='curse')).toBe(true);
 });
 it('emits eight collision-tested storm bolts on injury and rate limits repeated hits',()=>{
  const d=room(),c=d.creatures[0];makeElite(c,'unique',always(.01),{affixes:['storm']});controls(d).hurtByMagic(c,4);expect(d.bolts).toHaveLength(8);expect(new Set(d.bolts.map(b=>b.id)).size).toBe(8);controls(d).hurtByMagic(c,4);expect(d.bolts).toHaveLength(8);
  const initial=d.bolts.map(b=>[b.x,b.y]);d.update(.1,IDLE_INPUT);expect(d.bolts.some((b,i)=>b.x!==initial[i]?.[0]||b.y!==initial[i]?.[1])).toBe(true);
 });
 it('fires three native projectiles for eligible casters without changing their spell record',()=>{
  const spells=parseSpells(file(record({name:'Fire',target:2,element:0,params:[[5,5,0,0,0,0]]}))),d=new Dungeon(level(),{creatures:[{...info,spells:[0]}],weapons:[]},always(.01),DEFAULT_HERO,spells),c=d.creatures[0];c.state='chase';
  const before=JSON.stringify(spells[0]);makeElite(c,'unique',always(.01),{affixes:['volley']});expect(controls(d).updateCreatureCasting(c)).toBe(true);expect(d.bolts).toHaveLength(3);expect(new Set(d.bolts.map(b=>b.id)).size).toBe(3);expect(JSON.stringify(spells[0])).toBe(before);
 });
 it('teleports wounded leaders into reachable unoccupied floor, healing once per cooldown',()=>{
  const d=room(),c=d.creatures[0];makeElite(c,'unique',always(.01),{affixes:['blink']});c.health=1;const before=[c.x,c.y];controls(d).updateElite(c);expect([c.x,c.y]).not.toEqual(before);expect(c.health).toBe(3.5);const at=[c.x,c.y];controls(d).updateElite(c);expect([c.x,c.y]).toEqual(at);expect(Math.hypot(c.x-d.player.x,c.y-d.player.y)).toBeGreaterThanOrEqual(2);
 });
 it('uses real auras for allied damage, aim, pace, and player pulse harm; walls block them',()=>{
  for(const aura of ELITE_AURAS){const d=room(),c=d.creatures[0];d.hero.willpower=0;makeElite(c,'unique',always(.01),{affixes:['aura'],aura});c.state='idle';c.span=100;const hp=d.stats.health;controls(d).updateCreatures(.01,false);
   if(aura==='might'||aura==='fury')expect(c.auraDamage).toBeGreaterThan(1);
   if(aura==='aim')expect(c.auraAccuracy).toBeGreaterThan(1);
   if(aura==='fury')expect(c.auraPace).toBeGreaterThan(1);
   if(['flame','frost','storm'].includes(aura))expect(d.stats.health).toBeLessThan(hp);
   if(aura==='weakening')expect(d.statusEffects().some(e=>e.id==='elite-frailty')).toBe(true);
  }
  const d=room(),c=d.creatures[0];makeElite(c,'unique',always(.01),{affixes:['aura'],aura:'flame'});d.level.cells[3*d.level.width+4].kind='wall';const hp=d.stats.health;controls(d).updateElite(c);expect(d.stats.health).toBe(hp);
 });
 it('triggers death explosions once, blocks wall penetration and withholds player rewards for friendly fire',()=>{
  const d=room(),c=d.creatures[0];c.x=3.5;makeElite(c,'unique',always(.01),{affixes:['flame','frost']});const hp=d.stats.health;controls(d).hurtByMagic(c,10000);expect(d.stats.health).toBeLessThan(hp);const after=d.stats.health;controls(d).eliteDeath(c);expect(d.stats.health).toBe(after);
  const other=room();makeElite(other.creatures[0],'unique',always(.01),{affixes:[]});const xp=other.stats.experience;controls(other).hurtByMagic(other.creatures[0],1000,'magic',false,false,false);expect(other.stats.experience).toBe(xp);
 });
 it('keeps enemy damage-over-time rewards and transfer healing with the actual caster',()=>{
  const d=room(),target=d.creatures[0],caster=spawnCreature(2,info,7.5,3.5,always(.01));caster.health=1;d.creatures.push(caster);target.paralysed=caster.paralysed=100;
  const magic=d as unknown as {onCreature(spell:ReturnType<typeof parseSpells>[0],target:typeof d.creatures[0],level:number,source:typeof d.creatures[0]):void;updateMagic(dt:number):void};
  const drain=parseSpells(file(record({name:'Drain',effects:[13],subs:[1],attributes:[0],params:[[3,0,0,0,1,1]]})))[0];
  const hp=d.stats.health;magic.onCreature(drain,target,1,caster);expect(caster.health).toBe(4);expect(d.stats.health).toBe(hp);
  const dot=parseSpells(file(record({name:'Fire',effects:[1],params:[[100,100,0,0,1,20]]})))[0];magic.onCreature(dot,target,1,caster);
  d.time=25;magic.updateMagic(0);expect(target.health).toBe(0);expect(d.stats.experience).toBe(0);
 });
 it('cycles original monsters, champions and named affixes in practice while keeping one opponent alive',()=>{
  const d=room();new TestArea(d,[info],[{name:'Staff',damage:[2,2],twoHanded:true}]);expect(d.practiceMode).toBe(true);
  const practice=room();practice.creatures.length=0;const area=new TestArea(practice,[info],[{name:'Staff',damage:[2,2],twoHanded:true}]);const run=area.dungeon;
  run.creatures[0].state='dead';run.creatures[0].maxHealth=0;area.update(.01);run.time+=2;area.update(2);
  run.creatures.find(c=>c.state!=='dead')!.state='dead';area.update(.01);run.time+=2;area.update(2);
  expect(run.creatures.filter(c=>c.state!=='dead')).toHaveLength(1);expect(run.creatures.find(c=>c.state!=='dead')!.elite?.tier).toBe('unique');
 });
});
