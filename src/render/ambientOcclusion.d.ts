import * as THREE from 'three';
export function withDepth(target: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget;
export function createAmbientOcclusion(renderer: THREE.WebGLRenderer): {apply(target: THREE.WebGLRenderTarget,camera: THREE.PerspectiveCamera,on: boolean,options?: {region?: [number,number,number,number]; radius?: number}): void; stats(): unknown; dispose(): void};
