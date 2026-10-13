import {describe,it,expect} from 'vitest';
import {ARENA_HEIGHT,SWIMMING_HEIGHT,chasmFloor,isWaterTunnel,ceilingHeight} from '../src/game/level';
import {playerBlocked,step,settle,keepInChasm} from '../src/game/player';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {buildLevelGeometry} from '../src/render/levelGeometry';
import {sweepTerrain,terrainSphere} from '../src/game/surfacePhysics';
import {textLevel} from './helpers/level';

function tunnel(){
 const level=textLevel(['########','#.~~~~.#','########'],{height:.9375,chasmTextures:{wet:7},ceilingTex:2,wallCapTexture:{file:'WALLF.SET',frame:3}});
 for(const x of [3,4])level.cells[level.width+x].kind='wall';
 return level;
}
describe('liquid passages beneath dungeon walls',()=>{
 it('allows a swimmer through both roof cells, with no snap back or climb',()=>{
  const level=tunnel(),d=new Dungeon(level,undefined);Object.assign(d.player,{x:2.5,y:1.5,z:chasmFloor('wet',level.height),yaw:0});
  for(let i=0;i<120;i++)d.update(1/120,{...IDLE_INPUT,forward:1});
  expect(d.player.x).toBeGreaterThan(3);expect(d.swimming).toBe(true);expect(d.climb).toBeUndefined();
  for(let i=0;i<120;i++)d.update(1/120,{...IDLE_INPUT,forward:1});
  expect(d.player.x).toBeGreaterThan(4);expect(d.player.z).toBeCloseTo(-25*ARENA_HEIGHT);expect(d.swimming).toBe(true);
 });
 it('requires head clearance and leaves normal walls and the bank solid',()=>{
  const level=tunnel(),z=chasmFloor('wet',level.height),doors=new Set<number>();
  expect(playerBlocked(level,3.5,1.5,z,doors,true)).toBe(false);
  expect(playerBlocked(level,3.5,1.5,-SWIMMING_HEIGHT+.01,doors,true)).toBe(true);
  expect(playerBlocked(level,3.5,1.5,0,doors)).toBe(true);
  expect(playerBlocked(level,3.5,.5,z,doors,true)).toBe(true);
  expect(playerBlocked(level,6.5,1.5,z,doors,true)).toBe(true);
  expect(isWaterTunnel(level.cells[11])).toBe(true);expect(ceilingHeight(level.cells[11],level)).toBe(0);
 });
 it('lets radius-overlapping swimmers enter and reverse through a passage',()=>{
  const level=tunnel(),p={x:2.85,y:1.5,z:chasmFloor('wet',level.height),yaw:0,pitch:0},doors=new Set<number>();
  expect(keepInChasm(level,p,doors)).toBe(false);
  for(let i=0;i<120;i++){step(level,p,{forward:1,strafe:0,run:false},1/120,doors);settle(level,p,1/120);keepInChasm(level,p,doors);}
  expect(p.x).toBeGreaterThan(5);p.yaw=Math.PI;
  for(let i=0;i<120;i++){step(level,p,{forward:1,strafe:0,run:false},1/120,doors);settle(level,p,1/120);}
  expect(p.x).toBeCloseTo(2.85);expect(p.z).toBeCloseTo(-25*ARENA_HEIGHT);
 });
 it('draws a liquid floor, the solid-wall underside texture and chasm-textured channel sides',()=>{
  const level=tunnel(),{batches}=buildLevelGeometry(level);
  const quads=(key:string)=>{const p=batches.get(key)!.positions,result:number[][]=[];for(let i=0;i<p.length;i+=12)result.push(p.slice(i,i+12));return result;};
  const under=quads('wallcap:0').filter(q=>q.every((v,i)=>i%3!==1||v===0));
  expect(under).toHaveLength(2);
  for(const q of under)expect(q.filter((_,i)=>i%3===0).every(x=>x>=3&&x<=5)).toBe(true);
  expect(quads('liquid:wet')).toHaveLength(4);
  const sides=quads('chasm:wet:7');expect(sides.length).toBeGreaterThan(0);
  expect(sides.some(q=>q.some((v,i)=>i%3===1&&v===chasmFloor('wet',level.height)))).toBe(true);
 });
 it('shares the roof and channel boundary with projectile and chain collision',()=>{
  const level=tunnel(),doors=new Set<number>(),y=-.12;
  expect(sweepTerrain(level,doors,[2.5,y,1.5],[5.5,y,1.5])).toBeUndefined();
  const roof=sweepTerrain(level,doors,[3.5,y,1.5],[3.5,.1,1.5]);expect(roof?.point[1]).toBeCloseTo(0);expect(roof?.normal).toEqual([0,-1,0]);
  expect(sweepTerrain(level,doors,[3.5,y,1.5],[3.5,y,.5])).toBeDefined();
  expect(terrainSphere(level,doors,[3.5,y,1.5],.02)).toBeUndefined();
  const contact=terrainSphere(level,doors,[3.5,-.01,1.5],.02);expect(contact?.point[1]).toBeCloseTo(-.02);
 });
 it('handles lava roofs at the same height without opening a dry wall',()=>{
  const level=tunnel();level.cells[11].chasm='lava';expect(isWaterTunnel(level.cells[11])).toBe(true);
  expect(playerBlocked(level,3.5,1.5,-25*ARENA_HEIGHT,new Set(),true)).toBe(false);
  delete level.cells[11].chasm;expect(isWaterTunnel(level.cells[11])).toBe(false);
  expect(playerBlocked(level,3.5,1.5,-25*ARENA_HEIGHT,new Set(),true)).toBe(true);
 });
});
