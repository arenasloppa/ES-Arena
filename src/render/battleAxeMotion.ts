import bytes from './animations/battle-axe-motion.awm';
import {readWeaponMotion} from './weaponMotionData';
import {WeaponMotionRuntime,applyMotionPoseEdit,type AxeMotionSet} from './weaponMotionRuntime';
import {weaponAttackPlaybackSpeed} from '../game/weaponPlayback';
import type {Swing} from '../game/dungeon';
import type {GripPose} from './weaponAnimation';
export const battleAxeMotionSource=readWeaponMotion<AxeMotionSet>(bytes);
const runtime=new WeaponMotionRuntime(battleAxeMotionSource,battleAxeMotionSource.unitsToMetres);
export const AXE_WEAPON_FOV=battleAxeMotionSource.fieldOfView;
export function sampleBattleAxeMotion(time:number):GripPose {return runtime.sampleSocket(time);}
export function battleAxeReady(clock=0):GripPose {
  const[start,end]=battleAxeMotionSource.idle;return sampleBattleAxeMotion(start+Math.max(0,clock)%(end-start));
}
export function battleAxeAttackClip(kind='right',power=false) {
  const name=kind==='thrust'?'thrust':['chop','downLeft','downRight'].includes(kind)?'chop':'slash';
  return battleAxeMotionSource.attacks[name+(power?'Charged':'')];
}
export function battleAxeAttack(swing:Swing):GripPose {
  const clip=battleAxeAttackClip(swing.kind,swing.power),speed=weaponAttackPlaybackSpeed(1,15);
  return applyMotionPoseEdit(runtime.sampleAttack(clip,swing.time,speed),clip.poseEdit,swing.time*speed/clip.duration);
}
