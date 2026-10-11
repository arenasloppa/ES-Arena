/**
 * IMG and SET image readers.
 *
 * Most IMGs have a 12-byte header: i16 x offset, i16 y offset, u16 width,
 * u16 height, u16 flags, u16 data length. Flag bits 0x04 and 0x08 select
 * LZSS (type 04) or LZHUF (type 08, data prefixed with a u16 size)
 * compression, and 0x0100 means a 768-byte palette follows the pixels.
 *
 * Wall and floor textures are headerless: an IMG of exactly 4096 bytes is
 * one 64x64 tile, and a SET is several 64x64 tiles back to back.
 */
import { decodeType04, decodeType08 } from './compression';

export interface IndexedImage {
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  /** One palette index per pixel, row-major. */
  pixels: Uint8Array;
  /** Present when the file carries its own palette (raw 768-byte RGB). */
  palette?: Uint8Array;
}

export const TILE = 64;
const TILE_BYTES = TILE * TILE;

export function isRawTile(data: Uint8Array): boolean {
  return data.length === TILE_BYTES;
}

export function parseImg(data: Uint8Array): IndexedImage {
  if (isRawTile(data)) return { width: TILE, height: TILE, xOffset: 0, yOffset: 0, pixels: data.slice() };
  if (data.length < 12) throw new Error('IMG: file is too small');

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const xOffset = view.getInt16(0, true);
  const yOffset = view.getInt16(2, true);
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  const flags = view.getUint16(8, true);
  const length = view.getUint16(10, true);
  const size = width * height;
  if (size === 0 || width > 1024 || height > 1024) throw new Error(`IMG: implausible size ${width}x${height}`);
  if (12 + length > data.length) throw new Error('IMG: data length runs past end of file');

  const body = data.subarray(12, 12 + length);
  let pixels: Uint8Array;
  if (flags & 0x08) {
    const decompressed = view.getUint16(12, true);
    pixels = decodeType08(data.subarray(14, 12 + length), Math.max(decompressed, size)).subarray(0, size);
  } else if (flags & 0x04) {
    pixels = decodeType04(body, size);
  } else if (flags & 0x02) {
    pixels = decodeRle(body, size);
  } else {
    if (body.length < size) throw new Error('IMG: pixel data is truncated');
    pixels = body.slice(0, size);
  }

  const img: IndexedImage = { width, height, xOffset, yOffset, pixels };
  if (flags & 0x0100 && data.length >= 12 + length + 768) img.palette = data.slice(12 + length, 12 + length + 768);
  return img;
}

/** Splits a SET (or a raw tile) into 64x64 frames. */
export function parseSet(data: Uint8Array): IndexedImage[] {
  if (data.length % TILE_BYTES !== 0) throw new Error(`SET: size ${data.length} is not a multiple of 4096`);
  const frames: IndexedImage[] = [];
  for (let o = 0; o < data.length; o += TILE_BYTES) {
    frames.push({ width: TILE, height: TILE, xOffset: 0, yOffset: 0, pixels: data.slice(o, o + TILE_BYTES) });
  }
  return frames;
}

/** Simple byte RLE: a control byte < 0x80 copies n+1 literals, otherwise repeats the next byte (n & 0x7F)+1 times. */
export function decodeRle(src: Uint8Array, outLength: number): Uint8Array {
  const out = new Uint8Array(outLength);
  let s = 0;
  let d = 0;
  while (d < outLength && s < src.length) {
    const c = src[s++];
    if (c & 0x80) {
      const n = (c & 0x7f) + 1;
      const v = src[s++];
      for (let k = 0; k < n && d < outLength; k++) out[d++] = v;
    } else {
      for (let k = 0; k <= c && d < outLength && s < src.length; k++) out[d++] = src[s++];
    }
  }
  return out;
}

/** RCI animations (WATERANI.RCI, LAVAANI.RCI): headerless 320x100 frames back to back. */
export const RCI_WIDTH = 320;
export const RCI_HEIGHT = 100;

export function parseRci(data: Uint8Array): IndexedImage[] {
  const frameBytes = RCI_WIDTH * RCI_HEIGHT;
  if (data.length === 0 || data.length % frameBytes !== 0) throw new Error(`RCI: size ${data.length} is not a multiple of ${frameBytes}`);
  const frames: IndexedImage[] = [];
  for (let o = 0; o < data.length; o += frameBytes) {
    frames.push({ width: RCI_WIDTH, height: RCI_HEIGHT, xOffset: 0, yOffset: 0, pixels: data.slice(o, o + frameBytes) });
  }
  return frames;
}

/** Copies a rectangle out of an image (e.g. a 64x64 tile from an RCI frame). */
export function crop(img: IndexedImage, x: number, y: number, width: number, height: number): IndexedImage {
  const pixels = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) pixels.set(img.pixels.subarray((y + row) * img.width + x, (y + row) * img.width + x + width), row * width);
  return { width, height, xOffset: 0, yOffset: 0, pixels };
}
