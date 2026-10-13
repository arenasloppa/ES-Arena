import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {declickSamples} from '../src/audio/declick';
import {sweepTerrain,sweepWoodProps,terrainSphere,woodPropBounds,textureMaterial} from '../src/game/surfacePhysics';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {itemKey,makeSteelArrows} from '../src/game/items';
import {projectile,stepProjectile} from '../src/game/projectilePhysics';
import {textLevel} from './helpers/level';
import {SurfaceImpactView} from '../src/render/surfaceImpactView';
import {guardGrip,shoveGrip,poseQuaternion} from '../src/render/weaponAnimation';
import {STEEL_WEAPON_DEFINITIONS as defs} from '../src/render/steelWeaponDefinitions';
import {weaponAttackClip,weaponAttackSpeed,weaponReadyPose} from '../src/render/weaponMotion';
import {ChainPhysics,type Vec3} from '../src/game/chainPhysics';
import {flailSwingGuide} from '../src/render/flailSwingGuide';
function room(){const level=textLevel(['########','#......#','#.@....#','#......#','########']);level.flats.push({x:3.25,y:2.5,name:'BARREL.IMG',collisionWidth:.45,collisionHeight:.7});return level;}
function armed(type=3){const d=new Dungeon(room(),undefined);const item=d.inventory.add({kind:'weapon',name:'Test',type,material:1,damage:[2,4],twoHanded:defs[type].twoHanded,weight:2,value:10});d.use(itemKey(item));d.player.x=2.5;d.player.y=2.5;d.player.yaw=0;return d;}
describe('click-free Arena effects',()=>{
 it('suppresses the clipped ten-sample prefix without shortening or editing the source',()=>{
  const s=new Float32Array(2000);s.set([-1,-1,-.9375,-.9921875,-1,-1,-1,-1,-1,-1]);for(let i=500;i<1500;i++)s[i]=Math.sin(i*.3)*.4;
  const out=declickSamples(s,8000);expect(out.length).toBe(s.length);expect(Array.from(out.subarray(0,10))).toEqual(Array(10).fill(0));expect(Array.from(out.subarray(500,1500))).toEqual(Array.from(s.subarray(500,1500)));expect(s[0]).toBe(-1);
 });
 it('fades both boundaries without muting an actual clipped onset or changing its duration',()=>{
  const s=new Float32Array(800).fill(-.5);s[0]=-1;const out=declickSamples(s,8000);expect(Math.abs(out[0])).toBe(0);expect(Math.abs(out.at(-1)!)).toBe(0);expect(out[20]).not.toBe(0);expect(out[100]).toBe(-.5);expect(out.length).toBe(800);
 });
});
describe('wood barrel contacts',()=>{
 it('uses the actual sprite dimensions and catches the barrel before the masonry behind it',()=>{
  const level=room(),box=woodPropBounds(level.flats[0])!;expect(box.max[1]).toBe(.7);expect(box.max[0]-box.min[0]).toBeCloseTo(.45);
  const hit=sweepTerrain(level,new Set(),[2.5,.5,2.5],[7.5,.5,2.5])!;expect(hit.material).toBe('wood');expect(hit.point[0]).toBeCloseTo(3.025);expect(sweepWoodProps(level,[2.5,.8,2.5],[7.5,.8,2.5])).toBeUndefined();expect(textureMaterial('BARREL.IMG','wall')).toBe('wood');
 });
 it('resolves flail contact and embeds arrows in the same wooden surface',()=>{
  const level=room(),contact=terrainSphere(level,new Set(),[3.01,.4,2.5],.04)!;expect(contact.point[0]).toBeLessThanOrEqual(2.985+1e-9);
  const p=projectile([2.8,.4,2.5],[10,0,0]);stepProjectile(p,.05,(a,b)=>sweepTerrain(level,new Set(),a,b));expect(p.phase).toBe('embedded');expect(p.bounces).toBe(0);
 });
 for(const bash of [false,true])it(`plays a wood impact and emits chips once for ${bash?'shove':'swing'}`,()=>{
  const d=armed();d.events.length=0;d.update(.001,{...IDLE_INPUT,block:bash,attack:{held:false,pressed:true,released:true}});for(let i=0;i<180;i++)d.update(1/120,IDLE_INPUT);
  expect(d.events.filter(e=>e.type==='sound'&&e.name==='BASH.VOC')).toHaveLength(1);expect(d.events.filter(e=>e.type==='sound'&&e.name==='CLANK.VOC')).toHaveLength(0);expect(d.events.filter(e=>e.type==='surfaceImpact'&&e.material==='wood')).toHaveLength(1);
 });
 it('does not double the impact if the viewmodel reaches a barrel before the timed hit',()=>{
  const d=armed();d.events.length=0;d.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:true,released:true}});const s=d.swing!,hit=sweepWoodProps(d.level,[2.5,.5,2.5],[4,.5,2.5])!;d.meleeTerrainContact(hit,s);d.meleeTerrainContact(hit,s);for(let i=0;i<180;i++)d.update(1/120,IDLE_INPUT);expect(d.events.filter(e=>e.type==='sound'&&e.name==='BASH.VOC')).toHaveLength(1);expect(d.events.filter(e=>e.type==='surfaceImpact')).toHaveLength(1);
 });
 it('fires a recoverable arrow into a barrel with wood effects and no stone/metal sound',()=>{
  const d=armed(16);d.inventory.add(makeSteelArrows(2));d.events.length=0;d.update(.001,{...IDLE_INPUT,attack:{held:true,pressed:true,released:false}});for(let i=0;i<150;i++)d.update(1/120,{...IDLE_INPUT,attack:{held:true,pressed:false,released:false}});d.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:false,released:true}});for(let i=0;i<120;i++)d.update(1/120,IDLE_INPUT);
  expect(d.arrows[0].projectile?.phase).toBe('embedded');const count=d.inventory.steelArrowCount();expect(d.target()?.kind).toBe('arrow');d.activate();expect(d.inventory.steelArrowCount()).toBe(count+1);expect(d.events.some(e=>e.type==='surfaceImpact'&&e.material==='wood')).toBe(true);expect(d.events.some(e=>e.type==='sound'&&['CLANK.VOC','NHIT.VOC'].includes(e.name))).toBe(false);
 });
 it('keeps wood chips bounded and clears them without permanent debris',()=>{
  const view=new SurfaceImpactView();view.burst('soft',[0,0,0],[1,0,0]);expect(view.group.children).toHaveLength(0);view.burst('wood',[1,.5,2],[-1,0,0]);expect(view.group.children).toHaveLength(10);const initial=view.group.children[0].position.clone();view.update(0);expect(view.group.children[0].position).toEqual(initial);view.update(1/60);expect(view.group.children[0].position.x).toBeLessThan(initial.x);for(let i=0;i<20;i++)view.burst('wood',[1,.5,2],[-1,0,0]);expect(view.group.children).toHaveLength(60);view.update(1);expect(view.group.children).toHaveLength(0);view.dispose();
 });
});
describe('charged overhead cuts and guards',()=>{
 it('lifts the heavy flail head above its anchor before bringing it down, keeping links connected and outward',()=>{
  const c=weaponAttackClip(12,'chop',true),duration=c.duration/weaponAttackSpeed(12),chain=new ChainPhysics([.0427,.0628,.0628,.0628,.0628,.0628,.0427,.106],.11,{damping:9});chain.reset([0,0,0]);let high=-Infinity,impact=0;
  for(let i=0;i<=Math.ceil(duration*120);i++){
   const time=i/120,s={kind:'chop' as const,power:true,time,duration,hitAt:c.hit/c.duration,struck:false};chain.update(1/120,[0,0,0],[0,-9.81,0],(p,r)=>p[2]>-r*.6?{point:[p[0],p[1],-r*.6] as Vec3,normal:[0,0,-1]}:undefined,flailSwingGuide(s));
   const head=chain.points.at(-1)!;if(time/duration>.35&&time/duration<.55)high=Math.max(high,head[1]);if(Math.abs(time/duration-c.hit/c.duration)<.01)impact=head[1];expect(head[2]).toBeLessThanOrEqual(-.066+1e-8);for(let j=1;j<chain.points.length;j++)expect(Math.abs(new THREE.Vector3(...chain.points[j]).distanceTo(new THREE.Vector3(...chain.points[j-1]))-chain.lengths[j-1])).toBeLessThan(.012);
  }
  expect(high).toBeGreaterThan(.12);expect(impact).toBeLessThan(high-.15);
 });
 it('uses the same shorter broadside rotation for hammer and battle axe, without a shaft half-turn',()=>{
  const ready=poseQuaternion(weaponReadyPose(13)),a=poseQuaternion(guardGrip(defs[15])),h=poseQuaternion(guardGrip(defs[13]));expect(a.angleTo(h)).toBeLessThan(1e-7);expect(a.angleTo(ready)).toBeLessThan(Math.PI/2);expect(Math.abs(new THREE.Vector3(0,0,1).applyQuaternion(a).z)).toBeGreaterThan(.9);
 });
 for(const type of [16,17])it(`${defs[type].name} block/shove matches the broadsword without a sideways facing turn`,()=>{
  const g=guardGrip(defs[type]),q=poseQuaternion(g),shaft=new THREE.Vector3(0,1,0).applyQuaternion(q);expect(q.angleTo(poseQuaternion(guardGrip(defs[3])))).toBeLessThan(1e-7);expect(shaft.y).toBeGreaterThan(.6);expect(g.rotation[1]).toBeCloseTo(Math.PI/2);expect(shoveGrip(defs[type],{kind:'thrust',power:false,bash:true,time:.15,duration:.3,struck:false}).rotation).toEqual(g.rotation);
 });
});

describe('charged swing audio and material effects',()=>{
 for(const type of [0,1,3,6,12,13,14,15])it(`${defs[type].name} waits until its cutting section to play the charged whoosh once`,()=>{
  const d=armed(type);d.level.flats.length=0;d.events.length=0;
  d.update(.001,{...IDLE_INPUT,attack:{held:true,pressed:true,released:false}});
  for(let i=0;i<60&&!d.swing;i++)d.update(1/120,{...IDLE_INPUT,attack:{held:true,pressed:false,released:false}});
  const swing=d.swing!;expect(swing.power).toBe(true);if(type===6)expect(swing.kind).toBe('right');const soundAt=swing.soundAt!;
  expect(soundAt).toBeGreaterThan(.1);expect(soundAt).toBeLessThan(swing.duration*(swing.hitAt??.5));
  expect(d.events.some(e=>e.type==='sound'&&e.name==='SWISH.VOC')).toBe(false);
  while(swing.time+1/120<soundAt)d.update(1/120,IDLE_INPUT);
  expect(d.events.some(e=>e.type==='sound'&&e.name==='SWISH.VOC')).toBe(false);
  d.update(1/120,IDLE_INPUT);expect(d.events.filter(e=>e.type==='sound'&&e.name==='SWISH.VOC')).toHaveLength(1);
  for(let i=0;i<600&&d.swing;i++)d.update(1/120,IDLE_INPUT);
  expect(d.events.filter(e=>e.type==='sound'&&e.name==='SWISH.VOC')).toHaveLength(1);
 });
 it('keeps a tap attack sound immediate',()=>{const d=armed(6);d.events.length=0;d.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:true,released:true}});expect(d.swing?.power).toBe(false);expect(d.events.filter(e=>e.type==='sound'&&e.name==='SWISH.VOC')).toHaveLength(1);});
 for(const material of ['stone','metal'] as const)it(`emits one ${material} effect at the timed wall contact without a render sweep`,()=>{
  const d=armed();d.player.x=6.4;d.level.flats.length=0;d.level.wallTextures=[{file:material==='metal'?'STEEL.IMG':'STONE.IMG',frame:0}];d.events.length=0;
  d.update(.001,{...IDLE_INPUT,attack:{held:false,pressed:true,released:true}});for(let i=0;i<180;i++)d.update(1/120,IDLE_INPUT);
  const hits=d.events.filter(e=>e.type==='surfaceImpact');expect(hits).toHaveLength(1);expect(hits[0]).toMatchObject({material,point:[7,.5625,2.5],normal:[-1,0,0]});
 });
 it('throws stone chips and fading dust away from the hit and cleans up',()=>{
  const v=new SurfaceImpactView();v.burst('stone',[0,0,0],[0,0,1]);expect(v.group.children).toHaveLength(12);
  const dust=v.group.children.filter(o=>(o as THREE.Mesh).geometry.type==='SphereGeometry');expect(dust).toHaveLength(6);
  v.update(.05);expect(v.group.children.every(o=>o.position.z>0)).toBe(true);expect((dust[0] as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>).material.opacity).toBeLessThan(.3);
  v.update(1);expect(v.group.children).toHaveLength(0);v.dispose();
 });
 it('uses brief luminous metal sparks and freezes them while paused',()=>{
  const v=new SurfaceImpactView();v.burst('metal',[1,2,3],[-1,0,0]);expect(v.group.children).toHaveLength(16);const first=v.group.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>,p=first.position.clone();
  expect(first.material.blending).toBe(THREE.AdditiveBlending);v.update(0);expect(first.position).toEqual(p);v.update(.05);expect(first.position.x).toBeLessThan(p.x);expect(first.material.opacity).toBeLessThan(1);v.update(.5);expect(v.group.children).toHaveLength(0);v.dispose();
 });
});
