import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {relief} from '../src/render/textureRelief';
import {makeLiquidMaterial} from '../src/render/liquidMaterial';
import {SceneLighting} from '../src/render/sceneLighting';
import {normalMapFor} from '../src/render/normalMaps';
import {loadSettings,saveSettings,stepSetting,DEFAULT_SETTINGS,applyGraphicsPreset} from '../src/ui/settings';

describe('graphics settings and surface relief',()=>{
 it('preserves liquid shaders and animation frame references during lighting conversion',()=>{
  const frame = new THREE.DataTexture(new Uint8Array(16),2,2), liquid=makeLiquidMaterial(frame);
  const animated = new THREE.MeshBasicMaterial({map:frame});animated.userData.keepAnimatedMaterial=true;
  const group = new THREE.Group();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(),liquid.material), decoration=new THREE.Mesh(new THREE.PlaneGeometry(),animated);
  group.add(water,decoration);
  const scene = new THREE.Scene();scene.add(group);
  const dungeon = {level:{flats:[]}};
  const lighting = new SceneLighting({} as THREE.WebGLRenderer,scene,dungeon as never,{group} as never);
  (lighting as unknown as {prepare():void}).prepare();
  expect(water.material).toBe(liquid.material);expect(decoration.material).toBe(animated);
  expect(water.layers.isEnabled(2)).toBe(false);expect(decoration.layers.isEnabled(2)).toBe(true);
  const shader = {uniforms:{},fragmentShader:'#include <map_fragment>'};
  liquid.material.onBeforeCompile(shader as never,{} as THREE.WebGLRenderer);
  const uniforms=shader.uniforms as Record<string,{value:unknown}>;
  expect(uniforms.arenaLiquidFrame).toBe(liquid.frame);
  const next=new THREE.DataTexture(new Uint8Array(16),2,2);liquid.frame.value=next;
  expect(uniforms.arenaLiquidFrame.value).toBe(next);
  expect(shader.fragmentShader).toContain('gl_FragCoord');lighting.dispose();
 });
 it('keeps the selected preset and overrides obsolete individual options',()=>{
  let saved='';const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
  const selected={...DEFAULT_SETTINGS};applyGraphicsPreset(selected,'original');
  saveSettings(selected,storage);expect(loadSettings(storage)).toEqual(selected);
  expect(selected).toMatchObject({graphicsMode:'original',specular:false,glow:false,ambientOcclusion:false,volumetric:0,shadows:false,bumpMaps:false,lighting:false});
  expect(stepSetting(selected,'graphicsMode',1,false)).toBe('remake');
  expect(stepSetting(selected,'graphicsMode',-1,false)).toBe('remake');
  expect(stepSetting(DEFAULT_SETTINGS,'graphicsMode',1,false)).toBe('original');
  expect(stepSetting(DEFAULT_SETTINGS,'graphicsMode',1,true)).toBe('original');
  saved=JSON.stringify({glow:false,lighting:false,volumetric:0});
  expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  applyGraphicsPreset(selected,'remake');expect(selected).toEqual(DEFAULT_SETTINGS);
 });
 it('keeps diffuse and bump UV transforms together and separates reversed image origins',()=>{
  const pixels=new Uint8Array(8*8*4).fill(255);
  for(let y=2;y<4;y++)for(let x=0;x<8;x++)pixels.fill(20,(y*8+x)*4,(y*8+x)*4+3);
  const texture=new THREE.DataTexture(pixels,8,8);texture.repeat.set(2,.5);texture.offset.set(.1,.3);texture.center.set(.5,.5);texture.rotation=.2;texture.channel=1;
  const map=normalMapFor(texture)!;
  expect(map.repeat.equals(texture.repeat)).toBe(true);expect(map.offset.equals(texture.offset)).toBe(true);
  expect(map.center.equals(texture.center)).toBe(true);expect(map.rotation).toBe(texture.rotation);expect(map.channel).toBe(1);
  const reversed=texture.clone();reversed.flipY=!texture.flipY;
  const other=normalMapFor(reversed)!;expect(other).not.toBe(map);
  const a=map.image.data as Uint8Array,b=other.image.data as Uint8Array;expect(a.some((value:number,i:number)=>i%4===1&&value!==b[i])).toBe(true);
 });
 it('registers enemy materials for shadow reception without breaking animation references',()=>{
  const group=new THREE.Group(),scene=new THREE.Scene();scene.add(group);
  const material=new THREE.MeshStandardMaterial({roughness:.95});material.userData.noBump=true;
  const enemy=new THREE.Mesh(new THREE.PlaneGeometry(),material);enemy.userData.receiveSceneLighting=true;scene.add(enemy);
  const lighting=new SceneLighting({} as THREE.WebGLRenderer,scene,{level:{flats:[]}} as never,{group} as never);
  (lighting as unknown as {prepare():void}).prepare();
  expect(enemy.material).toBe(material);expect(material.customProgramCacheKey()).toBe('surface-lighting-v2');
  expect(enemy.layers.isEnabled(2)).toBe(true);lighting.dispose();
 });
 it('does not invent bumps on a uniformly painted surface',()=>{
  const pixels=new Uint8Array(8*8*4).fill(140),normal=relief(pixels,8,8,new Uint8ClampedArray(pixels.length));
  for(let i=0;i<normal.length;i+=4)expect([...normal.slice(i,i+4)]).toEqual([128,128,255,255]);
 });
 it('creates unit normals for raised detail and caches them across shared texture images',()=>{
  const pixels=new Uint8Array(8*8*4).fill(255);
  for(let y=2;y<6;y++)for(let x=2;x<6;x++)pixels.fill(30,(y*8+x)*4,(y*8+x)*4+3);
  const texture=new THREE.DataTexture(pixels,8,8),map=normalMapFor(texture)!;
  expect(normalMapFor(texture.clone())).toBe(map);
  const bytes=(map.image as {data:Uint8Array}).data;expect(bytes.some((value,i)=>i%4===0&&value!==128)).toBe(true);
  for(let i=0;i<bytes.length;i+=4){const length=Math.hypot(...[0,1,2].map(k=>bytes[i+k]/255*2-1));expect(length).toBeCloseTo(1,1);}
  expect(map.colorSpace).toBe(THREE.NoColorSpace);
 });
});
