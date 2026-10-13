/** Explicit material/type registry; other Silver weapons retain their original sprites. */
import {steelWeaponDefinition,STEEL_WEAPON_DEFINITIONS,type SteelWeaponDefinition} from './steelWeaponDefinitions';
export const SILVER_DAGGER:SteelWeaponDefinition={type:1,material:2,key:'dagger',name:'Dagger',style:'short',grip:[0,-.0425,0],edgeAxis:1,axisRoll:0,twoHanded:false};
export const TEST_WEAPON_DEFINITIONS:readonly SteelWeaponDefinition[]=[...STEEL_WEAPON_DEFINITIONS.slice(0,18),SILVER_DAGGER];
export function weaponModelDefinition(weapon:{type?:number;material?:number}):SteelWeaponDefinition|undefined{
 return weapon.material===2&&weapon.type===1?SILVER_DAGGER:steelWeaponDefinition(weapon);
}
export function weaponModelKey(def:SteelWeaponDefinition):string{return `${def.material??1}:${def.key}`;}
export function weaponModelPath(def:SteelWeaponDefinition):string{return `models/weapons/${def.material===2?'silver':'steel'}/${def.key}.glb`;}
/** Preserve Steel handling when extending it to additional material variants. */
export function usesModelWeaponHandling(weapon:{type?:number;material?:number}):boolean{return weapon.material===1||weaponModelDefinition(weapon)!==undefined;}
