/**
 * The room drawn behind the menu before any game files are loaded. Its
 * textures are generated here, so it contains nothing from the original game.
 */
import type * as THREE from 'three';
import type { Cell, Level } from '../game/level';
import type { TextureProvider } from './levelScene';
import { rgbaTexture } from './textures';

const SIZE = 64;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Shade = (x: number, y: number, rand: () => number) => [number, number, number];

function paint(seed: number, shade: Shade): Uint8Array {
  const rand = rng(seed);
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = shade(x, y, rand);
      const i = (y * SIZE + x) * 4;
      out[i] = Math.max(0, Math.min(255, r));
      out[i + 1] = Math.max(0, Math.min(255, g));
      out[i + 2] = Math.max(0, Math.min(255, b));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Per-block brightness so bricks and flagstones vary like hand-placed stone. */
function blockTone(seed: number, bx: number, by: number): number {
  return rng(seed * 977 + bx * 131 + by * 71)() * 30 - 15;
}

const PATTERNS: Record<string, () => Uint8Array> = {
  WALL: () =>
    paint(1, (x, y, rand) => {
      const row = Math.floor(y / 16);
      const ox = (x + (row % 2) * 16) % SIZE;
      const mortar = y % 16 === 0 || ox % 32 === 0;
      const n = rand() * 26 - 13;
      if (mortar) return [38 + n / 2, 40 + n / 2, 38 + n / 2];
      const t = blockTone(1, Math.floor(ox / 32), row) + n;
      const edge = y % 16 === 1 || ox % 32 === 1 ? 18 : 0;
      return [96 + t + edge, 104 + t + edge, 100 + t + edge];
    }),
  FLOOR: () =>
    paint(2, (x, y, rand) => {
      const joint = x % 32 === 0 || y % 32 === 0;
      const n = rand() * 22 - 11;
      if (joint) return [40 + n / 2, 30 + n / 2, 22 + n / 2];
      const t = blockTone(2, Math.floor(x / 32), Math.floor(y / 32)) + n;
      return [110 + t, 86 + t, 62 + t];
    }),
  CEILING: () =>
    paint(3, (x, y, rand) => {
      const seam = x % 16 === 0;
      const grain = Math.sin((y + Math.floor(x / 16) * 13) * 0.5) * 6;
      const n = rand() * 12 - 6;
      if (seam) return [28, 20, 14];
      const t = blockTone(3, Math.floor(x / 16), 0) + grain + n;
      return [78 + t, 56 + t, 38 + t];
    }),
  DOOR: () =>
    paint(4, (x, y, rand) => {
      const band = (y >= 10 && y < 14) || (y >= 50 && y < 54);
      const n = rand() * 14 - 7;
      if (band) return [60 + n, 62 + n, 66 + n];
      if (x % 13 === 0) return [36, 24, 14];
      const t = blockTone(4, Math.floor(x / 13), 0) + Math.sin(y * 0.4 + x) * 4 + n;
      return [104 + t, 70 + t, 40 + t];
    }),
  WATERSIDE: () =>
    paint(5, (_x, y, rand) => {
      const n = rand() * 16 - 8;
      const wet = y > 40 ? 20 : 0;
      return [52 + n - wet, 64 + n - wet / 2, 70 + n];
    }),
};

function waterFrames(): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let f = 0; f < 5; f++) {
    const phase = (f / 5) * Math.PI * 2;
    frames.push(
      paint(10 + f, (x, y, rand) => {
        const w =
          Math.sin((x / SIZE) * Math.PI * 4 + phase) * Math.cos((y / SIZE) * Math.PI * 2 - phase) * 18 +
          Math.sin(((x + y) / SIZE) * Math.PI * 6 + phase) * 8;
        const n = rand() * 8 - 4;
        return [20 + w / 3 + n, 52 + w / 2 + n, 84 + w + n];
      }),
    );
  }
  return frames;
}

class BackdropTextures implements TextureProvider {
  async tile(file: string): Promise<THREE.DataTexture | undefined> {
    const make = PATTERNS[file];
    return make && rgbaTexture(make(), SIZE, SIZE, true);
  }
  async sprite(): Promise<THREE.DataTexture | undefined> {
    return undefined;
  }
  async liquid(): Promise<THREE.DataTexture[]> {
    return waterFrames().map((f) => rgbaTexture(f, SIZE, SIZE, true));
  }
}

/**
 * A 13x13 hall: four pillars, a raised dais, doors north and south, and a
 * water channel along the south side.
 */
export function backdropLevel(): { level: Level; textures: TextureProvider } {
  const W = 13;
  const cells: Cell[] = [];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === W - 1;
      const pillar = (x === 3 || x === 9) && (y === 3 || y === 8);
      const cell: Cell = { kind: 'empty', wallTex: 0, floorTex: 0 };
      if (x === 6 && (y === 0 || y === W - 1)) {
        cell.kind = 'door';
        cell.wallTex = 1;
      } else if (edge || pillar) {
        cell.kind = 'wall';
      } else if (y === 2 && x >= 5 && x <= 7) {
        Object.assign(cell, { kind: 'raised', raisedHeight: 0.22, capTex: 0, capIsWall: false });
      } else if (y >= 10 && x >= 2 && x <= 10) {
        cell.chasm = 'wet';
      }
      cells.push(cell);
    }
  }
  const level: Level = {
    name: 'Backdrop',
    width: W,
    depth: W,
    height: 1,
    cells,
    wallTextures: [
      { file: 'WALL', frame: 0 },
      { file: 'DOOR', frame: 0 },
      { file: 'WATERSIDE', frame: 0 },
    ],
    floorTextures: [
      { file: 'FLOOR', frame: 0 },
      { file: 'CEILING', frame: 0 },
    ],
    chasmTextures: { wet: 2 },
    ceilingTex: 1,
    flats: [],
    triggers: [],
    start: { x: 6.5, y: 6.5 },
  };
  return { level, textures: new BackdropTextures() };
}
