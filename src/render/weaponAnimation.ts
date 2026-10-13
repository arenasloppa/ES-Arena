/** Attack playback, idle poses and angled weapon blocking. */
import * as THREE from 'three';
import {weaponReadyPose,weaponMotionPose,type WeaponMovement} from './weaponMotion';
import {weaponSizeReferences as sizes} from './weaponModelSizing';
import type {Swing} from '../game/dungeon';
import type {SurfaceMaterial} from '../game/projectilePhysics';
import type {SteelWeaponDefinition,WeaponStyle} from './steelWeaponDefinitions';
export interface GripPose {position:[number,number,number];rotation:[number,number,number];}
export const WEAPON_HIT_AT=.5;
export function idleGrip(def:SteelWeaponDefinition):GripPose {return weaponReadyPose(def.type);}
export function guardGrip(def:SteelWeaponDefinition,grip:[number,number,number]=[0,0,0]):GripPose {
  if(def.style==='bow'){
    const bounds=sizes[def.key].bounds,length=bounds[1][1]-bounds[1][0],depth=THREE.MathUtils.clamp(length*.42,.38,.66);
    // Keep the firing-side facing and raise across the view like the broadsword.
    const rotation:[number,number,number]=[-.88,Math.PI/2,0],q=poseQuaternion({position:[0,0,0],rotation});
    const centre=new THREE.Vector3(...bounds.map(([min,max])=>(min+max)/2)).applyQuaternion(q);
    const position=new THREE.Vector3(.02,-depth*.20,-depth).sub(centre);
    return{position:position.toArray(),rotation};
  }
  const bounds=sizes[def.twoHanded?'war-hammer':def.key].bounds,length=bounds[1][1]-bounds[1][0],depth=THREE.MathUtils.clamp(length*.68,.36,.9);
  let rotation:[number,number,number]=[.10,-.28,.88],q=poseQuaternion({position:[0,0,0],rotation});
  if(def.edgeAxis!==0&&def.type!==15){
    const facing=def.modelFacingYaw??(def.edgeAxis===-1?Math.PI:0),edgeSign=def.edgeAxis*Math.cos(facing)>0?1:-1;
    const alongBlade=new THREE.Vector3(-Math.sin(.88),Math.cos(.88),0),edge=new THREE.Vector3(0,0,-edgeSign);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(edge,alongBlade,new THREE.Vector3().crossVectors(edge,alongBlade)));
    const e=new THREE.Euler().setFromQuaternion(q,'YXZ');rotation=[e.x,e.y,e.z];
  }
  if(def.type===13||def.type===15){
    const ready=poseQuaternion(weaponReadyPose(13)),opposite=q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
    if(ready.angleTo(opposite)<ready.angleTo(q))q.copy(opposite);
    const e=new THREE.Euler().setFromQuaternion(q,'YXZ');rotation=[e.x,e.y,e.z];
  }
  const p=new THREE.Vector3(depth*.7,-depth*.68,-depth).sub(new THREE.Vector3(...grip).applyQuaternion(q));
  if(def.type===14)p.y+=.14;
  if(def.type===15){
    // Fitted main-head centres relative to each grip: crescent blade, excluding the top spear.
    // Match the hammer striking head instead of matching the two shafts' hand anchors.
    const hammerHead=new THREE.Vector3(0,.567523988060423,0);
    const axeHead=new THREE.Vector3(.02128229109133664,.3294381494579188,0);
    p.add(hammerHead.sub(axeHead).applyQuaternion(q));
  }
  return {position:p.toArray(),rotation};
}
/** A short forward shove keeps the held guard orientation and returns to it. */
export function shoveGrip(def:SteelWeaponDefinition,swing:Swing,grip:[number,number,number]=[0,0,0]):GripPose {
  const pose=guardGrip(def,grip),phase=THREE.MathUtils.clamp(swing.time/swing.duration,0,1);
  const push=phase<.45?THREE.MathUtils.smoothstep(phase,0,.45):phase<.55?1:1-THREE.MathUtils.smoothstep(phase,.55,1);
  return{position:[pose.position[0],pose.position[1]+.012*push,pose.position[2]-(def.style==='bow'?.12:def.twoHanded?.20:.16)*push],rotation:pose.rotation};
}
export function animatedGrip(def:SteelWeaponDefinition,swing:Swing|undefined,guard:boolean,_walked:number,_lowered:number,_sneaking=0,clock=0,movement?:WeaponMovement,idleClock=clock):GripPose {
  if(swing?.bash)return shoveGrip(def,swing);
  return guard&&!swing?guardGrip(def):weaponMotionPose(def,swing,clock,movement,idleClock);
}
export function poseQuaternion(pose:GripPose):THREE.Quaternion {return new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ'));}
export function impactResponse(
  material: SurfaceMaterial,
  style: WeaponStyle,
  bash = false,
  edge = style === 'sword' || style === 'short',
): 'recoil' | 'bite' | 'brush' {
  if (material === 'soft') return 'brush';
  if (material === 'wood' && !bash && edge) return 'bite';
  return 'recoil';
}
