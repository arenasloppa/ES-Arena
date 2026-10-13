import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {SpriteShadows} from '../src/render/spriteShadows';
import {textLevel} from './helpers/level';

describe('sprite shadow silhouettes',()=>{
 it('keeps visible transforms untouched while following frames, movement and visibility',()=>{
  const scene=new THREE.Scene(),source=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial());
  source.position.set(.5,.5,.5);source.rotation.y=.6;source.layers.enable(2);
  const frame=new THREE.DataTexture(new Uint8Array(16).fill(255),2,2);source.material.map=frame;source.material.alphaTest=.5;scene.add(source);
  const shadows=new SpriteShadows(scene,textLevel(['.']));shadows.register(source);
  const rotation=source.quaternion.clone();shadows.sync(true,new THREE.Vector3(3,1,1));
  expect(source.quaternion.equals(rotation)).toBe(true);expect(source.layers.isEnabled(2)).toBe(false);
  const caster=scene.children.find(o=>o!==source&&o.layers.isEnabled(2)) as THREE.Mesh;
  const contact=scene.children.find(o=>o!==source&&!o.layers.isEnabled(2)) as THREE.Mesh;
  expect(caster.visible).toBe(true);expect(contact.visible).toBe(true);
  expect((caster.material as THREE.MeshBasicMaterial).map).toBe(frame);expect(caster.quaternion.equals(rotation)).toBe(false);
  expect(contact.position.y).toBeCloseTo(.001);
  const next=frame.clone();source.material.map=next;source.position.x=.7;shadows.sync(true,new THREE.Vector3(-3,1,1));
  expect((caster.material as THREE.MeshBasicMaterial).map).toBe(next);expect(caster.position.x).toBeCloseTo(.7);
  expect(source.quaternion.equals(rotation)).toBe(true);
  source.visible=false;shadows.sync(true);expect(caster.visible).toBe(false);expect(contact.visible).toBe(false);
  source.visible=true;shadows.sync(false);expect(caster.visible).toBe(false);expect(contact.visible).toBe(false);
  source.removeFromParent();shadows.sync(true);expect(scene.children).toHaveLength(0);shadows.dispose();
 });
 it('projects the current sprite alpha away from light and clips the silhouette at solid walls',()=>{
  const level=textLevel(Array(9).fill('.........')),scene=new THREE.Scene();
  const source=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial());
  source.position.set(4.5,.5,4.5);source.material.map=new THREE.DataTexture(new Uint8Array(16).fill(255),2,2);source.material.alphaTest=.5;scene.add(source);
  const shadows=new SpriteShadows(scene,level);shadows.register(source);shadows.sync(true);
  const projected=scene.children.find(o=>o instanceof THREE.Mesh&&o.material instanceof THREE.ShaderMaterial) as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
  const light={position:new THREE.Vector3(1.5,1.5,4.5),range:6};shadows.project(true,[light],0);
  expect(projected.visible).toBe(true);expect(projected.material.uniforms.sprite.value).toBe(source.material.map);
  const positions=projected.geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++)expect(positions.getX(i)).toBeGreaterThanOrEqual(0);
  const full=projected.geometry.drawRange.count;
  level.cells[4*9+5].kind='wall';shadows.project(true,[light],0);
  expect(projected.geometry.drawRange.count).toBeLessThan(full);
  level.cells[4*9+5].kind='empty';level.cells[4*9+3].kind='wall';shadows.project(true,[light],0);
  expect(projected.visible).toBe(false);
  level.cells[4*9+3].kind='empty';light.position.x=7.5;shadows.project(true,[light],0);
  for(let i=0;i<positions.count;i++)expect(positions.getX(i)).toBeLessThanOrEqual(0);
  const next=source.material.map.clone();source.material.map=next;shadows.sync(true);shadows.project(true,[light],0);
  expect(projected.material.uniforms.sprite.value).toBe(next);
  shadows.project(false,[light],0);expect(projected.visible).toBe(false);shadows.dispose();
 });

});
