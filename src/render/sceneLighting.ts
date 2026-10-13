import * as THREE from 'three';
import type { Dungeon } from '../game/dungeon';
import type { ControlSettings } from '../game/engine';
import type { LevelScene } from './levelScene';
import { buildLevelGeometry } from './levelGeometry';
import { normalMapFor } from './normalMaps';
import {SpriteShadows} from './spriteShadows';
import { SH, DL, SH_FACES, SH_SLOTS, SH_TILE, SH_GLSL } from './shadowShared.js';
import { ELEMENT_COLOURS } from './spellView';

const WORLD_SCALE = 128;
interface Lamp {position: THREE.Vector3; range: number; phase: number; intensity: number; color: THREE.Color;}

export class SceneLighting {
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.20 * Math.PI);
  private readonly fill = new THREE.PointLight(0xcbd3df, 0.10, 2.5, 0);
  private readonly lamps: Lamp[];
  private readonly slots = Array.from({length: SH_SLOTS}, () => new THREE.PointLight(0xffb970, 0, 0, 0));
  private readonly dynamic = Array.from({length: 8}, () => new THREE.PointLight(0xffffff, 0, 0, 0));
  private readonly terrain = new THREE.Group();
  private readonly atlas = new THREE.WebGLRenderTarget(6 * SH_TILE, 2 * SH_SLOTS * SH_TILE, {minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  private readonly shadowCamera = new THREE.PerspectiveCamera(90,1,.01,8);
  private readonly shadowMaterial = new THREE.ShaderMaterial({
    side:THREE.DoubleSide,uniforms:{map:{value:null},hasMap:{value:0},cutoff:{value:0},lamp:{value:new THREE.Vector3()},reach:{value:1}},
    vertexShader:'varying vec3 point;varying vec2 texcoord;void main(){texcoord=uv;vec4 local=vec4(position,1.);\n#ifdef USE_INSTANCING\nlocal=instanceMatrix*local;\n#endif\nvec4 p=modelMatrix*local;point=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',
    fragmentShader:'uniform sampler2D map;uniform float hasMap,cutoff,reach;uniform vec3 lamp;varying vec3 point;varying vec2 texcoord;void main(){if(hasMap>.5&&texture2D(map,texcoord).a<cutoff)discard;float d=clamp(length(point-lamp)/reach,0.,1.);gl_FragColor=vec4(d,d,d,1.);}',
  });
  private readonly materials = new Set<THREE.MeshStandardMaterial>();
  private readonly positions = Array.from({length:SH_SLOTS},()=>new THREE.Vector3(Infinity,Infinity,Infinity));
  private readonly ids = Array(SH_SLOTS).fill(-1) as number[];
  private terrainVersion = -1;
  private readonly sprites:SpriteShadows;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly dungeon: Dungeon, private readonly levelScene: LevelScene) {
    this.sprites=new SpriteShadows(scene,dungeon.level,dungeon.openDoors);
    this.lamps=dungeon.level.flats.filter(f=>f.light||/torch|candl|fire|lamp/i.test(f.name)).map((f,i)=>({
      position:new THREE.Vector3(f.x,Math.min(dungeon.level.height-.08,(f.base??0)+dungeon.level.height*.65),f.y),
      range:Math.min(7,Math.max(2,f.light??4)),phase:i*1.71,intensity:.7,color:new THREE.Color(1,.5,.2),
    }));
    scene.add(this.ambient,this.fill,this.terrain,...this.slots,...this.dynamic);
    SH.uShAtlas.value=this.atlas.texture;SH.uMoonOn.value=0;
    this.shadowMaterial.onBeforeRender=(_r,_s,_c,_g,object)=>{
      const source=(object as THREE.Mesh).material;const material=Array.isArray(source)?source[0]:source;
      const map=(material as THREE.MeshBasicMaterial).map;
      this.shadowMaterial.uniforms.map.value=map;
      this.shadowMaterial.uniforms.hasMap.value=map?1:0;
      this.shadowMaterial.uniforms.cutoff.value=material.transparent?Math.max(.5,material.alphaTest):material.alphaTest||.001;
      this.shadowMaterial.uniformsNeedUpdate=true;
    };
  }

  private prepare(): void {
    const prepare=(object: THREE.Object3D)=>{
      if(!(object instanceof THREE.Mesh)||object.userData.shadowProxy)return;
      const convert=(source:THREE.Material)=>{
        if(!(source instanceof THREE.MeshBasicMaterial)||source.userData.keepAnimatedMaterial)return source;
        const material=new THREE.MeshStandardMaterial({map:source.map,color:source.color,roughness:source.userData.finish?.roughness??.9,metalness:source.userData.finish?.metalness??0,vertexColors:source.vertexColors,
          side:source.side,alphaTest:source.alphaTest,transparent:source.transparent,depthWrite:source.depthWrite});
        material.userData={...source.userData};return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials)if(material instanceof THREE.MeshStandardMaterial&&!this.materials.has(material)){
        if(!object.geometry.getAttribute('normal'))object.geometry.computeVertexNormals();
        material.userData.finish??={roughness:material.roughness,metalness:material.metalness};
        if(material.map&&!material.userData.noBump){material.normalMap=normalMapFor(material.map)??null;material.normalScale.setScalar(.45);}
        material.onBeforeCompile=shader=>{
          Object.assign(shader.uniforms,SH,DL);
          shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 surfaceWorld;');
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
            vec4 sw=vec4(transformed,1.);
            #ifdef USE_INSTANCING
            sw=instanceMatrix*sw;
            #endif
            surfaceWorld=(modelMatrix*sw).xyz;`);
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 surfaceWorld;\n${SH_GLSL}`);
          shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
            if(uShOn>.5){vec3 p=surfaceWorld*128.,n=inverseTransformDirection(normal,viewMatrix);float blocked=0.,total=.06;
              for(int k=0;k<SHN;k++){float amount=shReach(k,p,n);if(amount>.001){float vis=${object.userData.shadowBillboard ? 'shCube(k,0.,p-uShPos[k].xyz)' : 'min(shCube(k,0.,p-uShPos[k].xyz),shCube(k,1.,p-uShPos[k].xyz))'};blocked+=amount*(1.-vis)*uShPar[k].w;total+=amount;}}
              outgoingLight*=clamp(1.-blocked/total,0.,1.);
            }
            #include <opaque_fragment>`);
        };
        material.customProgramCacheKey=()=>object.userData.shadowBillboard?'sprite-lighting-v2':'surface-lighting-v2';material.needsUpdate=true;this.materials.add(material);
        material.addEventListener('dispose',()=>this.materials.delete(material));
      }
      if (materials.some(material => material.userData.liquid)) object.layers.disable(2);
      else if(object.userData.shadowBillboard)this.sprites.register(object);
      else if(!object.userData.environmentTile||object.userData.environmentDoor)object.layers.enable(2);
    };
    this.levelScene.group.traverse(prepare);
    this.scene.traverse(object=>{if(object.userData.receiveSceneLighting)prepare(object);});
  }

  private rebuildTerrain(): void {
    for(const child of [...this.terrain.children]){
      const mesh=child as THREE.Mesh;mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();this.terrain.remove(mesh);
    }
    for(const [key,batch]of buildLevelGeometry(this.dungeon.level).batches){
      if(key.startsWith('liquid')||key.startsWith('chasm'))continue;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uvs,2));geometry.setIndex(batch.indices);
      const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,material);mesh.layers.set(1);mesh.userData.shadowProxy=true;this.terrain.add(mesh);
      if(/^(?:maskedwall|glass|arch):/.test(key))void this.levelScene.material(key).then(source=>{material.map=(source as THREE.MeshBasicMaterial).map;material.alphaTest=source.alphaTest;this.ids.fill(-1);});
    }
    this.ids.fill(-1);this.terrainVersion=this.dungeon.terrainVersion;
  }

  update(camera: THREE.Camera, settings: ControlSettings, dt: number): void {
    this.prepare();if(this.terrainVersion!==this.dungeon.terrainVersion)this.rebuildTerrain();
    const on=settings.lighting!==false,time=performance.now()/1000;
    this.ambient.intensity=on ? .20*Math.PI : Math.PI;this.fill.intensity=on ? .10*Math.PI : 0;this.fill.position.copy(camera.position);
    for(const material of this.materials){const enabled=settings.bumpMaps!==false&&on;const desired=enabled&&material.map&&!material.userData.noBump?normalMapFor(material.map):undefined;
      const finish=material.userData.finish;
      material.roughness=on&&settings.specular!==false?finish.roughness:1;
      material.metalness=on&&settings.specular!==false?finish.metalness:0;
      if(material.normalMap!==(desired??null)){material.normalMap=desired??null;material.needsUpdate=true;}}
    const fallback: Lamp = {position:camera.position.clone(),range:2.5,phase:0,intensity:.10,color:this.fill.color};
    const ordered=this.lamps.map((lamp,id)=>({lamp,id,score:lamp.position.distanceToSquared(camera.position)})).sort((a,b)=>a.score-b.score).slice(0,2);
    if (!ordered.length) { ordered.push({lamp:fallback,id:-2,score:0}); this.fill.intensity=0; }
    const enabled=on&&settings.shadows!==false;
    if(!enabled)this.ids.fill(-1);
    SH.uShOn.value=enabled?1:0;this.sprites.sync(enabled);
    for(let k=0;k<SH_SLOTS;k++){
      const pick=ordered[k],light=this.slots[k];
      if(!pick||!on){light.intensity=0;SH.uShPar.value[k].set(1,0,-1,0);continue;}
      const lamp=pick.lamp,wave=.5*Math.sin(time*23+lamp.phase)+.3*Math.sin(time*37.1+lamp.phase*1.7)+.2*Math.sin(time*13.3+lamp.phase*2.3);
      light.position.copy(lamp.position);light.color.copy(lamp.color);light.intensity=lamp.intensity*Math.PI*(1+(pick.id===-2?0:.08*wave));light.distance=lamp.range;
      SH.uShPos.value[k].set(lamp.position.x*WORLD_SCALE,lamp.position.y*WORLD_SCALE,lamp.position.z*WORLD_SCALE,lamp.range*WORLD_SCALE);
      SH.uShCol.value[k].set(lamp.color.r,lamp.color.g,lamp.color.b,light.intensity/Math.PI);
      const changed=this.ids[k]!==pick.id;
      const fade=pick.id===-2?1:changed?0:Math.min(1,SH.uShPar.value[k].w+Math.max(dt,1/60)*5);
      SH.uShPar.value[k].set(WORLD_SCALE,0,k,fade);SH.uShExt.value[k].set(0,63,0,0);
      if(enabled){if(changed||this.positions[k].distanceToSquared(lamp.position)>1e-7)this.drawShadow(k,0,lamp);this.drawShadow(k,1,lamp);}
      this.positions[k].copy(lamp.position);this.ids[k]=pick.id;
    }
    this.sprites.project(enabled,ordered.map(pick=>pick.lamp),dt);
    const candidates=this.dungeon.bolts.map(b=>({position:new THREE.Vector3(b.x,b.z??camera.position.y*.85,b.y),color:new THREE.Color(ELEMENT_COLOURS[Math.min(b.spell.element,5)]),range:2,intensity:.65}));
    for(const pick of ordered)if(on&&!enabled)candidates.push({position:pick.lamp.position,color:pick.lamp.color,range:pick.lamp.range,intensity:pick.lamp.intensity});
    candidates.sort((a,b)=>a.position.distanceToSquared(camera.position)-b.position.distanceToSquared(camera.position));
    const active=on?candidates.slice(0,8):[];DL.uDynN.value=active.length;
    for(let i=0;i<8;i++){const source=active[i],light=this.dynamic[i];if(!source){light.intensity=0;continue;}
      const lampAlready=ordered.some(pick=>pick.lamp.position===source.position);light.position.copy(source.position);light.color.copy(source.color);light.distance=source.range;light.intensity=lampAlready?0:source.intensity*Math.PI;
      DL.uDynP.value[i].set(source.position.x*128,source.position.y*128,source.position.z*128,source.range*128);
      DL.uDynC.value[i].set(source.color.r*source.intensity,source.color.g*source.intensity,source.color.b*source.intensity,128);
    }
  }

  private drawShadow(slot:number,layer:number,lamp:Lamp): void {
    const previous={background:this.scene.background,target:this.renderer.getRenderTarget(),override:this.scene.overrideMaterial,color:this.renderer.getClearColor(new THREE.Color()),alpha:this.renderer.getClearAlpha(),auto:this.renderer.autoClear};
    const camera=this.shadowCamera;camera.far=lamp.range;camera.updateProjectionMatrix();camera.position.copy(lamp.position);camera.layers.set(layer===0?1:2);
    this.shadowMaterial.uniforms.lamp.value.copy(lamp.position);this.shadowMaterial.uniforms.reach.value=lamp.range;
    this.scene.background=null;this.scene.overrideMaterial=this.shadowMaterial;this.renderer.autoClear=false;this.renderer.setClearColor(0xffffff,1);
    this.atlas.scissorTest=true;
    if(layer===1)this.sprites.sync(true,lamp.position);
    try{for(let face=0;face<6;face++){const [direction,up]=SH_FACES[face];camera.up.fromArray(up);camera.lookAt(lamp.position.clone().add(new THREE.Vector3().fromArray(direction)));
      this.atlas.viewport.set(face*SH_TILE,(slot*2+layer)*SH_TILE,SH_TILE,SH_TILE);this.atlas.scissor.copy(this.atlas.viewport);
      this.renderer.setRenderTarget(this.atlas);this.renderer.clear();this.renderer.render(this.scene,camera);
    }}finally{this.scene.background=previous.background;this.scene.overrideMaterial=previous.override;this.renderer.autoClear=previous.auto;this.renderer.setClearColor(previous.color,previous.alpha);this.renderer.setRenderTarget(previous.target);}
  }

  dispose(): void {
    this.sprites.dispose();this.atlas.dispose();this.shadowMaterial.dispose();this.scene.remove(this.ambient,this.fill,this.terrain,...this.slots,...this.dynamic);
    for(const child of this.terrain.children){const mesh=child as THREE.Mesh;mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
  }
}
