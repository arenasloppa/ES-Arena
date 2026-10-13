import * as THREE from 'three';

/** A small quality-coloured marker makes drops visible even when a creature leaves no body. */
export class LootDropView {
  readonly group=new THREE.Group();
  private readonly shape=new THREE.OctahedronGeometry(.035);
  private readonly markers=new Map<number,THREE.Mesh<THREE.OctahedronGeometry,THREE.MeshBasicMaterial>>();
  update(drops:Array<{id:number;x:number;y:number;z:number;colour:string}>,time:number):void {
    const live=new Set(drops.map(drop=>drop.id));
    for(const [id,mesh]of this.markers)if(!live.has(id)){mesh.removeFromParent();mesh.material.dispose();this.markers.delete(id);}
    for(const drop of drops){
      let mesh=this.markers.get(drop.id);
      if(!mesh){mesh=new THREE.Mesh(this.shape,new THREE.MeshBasicMaterial());this.group.add(mesh);this.markers.set(drop.id,mesh);}
      mesh.material.color.set(drop.colour);mesh.position.set(drop.x,drop.z+.08+.01*Math.sin(time*2+drop.id),drop.y);mesh.rotation.y=time*.4;
    }
  }
  dispose():void {for(const mesh of this.markers.values())mesh.material.dispose();this.markers.clear();this.group.clear();this.shape.dispose();}
}
