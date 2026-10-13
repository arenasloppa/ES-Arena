import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnvironmentWallAssets, environmentModelPath, modelWallPanels } from '../src/render/environmentWalls';
import { buildLevelGeometry, type QuadBatch } from '../src/render/levelGeometry';
import { buildLevelScene, doorObject, poseDoor, type TextureProvider } from '../src/render/levelScene';
import { textLevel } from './helpers/level';
import { applyTileMask } from '../src/render/environmentPanelMask';
import { cropEnvironmentPanel } from '../src/render/environmentPanelCrop';
import { liquidBackdrop } from '../src/render/liquidBackdrop';

function panel() {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 0.9375, 0.184);
  geometry.translate(0, 0, 0.012);
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  return group;
}
const textures: TextureProvider = {
  tile: async () => undefined, sprite: async () => undefined, liquid: async () => [],
};

describe('textured dungeon wall panels', () => {
  it('fits all four directions inside the existing wall and room boundaries', () => {
    const level = textLevel(['...', '.#.', '...'], { height: 0.9375 });
    const cells = structuredClone(level.cells);
    const result = modelWallPanels(buildLevelGeometry(level).batches.get('wall:0')!, panel());
    expect(result.remaining.indices).toHaveLength(0);
    expect(result.meshes).toHaveLength(1);
    const mesh = result.meshes[0];
    expect(mesh.count).toBe(4);
    const local = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
      const world = local.clone().applyMatrix4(matrix);
      expect(world.min.x).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(world.max.x).toBeLessThanOrEqual(2 + 1e-6);
      expect(world.min.z).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(world.max.z).toBeLessThanOrEqual(2 + 1e-6);
      expect(world.min.y).toBeCloseTo(0, 6);
      expect(world.max.y).toBeCloseTo(level.height, 6);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      const front = new THREE.Vector3(0, 0, local.max.z).applyMatrix4(matrix);
      const expected = new THREE.Vector3(1.5, 0.46875, 1.5).addScaledVector(normal, 0.5);
      expect(front.distanceTo(expected)).toBeLessThan(1e-6);
    }
    expect(level.cells).toEqual(cells);
  });

  it('fits floors and ceilings behind the collision plane without changing their footprint', () => {
    const level = textLevel(['.']);
    const batch = buildLevelGeometry(level).batches.get('floor:0')!;
    const result = modelWallPanels(batch, panel());
    expect(result.remaining.indices).toHaveLength(0);
    const mesh = result.meshes[0];
    expect(mesh.count).toBe(2);
    const local = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
    for (let i = 0; i < 2; i++) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
      const box = local.clone().applyMatrix4(matrix);
      expect(box.min.x).toBeCloseTo(0); expect(box.max.x).toBeCloseTo(1);
      expect(box.min.z).toBeCloseTo(0); expect(box.max.z).toBeCloseTo(1);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      if (normal.y > 0) expect(box.max.y).toBeCloseTo(0);
      else expect(box.min.y).toBeCloseTo(level.height);
    }
  });

  it('retains unsupported UV patterns without stretching them', () => {
    const batch: QuadBatch = {
      positions: [0,0,0, 1,0,0, 1,0.4,0, 0,0.4,0],
      uvs: [0,0, 0.5,0, 1,0.4, 0,0.4], indices: [0,1,2,0,2,3],
    };
    const result = modelWallPanels(batch, panel());
    expect(result.meshes).toHaveLength(0); expect(result.remaining).toEqual(batch);
  });

  it('crops partial wall tiles and closes the cut edges while preserving their UV range', () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), new THREE.MeshBasicMaterial());
    mesh.name = 'Masonry_Relief'; group.add(mesh);
    const crop = cropEnvironmentPanel(group, 0.25, 0.75)!;
    expect(crop.children).toHaveLength(2);
    const bounds = new THREE.Box3().setFromObject(crop);
    expect(bounds.min.y).toBeCloseTo(-0.25); expect(bounds.max.y).toBeCloseTo(0.25);
    const geometry = (crop.children[0] as THREE.Mesh).geometry, uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0.25); expect(uv.getY(i)).toBeLessThanOrEqual(0.75);
    }
    const batch: QuadBatch = {
      positions: [0,0.25,0, 1,0.25,0, 1,0.75,0, 0,0.75,0],
      uvs: [0,0.25, 1,0.25, 1,0.75, 0,0.75], indices: [0,1,2,0,2,3],
    };
    const result = modelWallPanels(batch, group);
    expect(result.remaining.indices).toHaveLength(0);
    expect(result.meshes.every(m => m.count === 1)).toBe(true);
  });

  it('preserves original transparent openings at the replacement resolution', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(255), mask = new Uint8Array(2 * 2 * 4).fill(255);
    mask[3] = 0;
    applyTileMask(pixels, 4, 4, mask, 2, 2);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      expect(pixels[(y * 4 + x) * 4 + 3]).toBe(x < 2 && y < 2 ? 0 : 255);
      expect(pixels[(y * 4 + x) * 4]).toBe(255);
    }
  });

  it('rebuilds instances after a wall is destroyed and retains the native fallback', async () => {
    const level = textLevel(['...', '.#.', '...'], { wallTextures: [{ file: 'WALLB.SET', frame: 0 }] });
    const scene = await buildLevelScene(level, textures, { loadWall: async () => panel() });
    expect(scene.group.children.filter(o => o instanceof THREE.InstancedMesh)).toHaveLength(1);
    level.cells[4].kind = 'empty';
    await scene.refreshTerrain!();
    expect(scene.group.children.filter(o => o instanceof THREE.InstancedMesh)).toHaveLength(0);
    level.cells[4].kind = 'wall';
    const fallback = await buildLevelScene(level, textures);
    expect(fallback.group.children.some(o => o instanceof THREE.InstancedMesh)).toBe(false);
    expect(fallback.group.children.length).toBeGreaterThan(0);
  });

  it('joins recessed terrain fronts on the original plane without overlapping backs', () => {
    const group = new THREE.Group(), front = new THREE.Mesh(new THREE.PlaneGeometry(1, .9375, 2, 2), new THREE.MeshBasicMaterial());
    front.name = 'Masonry_Relief';
    const positions = front.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) positions.setZ(i, i === 4 ? .1 : .08);
    group.add(front, new THREE.Mesh(new THREE.BoxGeometry(1, .9375, .1), new THREE.MeshBasicMaterial()));
    const level = textLevel(['...', '.#.', '...'], {height: .9375});
    const result = modelWallPanels(buildLevelGeometry(level).batches.get('wall:0')!, group);
    expect(result.meshes).toHaveLength(1);
    const points = result.meshes[0].geometry.getAttribute('position');
    for (let i = 0; i < points.count; i++) expect(points.getZ(i)).toBeCloseTo(.1);
    expect(modelWallPanels(buildLevelGeometry(level).batches.get('wall:0')!, group, true).meshes).toHaveLength(2);
  });

  it('keeps the shore crop and liquid foot at the native water level', () => {
    const shore: QuadBatch = {positions:[0,-.125,0, 1,-.125,0, 1,0,0, 0,0,0], uvs:[0,13/15,1,13/15,1,1,0,1],indices:[0,1,2,0,2,3]};
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1, .9375, 32, 32), new THREE.MeshBasicMaterial());
    front.name = 'Masonry_Relief'; const group = new THREE.Group(); group.add(front);
    const fitted = modelWallPanels(shore, group);
    expect(fitted.remaining.indices).toHaveLength(0);
    const uv = fitted.meshes[0].geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) expect(uv.getY(i)).toBeGreaterThanOrEqual(13/15 - 1e-6);
    const backdrop = liquidBackdrop(shore, .027);
    expect(backdrop.positions.slice(0,6)).toEqual(shore.positions.slice(0,6));
    for (let i = 0; i < backdrop.positions.length; i += 3) {
      expect(backdrop.positions[i+1]).toBeGreaterThanOrEqual(-.125);
      expect(backdrop.positions[i+1]).toBeLessThanOrEqual(0);
      expect(backdrop.positions[i+2]).toBeLessThanOrEqual(0);
    }
    expect(backdrop.positions.at(-1)).toBeCloseTo(-.027);
  });

  it('opens modelled swinging gates on their native hinges', () => {
    const level = textLevel(['.#.', '.|.', '.#.']);
    level.cells[4].door = 'swinging';
    const door = buildLevelGeometry(level).doors[0];
    const object = doorObject(door, new THREE.MeshBasicMaterial(), panel());
    expect(object.children.length).toBe(door.panels.length);
    for (let i = 0; i < door.panels.length; i++) {
      expect(object.children[i].position.x).toBe(door.panels[i].hinge.x);
      expect(object.children[i].position.z).toBe(door.panels[i].hinge.z);
      expect(object.children[i].children.length).toBeGreaterThan(0);
      expect(object.children[i].children[0].userData.environmentDoor).toBe(true);
    }
    poseDoor({mesh:object,openAmount:0,target:1,kind:'swinging',alongX:door.alongX},1,level.height);
    for (const face of object.children) expect(face.rotation.y).toBeCloseTo(Math.PI/2);
  });

  it('keeps an open leaf visible across viewing angles and inside the hinge clearance', () => {
    const level=textLevel(['.#.','.|.','.#.']);level.cells[4].door='swinging';
    const geometry=buildLevelGeometry(level).doors[0],object=doorObject(geometry,new THREE.MeshBasicMaterial(),panel());
    const door={mesh:object,openAmount:0,target:1,kind:geometry.kind,alongX:geometry.alongX,centre:{x:1.5,z:1.5}};
    poseDoor(door,0,level.height,{x:.5,z:1.5});poseDoor(door,1,level.height,{x:.5,z:1.5});
    const leaf=object.children.find(face=>face.visible)!;
    for(const viewer of [{x:1.5,z:1.5},{x:2.5,z:1.5},{x:1.5,z:2.5}]) {
      poseDoor(door,1,level.height,viewer);expect(object.children.filter(face=>face.visible)).toEqual([leaf]);
    }
    object.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(leaf);
    expect(Math.min(bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z)).toBeLessThan(.01);
    expect(door.openAmount).toBe(1);
  });

  it('switches native textures and tile models together while preserving open doors', async () => {
    const level=textLevel(['.#.','.|.','.#.'],{wallTextures:[{file:'GATE.IMG',frame:0}],floorTextures:[{file:'FLOORA.SET',frame:0}]});
    level.cells[4].door='swinging';
    const native=new THREE.DataTexture(new Uint8Array(16).fill(255),2,2),replacement=new THREE.DataTexture(new Uint8Array(64).fill(255),4,4);
    const provider={...textures,tile:async()=>native};
    const template=panel();(template.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>).material.map=replacement;
    const scene=await buildLevelScene(level,provider,{loadWall:async()=>template});
    const door=scene.doors.get(4)!;poseDoor(door,.5,level.height,{x:.5,z:1.5});door.target=1;
    const billboards=scene.billboards,items=scene.items;
    expect((await scene.material('floor:0') as THREE.MeshBasicMaterial).map?.image).toBe(replacement.image);
    await scene.setGraphicsMode!('original');
    expect(scene.group.children.some(object=>object instanceof THREE.InstancedMesh)).toBe(false);
    expect((await scene.material('floor:0') as THREE.MeshBasicMaterial).map).toBe(native);
    expect(scene.doors.get(4)).toMatchObject({openAmount:.5,target:1});
    await Promise.all([scene.setGraphicsMode!('remake'),scene.setGraphicsMode!('original'),scene.setGraphicsMode!('remake')]);
    expect(scene.group.children.some(object=>object instanceof THREE.InstancedMesh)).toBe(true);
    expect((await scene.material('floor:0') as THREE.MeshBasicMaterial).map?.image).toBe(replacement.image);
    expect(scene.doors.get(4)).toMatchObject({openAmount:.5,target:1});
    expect(scene.billboards).toBe(billboards);expect(scene.items).toBe(items);
  });

  it('does not substitute unrelated wall textures or other atlas frames', async () => {
    const assets = new EnvironmentWallAssets();
    expect(await assets.loadWall('WALLB.SET', 5)).toBeUndefined();
    expect(environmentModelPath('SWATER.IMG', 0)).toBe('swater_img.glb');
    expect(environmentModelPath('SCELL.IMG', 0)).toBe('scell_img.glb');
    expect(environmentModelPath('SSD.IMG', 0)).toBe('ssd_img.glb');
    expect(environmentModelPath('WATERANI.RCI', 0)).toBeUndefined();
    expect(environmentModelPath('WALLF.SET', 3)).toBe('wallf_set_03.glb');
    expect(environmentModelPath('FLOORB.SET', 1)).toBe('floorb_set_01.glb');
  });
});
