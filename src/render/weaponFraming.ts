import * as THREE from 'three';
import type {GripPose} from './weaponAnimation';
/** Continuous bottom-edge framing; never switch the weapon between screen edges. */
export function hideWeaponTail(pose:GripPose,tail:readonly THREE.Vector3[],fov:number,_aspect=16/9,_upper:readonly THREE.Vector3[]=[]):GripPose {
  const slope=Math.tan(fov*Math.PI/360)*1.04;
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ')),origin=new THREE.Vector3(...pose.position);
  let lower=0;
  for(const point of tail){
    const p=point.clone().applyQuaternion(q).add(origin);
    // Include points behind the near plane so crossing it cannot toggle the correction.
    lower=Math.min(lower,p.z*slope-p.y);
  }
  return lower<0?{position:[pose.position[0],pose.position[1]+lower,pose.position[2]],rotation:pose.rotation}:pose;
}
