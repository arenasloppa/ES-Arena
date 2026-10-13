import {describe,it,expect} from 'vitest';
import {readMonsterRegeneration} from '../src/formats/monsterRegeneration';
import {spawnCreature,hurtCreature,updateCreature,creatureFrame,isAlive,isDefeated,isMagicTarget,paralyseCreature,type CreatureWorld} from '../src/game/creatures';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {TestArea} from '../src/game/testArea';
import {steelTestRoom} from '../src/game/steelTestRoom';
import {parseSpells} from '../src/formats/spells';
import {always,fakeCreature,textLevel} from './helpers/level';
import {file,record} from './helpers/spells';

function image(){
  const b=new Uint8Array(0x3f520);
  b.set(new TextEncoder().encode('exp_ab.cfa\0'),0x3f508);
  b.set([0xb8,1,0,0xb9,1,0,0x26,0x80,0x7d,4,22,0x74,0x11,0x41,0x26,0x80,0x7d,4,14,0x74,9,0x41,0x40,0x26,0x80,0x7d,4,23,0x75,3,0xe8,0x83,0],0x1a745);
  b.set([0xb8,0x80,0,0xbb,1,0,0xba,1,0,0xbd,0xfb,0xff],0x1a7f8);
  b.set([0xf7,0x84,0x0d,4,0x80,0,0x74,0x15,0x80,0x7c,4,23,0x74,0x0f,0x83,0x7c,0x5b,0,0x7f,0x1e],0x2b0c8);
  return b;
}
const profiles=readMonsterRegeneration(image())!;
function actor(id=14){
  const c=spawnCreature(0,fakeCreature({id,health:[20,20],regeneration:profiles[id-1]}),2.5,1.5,always(0));
  const w:CreatureWorld={level:textLevel(['########','#@.....#','########']),openDoors:new Set(),player:{x:1.5,y:1.5,level:1},sneaking:false,now:0,round:0,random:always(0),creatures:[c]};
  return{c,w};
}

describe('native regeneration initialization',()=>{
  it('reads only Troll, Vampire and Lich healing, with the Lich resurrection exception',()=>{
    expect(profiles.filter(Boolean)).toEqual([{health:1,everyRounds:1,revives:true},{health:1,everyRounds:1,revives:true},{health:2,everyRounds:1,revives:false}]);
    expect(profiles[13]).toBeDefined();expect(profiles[21]).toBeDefined();expect(profiles[22]).toBeDefined();expect(profiles[23]).toBeUndefined();
  });
  it('reads the native immediate healing and period values rather than guessing from monster names',()=>{
    const b=image();b[0x1a746]=3;b[0x1a7fc]=2;
    const p=readMonsterRegeneration(b)!;
    expect(p[13]).toEqual({health:3,everyRounds:2,revives:true});expect(p[22]?.health).toBe(4);
  });
  it.each([0x1a745,0x1a7f8,0x2b0c8,0x3f508])('rejects unsupported instruction layouts at %i',at=>{
    const b=image();b[at]^=1;expect(readMonsterRegeneration(b)).toBeUndefined();expect(readMonsterRegeneration(new Uint8Array(1))).toBeUndefined();
  });
});

describe('regeneration, permanent damage and resurrection',()=>{
  it.each([14,22,23])('monster %i heals on native game-minute boundaries with a maximum cap',id=>{
    const {c,w}=actor(id);hurtCreature(c,5,w);w.round=.99;updateCreature(c,w,.01);expect(c.health).toBe(15);
    w.round=1;updateCreature(c,w,.01);expect(c.health).toBe(id===23?17:16);
    updateCreature(c,w,.01);expect(c.health).toBe(id===23?17:16);
    w.round=100;updateCreature(c,w,.01);expect(c.health).toBe(20);
  });
  it.each([14,22])('physical overkill subdues monster %i without a permanent kill; death frames reverse when HP becomes positive',id=>{
    const {c,w}=actor(id);expect(hurtCreature(c,24,w)).toBe(false);expect(c.health).toBe(-4);expect(isDefeated(c)).toBe(false);
    const falls:number[]=[];updateCreature(c,w,.5,{fall:()=>falls.push(1)});expect(c.state).toBe('dead');expect(isMagicTarget(c)).toBe(true);
    w.round=4;updateCreature(c,w,.01);expect(c.health).toBe(0);expect(c.state).toBe('dead');
    w.round=5;updateCreature(c,w,.01);expect(c.health).toBe(1);expect(c.state).toBe('reviving');expect(isAlive(c)).toBe(false);
    expect(creatureFrame(c,4)).toEqual({death:true,frame:2});
    updateCreature(c,w,.25);expect(creatureFrame(c,4)).toEqual({death:true,frame:1});
    updateCreature(c,w,.25);expect(creatureFrame(c,4)).toEqual({death:true,frame:0});
    updateCreature(c,w,.25);expect(c.state).toBe('chase');expect(isAlive(c)).toBe(true);expect(falls).toHaveLength(1);
  });
  it('a physically defeated Lich stays dead and stops regenerating',()=>{
    const {c,w}=actor(23);expect(hurtCreature(c,24,w)).toBe(true);expect(isDefeated(c)).toBe(true);
    w.round=100;updateCreature(c,w,1);expect(c.health).toBe(-4);expect(c.state).toBe('dead');expect(isMagicTarget(c)).toBe(false);
  });
  // Numeric outcomes compared with original 3ebd:044b–0469 instructions locally.
  it.each([[10,20,4,6,16],[-8,20,5,-13,15],[1,4,8,-7,-4]])('magic preserves native signed current/max HP math (%i/%i minus %i)',(hp,max,damage,after,afterMax)=>{
    const {c,w}=actor();c.health=hp;c.maxHealth=max;if(hp<=0)c.state='dead';
    const killed=hurtCreature(c,damage,w,false,true);
    expect(c.health).toBe(after);expect(c.maxHealth).toBe(afterMax);expect(killed).toBe(afterMax<=0);
  });
  it('spells can finish subdued bodies and award a permanent kill only once',()=>{
    const {c,w}=actor();hurtCreature(c,24,w);updateCreature(c,w,1);
    expect(hurtCreature(c,19,w,false,true)).toBe(false);expect(c.maxHealth).toBe(1);
    expect(hurtCreature(c,1,w,false,true)).toBe(true);expect(isDefeated(c)).toBe(true);
    expect(hurtCreature(c,1,w,false,true)).toBe(false);w.round=100;updateCreature(c,w,1);expect(c.health).toBe(-24);
  });
  it('a regenerator cannot finish rising or attack while paralyzed; its paralysis still expires',()=>{
    const {c,w}=actor();paralyseCreature(c,2,w);hurtCreature(c,20,w);updateCreature(c,w,.5);
    w.round=1;updateCreature(c,w,.01);expect(c.health).toBe(1);expect(c.state).toBe('dying');
    expect(creatureFrame(c,4)).toEqual({death:true,frame:0});
    updateCreature(c,w,2);expect(c.paralysed).toBe(0);updateCreature(c,w,.01);expect(c.state).toBe('reviving');
    paralyseCreature(c,1,w);const frame=creatureFrame(c,4);updateCreature(c,w,.5);expect(creatureFrame(c,4)).toEqual(frame);
  });
  it.each(Array.from({length:24},(_,i)=>i+1))('paralysis freezes monster %i death frames and delays body-fall audio until it wears off',id=>{
    const {c,w}=actor(id),falls:number[]=[];
    paralyseCreature(c,1,w);hurtCreature(c,20,w);
    updateCreature(c,w,.5,{fall:()=>falls.push(1)});
    expect(c.state).toBe('dying');expect(creatureFrame(c,4)).toEqual({death:true,frame:0});expect(falls).toHaveLength(0);
    updateCreature(c,w,.5,{fall:()=>falls.push(1)});expect(c.paralysed).toBe(0);expect(c.time).toBe(0);
    updateCreature(c,w,.5,{fall:()=>falls.push(1)});expect(c.state).toBe('dead');expect(falls).toHaveLength(1);
  });
  it('a magical blow interrupts resurrection and produces one new fall after rising',()=>{
    const {c,w}=actor();hurtCreature(c,20,w);const falls:number[]=[];
    updateCreature(c,w,.5,{fall:()=>falls.push(1)});w.round=1;updateCreature(c,w,.01);
    expect(hurtCreature(c,20,w,false,true)).toBe(true);updateCreature(c,w,.5,{fall:()=>falls.push(1)});
    expect(c.state).toBe('dead');expect(falls).toHaveLength(2); // rose, then fell again
    expect(hurtCreature(c,1,w,false,true)).toBe(false);
  });
  it('a nonlethal spell while rising does not skip the remaining resurrection frames',()=>{
    const {c,w}=actor();hurtCreature(c,20,w);updateCreature(c,w,.5);
    w.round=10;updateCreature(c,w,.01);expect(c.state).toBe('reviving');expect(c.health).toBe(10);
    expect(hurtCreature(c,1,w,false,true)).toBe(false);expect(c.state).toBe('reviving');
    updateCreature(c,w,.25);expect(creatureFrame(c,4)).toEqual({death:true,frame:1});expect(isAlive(c)).toBe(false);
  });
});

function spell(damage:number,target=1,effect=4){return parseSpells(file(record({name:'Regeneration probe',target,effects:[effect],params:[[damage,damage,0,0,0,0]],cost:0})))[0];}
function encounter(id=14,spells=[spell(20)]){
  return new Dungeon(textLevel(['########','#@.....#','########'],{creatures:[{type:0,x:2.5,y:1.5}]}),
    {creatures:[fakeCreature({id,health:[20,20],regeneration:profiles[id-1]})],weapons:[]},always(0),{...DEFAULT_HERO,health:1000,magicka:1000},spells);
}
function physicalKnockdown(d:Dungeon){
  const {w}=actor();hurtCreature(d.creatures[0],24,w);d.update(.5,IDLE_INPUT);
}

describe('regenerators in actual dungeon spell and encounter paths',()=>{
  it('a real melee swing subdues a Troll without granting XP or clearing the dungeon',()=>{
    const d=encounter();d.readied=undefined;d.stats.weapon={...d.stats.weapon,damage:[30,30]};
    d.update(.01,{...IDLE_INPUT,attack:{held:false,pressed:true,released:true}});
    for(let i=0;i<30;i++)d.update(.01,IDLE_INPUT);
    expect(d.events.some(e=>e.type==='hit'&&!e.killed)).toBe(true);
    expect(d.creatures[0].health).toBeLessThanOrEqual(0);expect(d.kills).toBe(0);expect(d.stats.experience).toBe(0);
    expect(d.events.some(e=>e.type==='cleared')).toBe(false);
  });
  it('a touch spell permanently kills a subdued Troll and grants spawn-time XP once',()=>{
    const d=encounter(),c=d.creatures[0];physicalKnockdown(d);
    expect(d.kills).toBe(0);expect(d.stats.experience).toBe(0);expect(d.events.some(e=>e.type==='cleared')).toBe(false);
    expect(d.cast(d.spellbook[0])).toBe(true);expect(c.maxHealth).toBe(0);expect(d.kills).toBe(1);expect(d.stats.experience).toBe(50);
    expect(d.events.filter(e=>e.type==='cleared')).toHaveLength(1);d.update(1,IDLE_INPUT);expect(d.cast(d.spellbook[0])).toBe(false);expect(d.kills).toBe(1);
  });
  it('nonlethal magical damage lowers the healing cap without lowering the eventual reward',()=>{
    const d=encounter(14,[spell(5)]),c=d.creatures[0];expect(d.cast(d.spellbook[0])).toBe(true);expect(c.maxHealth).toBe(15);
    physicalKnockdown(d);for(let i=0;i<3;i++){d.update(1,IDLE_INPUT);expect(d.cast(d.spellbook[0])).toBe(true);}
    expect(d.kills).toBe(1);expect(d.stats.experience).toBe(50);
  });
  it('an aimed projectile can strike the low body while an overhead projectile passes over it',()=>{
    const d=encounter(14,[spell(20,2)]),c=d.creatures[0];physicalKnockdown(d);
    expect(d.cast(d.spellbook[0])).toBe(true);d.update(.2,IDLE_INPUT);expect(d.kills).toBe(0);
    d.update(1,IDLE_INPUT);d.player.pitch=Math.atan2(.1-.65,1);expect(d.cast(d.spellbook[0])).toBe(true);
    d.update(.2,IDLE_INPUT);expect(d.kills).toBe(1);expect(c.maxHealth).toBe(0);
  });
  it('area magic reaches subdued regenerators',()=>{
    const d=encounter(14,[spell(20,3)]);physicalKnockdown(d);expect(d.cast(d.spellbook[0])).toBe(true);expect(d.kills).toBe(1);
  });
  it('continuous magic remains on a subdued regenerator and can finish it',()=>{
    const d=encounter(14,[spell(20,1,1)]);const probe=d.spellbook[0];probe.effects[0].params[5]=10;
    expect(d.cast(probe)).toBe(true);physicalKnockdown(d);
    for(let i=0;i<300&&d.kills===0;i++)d.update(.1,IDLE_INPUT);
    expect(d.kills).toBe(1);expect(isDefeated(d.creatures[0])).toBe(true);
  });
  it('newly spawned actors do not receive regeneration accumulated before their spawn',()=>{
    const d=encounter();d.practiceMode=true;d.clock=6000;
    const c=spawnCreature(5,d.creatures[0].info,5,1.5,always(0));c.health=1;d.addPracticeCreature(c);d.update(.01,IDLE_INPUT);
    expect(c.health).toBe(1);d.clock=6060;d.update(.01,IDLE_INPUT);expect(c.health).toBe(2);
  });
  it('the Test Area retains a knocked-down Troll and advances only after a permanent magical kill',()=>{
    const troll=fakeCreature({id:14,health:[20,20],regeneration:profiles[13]});
    const d=new Dungeon(steelTestRoom(),undefined),area=new TestArea(d,[troll,fakeCreature({name:'Next monster'})],[]),c=d.creatures[0];
    const {w}=actor();hurtCreature(c,24,w);updateCreature(c,w,.5);area.update(.1);d.time+=10;area.update(.1);
    expect(d.creatures).toEqual([c]);expect(c.info).toBe(troll);
    expect(hurtCreature(c,20,w,false,true)).toBe(true);area.update(.1);d.time+=1.6;area.update(.1);
    expect(d.creatures.find(isAlive)?.info.name).toBe('Next monster');d.time+=5;area.update(.1);expect(d.creatures).not.toContain(c);
  });
});
