import * as THREE from 'three';
import type { GameData } from '../data/files';
import { crop, parseImg, parseRci, parseSet, RCI_HEIGHT, RCI_WIDTH, TILE, type IndexedImage } from '../formats/img';
import { indicesToRgba, parseCol, type Palette } from '../formats/palette';

/** Loads Arena images from the player's data and caches them as Three.js textures. */
export class TextureCache {
  private cache = new Map<string, Promise<THREE.DataTexture | undefined>>();
  private animCache = new Map<string, Promise<THREE.DataTexture[]>>();

  constructor(private readonly data: GameData, private readonly palette: Palette) {}

  /** A 64x64 wall/floor tile: frame n of a SET, or a single IMG. */
  tile(file: string, frame = 0): Promise<THREE.DataTexture | undefined> {
    return this.load(`${file}#${frame}`, async () => {
      const bytes = await this.data.read(file);
      const img = file.endsWith('.SET') ? parseSet(bytes)[frame] : parseImg(bytes);
      return img && toTexture(img, this.palette, true);
    });
  }

  /** A sprite with transparency (palette index 0). */
  sprite(file: string): Promise<THREE.DataTexture | undefined> {
    return this.load(file, async () => toTexture(parseImg(await this.data.read(file)), this.palette, true, true));
  }

  /**
   * Animated liquid frames from WATERANI.RCI / LAVAANI.RCI. Arena draws these
   * in screen space; we cut a 64x64 tile from the near (bottom) part of each
   * frame and tile it across the surface. Empty when the file is missing.
   */
  liquid(file: string): Promise<THREE.DataTexture[]> {
    let p = this.animCache.get(file);
    if (!p) {
      p = (async () => {
        if (!this.data.has(file)) return [];
        const frames = parseRci(await this.data.read(file));
        const x = (RCI_WIDTH - TILE) / 2;
        return frames.map((f) => toTexture(crop(f, x, RCI_HEIGHT - TILE, TILE, TILE), this.palette, true));
      })().catch((err) => {
        console.warn(`Could not load ${file}:`, err);
        return [];
      });
      this.animCache.set(file, p);
    }
    return p;
  }

  private load(key: string, make: () => Promise<THREE.DataTexture | undefined>) {
    let p = this.cache.get(key);
    if (!p) {
      p = make().catch((err) => {
        console.warn(`Could not load ${key}:`, err);
        return undefined;
      });
      this.cache.set(key, p);
    }
    return p;
  }
}

export function toTexture(img: IndexedImage, palette: Palette, repeat: boolean, transparentZero = false): THREE.DataTexture {
  const pal = img.palette ? parseCol(img.palette) : palette;
  return rgbaTexture(indicesToRgba(img.pixels, pal, transparentZero), img.width, img.height, repeat);
}

/** Wraps top-row-first RGBA pixels in a nearest-filtered texture. */
export function rgbaTexture(rgba: Uint8Array, width: number, height: number, repeat: boolean): THREE.DataTexture {
  // Arena images are stored top row first; WebGL wants the bottom row first.
  const flipped = new Uint8Array(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(rgba.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  const tex = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
