import * as THREE from 'three';
import type { ControlSettings } from '../game/engine';
import { createSoftLighting } from './softLighting';
import { createAmbientOcclusion, withDepth } from './ambientOcclusion.js';
import { createVolumetric } from './volumetricLight.js';

export class SceneEffects {
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly post = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: {tex: {value: null}},
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D tex;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tex,vUv).rgb,1.);\n#include <colorspace_fragment>\n}',
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
  private readonly soft;
  private readonly ao;
  private readonly volumetric;
  private readonly volumeCamera = new THREE.PerspectiveCamera();
  private target?: THREE.WebGLRenderTarget;
  private active = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene.add(this.quad);
    this.soft = createSoftLighting(renderer);this.ao=createAmbientOcclusion(renderer);this.volumetric=createVolumetric(renderer);
  }

  begin(settings: ControlSettings): void {
    this.active = settings.glow !== false || settings.ambientOcclusion !== false || (settings.volumetric ?? 2) > 0;
    if (!this.active) {this.renderer.setRenderTarget(null);return;}
    const size = this.renderer.getSize(new THREE.Vector2()), height = Math.min(640, Math.round(size.y));
    const width = Math.max(1, Math.round(height * size.x / size.y));
    if (!this.target || this.target.width !== width || this.target.height !== height) {
      this.target?.dispose();
      this.target = withDepth(new THREE.WebGLRenderTarget(width,height,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
    }
    this.renderer.setRenderTarget(this.target);
  }

  applyWorld(camera: THREE.PerspectiveCamera, settings: ControlSettings): void {
    if (!this.active || !this.target) return;
    this.ao.apply(this.target, camera, settings.ambientOcclusion !== false, {radius:28/128});
    this.volumeCamera.copy(camera);
    this.volumeCamera.matrixWorld.copy(camera.matrixWorld).premultiply(new THREE.Matrix4().makeScale(128,128,128));
    this.volumeCamera.matrixWorldInverse.copy(this.volumeCamera.matrixWorld).invert();
    this.volumetric.apply(this.target,this.volumeCamera,settings.volumetric??2,{name:'dungeon'});
  }

  present(settings: ControlSettings, _dt: number, _history = true): void {
    if (!this.active || !this.target) return;
    this.post.uniforms.tex.value=this.soft.render(this.target.texture,settings.glow!==false);
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
  }

  dispose(): void {
    this.target?.dispose();this.soft.dispose();this.ao.dispose();this.volumetric.dispose();this.post.dispose();this.quad.geometry.dispose();
  }
}
