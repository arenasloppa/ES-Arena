import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {parseInf} from '../src/formats/inf';
import {parseMif} from '../src/formats/mif';
import {buildLevel,ARENA_HEIGHT} from '../src/game/level';
import {buildLevelGeometry} from '../src/render/levelGeometry';
import {buildLevelScene} from '../src/render/levelScene';
import {TextureCache} from '../src/render/textures';
import {encryptInf,makeMif} from './helpers/encode';
import {textLevel} from './helpers/level';

const nativeStyleInf=()=>parseInf(encryptInf('@FLOORS\nfloora.set #4\nfloorb.set #2\nfloorc.img\n@WALLS\nwalls.set #35\nwallf.set #4\n'));
describe('dungeon texture selection',()=>{
 it('resolves the original wall underside slot 45 independently of the ceiling and side',()=>{
  const l=buildLevel(parseMif(makeMif({width:1,depth:1,map1:[0x1919],flor:[0x0d00]})),0,nativeStyleInf());
  expect(l.wallCapTexture).toEqual({file:'WALLF.SET',frame:3});
  expect(l.floorTextures[l.ceilingTex]).toEqual({file:'FLOORA.SET',frame:0});
  const b=buildLevelGeometry(l).batches.get('wallcap:0')!;
  expect(b.positions.filter((_,i)=>i%3===1)).toEqual([0,0,0,0]);
 });
 it('uses the first native texture for slot 45 only when that INF lacks the slot',()=>{
  const l=buildLevel(parseMif(makeMif({width:1,depth:1,map1:[0],flor:[0]})),0,parseInf(encryptInf('@FLOORS\nfloor.img\n@WALLS\nwall.img\n')));
  expect(l.wallCapTexture).toEqual({file:'FLOOR.IMG',frame:0});
 });
 it('does not substitute the solid wall underside for a raised platform underside',()=>{
  const l=textLevel(['.'],{ceilingTex:1,wallCapTexture:{file:'CAP.IMG',frame:0}});
  Object.assign(l.cells[0],{kind:'raised',raisedBottom:.6,raisedTop:.8});
  const b=buildLevelGeometry(l).batches;
  expect(b.has('wallcap:0')).toBe(false);
  expect(b.get('floor:1')!.positions.filter((_,i)=>i%3===1)).toContain(.6);
 });
 it('aligns elevated platform side pixels to their actual height instead of restarting at the floor',()=>{
  const l=textLevel(['...'],{height:100*ARENA_HEIGHT});
  Object.assign(l.cells[1],{kind:'raised',raisedBottom:50*ARENA_HEIGHT,raisedTop:75*ARENA_HEIGHT,capTex:0});
  const uv=buildLevelGeometry(l).batches.get('maskedwall:0')!.uvs;
  expect(uv.slice(0,8)).toEqual([0,.5,1,.5,1,.75,0,.75]);
 });
 it('loads the selected wall underside frame and alpha-tests the correct SET frame for arches',async()=>{
  const l=textLevel(['..'],{wallTextures:[{file:'ARCH.SET',frame:2}],wallCapTexture:{file:'WALLF.SET',frame:3}});
  l.cells[0].kind='transparent';l.cells[1].kind='wall';l.cells[1].chasm='wet';
  const calls:Array<unknown[]>=[],texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
  const scene=await buildLevelScene(l,{tile:async(...args)=>{calls.push(args);return texture;},sprite:async()=>{throw Error('SET frames must not be parsed as IMG sprites');},liquid:async()=>[texture]});
  expect(calls).toContainEqual(['ARCH.SET',2,true]);expect(calls).toContainEqual(['WALLF.SET',3,false]);
  expect((await scene.material('arch:0') as THREE.MeshBasicMaterial).alphaTest).toBe(.5);
  expect((await scene.material('arch:0') as THREE.MeshBasicMaterial).side).toBe(THREE.FrontSide);
 });
 it('keeps all 320×100 pixels of each original liquid frame',async()=>{
  const bytes=new Uint8Array(320*100*2);bytes[0]=1;bytes[320*100-1]=2;bytes[320*100]=3;
  const palette=new Uint8Array(1024);palette.set([40,50,60,255],4);palette.set([70,80,90,255],8);palette.set([100,110,120,255],12);
  const cache=new TextureCache({has:()=>true,read:async()=>bytes} as never,palette);
  const frames=await cache.liquid('WATERANI.RCI');expect(frames).toHaveLength(2);
  const a=frames[0].image as {width:number;height:number;data:Uint8Array},b=frames[1].image as typeof a;
  expect([a.width,a.height]).toEqual([320,100]);
  expect(Array.from(a.data.slice(99*320*4,99*320*4+3))).toEqual([40,50,60]);
  expect(Array.from(a.data.slice(319*4,319*4+3))).toEqual([70,80,90]);
  expect(Array.from(b.data.slice(99*320*4,99*320*4+3))).toEqual([100,110,120]);
  cache.dispose();
 });
});
