import * as THREE from 'three';
import type {GripPose} from './weaponAnimation';

export interface MotionKey<T=number[]> {time:number;value:T;forward?:T;backward?:T;}
export interface MotionTrack<T=number[]> {type:number;keys:MotionKey<T>[];}
export interface MotionNode {name:string;parent:number|null;position:number[];rotation:number[];scale:number;}
export interface MotionHierarchy {nodes:MotionNode[];tracks:Record<string,{translation:MotionTrack;rotation:MotionTrack}>;sourceSha256?:string;}
export interface MotionPoseEdit {position:MotionTrack;tilt:MotionTrack<number>;followEase:number;}
export interface AttackClip {segments:number[][];duration:number;hit:number;group:string;strength:number;poseEdit?:MotionPoseEdit;}
export type WeaponMovement='walk'|'run'|'sneak';
export interface MotionFamily {attacks:Record<string,AttackClip>;idle:number[];movements:Record<WeaponMovement,number[]>;}
export interface WeaponMotionSet extends MotionHierarchy {unitsToMetres:number;fieldOfView:number;families:Record<string,MotionFamily>;bow:Record<string,number>;bowEdits?:{draw:MotionPoseEdit;release:MotionPoseEdit};}
export interface AxeMotionSet extends MotionHierarchy {unitsToMetres:number;fieldOfView:number;attacks:Record<string,AttackClip>;idle:number[];}
export interface IdleMotionProfile {offset:number[];pitch:number;tilt:number;sway:number[];angularSway:number;period:number;}
export interface WeaponProfile {group:string;speed:number;record:string;referenceType:number;proxy:boolean;idleMotion?:IdleMotionProfile;viewOffset?:number[];}
export interface BowMotionSet extends MotionHierarchy {morphs:MotionTrack<number>[];vertices:Array<{base:number[];draw:number[];recoil:number[]}>;sourceGroupStart:number;}
export interface WeaponSizeReference {reference:string;model:string;bounds:number[][];exactEquivalent:boolean;}

function bracket<T>(keys:MotionKey<T>[],time:number):[MotionKey<T>,MotionKey<T>,number] {
  let left=0,right=keys.length-1;
  while(right-left>1){const middle=(left+right)>>>1;if(keys[middle].time<=time)left=middle;else right=middle;}
  const a=keys[left],b=keys[right];return[a,b,THREE.MathUtils.clamp((time-a.time)/(b.time-a.time||1),0,1)];
}
function hermite(a:number,b:number,out:number,incoming:number,u:number):number {
  const squared=u*u,cubed=squared*u;
  return a*(2*cubed-3*squared+1)+b*(3*squared-2*cubed)+out*(cubed-2*squared+u)+incoming*(cubed-squared);
}
function vector(track:MotionTrack|undefined,time:number,fallback:number[]):THREE.Vector3 {
  if(!track?.keys.length)return new THREE.Vector3().fromArray(fallback);
  const[a,b,u]=bracket(track.keys,time);
  if(track.type===5)return new THREE.Vector3().fromArray(u>.5?b.value:a.value);
  const components=a.value.map((x,i)=>track.type===2||track.type===3?hermite(x,b.value[i],a.forward![i],b.backward![i],u):x+(b.value[i]-x)*u);
  return new THREE.Vector3().fromArray(components);
}
function quaternion(track:MotionTrack|undefined,time:number,fallback:number[]):THREE.Quaternion {
  if(!track?.keys.length)return new THREE.Quaternion().fromArray(fallback).normalize();
  const[a,b,u]=bracket(track.keys,time),start=new THREE.Quaternion().fromArray(a.value).normalize(),end=new THREE.Quaternion().fromArray(b.value).normalize();
  return track.type===5?(u>.5?end:start):start.slerp(end,u);
}
export function sampleMotionScalar(track:MotionTrack<number>,time:number):number {
  if(!track.keys.length)return 0;const[a,b,u]=bracket(track.keys,time);
  return track.type===2||track.type===3?hermite(a.value,b.value,a.forward!,b.backward!,u):a.value+(b.value-a.value)*u;
}

/** Small authored socket corrections; rotation is about the view axis, never the shaft axis. */
export function applyMotionPoseEdit(pose:GripPose,edit:MotionPoseEdit|undefined,phase:number):GripPose {
  if(!edit)return pose;
  const t=THREE.MathUtils.clamp(phase,0,1),offset=vector(edit.position,t,[0,0,0]),tilt=sampleMotionScalar(edit.tilt,t);
  if(offset.lengthSq()<1e-20&&Math.abs(tilt)<1e-10)return pose;
  const position=new THREE.Vector3(...pose.position).add(offset),rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ'));
  rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),tilt));
  const euler=new THREE.Euler().setFromQuaternion(rotation,'YXZ');return{position:position.toArray(),rotation:[euler.x,euler.y,euler.z]};
}

/** Continuous breathing/walking sway, with distinct rest angles and no shaft-axis roll. */
export function applyIdleMotion(pose:GripPose,profile:IdleMotionProfile|undefined,clock:number,moving=false,amount=1):GripPose {
  if(!profile||amount<=0)return pose;
  const phase=Math.max(0,clock)*Math.PI*2/profile.period,scale=moving?1.35:1;
  const position=new THREE.Vector3(...pose.position).addScaledVector(new THREE.Vector3(...profile.offset),amount);
  position.addScaledVector(new THREE.Vector3(profile.sway[0]*Math.sin(phase),profile.sway[1]*Math.sin(phase*2),profile.sway[2]*Math.sin(phase)),scale*amount);
  const correction=new THREE.Quaternion().setFromEuler(new THREE.Euler((profile.pitch+profile.angularSway*.55*Math.sin(phase*2))*amount,0,(profile.tilt+profile.angularSway*Math.sin(phase))*amount,'YXZ'));
  const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ')).premultiply(correction),euler=new THREE.Euler().setFromQuaternion(rotation,'YXZ');
  return{position:position.toArray(),rotation:[euler.x,euler.y,euler.z]};
}

/** Shared evaluator for attachment sockets and bow controllers. Parent transforms remain intact. */
export class WeaponMotionRuntime {
  private readonly attackJoins=new WeakMap<AttackClip,Array<{time:number;length:number;offset:THREE.Vector3;rotation:THREE.Quaternion}>>();
  private readonly cameraIndex:number;
  private readonly socketIndex:number;
  private readonly basis=new THREE.Matrix4().makeRotationX(-Math.PI/2);
  constructor(private readonly data:MotionHierarchy,private readonly unitsToMetres:number,socket='Weapon Bone') {
    this.cameraIndex=data.nodes.findIndex(n=>n.name==='Camera');
    this.socketIndex=data.nodes.findIndex(n=>n.name===socket);
    if(this.socketIndex<0)throw Error(`Missing motion socket: ${socket}`);
    for(let i=0;i<data.nodes.length;i++){const parent=data.nodes[i].parent;if(parent!==null&&(parent<0||parent>=i))throw Error('Invalid motion hierarchy');}
  }
  sampleWorld(time:number):THREE.Matrix4[] {
    const matrices:THREE.Matrix4[]=[];
    for(const node of this.data.nodes){
      const channels=this.data.tracks[node.name],local=new THREE.Matrix4().compose(vector(channels?.translation,time,node.position),quaternion(channels?.rotation,time,node.rotation),new THREE.Vector3().setScalar(node.scale));
      matrices.push(node.parent===null?local:local.premultiply(matrices[node.parent]));
    }
    return matrices;
  }
  /** Carry the outgoing pose into each recovery segment, then ease away its offset. */
  sampleAttack(clip:AttackClip,seconds:number,speed:number):GripPose {
    let joins=this.attackJoins.get(clip);
    if(!joins){
      joins=[];let elapsed=0;
      for(let i=0;i<clip.segments.length-1;i++){
        elapsed+=clip.segments[i][1]-clip.segments[i][0];
        const before=this.sampleSocket(clip.segments[i][1]),after=this.sampleSocket(clip.segments[i+1][0]);
        const q=(pose:GripPose)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ'));
        joins.push({time:elapsed,length:(clip.segments[i+1][1]-clip.segments[i+1][0])*.35,offset:new THREE.Vector3(...before.position).sub(new THREE.Vector3(...after.position)),rotation:q(before).multiply(q(after).invert())});
      }
      this.attackJoins.set(clip,joins);
    }
    const pose=this.sampleSocket(motionClipTime(clip,seconds,speed)),elapsed=THREE.MathUtils.clamp(seconds*speed,0,clip.duration);
    for(const join of joins){
      const length=Math.min(.10*speed,join.length);
      if(elapsed<join.time||elapsed>=join.time+length||length<=0)continue;
      const fade=1-THREE.MathUtils.smootherstep(elapsed,join.time,join.time+length);
      const position=new THREE.Vector3(...pose.position).addScaledVector(join.offset,fade);
      const correction=new THREE.Quaternion().slerp(join.rotation,fade);
      const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ')).premultiply(correction),e=new THREE.Euler().setFromQuaternion(rotation,'YXZ');
      return{position:position.toArray(),rotation:[e.x,e.y,e.z]};
    }
    return pose;
  }
  sampleSocket(time:number):GripPose {
    const world=this.sampleWorld(time),matrix=this.basis.clone().multiply(world[this.socketIndex]),position=new THREE.Vector3(),rotation=new THREE.Quaternion();
    matrix.decompose(position,rotation,new THREE.Vector3());
    if(this.cameraIndex>=0)position.sub(new THREE.Vector3().setFromMatrixPosition(world[this.cameraIndex]).applyMatrix4(this.basis));
    position.multiplyScalar(this.unitsToMetres);
    const euler=new THREE.Euler().setFromQuaternion(rotation,'YXZ');return{position:position.toArray(),rotation:[euler.x,euler.y,euler.z]};
  }
}

/** Map gameplay seconds onto a clip's release/follow segments using one shared speed. */
export function motionClipTime(clip:AttackClip,seconds:number,speed:number):number {
  let remaining=THREE.MathUtils.clamp(seconds*speed,0,clip.duration);
  for(let i=0;i<clip.segments.length;i++){
    const[start,end]=clip.segments[i],length=end-start;
    if(remaining<length||i===clip.segments.length-1){
      let u=length>0?Math.min(remaining/length,1):0;
      if(i===clip.segments.length-1){const amount=THREE.MathUtils.clamp(clip.poseEdit?.followEase??0,0,1);u+=(u*u*(3-2*u)-u)*amount;}
      return start+length*u;
    }
    remaining-=length;
  }
  return clip.segments.at(-1)![1];
}

/** Keep one quaternion branch during a fade, including when the relative turn crosses 180 degrees. */
export function blendRotationContinuous(base:THREE.Quaternion,target:THREE.Quaternion,amount:number,reference:THREE.Quaternion):THREE.Quaternion {
  const delta=base.clone().invert().multiply(target).normalize();
  if(delta.dot(reference)<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
  const sine=Math.hypot(delta.x,delta.y,delta.z),halfAngle=Math.atan2(sine,delta.w);
  if(sine<1e-10)return base.clone();
  const scale=Math.sin(halfAngle*amount)/sine;
  return base.clone().multiply(new THREE.Quaternion(delta.x*scale,delta.y*scale,delta.z*scale,Math.cos(halfAngle*amount))).normalize();
}
