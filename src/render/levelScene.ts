import * as THREE from 'three';
import { makeLiquidMaterial } from './liquidMaterial';
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
      for (const face of m.children) {
        face.rotation.y = open * (Math.PI / 2);
        const n = face.userData.normal as { x: number; z: number } | undefined;
        const c = door.centre;
        if (viewer && n && c) face.visible = (viewer.x - c.x) * n.x + (viewer.z - c.z) * n.z > 0;
      }
      break;
  }
}

/** A door's mesh; a swinging door's faces are each built around their hinge, so turning one turns it on that corner. */
export function doorObject(d: DoorGeometry, material: THREE.Material): THREE.Object3D {
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
  g.setIndex(b.indices);
  return g;
}

export async function buildLevelScene(level: Level, textures: TextureProvider): Promise<LevelScene> {
  const group = new THREE.Group();
  const geo = buildLevelGeometry(level);
  const materials = new Map<string, THREE.Material>();

  const animated: Array<{ mat: THREE.MeshBasicMaterial; frames: THREE.DataTexture[]; frame?: { value: THREE.DataTexture } }> = [];
  const LIQUID_FILES: Record<string, string> = { wet: 'WATERANI.RCI', lava: 'LAVAANI.RCI' };

  const material = async (key: string): Promise<THREE.Material> => {
    const cached = materials.get(key);
    if (cached) return cached;
    const [kind, idxStr, layerIndex] = key.split(':');
    if (kind === 'liquid' || kind === 'chasm') {
      const frames = await textures.liquid(LIQUID_FILES[idxStr]);
      const fallback = level.chasmTextures[idxStr as 'wet' | 'lava'];
      if (!frames.length && fallback !== undefined) return material(`wall:${fallback}`);
      const entry = kind === 'chasm' ? level.wallTextures[Number(layerIndex)] : undefined;
      const layer = entry && await textures.tile(entry.file, entry.frame, true);
      const result = frames.length ? makeLiquidMaterial(frames[0], layer) : undefined;
      const mat = result?.material ?? new THREE.MeshBasicMaterial({ color: 0x203040 });
      if (result) animated.push({ mat, frames, frame: result.frame });
      materials.set(key, mat);
      return mat;
    }
    const idx = Number(idxStr);
    const entry = kind === 'wallcap' ? level.wallCapTexture : kind === 'floor' ? level.floorTextures[idx] : level.wallTextures[idx];
    const glass = kind === 'glass' || kind === 'arch' || kind === 'maskedwall';
    const tex = entry && await textures.tile(entry.file, entry.frame, glass);
    const mat = new THREE.MeshBasicMaterial({
      map: tex ?? null,
      color: tex ? 0xffffff : 0x555555,
      side: kind === 'arch' ? THREE.FrontSide : THREE.DoubleSide,
      alphaTest: glass ? 0.5 : 0,
      transparent: false,
    });
    materials.set(key, mat);
    return mat;
  };

  let terrainMeshes:THREE.Mesh[]=[];
  let revision=0;
  const refreshTerrain=async()=>{
    const current=++revision,next:THREE.Mesh[]=[];
    for(const [key,batch] of buildLevelGeometry(level).batches)next.push(new THREE.Mesh(toGeometry(batch),await material(key)));
    if(current!==revision){for(const m of next)m.geometry.dispose();return;}
    for(const m of terrainMeshes){group.remove(m);m.geometry.dispose();}
    terrainMeshes=next;group.add(...next);
  };
  await refreshTerrain();

  const doors = new Map<number, DoorMesh>();
  for (const d of geo.doors) {
    const mesh = doorObject(d, await material(d.key));
    group.add(mesh);
    doors.set(d.cellIndex, { mesh, openAmount: 0, target: 0, kind: d.kind, alongX: d.alongX, centre: { x: d.x + 0.5, z: d.y + 0.5 } });
  }

  const skippedFlats: string[] = [];
  const billboards: THREE.Mesh[] = [];
  const plane = new THREE.PlaneGeometry(1, 1);
  /** Animated decorations, and their frames: Arena plays them at 12 frames a second (OpenTESArena). */
  const animatedFlats: Array<{ mat: THREE.MeshBasicMaterial; frames: THREE.DataTexture[] }> = [];
  const flatSprite = async (flat: LevelFlat): Promise<THREE.Mesh | undefined> => {
    const frames = flat.name.endsWith('.DFA') ? ((await textures.spriteFrames?.(flat.name)) ?? []) : [];
    const tex = flat.name.endsWith('.IMG') ? await textures.sprite(flat.name) : frames[0];
    if (!tex) {
      skippedFlats.push(flat.name);
      return undefined;
    }
    const img = tex.image as { width: number; height: number };
    const flatMaterial = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    if (frames.length > 1) animatedFlats.push({ mat: flatMaterial, frames });
    const sprite = new THREE.Mesh(plane, flatMaterial);
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

  return { group, doors, billboards, items, material, animate, skippedFlats, refreshTerrain };
}
