import * as THREE from 'three';
import motionBytes from './animations/weapon-motion.awm';
import profileBytes from './animations/weapon-profiles.awm';
import bowBytes from './animations/bow-controls.awm';
import {readWeaponMotion} from './weaponMotionData';
import {WeaponMotionRuntime,blendRotationContinuous,sampleMotionScalar,applyMotionPoseEdit,applyIdleMotion,type WeaponMotionSet,type WeaponProfile,type BowMotionSet,type WeaponMovement} from './weaponMotionRuntime';
import {weaponAttackPlaybackSpeed,weaponPlaybackRate} from '../game/weaponPlayback';
import {battleAxeAttack,battleAxeReady,battleAxeAttackClip} from './battleAxeMotion';
import {weaponSizeReferences} from './weaponModelSizing';
import {STEEL_WEAPON_DEFINITIONS,type SteelWeaponDefinition} from './steelWeaponDefinitions';
import type {Swing} from '../game/dungeon';
import type {GripPose} from './weaponAnimation';
export interface LookPose {yaw:number;pitch:number;}
export type {WeaponMovement} from './weaponMotionRuntime';
export const weaponMotionSource=readWeaponMotion<WeaponMotionSet>(motionBytes);
const profiles=readWeaponMotion<Record<string,WeaponProfile>>(profileBytes);
const bows=readWeaponMotion<Record<string,BowMotionSet>>(bowBytes);
const runtime=new WeaponMotionRuntime(weaponMotionSource,weaponMotionSource.unitsToMetres);
const bowRuntimes=Object.fromEntries(Object.entries(bows).map(([key,data])=>[key,new WeaponMotionRuntime(data,weaponMotionSource.unitsToMetres,'ArrowBone')]));
export const WEAPON_MOTION_FOV=weaponMotionSource.fieldOfView;
export const BOW_MOTION_MARKERS=weaponMotionSource.bow;
export function sampleWeaponMotion(time:number):GripPose {return runtime.sampleSocket(time);}
export function weaponMotionProfile(type:number):WeaponProfile {return profiles[STEEL_WEAPON_DEFINITIONS[type]?.key]??profiles.broadsword;}
export function weaponAttackSpeed(type:number):number {return weaponAttackPlaybackSpeed(weaponMotionProfile(type).speed,type);}
function motionFamily(type:number) {const group=weaponMotionProfile(type).group;return weaponMotionSource.families[group==='bow'?'oneHand':group];}
function framedWeaponPose(type:number,pose:GripPose):GripPose {
  const offset=weaponMotionProfile(type).viewOffset;if(!offset)return pose;
  return{position:pose.position.map((v,i)=>v+offset[i]) as GripPose['position'],rotation:pose.rotation};
}
export function weaponAttackClip(type:number,kind='right',power=false) {
  if(type===15)return battleAxeAttackClip(kind,power);
  const name=power&&type===0?'thrust':kind==='thrust'?'thrust':['chop','downLeft','downRight'].includes(kind)?'chop':'slash';return motionFamily(type).attacks[name+(power?'Charged':'')];
}
function usesHammerReady(type:number):boolean {
  const def=STEEL_WEAPON_DEFINITIONS[type];return !!def?.twoHanded&&def.style!=='bow'&&type!==13;
}
export function weaponReadyPose(type:number,clock=0,movement?:WeaponMovement,idleClock=clock):GripPose {
  // Share the hammer socket pose, retaining each fitted mesh's size and facing.
  if(usesHammerReady(type))return weaponReadyPose(13,clock,movement,idleClock);
  if(type===15)return framedWeaponPose(type,applyIdleMotion(battleAxeReady(clock),weaponMotionProfile(type).idleMotion,idleClock,!!movement));
  const family=motionFamily(type),[start,end]=movement?family.movements[movement]:family.idle;
  return framedWeaponPose(type,applyIdleMotion(sampleWeaponMotion(start+Math.max(0,clock)%(end-start)),weaponMotionProfile(type).idleMotion,idleClock,!!movement));
}
function baseWeaponAttackPose(type:number,swing:Swing,idleClock=0):GripPose {
  const clip=weaponAttackClip(type,swing.kind,swing.power),speed=weaponAttackSpeed(type);
  const phase=THREE.MathUtils.clamp(swing.time*speed/clip.duration,0,1);
  if(type===12&&swing.power&&['chop','downLeft','downRight'].includes(swing.kind))return overheadChargePose(type,phase,clip.hit/clip.duration,idleClock);
  const pose=type===15?battleAxeAttack(swing):applyMotionPoseEdit(runtime.sampleAttack(clip,swing.time,speed),clip.poseEdit,phase);
  // Let the idle corrections fade out before the strike and return smoothly during recovery.
  const idleAmount=Math.max(1-THREE.MathUtils.smoothstep(phase,0,.12),THREE.MathUtils.smoothstep(phase,.85,1));
  if(usesHammerReady(type)){
    if(idleAmount===0)return pose;
    // Ease from/to the shared ready stance; leave the strike and damage clock untouched.
    const ready=weaponReadyPose(13,0,undefined,idleClock);
    const position=new THREE.Vector3(...pose.position).lerp(new THREE.Vector3(...ready.position),idleAmount);
    const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ'));
    rotation.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(...ready.rotation,'YXZ')),idleAmount);
    const e=new THREE.Euler().setFromQuaternion(rotation,'YXZ');
    return{position:position.toArray(),rotation:[e.x,e.y,e.z]};
  }
  return framedWeaponPose(type,applyIdleMotion(pose,weaponMotionProfile(type).idleMotion,idleClock,false,idleAmount));
}
/** A charged overhead cut stays in front of the view and drops through its timed impact. */
function overheadChargePose(type:number,phase:number,hit:number,idleClock:number):GripPose {
  const ready=weaponReadyPose(type,0,undefined,idleClock),base=new THREE.Quaternion().setFromEuler(new THREE.Euler(...ready.rotation,'YXZ'));
  const keys=[
    {t:0,p:[0,0,0],pitch:0,roll:0},
    {t:.44,p:[.07,.08,-.07],pitch:-.18,roll:-.12},
    {t:.55,p:[.07,.08,-.07],pitch:-.18,roll:-.12},
    {t:hit,p:[-.20,-.03,-.16],pitch:-1.60,roll:.08},
    {t:.90,p:[-.30,-.08,-.12],pitch:-2.05,roll:.16},
    {t:1,p:[0,0,0],pitch:0,roll:0},
  ];
  const index=Math.min(keys.length-2,Math.max(0,keys.findIndex((_key,i)=>i<keys.length-1&&phase<=keys[i+1].t))),a=keys[index],b=keys[index+1];
  const u=THREE.MathUtils.smootherstep(phase,a.t,b.t),offset=new THREE.Vector3(...a.p).lerp(new THREE.Vector3(...b.p),u);
  const correction=(key:typeof a)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(key.pitch,0,key.roll,'YXZ')).multiply(base);
  const q=correction(a).slerp(correction(b),u),e=new THREE.Euler().setFromQuaternion(q,'YXZ');
  return{position:new THREE.Vector3(...ready.position).add(offset).toArray(),rotation:[e.x,e.y,e.z]};
}
const slashDirections=new Map<string,number>();
const mirrorReferences=new Map<string,THREE.Quaternion>();
function reflectedRotation(q:THREE.Quaternion):THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeRotationFromQuaternion(q).premultiply(new THREE.Matrix4().makeScale(-1,1,1)).multiply(new THREE.Matrix4().makeScale(1,1,-1)));
}
function mirrorReference(type:number,swing:Swing,recovering:boolean):THREE.Quaternion {
  const clip=weaponAttackClip(type,swing.kind,swing.power),key=`${type}:${swing.power}:${clip.group}:${recovering}`;
  let reference=mirrorReferences.get(key);
  if(!reference){
    const pose=baseWeaponAttackPose(type,{...swing,time:clip.duration*(recovering ? .85 : .12)/weaponAttackSpeed(type)},0);
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ'));
    reference=q.clone().invert().multiply(reflectedRotation(q)).normalize();
    if(reference.w<0)reference.set(-reference.x,-reference.y,-reference.z,-reference.w);
    mirrorReferences.set(key,reference);
  }
  return reference;
}
function baseSlashDirection(type:number,swing:Swing):number {
  const clip=weaponAttackClip(type,swing.kind,swing.power),key=`${type}:${swing.power}:${clip.group}`;
  let direction=slashDirections.get(key);
  if(direction===undefined){
    const speed=weaponAttackSpeed(type),tipY=weaponSizeReferences[STEEL_WEAPON_DEFINITIONS[type].key].bounds[1][1];
    const tipX=(time:number)=>{const pose=baseWeaponAttackPose(type,{...swing,time},0);return new THREE.Vector3(0,tipY,0).applyEuler(new THREE.Euler(...pose.rotation,'YXZ')).x+pose.position[0];};
    direction=Math.sign(tipX((clip.hit+clip.duration*.025)/speed)-tipX((clip.hit-clip.duration*.025)/speed))||-1;
    slashDirections.set(key,direction);
  }
  return direction;
}
export function weaponAttackPose(type:number,swing:Swing,idleClock=0):GripPose {
  const pose=baseWeaponAttackPose(type,swing,idleClock);
  if(swing.sweepDirection===undefined||swing.bash||baseSlashDirection(type,swing)===swing.sweepDirection)return pose;
  const clip=weaponAttackClip(type,swing.kind,swing.power),phase=THREE.MathUtils.clamp(swing.time*weaponAttackSpeed(type)/clip.duration,0,1);
  const amount=THREE.MathUtils.smoothstep(phase,0,.12)*(1-THREE.MathUtils.smoothstep(phase,.85,1));
  if(amount===0)return pose;
  // Reflect the arc across the held socket, preserving each working edge's forward Z.
  // Reflecting local Z as well gives a proper rotation, showing the opposite blade face.
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation,'YXZ'));
  q.copy(blendRotationContinuous(q,reflectedRotation(q),amount,mirrorReference(type,swing,phase>.85)));
  const e=new THREE.Euler().setFromQuaternion(q,'YXZ'),centreX=weaponReadyPose(type).position[0];
  return{position:[THREE.MathUtils.lerp(pose.position[0],2*centreX-pose.position[0],amount),pose.position[1],pose.position[2]],rotation:[e.x,e.y,e.z]};
}
export function bowDrawDuration(type:number):number {
  return (BOW_MOTION_MARKERS['shoot max attack']-BOW_MOTION_MARKERS['shoot start'])/weaponAttackSpeed(type);
}
export function bowReleaseTiming(type:number,drawSeconds:number) {
  const b=BOW_MOTION_MARKERS,speed=weaponAttackSpeed(type),draw=drawSeconds*speed;
  const strength=THREE.MathUtils.clamp((draw-(b['shoot min attack']-b['shoot start']))/(b['shoot max attack']-b['shoot min attack']),0,1);
  const start=b['shoot max attack']+(1-strength)*(b['shoot min hit']-b['shoot max attack']);
  return{strength,start,duration:(b['shoot release']-start+b['shoot follow stop']-b['shoot follow start'])/speed,hit:(b['shoot release']-start)/speed};
}
export function bowMotionState(type:number,swing:Swing|undefined) {
  const b=BOW_MOTION_MARKERS,speed=weaponAttackSpeed(type);
  if(!swing||swing.kind!=='shoot'||swing.bash)return{sourceTime:b['shoot start'],controllerTime:0,attached:false};
  let time:number;
  if(swing.bowReleaseSource===undefined)time=b['shoot start']+Math.min(Math.max(0,swing.time*speed),b['shoot max attack']-b['shoot start']);
  else{const elapsed=Math.max(0,swing.time*speed),releaseLength=b['shoot release']-swing.bowReleaseSource;time=elapsed<releaseLength?swing.bowReleaseSource+elapsed:Math.min(b['shoot follow stop'],b['shoot follow start']+elapsed-releaseLength);}
  return{sourceTime:time,controllerTime:time-bows['long-bow'].sourceGroupStart,attached:!swing.struck&&time>=b['shoot attach']&&time<=b['shoot release']};
}
export function bowAttachmentPose(type:number,swing:Swing|undefined) {
  const key=type===16?'short-bow':'long-bow',data=bows[key],state=bowMotionState(type,swing),world=bowRuntimes[key].sampleWorld(state.controllerTime);
  const arrow=world[data.nodes.findIndex(n=>n.name==='ArrowBone')],position=new THREE.Vector3(),rotation=new THREE.Quaternion();arrow.decompose(position,rotation,new THREE.Vector3());position.multiplyScalar(weaponMotionSource.unitsToMetres);
  return{arrowPosition:position,arrowRotation:rotation,draw:sampleMotionScalar(data.morphs[1],state.controllerTime),recoil:sampleMotionScalar(data.morphs[2],state.controllerTime),attached:state.attached};
}
export function weaponMotionPose(def:SteelWeaponDefinition,swing:Swing|undefined,clock=0,movement?:WeaponMovement,idleClock=clock):GripPose {
  if(swing?.kind==='shoot'&&def.style==='bow'&&!swing.bash){
    const state=bowMotionState(def.type,swing),drawing=swing.bowReleaseSource===undefined,edit=drawing?weaponMotionSource.bowEdits?.draw:weaponMotionSource.bowEdits?.release;
    const phase=drawing?swing.time/bowDrawDuration(def.type):swing.time/swing.duration;
    const pose=applyMotionPoseEdit(sampleWeaponMotion(state.sourceTime),edit,phase);
    const idleAmount=drawing?1-THREE.MathUtils.smoothstep(phase,0,.12):THREE.MathUtils.smoothstep(phase,.85,1);
    return applyIdleMotion(pose,weaponMotionProfile(def.type).idleMotion,idleClock,false,idleAmount);
  }
  if(swing&&swing.kind!=='shoot'&&!swing.bash)return weaponAttackPose(def.type,swing,idleClock);
  return weaponReadyPose(def.type,clock,movement,idleClock);
}
export function weaponMotionReview(type:number|undefined,swing:Swing|undefined,blocking=false) {
  if(type===undefined)return{source:'No weapon equipped',label:'Unarmed',clip:''};
  const profile=weaponMotionProfile(type),group=profile.group==='bow'?'BowAndArrow':profile.group==='twoWide'?'WeaponTwoWide':profile.group==='twoHand'?'WeaponTwoHand':'WeaponOneHand';
  const label=swing?.bash?'Weapon bash':blocking?'Angled weapon block':swing?.kind==='shoot'?(swing.bowReleaseSource===undefined?'Draw / hold':'Release / follow'):swing?weaponAttackClip(type,swing.kind,swing.power).group.split(': ')[1]+(swing.power?' · full charge':' · minimum charge'):'Idle sway';
  return{source:blocking&&!swing?'Weapon block':'Weapon animations'+(profile.proxy?' · mace motion for flail':''),label,clip:`${group} · attack playback ${Math.round(weaponPlaybackRate(type)*100)}%`};
}
export function bowMorphSamples(type:number){return bows[type===16?'short-bow':'long-bow'].vertices;}
