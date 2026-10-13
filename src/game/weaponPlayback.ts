/** Local weapon playback timing. */
export const WEAPON_ATTACK_PLAYBACK_RATE = 0.8;

/** Additional inertia by weapon family; heavier shafts and heads take longer to swing. */
const WEAPON_PLAYBACK_RATES:readonly number[]=[.64,.72,.76,.70,.72,.68,.56,.80,.76,.70,.54,.62,.54,.48,.58,.50,.80,.72];
export function weaponPlaybackRate(type?:number):number {
  return type===undefined?WEAPON_ATTACK_PLAYBACK_RATE:WEAPON_PLAYBACK_RATES[type]??WEAPON_ATTACK_PLAYBACK_RATE;
}

/** Shared by pose sampling, damage markers, recovery and bow attachment/release. */
export function weaponAttackPlaybackSpeed(sourceSpeed: number,type?:number): number {
  return sourceSpeed * weaponPlaybackRate(type);
}
