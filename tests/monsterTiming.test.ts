import {describe,it,expect} from 'vitest';
import {readMonsterTiming} from '../src/formats/monsterTiming';
import {creatureFrame,hurtCreature,monsterInReach,monsterStepSeconds,paralyseCreature,spawnCreature,updateCreature,type CreatureWorld} from '../src/game/creatures';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {creatureMagic} from '../src/game/creatureMagic';
import {parseSpells} from '../src/formats/spells';
import {always,fakeCreature,textLevel} from './helpers/level';
import {file,record} from './helpers/spells';

function image(){
  const b=new Uint8Array(0x3f520);b.set(new TextEncoder().encode('exp_ab.cfa\0'),0x3f508);
  for(const [at,hex]of [
    [0xa428,'a151013b0660ba74f7f7069ac30004750dff0660baa151013b0660ba74f7ff06bccc'],
    [0x1d89,'640fb6472db91400f7e1c1e808051400894408'],[0x1e3a,'c1e80203c33daa000f878e00'],
    [0x1eab,'2507000f85ef00'],[0x1f77,'33d2b91600f7f123d2751f'],[0x1da5,'807c0d087220807c0d0a0f85ee01'],
    [0x19b8,'807c0d087204c6440d00'],
    [0x2117,'f74402ffff7508a1cecc653907730d'],
    [0x221b,'c6440cc0fe440d807c0d0c7204c6440d00c3'],[0x21a7,'fe440d807c0d037301'],
  ]as [number,string][])b.set(Uint8Array.from(hex.match(/../g)!,s=>parseInt(s,16)),at);
  return b;
}
const timing=readMonsterTiming(image())!;
function actor(speed=128,lift=0){
  const c=spawnCreature(0,fakeCreature({id:1,timing,lift,health:[100,100],attributes:[128,128,128,128,speed,128,128,128]}),10.5,1.5,always(0));c.state='chase';
  const w:CreatureWorld={level:textLevel(['####################','#@.................#','####################']),openDoors:new Set(),player:{x:1.5,y:1.5,level:1},sneaking:false,now:0,round:0,random:always(0),creatures:[c]};
  return{c,w,tick:monsterStepSeconds(c)};
}

describe('native monster timing layout',()=>{
  it('validates and decodes the original AI/frame constants',()=>{
    expect(timing).toEqual({timerTicks:2,meleeMask:7,castDivisor:22,reach:170,attackFirst:8,attackEnd:12,strikeFrame:10,deathEnd:3,speedMultiplier:20,speedBase:20});
  });
  it.each([0xa428,0x1d89,0x1e3a,0x1eab,0x1f77,0x1da5,0x19b8,0x2117,0x221b,0x21a7,0x3f508])('rejects unsupported instructions at %i',at=>{
    const b=image();b[at]^=1;expect(readMonsterTiming(b)).toBeUndefined();expect(readMonsterTiming(new Uint8Array(4))).toBeUndefined();
  });
});

describe('fixed native simulation and movement',()=>{
  it('produces the same AI steps and movement at 30, 60 and 144 FPS',()=>{
    const results=[30,60,144].map(fps=>{const {c,w}=actor();let steps=0;for(let i=0;i<fps;i++){w.now=(i+1)/fps;updateCreature(c,w,1/fps,{casting:()=>{steps++;return false;}});}return{x:c.x,steps};});
    for(const result of results){expect(result.steps).toBe(10);expect(result.x).toBeCloseTo(10.5-10*60/128,8);}
  });
  it.each([0,64,128,192,255])('uses the native Speed %i arithmetic, rather than identical creature speeds',speed=>{
    const {c,w}=actor(speed);updateCreature(c,w,.001);expect(c.x).toBeCloseTo(10.5-2*(20+((speed*20)>>8))/128,8);
  });
  it('applies Speed drain to the native pace',()=>{
    const {c,w}=actor(128);creatureMagic(c).modifiers.push({attribute:4,points:-25,loss:0,every:60,next:60,until:60});
    updateCreature(c,w,.001);expect(c.x).toBeCloseTo(10.5-50/128,8);
  });
  it.each(['wet','lava','dry']as const)('a floating native creature crosses a %s chasm while a ground creature stays out',kind=>{
    for(const lift of [0,6]){
      const {c,w,tick}=actor(128,lift);c.x=6.5;w.level.cells[1*w.level.width+5].chasm=kind;
      for(let i=0;i<5;i++)updateCreature(c,w,tick);
      expect(c.x<5).toBe(lift!==0);
    }
  });
  it('floating creatures still collide with walls',()=>{
    const {c,w,tick}=actor(128,6);c.x=6.5;w.level.cells[w.level.width+5].kind='wall';
    for(let i=0;i<5;i++)updateCreature(c,w,tick);expect(c.x).toBeGreaterThan(6);
  });
  it('uses the original quarter-minimum reach metric, not circular distance',()=>{
    const {c}=actor();c.x=c.y=0;
    expect(monsterInReach(c,{x:170/128,y:0})).toBe(true);expect(monsterInReach(c,{x:171/128,y:0})).toBe(false);
    expect(monsterInReach(c,{x:136/128,y:136/128})).toBe(true);expect(monsterInReach(c,{x:137/128,y:137/128})).toBe(false);
  });
});

describe('native attack and death frames',()=>{
  it('starts with frame 9, strikes once when AI sees frame 10, and resets after frame 11',()=>{
    const {c,w,tick}=actor();c.x=2.5;const strikes:number[]=[],swings:number[]=[];
    const events={swing:()=>swings.push(1),strike:()=>strikes.push(1)};
    updateCreature(c,w,.001,events);expect(creatureFrame(c,4).frame).toBe(9);expect(strikes).toHaveLength(0);
    updateCreature(c,w,tick,events);expect(creatureFrame(c,4).frame).toBe(10);expect(strikes).toHaveLength(0);
    updateCreature(c,w,tick,events);expect(creatureFrame(c,4).frame).toBe(11);expect(strikes).toHaveLength(1);
    updateCreature(c,w,tick,events);expect(c.state).toBe('chase');expect(c.cooldown).toBe(0);expect(swings).toHaveLength(1);expect(strikes).toHaveLength(1);
  });
  it('the native 1-in-8 gate can delay a melee attempt without imposing a second cooldown',()=>{
    const {c,w,tick}=actor();c.x=2.5;w.random=always(1/65536);
    updateCreature(c,w,tick);expect(c.state).toBe('chase');w.random=always(0);updateCreature(c,w,tick);expect(c.state).toBe('attack');
  });
  it('an accepted diagonal melee attack resolves its hit chance without a narrower Euclidean check',()=>{
    const {c,w,tick}=actor();w.level=textLevel(['####################','#@.................#','#..................#','#..................#','####################']);c.x=w.player.x+136/128;c.y=w.player.y+136/128;
    const strikes:number[]=[];updateCreature(c,w,.001,{strike:(_,damage)=>strikes.push(damage)});
    updateCreature(c,w,2*tick,{strike:(_,damage)=>strikes.push(damage)});expect(strikes).toHaveLength(1);expect(strikes[0]).toBeGreaterThan(0);
  });
  it('a lateral dodge cancels the native attack instead of rotating the attacker to follow the player',()=>{
    const {c,w,tick}=actor();c.x=2.5;const strikes:number[]=[];updateCreature(c,w,.001,{strike:(_,n)=>strikes.push(n)});
    w.player={...w.player,x:c.x,y:3.5};updateCreature(c,w,tick,{strike:(_,n)=>strikes.push(n)});
    expect(c.state).toBe('chase');expect(strikes).toHaveLength(0);expect(c.facing).toBeCloseTo(Math.PI);
  });
  it('retreating within the same view direction does not add a range check to a committed native blow',()=>{
    const {c,w,tick}=actor();c.x=2.5;let damage=0;updateCreature(c,w,.001,{strike:(_,n)=>damage+=n});
    w.player.x=.1;updateCreature(c,w,2*tick,{strike:(_,n)=>damage+=n});expect(damage).toBeGreaterThan(0);
  });
  it('falls through three native animation updates, reversing one frame each update on revival',()=>{
    const {c,w,tick}=actor();c.info.regeneration={health:1,everyRounds:1,revives:true};let falls=0;
    hurtCreature(c,100,w);updateCreature(c,w,.001,{fall:()=>falls++});expect(creatureFrame(c,4)).toEqual({death:true,frame:1});
    updateCreature(c,w,tick,{fall:()=>falls++});expect(creatureFrame(c,4).frame).toBe(2);expect(falls).toBe(0);
    updateCreature(c,w,tick,{fall:()=>falls++});expect(c.state).toBe('dead');expect(falls).toBe(1);
    w.round=1;updateCreature(c,w,tick);expect(creatureFrame(c,4)).toEqual({death:true,frame:1});
    updateCreature(c,w,tick);expect(creatureFrame(c,4).frame).toBe(0);updateCreature(c,w,tick);expect(c.state).toBe('chase');
    hurtCreature(c,100,w);updateCreature(c,w,tick*3,{fall:()=>falls++});expect(falls).toBe(1);
  });
  it('paralysis freezes native frames but its timer expires, allowing animation to resume',()=>{
    const {c,w,tick}=actor();paralyseCreature(c,1,w);hurtCreature(c,100,w);updateCreature(c,w,tick*4);expect(creatureFrame(c,4).frame).toBe(0);
    updateCreature(c,w,tick*6);expect(c.paralysed).toBe(0);expect(creatureFrame(c,4).frame).toBe(1);
    updateCreature(c,w,tick);expect(creatureFrame(c,4).frame).toBe(2);
  });
});

function caster(random:()=>number){
  const s=parseSpells(file(record({name:'Native bolt probe',target:2,effects:[4],params:[[1,1,0,0,0,0]],cost:0})))[0];
  const info=fakeCreature({id:11,timing,spells:[0],spellLevel:6,attributes:Array(8).fill(128)});
  const d=new Dungeon(textLevel(['####################','#@.................#','####################'],{creatures:[{type:0,x:8.5,y:1.5}]}),{creatures:[info],weapons:[]},random,{...DEFAULT_HERO,health:100},[s]);
  d.creatures[0].state='chase';return d;
}
describe('native casting cadence',()=>{
  it('rolls each eligible AI step instead of waiting 2.5–4 seconds',()=>{
    const d=caster(always(0));d.update(.001,IDLE_INPUT);expect(d.bolts).toHaveLength(1);d.update(monsterStepSeconds(d.creatures[0]),IDLE_INPUT);expect(d.bolts).toHaveLength(2);
  });
  it('a failed cast gate freezes the casting stance without launching or advancing walk frames',()=>{
    const d=caster(always(1/65536)),c=d.creatures[0];d.update(.001,IDLE_INPUT);const x=c.x;
    d.update(monsterStepSeconds(c),IDLE_INPUT);expect(c.x).toBe(x);expect(d.bolts).toHaveLength(0);expect(creatureFrame(c,4)).toEqual({death:false,frame:0});
  });
  it('a multiple of 22 passes the native unsigned remainder gate',()=>{
    const d=caster(always(22/65536));d.update(.001,IDLE_INPUT);expect(d.bolts).toHaveLength(1);
  });
  it('does not freeze or cast when silenced, or while performing a melee attack',()=>{
    const d=caster(always(0)),c=d.creatures[0];creatureMagic(c).silencedUntil=100;d.update(.001,IDLE_INPUT);expect(c.native?.casting).toBe(false);expect(d.bolts).toHaveLength(0);
    creatureMagic(c).silencedUntil=0;c.x=2.5;d.update(monsterStepSeconds(c),IDLE_INPUT);expect(c.state).toBe('attack');expect(c.native?.casting).toBe(false);expect(d.bolts).toHaveLength(0);
  });
});
