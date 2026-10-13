import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {hideWeaponTail} from '../src/render/weaponFraming';
import {weaponAttackClip,weaponAttackPose,weaponAttackSpeed} from '../src/render/weaponMotion';
const tail=[new THREE.Vector3(-.02,-.19,0),new THREE.Vector3(.02,-.19,0),new THREE.Vector3(0,-.20,.02)];
describe('melee pommel and handle framing',()=>{
  it('keeps the tail below the screen through normal, power and reversed swings without rotating or resizing',()=>{
    for(const type of Array.from({length:16},(_,i)=>i))for(const kind of ['right','left','chop','thrust'] as const)for(const power of [false,true])for(const sweepDirection of [undefined,-1,1] as const){
      const c=weaponAttackClip(type,kind,power),duration=c.duration/weaponAttackSpeed(type);
      for(let i=0;i<=60;i++){
        const pose=weaponAttackPose(type,{kind,power,sweepDirection,time:duration*i/60,duration,struck:false});
        const framed=hideWeaponTail(pose,tail,60),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...framed.rotation,'YXZ'));
        expect(framed.position[0]).toBe(pose.position[0]);expect(framed.position[2]).toBe(pose.position[2]);expect(framed.rotation).toEqual(pose.rotation);
        for(const point of tail){const p=point.clone().applyQuaternion(q).add(new THREE.Vector3(...framed.position));if(p.z<-.015)expect(Math.abs(p.y)>=-p.z*Math.tan(Math.PI/6)-1e-9||Math.abs(p.x)>=-p.z*Math.tan(Math.PI/6)*16/9-1e-9).toBe(true);}
      }
    }
  });
  it('leaves an already hidden pommel and points behind the near plane unchanged',()=>{
    const pose={position:[0,-2,-.5] as [number,number,number],rotation:[0,0,0] as [number,number,number]};expect(hideWeaponTail(pose,tail,60)).toBe(pose);
    const behind={...pose,position:[0,0,1] as [number,number,number]};expect(hideWeaponTail(behind,tail,60)).toBe(behind);
  });
});

describe('continuous default broadsword framing',()=>{
  it('never shifts sideways or snaps when the pommel crosses a screen edge',()=>{
    const cap=[];for(let i=0;i<32;i++){const a=i*Math.PI*2/32;cap.push(new THREE.Vector3(Math.cos(a)*.025,-.2,Math.sin(a)*.025));}
    const c=weaponAttackClip(3,'right',false),duration=c.duration/weaponAttackSpeed(3);let previous:number|undefined,maxStep=0;
    for(let i=0;i<=480;i++){
      const pose=weaponAttackPose(3,{kind:'right',power:false,time:duration*i/480,duration,struck:false}),framed=hideWeaponTail(pose,cap,60,16/9,[new THREE.Vector3(0,.6,0)]);
      expect(framed.position[0]).toBe(pose.position[0]);
      const correction=framed.position[1]-pose.position[1];if(previous!==undefined)maxStep=Math.max(maxStep,Math.abs(correction-previous));previous=correction;
    }
    expect(maxStep).toBeLessThan(.02);
  });
});
