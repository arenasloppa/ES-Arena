import * as THREE from 'three';
import type { Level, LevelFlat } from '../game/level';
import { buildLevelGeometry, type QuadBatch } from './levelGeometry';

/** Where level textures come from: the player's game files (TextureCache) or the built-in backdrop. */
export interface TextureProvider {
  tile(file: string, frame?: number): Promise<THREE.DataTexture | undefined>;
  sprite(file: string): Promise<THREE.DataTexture | undefined>;
  liquid(file: string): Promise<THREE.DataTexture[]>;
}

export interface DoorMesh {
  mesh: THREE.Mesh;
  /** 0 = closed, 1 = fully open. */
  openAmount: number;
  target: number;
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
  /** Flats the remake cannot draw yet (animated DFA sprites). */
  skippedFlats: string[];
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

  const animated: Array<{ mat: THREE.MeshBasicMaterial; frames: THREE.DataTexture[] }> = [];
  const LIQUID_FILES: Record<string, string> = { wet: 'WATERANI.RCI', lava: 'LAVAANI.RCI' };

  const material = async (key: string): Promise<THREE.Material> => {
    const cached = materials.get(key);
    if (cached) return cached;
    const [kind, idxStr] = key.split(':');
    if (kind === 'liquid') {
      const frames = await textures.liquid(LIQUID_FILES[idxStr]);
      const fallback = level.chasmTextures[idxStr as 'wet' | 'lava'];
      if (!frames.length && fallback !== undefined) return material(`wall:${fallback}`);
      const mat = new THREE.MeshBasicMaterial({ map: frames[0] ?? null, color: frames.length ? 0xffffff : 0x203040 });
      if (frames.length > 1) animated.push({ mat, frames });
      materials.set(key, mat);
      return mat;
    }
    const idx = Number(idxStr);
    const entry = kind === 'floor' ? level.floorTextures[idx] : level.wallTextures[idx];
    const glass = kind === 'glass';
    const tex = entry && (glass ? await textures.sprite(entry.file) : await textures.tile(entry.file, entry.frame));
    const mat = new THREE.MeshBasicMaterial({
      map: tex ?? null,
      color: tex ? 0xffffff : 0x555555,
      side: THREE.DoubleSide,
      alphaTest: glass ? 0.5 : 0,
      transparent: false,
    });
    materials.set(key, mat);
    return mat;
  };

  for (const [key, batch] of geo.batches) {
    group.add(new THREE.Mesh(toGeometry(batch), await material(key)));
  }

  const doors = new Map<number, DoorMesh>();
  for (const d of geo.doors) {
    const mesh = new THREE.Mesh(toGeometry(d.batch), await material(d.key));
    group.add(mesh);
    doors.set(d.cellIndex, { mesh, openAmount: 0, target: 0 });
  }

  const skippedFlats: string[] = [];
  const billboards: THREE.Mesh[] = [];
  const plane = new THREE.PlaneGeometry(1, 1);
  const flatSprite = async (flat: LevelFlat): Promise<THREE.Mesh | undefined> => {
    const tex = flat.name.endsWith('.IMG') ? await textures.sprite(flat.name) : undefined;
    if (!tex) {
      skippedFlats.push(flat.name);
      return undefined;
    }
    const img = tex.image as { width: number; height: number };
    const sprite = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
    // Things hung from the ceiling may reach through it; the ceiling hides the rest.
    placeSprite(sprite, flat.x, flat.y, img.width, img.height, (flat.base ?? 0) * level.height + liftFor(flat.yOffset));
    group.add(sprite);
    billboards.push(sprite);
    return sprite;
  };
  for (const flat of level.flats) await flatSprite(flat);
  const items: Array<THREE.Mesh | undefined> = [];
  for (const item of level.items) items.push(await flatSprite(item));

  const animate = (seconds: number) => {
    for (const a of animated) a.mat.map = a.frames[Math.floor(seconds * 6) % a.frames.length];
  };

  return { group, doors, billboards, items, material, animate, skippedFlats };
}
