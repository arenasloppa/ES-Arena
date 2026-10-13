import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { QuadBatch } from './levelGeometry';
import { cropEnvironmentPanel } from './environmentPanelCrop';

export interface WallModelProvider {
  loadWall(file: string, frame: number): Promise<THREE.Group | undefined>;
}

export class EnvironmentWallAssets implements WallModelProvider {
  private readonly templates = new Map<string, Promise<THREE.Group>>();
  private readonly loader = new GLTFLoader();

  constructor() {
    this.loader.register(parser => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      parser.textureLoader.setCrossOrigin(parser.options.crossOrigin);
      return { name: 'ENVIRONMENT_EMBEDDED_ATLAS' };
    });
  }

  loadWall(file: string, frame: number): Promise<THREE.Group | undefined> {
    const path = environmentModelPath(file, frame);
    if (!path) return Promise.resolve(undefined);
    let pending = this.templates.get(path);
    if (pending) return pending;
    pending = this.loader.loadAsync(`${import.meta.env.BASE_URL}models/environment/${path}`).then(gltf => {
      const model = gltf.scene;
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = object.geometry.clone();
        const normals = geometry.getAttribute('normal');
        const colors = new Float32Array(geometry.getAttribute('position').count * 3);
        for (let i = 0; i < colors.length / 3; i++) {
          const shade = 0.78 + 0.22 * Math.max(0, normals?.getZ(i) ?? 1);
          colors.set([shade, shade, shade], i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (geometry.index) geometry.computeTangents();
        if (geometry.index && normals) geometry.computeTangents();
        object.geometry = geometry;
        const prepare = (source: THREE.Material) => {
          const map = (source as THREE.MeshStandardMaterial).map;
          if (!map) throw new Error('Dungeon wall has no loaded texture');
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.LinearMipmapLinearFilter;
          map.anisotropy = 8; map.needsUpdate = true;
          const material = new THREE.MeshBasicMaterial({map,vertexColors:true,alphaTest:source.alphaTest,side:source.side});
          material.userData.finish = file.toUpperCase()==='SCELL.IMG' ? {roughness:.35,metalness:.6}
            : file.toUpperCase()==='SWATER.IMG' ? {roughness:.48,metalness:0}
            : file.toUpperCase().startsWith('FLOOR') ? {roughness:.72,metalness:0} : {roughness:.87,metalness:0};
          return material;
        };
        object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material);
      });
      return model;
    }).catch(error => {
      this.templates.delete(path);
      throw error;
    });
    this.templates.set(path, pending);
    return pending;
  }
}

/** Runtime models for the finished Imperial Dungeon masonry and floor tiles. */
export function environmentModelPath(file: string, frame: number): string | undefined {
  const name = file.toUpperCase();
  if (name === 'WALLB.SET' && frame === 0) return 'imperial-dungeon-wall.glb';
  const frames: Record<string, readonly number[]> = {
    'WALLA.SET': [0], 'WALLB.SET': [1, 2, 3, 4], 'WALLF.SET': [3],
    'WALL_D05.IMG': [0], 'GATE.IMG': [0], 'SCELL.IMG': [0], 'SSD.IMG': [0], 'SWATER.IMG': [0], 'FLOORA.SET': [0], 'FLOORB.SET': [0, 1],
  };
  if (!frames[name]?.includes(frame)) return undefined;
  return name.replace('.', '_').toLowerCase() + (name.endsWith('.SET') ? `_${String(frame).padStart(2, '0')}` : '') + '.glb';
}

/** Fits tile relief behind native collision planes. Joined terrain uses only stitched fronts. */
export function modelWallPanels(batch: QuadBatch, model: THREE.Group, closed = false): { meshes: THREE.InstancedMesh[]; remaining: QuadBatch } {
  const remaining: QuadBatch = { positions: [], uvs: [], indices: [] };
  const groups = new Map<THREE.Group, THREE.Matrix4[]>();
  for (let base = 0; base < batch.positions.length / 3; base += 4) {
    const point = (offset: number) => new THREE.Vector3().fromArray(batch.positions, (base + offset) * 3);
    const p0 = point(0), p1 = point(1), p2 = point(2), p3 = point(3);
    const right = p1.clone().sub(p0), up = p3.clone().sub(p0);
    const width = right.length(), height = up.length();
    const uv = batch.uvs.slice(base * 2, (base + 4) * 2), v0 = uv[1], v1 = uv[5];
    const expected = [0, v0, 1, v0, 1, v1, 0, v1];
    const rectangular = p0.clone().add(right).add(up).distanceTo(p2) < 1e-6;
    const validUv = expected.every((value, i) => Math.abs(uv[i] - value) < 1e-6);
    const orthogonal = Math.abs(right.dot(up)) < 1e-6;
    const template = validUv && v0 >= 0 && v1 <= 1 && v1 > v0
      ? (v0 === 0 && v1 === 1 ? model : cropEnvironmentPanel(model, v0, v1)) : undefined;
    if (!template || !rectangular || !orthogonal || width <= 0 || height <= 0) {
      const next = remaining.positions.length / 3;
      remaining.positions.push(...batch.positions.slice(base * 3, (base + 4) * 3));
      remaining.uvs.push(...uv);
      remaining.indices.push(next, next + 1, next + 2, next, next + 2, next + 3);
      continue;
    }
    template.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(template), size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    right.normalize(); up.normalize();
    const normal = right.clone().cross(up).normalize();
    const position = p0.clone().add(p2).multiplyScalar(0.5)
      .addScaledVector(right, -centre.x * width / size.x)
      .addScaledVector(up, -centre.y * height / size.y)
      .addScaledVector(normal, -bounds.max.z);
    const placements = groups.get(template) ?? [];
    placements.push(new THREE.Matrix4().makeBasis(right, up, normal)
      .scale(new THREE.Vector3(width / size.x, height / size.y, 1)).setPosition(position));
    groups.set(template, placements);
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const [template, placements] of groups) template.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const front = template.getObjectByName('Masonry_Relief');
    if (!closed && front && object !== front) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (!closed && object === front) {
      const bounds = new THREE.Box3().setFromObject(template);
      const points = geometry.getAttribute('position');
      for (let i = 0; i < points.count; i++) {
        if (Math.abs(points.getX(i) - bounds.min.x) < 1e-6 || Math.abs(points.getX(i) - bounds.max.x) < 1e-6
          || Math.abs(points.getY(i) - bounds.min.y) < 1e-6 || Math.abs(points.getY(i) - bounds.max.y) < 1e-6) points.setZ(i, bounds.max.z);
      }
      geometry.computeVertexNormals();
      const normals = geometry.getAttribute('normal'), colors = new Float32Array(points.count * 3);
      for (let i = 0; i < points.count; i++) { const shade = .78 + .22 * Math.max(0, normals.getZ(i)); colors.set([shade, shade, shade], i * 3); }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (geometry.index) geometry.computeTangents();
    }
    const ownMaterial = (original: THREE.Material) => {
      const material = original.clone() as THREE.MeshBasicMaterial;
      if (material.map) { material.map = material.map.clone(); material.map.needsUpdate = true; }
      return material;
    };
    const material = Array.isArray(object.material) ? object.material.map(ownMaterial) : ownMaterial(object.material);
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = 'Imperial Dungeon Tile';
    mesh.userData.wallPanels = placements.length;
    mesh.userData.environmentTile = true;
    placements.forEach((placement, i) => mesh.setMatrixAt(i, placement));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    meshes.push(mesh);
  });
  return { meshes, remaining };
}

export const environmentWalls = new EnvironmentWallAssets();
