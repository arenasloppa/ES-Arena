/** Size the custom meshes, never the animation translations. References are from the local BSA. */
import * as THREE from 'three';
import bytes from './animations/weapon-sizes.awm';
import {readWeaponMotion} from './weaponMotionData';
import type {WeaponSizeReference} from './weaponMotionRuntime';
export const weaponSizeReferences=readWeaponMotion<Record<string,WeaponSizeReference>>(bytes);
const sizes=weaponSizeReferences;
import type { SteelWeaponDefinition } from './steelWeaponDefinitions';
export interface WeaponSizeFit { scale: number; offset: [number,number,number]; grip: [number,number,number]; reference: string; exactEquivalent: boolean; }
export function fitWeaponModel(asset: THREE.Group, def: SteelWeaponDefinition): THREE.Group {
  const ref = sizes[def.key as keyof typeof sizes];
  if (!ref) throw new Error(`Missing weapon size reference: ${def.key}`);
  // Bow staves and -X single-edge meshes need the source's local facing. Fit the mesh, never the socket.
  asset.rotation.y+=def.modelFacingYaw??(def.style==='bow'||def.edgeAxis===-1?Math.PI:0);
  asset.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(asset), center = box.getCenter(new THREE.Vector3());
  // Uniform scale retains each custom weapon's silhouette; match the original tip-to-tail length.
  const scale = (ref.bounds[1][1]-ref.bounds[1][0])/(box.max.y-box.min.y);
  const offset: [number,number,number] = [(ref.bounds[0][0]+ref.bounds[0][1])/2-center.x*scale,ref.bounds[1][0]-box.min.y*scale,(ref.bounds[2][0]+ref.bounds[2][1])/2-center.z*scale];
  const fitted = new THREE.Group(), root = new THREE.Group();
  fitted.name = 'Weapon_size_and_origin'; fitted.scale.setScalar(scale); fitted.position.fromArray(offset); fitted.add(asset); root.add(fitted);
  root.userData.weaponSize = {scale,offset,grip:new THREE.Vector3(...def.grip).applyQuaternion(asset.quaternion).multiplyScalar(scale).add(new THREE.Vector3(...offset)).toArray(),reference:ref.reference,exactEquivalent:ref.exactEquivalent} satisfies WeaponSizeFit;
  return root;
}
