import * as THREE from 'three';
import type {Swing} from '../game/dungeon';
import type {Vec3} from '../game/chainPhysics';
export function flailSwingGuide(swing?:Swing):{direction:Vec3;strength:number;damping:number} {
 const phase=swing?THREE.MathUtils.clamp(swing.time/swing.duration,0,1):0;
 if(swing?.power&&!swing.bash&&['chop','downLeft','downRight'].includes(swing.kind)){
  const lift=THREE.MathUtils.smootherstep(phase,0,.18)*(1-THREE.MathUtils.smootherstep(phase,.55,swing.hitAt??.706));
  return{direction:new THREE.Vector3(0,THREE.MathUtils.lerp(-.92,1.8,lift),THREE.MathUtils.lerp(-.39,-.80,lift)).normalize().toArray(),strength:220,damping:18};
 }
 const drive=swing&&!swing.bash?Math.sin(Math.PI*phase):0;
 return{direction:new THREE.Vector3(0,-.92+.57*drive,-.39-.55*drive).normalize().toArray(),strength:32,damping:8};
}
