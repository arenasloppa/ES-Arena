import {usesModelWeaponHandling} from '../render/weaponModelDefinitions';
import type { Weapon } from './combat';
import {weaponAttackClip,weaponAttackSpeed,bowDrawDuration} from '../render/weaponMotion';
/** Other materials retain Arena's original combat timing. */
export function steelAttackDuration(weapon: Weapon, power: boolean, kind = 'right'): number {
  if (!usesModelWeaponHandling(weapon)) return power ? .6 : .4;
  const type=weapon.type??3;return weaponAttackClip(type,kind,power).duration/weaponAttackSpeed(type);
}
export function steelImpactAt(weapon: Weapon, power = false, kind = 'right'): number {
  if(!usesModelWeaponHandling(weapon))return .5;
  const clip=weaponAttackClip(weapon.type??3,kind,power);return clip.hit/clip.duration;
}
export function steelBowDrawTime(weapon: Weapon): number {
  return bowDrawDuration(weapon.type??16);
}

/** Play a charged swing's whoosh at the start of its cutting section, after the windup. */
export function steelSwingSoundTime(weapon:Weapon,power:boolean,kind='right'):number {
  if(!power||!usesModelWeaponHandling(weapon))return 0;
  const type=weapon.type??3,clip=weaponAttackClip(type,kind,power),speed=weaponAttackSpeed(type);
  if(type===12&&['chop','downLeft','downRight'].includes(kind))return .55*clip.duration/speed;
  return (clip.segments[0][1]-clip.segments[0][0])/speed;
}
