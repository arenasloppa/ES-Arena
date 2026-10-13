import * as THREE from 'three';
import type {Vec3} from '../game/chainPhysics';
import {METRES_TO_WORLD,type SurfaceMaterial} from '../game/projectilePhysics';

type Particle={mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;velocity:THREE.Vector3;spin:THREE.Vector3;life:number;duration:number;kind:'chip'|'dust'|'spark'};
/** Short-lived wood splinters, stone chips/dust and metal sparks at the actual contact. */
export class SurfaceImpactView {
 readonly group=new THREE.Group();
 private readonly geometry=new THREE.BoxGeometry(1,1,1);
 private readonly dustGeometry=new THREE.SphereGeometry(1,6,4);
 private readonly materials={
  wood:[new THREE.MeshBasicMaterial({color:0x9d7147}),new THREE.MeshBasicMaterial({color:0x6d492d})],
  stone:[new THREE.MeshBasicMaterial({color:0x99958d}),new THREE.MeshBasicMaterial({color:0x66635f})],
  dust:new THREE.MeshBasicMaterial({color:0xaaa59a,transparent:true,opacity:.3,depthWrite:false}),
  spark:new THREE.MeshBasicMaterial({color:0xffcf75,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}),
 };
 private readonly chips:Particle[]=[];
 private remove(index:number):void {const [p]=this.chips.splice(index,1);p.mesh.removeFromParent();p.mesh.material.dispose();}
 burst(material:SurfaceMaterial,point:Vec3,normal:Vec3):void {
  if(material==='soft')return;
  const outward=new THREE.Vector3(...normal).normalize();
  if(outward.lengthSq()<.5)outward.set(0,1,0);
  const tangent=new THREE.Vector3(Math.abs(outward.y)>.9?1:0,Math.abs(outward.y)>.9?0:1,0).cross(outward).normalize(),bitangent=outward.clone().cross(tangent);
  const count=material==='metal'?16:material==='stone'?12:10;
  for(let i=0;i<count;i++){
   if(this.chips.length>=60)this.remove(0);
   const kind:Particle['kind']=material==='metal'?'spark':material==='stone'&&i>=6?'dust':'chip',angle=i*2.399963;
   const base=kind==='spark'?this.materials.spark:kind==='dust'?this.materials.dust:this.materials[material==='stone'?'stone':'wood'][i%2];
   const mesh=new THREE.Mesh(kind==='dust'?this.dustGeometry:this.geometry,base.clone());
   if(kind==='spark')mesh.scale.set(.002,.025+(i%4)*.01,.002);
   else if(kind==='dust')mesh.scale.setScalar(.012+(i%3)*.005);
   else if(material==='stone')mesh.scale.set(.008+(i%3)*.003,.007,.006);
   else mesh.scale.set(.008,.024+(i%3)*.008,.005);
   mesh.scale.multiplyScalar(METRES_TO_WORLD);
   mesh.position.fromArray(point).addScaledVector(outward,.012*METRES_TO_WORLD);mesh.rotation.set(angle,angle*.7,angle*.3);
   const speed=kind==='spark'?1.1+(i%5)*.24:kind==='dust'?.20:.5+(i%3)*.13;
   const fan=kind==='spark'?.9:kind==='dust'?.18:.35;
   const velocity=outward.clone().multiplyScalar(speed).addScaledVector(tangent,Math.cos(angle)*fan).addScaledVector(bitangent,Math.sin(angle)*fan).multiplyScalar(METRES_TO_WORLD);
   const duration=kind==='spark'?.16+(i%4)*.035:kind==='dust'?.40+(i%3)*.08:.55+(i%3)*.06;
   this.chips.push({mesh,velocity,spin:new THREE.Vector3(2+i*.1,1-i*.2,2),life:duration,duration,kind});this.group.add(mesh);
  }
 }
 update(dt:number):void {
  if(dt<=0)return;
  for(let i=this.chips.length-1;i>=0;i--){
   const c=this.chips[i];c.life-=dt;
   if(c.life<=0){this.remove(i);continue;}
   c.velocity.y-=(c.kind==='dust'?.6:9.81)*METRES_TO_WORLD*dt;
   c.velocity.multiplyScalar(Math.exp(-(c.kind==='spark'?5:c.kind==='dust'?3:0)*dt));
   c.mesh.position.addScaledVector(c.velocity,dt);
   if(c.kind==='spark'){
    c.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),c.velocity.clone().normalize());
    c.mesh.material.opacity=c.life/c.duration;
   }else if(c.kind==='dust'){
    c.mesh.scale.multiplyScalar(Math.exp(dt*2));c.mesh.material.opacity=.3*c.life/c.duration;
   }else {c.mesh.rotateX(c.spin.x*dt);c.mesh.rotateY(c.spin.y*dt);c.mesh.rotateZ(c.spin.z*dt);}
  }
 }
 dispose():void {
  while(this.chips.length)this.remove(this.chips.length-1);
  this.geometry.dispose();this.dustGeometry.dispose();
  [...this.materials.wood,...this.materials.stone,this.materials.dust,this.materials.spark].forEach(m=>m.dispose());
 }
}
