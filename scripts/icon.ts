/**
 * Draws the desktop app's icon (build/icon.png): a pixel-art dungeon corridor
 * fading to black, with a lit doorway at the end, in a gilt frame. Everything
 * is generated here; no game art is used.
 *
 *   npx tsx scripts/icon.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { png } from './png';

const SIZE = 1024;
const CELL = 16; // one art pixel, in icon pixels
const GRID = SIZE / CELL;
// macOS icon grid: an 824 px rounded square centred on the canvas.
const HALF = 412;
const RADIUS = 185;

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i] - v) * t) as RGB;
const scale = (c: RGB, k: number): RGB => c.map((v) => v * k) as RGB;
const add = (a: RGB, b: RGB): RGB => a.map((v, i) => v + b[i]) as RGB;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const frac = (x: number) => x - Math.floor(x);
/** Stable pseudo-random value in [0, 1) for a pair of integers. */
const hash = (a: number, b: number) => frac(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

const STONE = hex('#7a6850');
const MORTAR = hex('#2a231b');
const FLAG = hex('#5d5040');
const BEAM = hex('#4a3522');
const PLANK = hex('#2e2117');
const GLOW_IN = hex('#ffe3a0');
const GLOW_OUT = hex('#d0731f');
const TORCH = hex('#ff9a3c');
const NIGHT = hex('#0b0a08');
const FRAME = hex('#3b2c1b');
const GILT = hex('#c9a24a');

const DOOR_DEPTH = 4.5;
const FOG_START = 1;
const FOG_END = 6.5;

/** Bricks on (along, up) wall coordinates. */
function brick(along: number, up: number, side: number): RGB {
  const row = Math.floor(up / 0.4);
  const x = along / 0.8 + (row % 2 ? 0.5 : 0);
  const col = Math.floor(x);
  if (frac(up / 0.4) < 0.12 || frac(x) < 0.07) return MORTAR;
  return scale(STONE, 0.8 + 0.35 * hash(col + side * 97, row));
}

/** One art pixel; (u, v) runs from -1 to 1 across the rounded square. */
function corridor(u: number, v: number): RGB {
  const au = Math.abs(u);
  const av = Math.abs(v);
  let depth: number;
  let color: RGB;
  if (Math.max(au, av) * DOOR_DEPTH < 1) {
    // The far wall, with an arched doorway full of light.
    depth = DOOR_DEPTH;
    const x = u * DOOR_DEPTH;
    const y = v * DOOR_DEPTH;
    const inArch = Math.abs(x) < 0.6 && (y > -0.15 || x * x + (y + 0.15) ** 2 < 0.36);
    if (inArch) return mix(GLOW_IN, GLOW_OUT, clamp(Math.hypot(x, y - 0.7) / 1.3));
    color = brick(x, y, 2);
  } else if (au > av) {
    depth = 1 / au;
    color = brick(depth, v * depth, u < 0 ? 0 : 1);
  } else if (v > 0) {
    depth = 1 / av;
    const s = u * depth;
    color = frac(s / 0.7 + 0.5) < 0.08 || frac(depth / 0.7) < 0.08 ? MORTAR : scale(FLAG, 0.85 + 0.3 * hash(Math.floor(s / 0.7 + 0.5), Math.floor(depth / 0.7)));
  } else {
    depth = 1 / av;
    color = frac(depth / 0.9) < 0.3 ? BEAM : PLANK;
  }
  // Arena's dungeons fade to black with distance; light from the doorway warms what is near it.
  const light = clamp((FOG_END - depth) / (FOG_END - FOG_START));
  const banded = Math.round(light * 6) / 6;
  const warmth = Math.exp(-(DOOR_DEPTH - depth) * 1.1) * 0.35;
  return add(scale(color, banded), scale(TORCH, warmth * (0.4 + 0.6 * banded)));
}

/** Signed distance to the rounded square's edge, negative inside. */
function edgeDistance(x: number, y: number): number {
  const qx = Math.abs(x - SIZE / 2) - (HALF - RADIUS);
  const qy = Math.abs(y - SIZE / 2) - (HALF - RADIUS);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
}

const art: RGB[] = [];
for (let gy = 0; gy < GRID; gy++) {
  for (let gx = 0; gx < GRID; gx++) {
    const u = ((gx + 0.5) * CELL - SIZE / 2) / (HALF - 40);
    const v = ((gy + 0.5) * CELL - SIZE / 2) / (HALF - 40);
    art.push(corridor(u, v));
  }
}

const rgba = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = edgeDistance(x + 0.5, y + 0.5);
    // Frame bands from the outside in, blended over a pixel for smooth edges.
    let c = art[Math.floor(y / CELL) * GRID + Math.floor(x / CELL)];
    c = mix(c, NIGHT, clamp(d + 40.5));
    c = mix(c, GILT, clamp(d + 30.5));
    c = mix(c, FRAME, clamp(d + 20.5));
    const i = (y * SIZE + x) * 4;
    rgba.set([...c.map((v) => Math.round(clamp(v, 0, 255))), Math.round(clamp(0.5 - d) * 255)], i);
  }
}

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png(SIZE, SIZE, rgba));
console.log('Wrote build/icon.png');
