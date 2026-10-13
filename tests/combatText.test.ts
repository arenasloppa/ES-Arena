import {describe,it,expect} from 'vitest';
import {CombatText,DAMAGE_COLOURS,CRITICAL_COLOUR,spellDamageKind} from '../src/game/combatText';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {always,fakeCreature,textLevel} from './helpers/level';
import {parseSpells} from '../src/formats/spells';
import {file,record} from './helpers/spells';

describe('floating combat feedback',()=>{
  it('stays at the impact point, follows camera projection and expires without overwriting rapid hits',()=>{
    const text=new CombatText(),point:[number,number,number]=[2,.7,3];
    text.add(8,point,0,'physical',true);text.add(4,point,.02,'fire');point[0]=9;
    const frame=text.frame(.1,p=>({x:p[0]*100,y:p[2]*100,visible:true}));
    expect(frame).toHaveLength(2);expect(frame[0]).toMatchObject({amount:8,critical:true,kind:'physical'});
    expect(frame[0].x).toBeLessThan(201);expect(frame[0].y).toBeLessThan(300);
    expect(text.frame(.3,p=>({x:p[0]*50,y:100,visible:true}))[0].x).toBeLessThan(101);
    expect(text.frame(.3,()=>({x:0,y:0,visible:false}))).toEqual([]);
    expect(text.frame(2,()=>({x:0,y:0,visible:true}))).toEqual([]);
  });
  it('uses distinct elemental colours, larger gold criticals and bounded label storage',()=>{
    expect(new Set(Object.values(DAMAGE_COLOURS)).size).toBe(6);
    expect(Object.values(DAMAGE_COLOURS)).not.toContain(CRITICAL_COLOUR);
    expect([0,1,2,3,4,5].map(spellDamageKind)).toEqual(['fire','frost','poison','shock','magic','magic']);
    const text=new CombatText();for(let i=0;i<100;i++)text.add(i,[0,0,0],0);
    text.add(0,[0,0,0],0);text.add(NaN,[0,0,0],0);
    expect(text.frame(0,()=>({x:0,y:0,visible:true}))).toHaveLength(64);
    text.clear();expect(text.frame(0,()=>({x:0,y:0,visible:true}))).toHaveLength(0);
  });
  it('tags actual melee critical damage and caps feedback at the remaining health',()=>{
    const level=textLevel(['#####','#@..#','#####'],{creatures:[{type:0,x:2.1,y:1.5}]});
    const d=new Dungeon(level,{creatures:[fakeCreature({health:[3,3]})],weapons:[{name:'Dagger',damage:[5,5],twoHanded:false}]},always(0),{...DEFAULT_HERO,critical:1});
    d.update(.01,{...IDLE_INPUT,attack:{pressed:true,released:true,held:false}});
    for(let i=0;i<30;i++)d.update(.02,IDLE_INPUT);
    const hit=d.events.find(e=>e.type==='hit');
    expect(hit).toMatchObject({type:'hit',damage:10,appliedDamage:3,critical:true,damageKind:'physical'});
  });
  it('tags a spell hit from its actual element and health loss',()=>{
    const level=textLevel(['#######','#@....#','#######'],{creatures:[{type:0,x:3.1,y:1.5}]});
    const spells=parseSpells(file(record({name:'Frost Test',target:2,element:1,params:[[6,6,0,0,0,0]],cost:1})));
    const d=new Dungeon(level,{creatures:[fakeCreature({health:[20,20]})],weapons:[]},always(0),{...DEFAULT_HERO,magicka:100},spells);
    d.update(.01,{...IDLE_INPUT,block:true});for(let i=0;i<40;i++)d.update(.02,IDLE_INPUT);
    expect(d.events.find(e=>e.type==='hit')).toMatchObject({damage:6,appliedDamage:6,damageKind:'frost'});
  });
});
