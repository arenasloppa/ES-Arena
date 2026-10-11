import { parseDfa } from '../formats/dfa';
import * as THREE from 'three';
import type { GameData } from '../data/files';
import { parseCfa } from '../formats/cfa';
import { parseCif } from '../formats/cif';
import { crop, parseImg, parseRci, parseSet, RCI_HEIGHT, RCI_WIDTH, TILE, type IndexedImage } from '../formats/img';
import { indicesToRgba, parseCol, type Palette } from '../formats/palette';

/** One animation file: its frame size and a texture per frame. */
export interface SpriteFile {
  width: number;
  height: number;
  frames: THREE.DataTexture[];
}

/** A creature's look: five views from the front round to the back (STEM1.CFA to STEM5.CFA), and its death (STEM6.CFA). */
export interface CreatureSprite {
  views: SpriteFile[];
  death: SpriteFile;
}

/** An image drawn straight onto the screen, placed on Arena's 320x147 game view. */
export interface ScreenImage {
  x: number;
  y: number;
  image: HTMLCanvasElement;
}

/** Loads Arena images from the player's data and caches them as Three.js textures. */
export class TextureCache {
  private cache = new Map<string, Promise<THREE.DataTexture | undefined>>();
  private animCache = new Map<string, Promise<THREE.DataTexture[]>>();
  private creatureCache = new Map<string, Promise<CreatureSprite | undefined>>();
  private screenCache = new Map<string, Promise<ScreenImage[]>>();

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

  /** Every frame of an animated decoration (DFA), with transparency; empty when it can't be read. */
  spriteFrames(file: string): Promise<THREE.DataTexture[]> {
    let p = this.animCache.get(file);
    if (!p) {
      p = (async () => parseDfa(await this.data.read(file)).map((img) => toTexture(img, this.palette, true, true)))().catch((err) => {
        console.warn(`Could not load ${file}:`, err);
        return [];
      });
      this.animCache.set(file, p);
    }
    return p;
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

  /** A creature's six animation files, or undefined when any is missing or unreadable. */
  creature(stem: string): Promise<CreatureSprite | undefined> {
    let p = this.creatureCache.get(stem);
    if (!p) {
      p = (async () => {
        const files = await Promise.all(
          [1, 2, 3, 4, 5, 6].map(async (n) => {
            const cfa = parseCfa(await this.data.read(`${stem}${n}.CFA`));
            const frames = cfa.frames.map((pixels) =>
              toTexture({ width: cfa.width, height: cfa.height, xOffset: 0, yOffset: 0, pixels }, this.palette, false, true),
            );
            return { width: cfa.width, height: cfa.height, frames };
          }),
        );
        return { views: files.slice(0, 5), death: files[5] };
      })().catch((err) => {
        console.warn(`Could not load the ${stem} animations:`, err);
        return undefined;
      });
      this.creatureCache.set(stem, p);
    }
    return p;
  }

  /** The frames of a CIF, such as a first-person weapon, ready to draw on a 2D canvas. Empty when missing. */
  screenImages(file: string): Promise<ScreenImage[]> {
    let p = this.screenCache.get(file);
    if (!p) {
      p = (async () =>
        parseCif(await this.data.read(file)).map((img) => {
          const rgba = indicesToRgba(img.pixels, img.palette ? parseCol(img.palette) : this.palette, true);
          return { x: img.xOffset, y: img.yOffset, image: toCanvas(img.width, img.height, rgba) };
        }))().catch((err) => {
        console.warn(`Could not load ${file}:`, err);
        return [];
      });
      this.screenCache.set(file, p);
    }
    return p;
  }

  /**
   * The frames of a first-person CFA animation, such as the blood splash,
   * ready to draw on a 2D canvas at the place the file gives. Empty when missing.
   */
  screenAnimation(file: string): Promise<ScreenImage[]> {
    let p = this.screenCache.get(file);
    if (!p) {
      p = (async () => {
        if (!this.data.has(file)) return [];
        const cfa = parseCfa(await this.data.read(file));
        return cfa.frames.map((pixels) => ({
          x: cfa.x,
          y: cfa.y,
          image: toCanvas(cfa.width, cfa.height, indicesToRgba(pixels, this.palette, true)),
        }));
      })().catch((err) => {
        console.warn(`Could not load ${file}:`, err);
        return [];
      });
      this.screenCache.set(file, p);
    }
    return p;
  }

  /** Frees every texture loaded so far, once the map using them is gone. */
  dispose(): void {
    const free = (t: THREE.Texture | undefined) => t?.dispose();
    for (const p of this.cache.values()) void p.then(free);
    for (const p of this.animCache.values()) void p.then((frames) => frames.forEach(free));
    for (const p of this.creatureCache.values()) {
      void p.then((sprite) => sprite && [...sprite.views, sprite.death].forEach((f) => f.frames.forEach(free)));
    }
    this.cache.clear();
    this.animCache.clear();
    this.creatureCache.clear();
    this.screenCache.clear();
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

function toCanvas(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = new ImageData(width, height);
  pixels.data.set(rgba);
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  return canvas;
}
