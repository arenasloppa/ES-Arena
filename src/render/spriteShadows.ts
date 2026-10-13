import * as THREE from 'three';
import {floorHeight, type Level} from '../game/level';
import {cellIndex,lineOfSight} from '../game/grid';

export interface ShadowLight {position:THREE.Vector3;range:number;}
interface Shadow {
  caster:THREE.Mesh;
  contact:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
  projected:THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
  direction?:THREE.Vector2;
}

/** Separate lamp-facing silhouettes keep shadow rendering from changing visible sprite transforms. */
export class SpriteShadows {
  private readonly shadows=new Map<THREE.Mesh,Shadow>();
  private readonly ground=new THREE.PlaneGeometry(1,1);
  private readonly footprint:THREE.DataTexture;
  constructor(private readonly scene:THREE.Scene,private readonly level:Level,private readonly openDoors=new Set<number>()){
    const pixels=new Uint8Array(32*32*4);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){
      const r=Math.hypot((x-15.5)/15.5,(y-15.5)/15.5),i=(y*32+x)*4;
      pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=Math.round(Math.pow(Math.max(0,1-r*r),2)*255);
    }
    this.footprint=new THREE.DataTexture(pixels,32,32);this.footprint.minFilter=this.footprint.magFilter=THREE.LinearFilter;this.footprint.needsUpdate=true;
  }
  register(source:THREE.Mesh):void {
    if(this.shadows.has(source))return;
    const caster=new THREE.Mesh(source.geometry,new THREE.MeshBasicMaterial());caster.layers.set(2);caster.userData.shadowProxy=true;
    const material=new THREE.MeshBasicMaterial({map:this.footprint,color:0x000000,transparent:true,opacity:.16,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const contact=new THREE.Mesh(this.ground,material);contact.rotation.x=-Math.PI/2;contact.userData.shadowProxy=true;contact.renderOrder=1;
    const geometry=new THREE.PlaneGeometry(1,1,4,12);(geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    geometry.index!.setUsage(THREE.DynamicDrawUsage);
    const shader=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
      uniforms:{sprite:{value:null},texel:{value:new THREE.Vector2()},opacity:{value:0}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`uniform sampler2D sprite;uniform vec2 texel;uniform float opacity;varying vec2 vUv;
        float mask(vec2 uv){return smoothstep(.2,.6,texture2D(sprite,uv).a);}
        void main(){float a=mask(vUv)*.6+(mask(vUv+vec2(texel.x,0.))+mask(vUv-vec2(texel.x,0.))+mask(vUv+vec2(0.,texel.y))+mask(vUv-vec2(0.,texel.y)))*.1;
          if(a<.01)discard;gl_FragColor=vec4(0.,0.,0.,a*opacity*mix(1.,.8,vUv.y));}`});
    const projected=new THREE.Mesh(geometry,shader);projected.userData.shadowProxy=true;projected.renderOrder=1;projected.visible=false;
    this.scene.add(caster,contact,projected);this.shadows.set(source,{caster,contact,projected});source.layers.disable(2);
  }
  sync(on:boolean,lamp?:THREE.Vector3):void {
    for(const [source,shadow]of this.shadows){
      let parent:THREE.Object3D|null=source,visible=true,attached=false;
      while(parent){visible&&=parent.visible;if(parent===this.scene){attached=true;break;}parent=parent.parent;}
      if(!attached){this.remove(source,shadow);continue;}
      source.updateWorldMatrix(true,false);
      const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();source.matrixWorld.decompose(position,rotation,scale);
      shadow.caster.position.copy(position);shadow.caster.scale.copy(scale);
      if(lamp)shadow.caster.rotation.set(0,Math.atan2(lamp.x-position.x,lamp.z-position.z),0);
      const original=(Array.isArray(source.material)?source.material[0]:source.material) as THREE.MeshStandardMaterial;
      const material=shadow.caster.material as THREE.MeshBasicMaterial;
      material.map=original.map;material.alphaTest=original.transparent?Math.max(.5,original.alphaTest):original.alphaTest;
      shadow.caster.visible=on&&visible&&!!original.map;
      const cell=this.level.cells[cellIndex(this.level,position.x,position.z)];
      const floor=cell?floorHeight(cell,this.level):0,bottom=position.y-Math.abs(scale.y)/2;
      const above=Math.max(0,bottom-floor);
      shadow.contact.position.set(position.x,floor+.001,position.z);
      shadow.contact.scale.set(Math.abs(scale.x)*.55,Math.min(.45,Math.abs(scale.x)*.32),1);
      shadow.contact.material.opacity=.16*Math.max(0,1-above/.7);
      shadow.contact.visible=on&&visible&&above<.7&&!original.transparent;
    }
  }
  /** A floor decal of the current animation frame, facing away from the closest unobstructed light. */
  project(on:boolean,lights:readonly ShadowLight[],dt:number):void {
    for(const [source,shadow]of this.shadows){
      const projected=shadow.projected,original=(Array.isArray(source.material)?source.material[0]:source.material) as THREE.MeshStandardMaterial;
      projected.visible=false;
      if(!on||!shadow.caster.visible||original.transparent||!original.map)continue;
      const position=shadow.caster.position,scale=shadow.caster.scale;
      const cell=this.level.cells[cellIndex(this.level,position.x,position.z)];
      if(!cell||cell.kind==='wall'||cell.chasm)continue;
      const floor=floorHeight(cell,this.level),above=Math.max(0,position.y-Math.abs(scale.y)/2-floor);
      if(above>=.7)continue;
      const light=lights.filter(l=>l.position.distanceTo(position)<l.range&&lineOfSight(this.level,l.position.x,l.position.z,position.x,position.z,this.openDoors))
        .reduce<ShadowLight|undefined>((best,l)=>!best||l.position.distanceToSquared(position)<best.position.distanceToSquared(position)?l:best,undefined);
      if(!light)continue;
      const direction=new THREE.Vector2(position.x-light.position.x,position.z-light.position.z);
      const distance=direction.length();if(distance<.001)direction.set(0,1);else direction.divideScalar(distance);
      if(!shadow.direction)shadow.direction=direction.clone();
      else shadow.direction.lerp(direction,dt>0?1-Math.exp(-dt*14):1);
      const length=Math.min(1.5,Math.max(.04,Math.abs(scale.y)*distance/Math.max(.35,light.position.y-floor)));
      const right=new THREE.Vector2(-shadow.direction.y,shadow.direction.x);
      const geometry=projected.geometry,uv=geometry.getAttribute('uv'),points=geometry.getAttribute('position');
      projected.position.set(position.x,floor+.001,position.z);
      const valid:boolean[]=[];
      for(let i=0;i<uv.count;i++){
        const across=(uv.getX(i)-.5)*scale.x,along=above*.35+uv.getY(i)*length;
        const x=right.x*across+shadow.direction.x*along,z=right.y*across+shadow.direction.y*along;
        const target=this.level.cells[cellIndex(this.level,position.x+x,position.z+z)];
        valid.push(!!target&&target.kind!=='wall'&&!target.chasm&&(target.kind!=='door'||this.openDoors.has(cellIndex(this.level,position.x+x,position.z+z))));
        points.setXYZ(i,x,(target?floorHeight(target,this.level):floor)-floor,z);
      }
      let count=0;
      const index=geometry.index!;
      for(let y=0;y<12;y++)for(let x=0;x<4;x++){
        const a=y*5+x,b=a+1,c=a+5,d=c+1;
        if(![a,b,c,d].every(i=>valid[i]))continue;
        for(const i of [a,c,b,b,c,d])index.setX(count++,i);
      }
      index.needsUpdate=true;geometry.setDrawRange(0,count);points.needsUpdate=true;
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const image=original.map.image as {width:number;height:number};
      projected.material.uniforms.sprite.value=original.map;projected.material.uniforms.texel.value.set(.6/image.width,.6/image.height);
      projected.material.uniforms.opacity.value=.72*Math.max(0,1-above/.9)*(1-THREE.MathUtils.smoothstep(distance,light.range*.7,light.range));
      projected.visible=count>0;
    }
  }
  private remove(source:THREE.Mesh,{caster,contact,projected}:Shadow):void{
    this.scene.remove(caster,contact,projected);projected.geometry.dispose();projected.material.dispose();(caster.material as THREE.Material).dispose();contact.material.dispose();this.shadows.delete(source);
  }
  dispose():void {for(const [source,shadow]of this.shadows)this.remove(source,shadow);this.ground.dispose();this.footprint.dispose();}
}
