import {describe,it,expect} from 'vitest';
import {readSpellAreaCells} from '../src/formats/spellArea';
import {Dungeon,IDLE_INPUT,AREA_RADIUS} from '../src/game/dungeon';
import {spawnCreature,hurtCreature,type CreatureWorld} from '../src/game/creatures';
import {DEFAULT_HERO} from '../src/game/combat';
import {parseSpells} from '../src/formats/spells';
import {always,fakeCreature,textLevel} from './helpers/level';
import {file,record} from './helpers/spells';

function image(){
  const b=new Uint8Array(0x43e51+42);
  b.set(new TextEncoder().encode('exp_ab.cfa\0'),0x3f508);
  b.set([0xb9,0x15,0,0xbf,0x51,0x84,0x8b,0xd3,3,0x15,0x3b,0xc2,0x74,7,0x83,0xc7,2,0xe2,0xf3,0xf8,0xc3,0xf9,0xc3],0x2d71d);
  const offsets=[-514,-512,-510,-260,-258,-256,-254,-252,-4,-2,0,2,4,260,258,256,254,252,514,512,510];
  const v=new DataView(b.buffer);offsets.forEach((n,i)=>v.setInt16(0x43e51+i*2,n,true));return b;
}
const cells=readSpellAreaCells(image())!;
function spell(target=3){return parseSpells(file(record({name:'Area probe',target,effects:[4],params:[[5,5,0,0,0,0]],cost:0})))[0];}
function dungeon(s=spell()){
  return new Dungeon(textLevel(['############','#..........#','#..........#','#....@.....#','#..........#','#..........#','#..........#','############']),
    {creatures:[],weapons:[],spellAreaCells:cells},always(0),{...DEFAULT_HERO,health:100,magicka:100,willpower:0,saves:[100,100,100,100,100]},[s]);
}
function add(d:Dungeon,x:number,y:number,id=1){
  const c=spawnCreature(d.creatures.length,fakeCreature({id,health:[100,100]}),x,y,always(0));c.paralysed=100;d.creatures.push(c);return c;
}
function launch(d:Dungeon,s:ReturnType<typeof spell>,source:ReturnType<typeof add>,x:number,y:number){
  d.bolts.push({id:0,spell:s,source,level:1,x,y,dx:1,dy:0,z:.5,dz:0,travelled:0});d.update(.01,IDLE_INPUT);
}

describe('original area-spell cells',()=>{
  it('decodes the verified 21-cell native footprint, excluding the four corners',()=>{
    expect(cells).toHaveLength(21);
    // Every entry compared against original 3cdd:094d over this 7x7 grid.
    for(let x=-3;x<=3;x++)for(let y=-3;y<=3;y++)expect(cells.some(c=>c.x===x&&c.y===y)).toBe(Math.abs(x)<=2&&Math.abs(y)<=2&&!(Math.abs(x)===2&&Math.abs(y)===2));
  });
  it('reads the actual table and rejects unsupported, duplicate or malformed data',()=>{
    const b=image(),v=new DataView(b.buffer);v.setInt16(0x43e51,-516,true);expect(readSpellAreaCells(b)?.[0]).toEqual({x:-2,y:-2});
    v.setInt16(0x43e51,-512,true);expect(readSpellAreaCells(b)).toBeUndefined();
    expect(readSpellAreaCells(new Uint8Array(10))).toBeUndefined();
    const bad=image();bad[0x2d71d]^=1;expect(readSpellAreaCells(bad)).toBeUndefined();
  });
  it('a player area spell uses map cells rather than a sphere, including their far edges',()=>{
    const d=dungeon(),inside=add(d,7.99,4.99),corner=add(d,7.5,5.5),outside=add(d,8.01,3.5);
    expect(d.cast(d.spellbook[0])).toBe(true);expect(inside.health).toBe(95);expect(corner.health).toBe(100);expect(outside.health).toBe(100);expect(d.stats.health).toBe(100);
  });
  it('uses the native footprint across intervening walls instead of adding an unsupported LOS filter',()=>{
    const d=dungeon(),c=add(d,7.5,3.5);d.level.cells[3*d.level.width+6].kind='wall';
    expect(d.cast(d.spellbook[0])).toBe(true);expect(c.health).toBe(95);
  });
  it('native area collection excludes subdued and rising bodies',()=>{
    const d=dungeon(),c=add(d,6.5,3.5,14);
    c.info.regeneration={health:1,everyRounds:1,revives:true};
    const w:CreatureWorld={level:d.level,openDoors:d.openDoors,player:{...d.player,level:1},sneaking:false,now:0,random:always(0),creatures:d.creatures};
    hurtCreature(c,101,w);expect(d.cast(d.spellbook[0])).toBe(true);expect(c.maxHealth).toBe(100);
    c.state='reviving';c.health=10;d.update(1,IDLE_INPUT); // Still paralyzed.
    expect(d.cast(d.spellbook[0])).toBe(true);expect(c.maxHealth).toBe(100);
  });
});

describe('monster area spell impact',()=>{
  it.each([3,4])('target %i remains a projectile and expands at the impact, not at its source',target=>{
    const s=spell(target),d=dungeon(s),source=add(d,8.5,3.5),near=add(d,7.9,3.5),far=add(d,10.5,3.5);
    launch(d,s,source,5.2,3.5);
    expect(d.bolts).toHaveLength(0);expect(d.stats.health).toBe(95);expect(near.health).toBe(95);expect(far.health).toBe(100);
    expect(d.events.find(e=>e.type==='burst')).toMatchObject({radius:AREA_RADIUS});
  });
  it('target 3 excludes its monster caster even when the impact area includes it',()=>{
    const s=spell(3),d=dungeon(s),source=add(d,6.5,3.5);launch(d,s,source,5.2,3.5);expect(source.health).toBe(100);
  });
  it('target 4 can harm its monster caster and the player caster',()=>{
    const s=spell(4),d=dungeon(s),source=add(d,6.5,3.5);launch(d,s,source,5.2,3.5);expect(source.health).toBe(95);
    const player=dungeon(s);player.bolts.push({id:0,spell:s,level:1,x:6.5,y:3.5,dx:0,dy:-1,z:.5,travelled:0});
    player.level.cells[2*player.level.width+6].kind='wall';player.update(.5,IDLE_INPUT);expect(player.stats.health).toBe(95);
  });
});
