import {it,expect} from 'vitest';
import * as THREE from 'three';
import {Dungeon,IDLE_INPUT} from '../src/game/dungeon';
import {itemKey,makeSteelArrows} from '../src/game/items';
import {TEST_WEAPON_DEFINITIONS} from '../src/render/weaponModelDefinitions';
import {WeaponPressMotion} from '../src/render/weaponPressMotion';
import {AttackHold} from '../src/input/rangeGamepad';
import {steelAttackDuration} from '../src/game/weaponHandling';
import {textLevel} from './helpers/level';
const press={...IDLE_INPUT,attack:{held:true,pressed:true,released:false}};
const held={...press,attack:{held:true,pressed:false,released:false}};
const release={...IDLE_INPUT,attack:{held:false,pressed:false,released:true}};
function armed(def:typeof TEST_WEAPON_DEFINITIONS[number]){
 const d=new Dungeon(textLevel(['####################','#..................#','#........@.........#','#..................#','####################']),undefined);
 const item=d.inventory.add({kind:'weapon',name:def.name,type:def.type,material:def.material??1,damage:[2,4],twoHanded:def.twoHanded,weight:2,value:10});d.use(itemKey(item));d.inventory.add(makeSteelArrows(10));return d;
}
for(const def of TEST_WEAPON_DEFINITIONS)it(`${def.name} responds to the press frame without moving damage earlier`,()=>{
 const d=armed(def),dt=1/120,stamina=d.stats.stamina;
 d.update(dt,press);
 if(def.style==='bow'){expect(d.swing?.kind).toBe('shoot');expect(d.swing?.time).toBe(0);expect(d.arrows).toHaveLength(0);expect(d.attackCharging).toBe(false);return;}
 expect(d.attackCharging).toBe(true);expect(d.swing).toBeUndefined();expect(d.stats.stamina).toBe(stamina);expect(d.events.some(e=>e.type==='swing')).toBe(false);
 const motion=new WeaponPressMotion();motion.update(d.attackCharging,dt);const p=new THREE.Vector3(),q=new THREE.Quaternion();motion.apply(p,q);expect(p.z).toBeGreaterThan(.005);expect(q.angleTo(new THREE.Quaternion())).toBeGreaterThan(.01);
 d.update(dt,release);expect(d.attackCharging).toBe(false);expect(d.swing?.power).toBe(false);expect(d.swing?.time).toBe(dt);expect(d.swing?.struck).toBe(false);expect(d.swing?.duration).toBe(steelAttackDuration(d.stats.weapon,false,d.swing!.kind));
 const power=armed(def);power.update(dt,press);for(let i=0;i<38;i++)power.update(dt,held);expect(power.swing).toBeUndefined();power.update(dt,held);expect(power.swing?.power).toBe(true);expect(power.attackCharging).toBe(false);expect(power.swing?.struck).toBe(false);
});
it('preparation fades continuously into the swing and is frame-rate independent',()=>{
 const a=new WeaponPressMotion(),b=new WeaponPressMotion(),sample=(m:WeaponPressMotion)=>{const p=new THREE.Vector3(),q=new THREE.Quaternion();m.apply(p,q);return{p,q};};
 for(let i=0;i<12;i++)a.update(true,1/120);for(let i=0;i<6;i++)b.update(true,1/60);expect(sample(a).p.distanceTo(sample(b).p)).toBeLessThan(1e-12);
 let last=sample(a);for(let i=0;i<120;i++){a.update(false,1/120);const next=sample(a);expect(next.p.distanceTo(last.p)).toBeLessThan(.007);expect(next.q.angleTo(last.q)).toBeLessThan(.014);last=next;}expect(last.p.length()).toBeLessThan(1e-7);
});
it('freezes preparation when no frame time passes',()=>{const m=new WeaponPressMotion();m.update(true,1/60);const p=new THREE.Vector3(),q=new THREE.Quaternion();m.apply(p,q);m.update(false,0);const after=new THREE.Vector3(),r=new THREE.Quaternion();m.apply(after,r);expect(after).toEqual(p);expect(r).toEqual(q);});
it('releasing one device cannot release or restart an attack held on another',()=>{
 const a=new AttackHold();expect(a.sample(true).pressed).toBe(true);
 // Mouse tap/release arrives while RT is held.
 expect(a.sample(true,true)).toEqual({held:true,pressed:false,released:false});
 // RT releases while mouse remains held.
 expect(a.sample(true)).toEqual({held:true,pressed:false,released:false});
 expect(a.sample(false)).toEqual({held:false,pressed:false,released:true});
 expect(a.sample(false,true)).toEqual({held:false,pressed:true,released:true});
});
