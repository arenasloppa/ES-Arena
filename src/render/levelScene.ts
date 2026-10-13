import * as THREE from 'three';
import { makeLiquidMaterial } from './liquidMaterial';
import { liquidBackdrop } from './liquidBackdrop';
import { modelWallPanels, type WallModelProvider } from './environmentWalls';
import { environmentAtlas, maskEnvironmentPanel } from './environmentPanelMask';
import type { DoorKind, Level, LevelFlat } from '../game/level';
import { buildLevelGeometry, type DoorGeometry, type QuadBatch } from './levelGeometry';

/** Where level textures come from: the player's game files (TextureCache) or the built-in backdrop. */
export interface TextureProvider {
  tile(file: string, frame?: number, transparentZero?: boolean): Promise<THREE.DataTexture | undefined>;
  sprite(file: string): Promise<THREE.DataTexture | undefined>;
  /** Every frame of an animated decoration (DFA). */
  spriteFrames?(file: string): Promise<THREE.DataTexture[]>;
  liquid(file: string): Promise<THREE.DataTexture[]>;
}

export interface DoorMesh {
  /** The door as one mesh, or for a swinging door a group of its faces, each turning on its own hinge. */
  mesh: THREE.Object3D;
  /** 0 = closed, 1 = fully open. */
  openAmount: number;
  target: number;
  /** How it opens, and toward which walls (see DoorGeometry). */
  kind: DoorKind;
  alongX: boolean;
  /** The middle of its cell. */
  centre?: { x: number; z: number };
}

/**
 * Poses a door `open` (0 to 1) of the way open: raising doors go up into
 * the ceiling, sliding ones sideways into the wall beside them, and each
 * face of a swinging one turns in on its hinge (see DoorPanel), as in Arena.
 * Arena draws only the face of a swinging door on the viewer's side, so its
 * far face does not show through the bars, nor lie along the doorway's other
 * wall once open; give `viewer` to do the same.
 */
export function poseDoor(door: DoorMesh, open: number, roomHeight: number, viewer?: { x: number; z: number }): void {
  const m = door.mesh;
  switch (door.kind) {
    case 'raising':
    case 'splitting':
      m.position.y = open * roomHeight * 0.95;
      break;
    case 'sliding':
      if (door.alongX) m.position.x = -open * 0.98;
      else m.position.z = -open * 0.98;
      break;
    case 'swinging':
      if (viewer && door.centre && (door.openAmount <= 0 || m.userData.activePanel === undefined)) {
        const c = door.centre;
        let best = -Infinity;
        m.children.forEach((face, index) => {
          const n = face.userData.normal as {x:number;z:number} | undefined;
          const score = n ? (viewer.x-c.x)*n.x+(viewer.z-c.z)*n.z : -Infinity;
          if (score > best) {best=score;m.userData.activePanel=index;}
        });
      }
      for (const [index, face] of m.children.entries()) {
        face.rotation.y = open * (Math.PI / 2);
        const n = face.userData.normal as { x: number; z: number } | undefined;
        const c = door.centre;
        if (viewer && n && c) face.visible = open > 0 && m.userData.modelledDoor
          ? index === m.userData.activePanel
          : (viewer.x - c.x) * n.x + (viewer.z - c.z) * n.z > 0;
      }
      break;
  }
  door.openAmount = open;
}

/** A door's mesh; a swinging door's faces are each built around their hinge, so turning one turns it on that corner. */
export function doorObject(d: DoorGeometry, material: THREE.Material, model?: THREE.Group): THREE.Object3D {
  let thinModel: THREE.Group | undefined;
  if (model && d.kind === 'swinging') {
    // A swinging leaf must fit the hinge clearance when fully open.
    model = model.clone(true);thinModel=model;
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.clone(), position = geometry.getAttribute('position');
      for (let i=0;i<position.count;i++) position.setZ(i, position.getZ(i)*.04);
      geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();object.geometry=geometry;
    });
  }
  const modelled = (batch: QuadBatch) => {
    const group = new THREE.Group(), panels = modelWallPanels(batch, model!, true);
    for (const instance of panels.meshes) {
      for (let i = 0; i < instance.count; i++) {
        const placement = new THREE.Matrix4(); instance.getMatrixAt(i, placement);
        const mesh = new THREE.Mesh(instance.geometry.clone().applyMatrix4(placement), instance.material);
        mesh.userData.environmentTile = true; mesh.userData.environmentDoor = true;
        group.add(mesh);
      }
      instance.geometry.dispose(); instance.dispose();
    }
    if (panels.remaining.indices.length) group.add(new THREE.Mesh(toGeometry(panels.remaining), material));
    return group;
  };
  if (model) {
    if (d.kind !== 'swinging') return modelled(d.batch);
    const group = new THREE.Group();
    group.userData.modelledDoor = true;
    for (const panel of d.panels) {
      const face = modelled(panel.batch);
      for (const child of face.children) (child as THREE.Mesh).geometry.translate(-panel.hinge.x, 0, -panel.hinge.z);
      face.position.set(panel.hinge.x, 0, panel.hinge.z); face.userData.normal = panel.normal; group.add(face);
    }
    thinModel?.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose();});
    return group;
  }
  if (d.kind !== 'swinging') return new THREE.Mesh(toGeometry(d.batch), material);
  const group = new THREE.Group();
  for (const panel of d.panels) {
    const geometry = toGeometry(panel.batch);
    geometry.translate(-panel.hinge.x, 0, -panel.hinge.z);
    const face = new THREE.Mesh(geometry, material);
    face.position.set(panel.hinge.x, 0, panel.hinge.z);
    face.userData.normal = panel.normal;
    group.add(face);
  }
  return group;
}

export interface LevelScene {
  group: THREE.Group;
  doors: Map<number, DoorMesh>;
  /** Upright sprite planes; turn them to face the camera each frame (yaw only, like Arena). */
  billboards: THREE.Mesh[];
  /** Sprites of the level's items, in the order of Level.items; hide one once it is taken. */
  items: Array<THREE.Mesh | undefined>;
  /** The material for a texture key, shared with the map screen. */
  material(key: string): Promise<THREE.Material>;
  /** Advances animated textures (water, lava). */
  animate(seconds: number): void;
  /** Flats that could not be drawn (missing or unreadable files). */
  skippedFlats: string[];
  refreshTerrain?():Promise<void>;
  setGraphicsMode?(mode: 'original' | 'remake'): Promise<void>;
}

/**
 * Sprite size in voxels per pixel. A voxel is 128 of Arena's units wide, a
 * sprite pixel is one unit, and Arena's art was drawn for a 320x200 screen
 * whose pixels a monitor showed 1.2 times taller than wide.
 */
export const PIXEL_WIDTH = 1 / 128;
export const PIXEL_HEIGHT = 1.2 / 128;

/** Sizes and places an upright sprite with its bottom edge `bottom` above the floor. */
export function placeSprite(mesh: THREE.Object3D, x: number, y: number, widthPx: number, heightPx: number, bottom: number, mirror = false): void {
  const w = widthPx * PIXEL_WIDTH;
  const h = heightPx * PIXEL_HEIGHT;
  mesh.scale.set(mirror ? -w : w, h, 1);
  mesh.position.set(x, bottom + h / 2, y);
}

/** Height above the floor for an INF or creature offset in Arena units (negative is up). */
export function liftFor(yOffset: number | undefined): number {
  return yOffset ? -yOffset * PIXEL_HEIGHT : 0;
}

function toGeometry(b: QuadBatch): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  g.setIndex(b.indices);g.computeVertexNormals();g.computeTangents();
  return g;
}

export async function buildLevelScene(level: Level, textures: TextureProvider, wallModels?: WallModelProvider, initialMode: 'original' | 'remake' = 'remake'): Promise<LevelScene> {
  const group = new THREE.Group();
  const materials = new Map<string, THREE.Material>();
  const doors = new Map<number, DoorMesh>();
  let graphicsMode = initialMode;
  let installedMode: 'original' | 'remake' | undefined;

  const animated: Array<{ mat: THREE.MeshBasicMaterial; frames: THREE.DataTexture[]; frame?: { value: THREE.DataTexture } }> = [];
  const LIQUID_FILES: Record<string, string> = { wet: 'WATERANI.RCI', lava: 'LAVAANI.RCI' };

  const material = async (key: string, mode = graphicsMode): Promise<THREE.Material> => {
    const cacheKey = `${mode}:${key}`;
    const cached = materials.get(cacheKey);
    if (cached) return cached;
    const [kind, idxStr, layerIndex] = key.split(':');
    if (kind === 'liquid' || kind === 'chasm') {
      const frames = await textures.liquid(LIQUID_FILES[idxStr]);
      const fallback = level.chasmTextures[idxStr as 'wet' | 'lava'];
      if (!frames.length && fallback !== undefined) return material(`wall:${fallback}`, mode);
      const entry = kind === 'chasm' ? level.wallTextures[Number(layerIndex)] : undefined;
      const layer = entry && await textures.tile(entry.file, entry.frame, true);
      const result = frames.length ? makeLiquidMaterial(frames[0], layer) : undefined;
      const mat = result?.material ?? new THREE.MeshBasicMaterial({ color: 0x203040 });
      if (result) animated.push({ mat, frames, frame: result.frame });
      materials.set(cacheKey, mat);
      return mat;
    }
    const idx = Number(idxStr);
    const entry = kind === 'wallcap' ? level.wallCapTexture : kind === 'floor' ? level.floorTextures[idx] : level.wallTextures[idx];
    const glass = kind === 'glass' || kind === 'arch' || kind === 'maskedwall';
    let tex: THREE.Texture | undefined = entry && await textures.tile(entry.file, entry.frame, glass);
    if (mode === 'remake' && entry && wallModels && kind !== 'glass' && kind !== 'arch') {
      const model = await wallModels.loadWall(entry.file, entry.frame);
      if (model) {
        const prepared = glass && tex instanceof THREE.DataTexture ? maskEnvironmentPanel(model, tex) : model;
        const atlas = environmentAtlas(prepared);
        if (atlas) { tex = atlas.clone(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true; }
      }
    }
    const mat = new THREE.MeshBasicMaterial({
      map: tex ?? null,
      color: tex ? 0xffffff : 0x555555,
      side: kind === 'arch' ? THREE.FrontSide : THREE.DoubleSide,
      alphaTest: glass ? 0.5 : 0,
      transparent: false,
    });
    materials.set(cacheKey, mat);
    return mat;
  };

  let terrainMeshes: THREE.Mesh[] = [];
  let revision = 0;
  const wallTemplates = new Map<string, Promise<THREE.Group | undefined>>();
  const disposeTerrain = (mesh: THREE.Mesh) => {
    mesh.geometry.dispose();
    if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    if (mesh.userData.environmentTile) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) { (material as THREE.MeshBasicMaterial).map?.dispose(); (material as THREE.MeshStandardMaterial).normalMap?.dispose(); material.dispose(); }
    } else for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material instanceof THREE.MeshStandardMaterial) material.dispose();
    }
  };

  const disposeDoor = (object: THREE.Object3D) => object.traverse(child => {
    if (child instanceof THREE.Mesh) disposeTerrain(child);
  });
  const refreshTerrain = async () => {
    const current = ++revision, mode = graphicsMode, next: THREE.Mesh[] = [];
    const models = mode === 'remake' ? wallModels : undefined;
    const geometry = buildLevelGeometry(level);
    for (const [key, batch] of geometry.batches) {
      const [kind, index, layerIndex] = key.split(':');
      const entry = kind === 'wallcap' ? level.wallCapTexture : kind === 'floor' ? level.floorTextures[Number(index)]
        : kind === 'wall' || kind === 'maskedwall' ? level.wallTextures[Number(index)]
        : kind === 'chasm' && index === 'wet' ? level.wallTextures[Number(layerIndex)] : undefined;
      let remaining = batch;
      if (entry && models) {
        let template = wallTemplates.get(key);
        if (!template) {
          template = models.loadWall(entry.file, entry.frame).then(async model => {
            if (model && (kind === 'maskedwall' || kind === 'chasm')) {
              const mask = await textures.tile(entry.file, entry.frame, true);
              if (mask) return maskEnvironmentPanel(model, mask);
            }
            return model;
          }).catch(error => {
            console.warn('Could not load dungeon wall model:', error);
            return undefined;
          });
          wallTemplates.set(key, template);
        }
        const model = await template;
        if (model) {
          const panels = modelWallPanels(batch, model);
          for (const mesh of panels.meshes) mesh.userData.textureKey = key;
          next.push(...panels.meshes);
          remaining = panels.remaining;
          if (kind === 'chasm' && !remaining.indices.length) {
            const surface = model.getObjectByName('Masonry_Relief') as THREE.Mesh;
            surface.geometry.computeBoundingBox();
            const bounds = surface.geometry.boundingBox!;
            const depth = bounds.max.z - bounds.min.z + .001;
            next.push(new THREE.Mesh(toGeometry(liquidBackdrop(batch, depth)), await material(`liquid:${index}`, mode)));
          }
        }
      }
      if (remaining.indices.length) next.push(new THREE.Mesh(toGeometry(remaining), await material(key, mode)));
    }
    const nextDoors = new Map<number, DoorMesh>();
    for (const d of mode !== installedMode ? geometry.doors : []) {
      const entry = level.wallTextures[Number(d.key.split(':')[1])];
      let model = entry && models ? await models.loadWall(entry.file, entry.frame) : undefined;
      if (model && entry && d.key.startsWith('glass:')) {
        const mask = await textures.tile(entry.file, entry.frame, true);
        if (mask) model = maskEnvironmentPanel(model, mask);
      }
      const mesh = doorObject(d, await material(d.key, mode), model);
      const old = doors.get(d.cellIndex);
      if (old) mesh.userData.activePanel = old.mesh.userData.activePanel;
      const door = {mesh, openAmount: old?.openAmount ?? 0, target: old?.target ?? 0, kind: d.kind, alongX: d.alongX, centre: {x:d.x+.5,z:d.y+.5}};
      poseDoor(door, door.openAmount, level.height);
      nextDoors.set(d.cellIndex, door);
    }
    if (current !== revision) { next.forEach(disposeTerrain);nextDoors.forEach(door=>disposeDoor(door.mesh));return; }
    for (const mesh of terrainMeshes) { group.remove(mesh); disposeTerrain(mesh); }
    terrainMeshes = next; group.add(...next);
    for (const [index, door] of nextDoors) {
      const old=doors.get(index);
      if (!old) continue;
      door.target=old.target;door.mesh.userData.activePanel=old.mesh.userData.activePanel;
      poseDoor(door,old.openAmount,level.height);
      door.mesh.children.forEach((face,i)=>{face.visible=old.mesh.children[i]?.visible??true;});
    }
    if (mode !== installedMode) {
      for (const door of doors.values()) {group.remove(door.mesh);disposeDoor(door.mesh);}
      doors.clear();nextDoors.forEach((door,index)=>{doors.set(index,door);group.add(door.mesh);});
    }
    installedMode = mode;
  };
  await refreshTerrain();

  const skippedFlats: string[] = [];
  const billboards: THREE.Mesh[] = [];
  const plane = new THREE.PlaneGeometry(1, 1);
  /** Animated decorations, and their frames: Arena plays them at 12 frames a second (OpenTESArena). */
  const animatedFlats: Array<{ mat: THREE.MeshStandardMaterial; frames: THREE.DataTexture[] }> = [];
  const flatSprite = async (flat: LevelFlat): Promise<THREE.Mesh | undefined> => {
    const frames = flat.name.endsWith('.DFA') ? ((await textures.spriteFrames?.(flat.name)) ?? []) : [];
    const tex = flat.name.endsWith('.IMG') ? await textures.sprite(flat.name) : frames[0];
    if (!tex) {
      skippedFlats.push(flat.name);
      return undefined;
    }
    const img = tex.image as { width: number; height: number };
    const flatMaterial = new THREE.MeshStandardMaterial({map:tex,alphaTest:0.5,side:THREE.DoubleSide,roughness:.94});
    flatMaterial.userData.noBump = true;
    if (frames.length > 1) {
      flatMaterial.userData.keepAnimatedMaterial = true;
      animatedFlats.push({ mat: flatMaterial, frames });
    }
    const sprite = new THREE.Mesh(plane, flatMaterial);
    sprite.userData.shadowBillboard = true;
    // Larger kinds (F:4 and F:64) are drawn at their scale; things hung from the ceiling (F:32) hang from it.
    const scale = flat.scale ?? 1;
    const bottom = flat.ceiling ? level.height - img.height * scale * PIXEL_HEIGHT : (flat.base ?? 0) + liftFor(flat.yOffset);
    placeSprite(sprite, flat.x, flat.y, img.width * scale, img.height * scale, bottom);
    flat.collisionWidth=img.width*scale/128;flat.collisionHeight=img.height*scale*PIXEL_HEIGHT;
    group.add(sprite);
    billboards.push(sprite);
    return sprite;
  };
  for (const flat of level.flats) await flatSprite(flat);
  const items: Array<THREE.Mesh | undefined> = [];
  for (const item of level.items) items.push(await flatSprite(item));

  const animate = (seconds: number) => {
    for (const a of animated) {
      const texture = a.frames[Math.floor(seconds * 6) % a.frames.length];
      if (a.frame) a.frame.value = texture;
      else a.mat.map = texture;
    }
    for (const a of animatedFlats) a.mat.map = a.frames[Math.floor(seconds * 12) % a.frames.length];
  };

  const setGraphicsMode = async (mode: 'original' | 'remake') => {
    if (graphicsMode === mode && installedMode === mode) return;
    graphicsMode = mode;
    await refreshTerrain();
  };
  return { group, doors, billboards, items, material, animate, skippedFlats, refreshTerrain, setGraphicsMode };
}
