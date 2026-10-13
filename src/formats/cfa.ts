/**
 * CFA animation reader: creatures, people and effects, one view angle or
 * one action per file, every frame the same size.
 *
 * Header, little-endian:
 *   0x00 u16 width, u16 height, u16 bytes per packed row
 *   0x06 u16 x, u16 y: screen placement, used by first-person sprites
 *   0x0A u8 bits per pixel, u8 frame count
 *   0x0C u16 offset of each frame's data (room for 31)
 *   0x4A u16 file size
 *   0x4C colour table: the palette index for each packed value, up to the
 *        first frame
 * Each frame is run-length coded: a count byte with the high bit set
 * repeats the next byte (count & 0x7F) + 1 times, otherwise the next
 * count + 1 bytes are copied. The result is rows of bit-packed colour table
 * values, most significant bit first. At 8 bits per pixel the bytes are
 * direct palette indices, with no lookup table. Palette index 0 is transparent.
 */

export interface CfaFile {
  width: number;
  height: number;
  /** Screen placement for first-person sprites; unused by creatures. */
  x: number;
  y: number;
  /** Palette indices, row-major, one array per frame; 0 is transparent. */
  frames: Uint8Array[];
}

const OFFSETS = 0x0c;
const TABLE = 0x4c;

export function parseCfa(data: Uint8Array): CfaFile {
  if (data.length < TABLE) throw new Error('CFA: file is too small');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const rowBytes = view.getUint16(4, true);
  const x = view.getUint16(6, true);
  const y = view.getUint16(8, true);
  const bpp = data[10];
  const count = data[11];
  if (!width || !height || width > 1024 || height > 1024) throw new Error(`CFA: implausible size ${width}x${height}`);
  if (bpp < 1 || bpp > 8 || rowBytes * 8 < width * bpp) throw new Error('CFA: bad pixel packing');
  if (count < 1 || count > 31) throw new Error(`CFA: bad frame count ${count}`);

  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(view.getUint16(OFFSETS + i * 2, true));
  const end = Math.min(data.length, view.getUint16(0x4a, true) || data.length);
  if (offsets[0] < TABLE || offsets.some((o, i) => o > end || (i > 0 && o < offsets[i - 1]))) {
    throw new Error('CFA: frame offsets are out of order');
  }
  const table = data.subarray(TABLE, offsets[0]);

  const frames = offsets.map((start, f) => {
    const packed = unRle(data.subarray(start, f + 1 < count ? offsets[f + 1] : end), rowBytes * height);
    const pixels = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) {
      let bit = row * rowBytes * 8;
      for (let col = 0; col < width; col++) {
        let v = 0;
        for (let b = 0; b < bpp; b++, bit++) v = (v << 1) | ((packed[bit >> 3] >> (7 - (bit & 7))) & 1);
        pixels[row * width + col] = bpp === 8 ? v : (v ? (table[v] ?? 0) : 0);
      }
    }
    return pixels;
  });
  return { width, height, x, y, frames };
}

function unRle(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (o < size && i < src.length) {
    const n = src[i++];
    if (n & 0x80) {
      const v = src[i++];
      for (let k = (n & 0x7f) + 1; k > 0 && o < size; k--) out[o++] = v;
    } else {
      for (let k = n + 1; k > 0 && o < size && i < src.length; k--) out[o++] = src[i++];
    }
  }
  return out;
}
