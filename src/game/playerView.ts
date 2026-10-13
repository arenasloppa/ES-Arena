import {ARENA_HEIGHT} from './level';
export const STANDING_EYE=60*ARENA_HEIGHT;
export const SNEAKING_EYE=40*ARENA_HEIGHT;
export const SWIMMING_EYE=12*ARENA_HEIGHT;
export const DEAD_EYE=10*ARENA_HEIGHT;

/** Camera and projectile launch share the same stance height. */
export function playerEyeOffset(sneaking:boolean,swimming=false):number {
  return swimming?SWIMMING_EYE:sneaking?SNEAKING_EYE:STANDING_EYE;
}
