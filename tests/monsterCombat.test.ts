import {describe,it,expect} from 'vitest';
import {monsterWeaponDamage} from '../src/game/monsterCombat';
import {STEEL_WEAPON_DEFINITIONS} from '../src/render/steelWeaponDefinitions';
import type {Weapon} from '../src/game/combat';
import {fakeCreature} from './helpers/level';
const requirements=[5,4,4,5], undead=[7,10,12,13,15,22,23];
const sword:Weapon={name:'Test sword',type:3,material:1,damage:[1,10],cif:'SWORD.CIF'};
const hit=(id:number,material:number,type=3)=>monsterWeaponDamage(10,{...sword,material,type},fakeCreature({id}),undead,requirements);
describe('original creature weapon resistance',()=>{
 it('enforces every original material threshold and vampire Silver exception',()=>{
  for(const [id,min] of [[17,3],[18,4],[19,5],[20,5],[21,4],[22,4],[23,5]]) {
   for(let material=0;material<8;material++) expect(hit(id,material)).toBe(material<min&&!(id===22&&material===2)?0:material===2&&undead.includes(id)?20:10);
  }
 });
 it('halves blades axes and arrows on skeletons while preserving blunt damage, doubles Silver against undead',()=>{
  for(const type of [1,2,3,4,5,6,7,8,9,10,14,15,16,17])expect(hit(7,1,type)).toBe(5);
  expect(STEEL_WEAPON_DEFINITIONS.filter(w=>[0,11,12,13].includes(w.type)).map(w=>w.name)).toEqual(['Staff','Mace','Flail','War Hammer']);
  for(const type of [0,11,12,13])expect(hit(7,1,type)).toBe(10);
  expect(hit(7,2)).toBe(10);expect(hit(13,2)).toBe(20);expect(hit(2,2)).toBe(10);
 });
 it('allows fists to bypass material resistance, and keeps the final boss immune to physical damage',()=>{
  expect(monsterWeaponDamage(10,{...sword,type:undefined,material:undefined},fakeCreature({id:17}),undead,requirements)).toBe(10);
  for(let m=0;m<8;m++)expect(hit(24,m)).toBe(0);
 });
});
