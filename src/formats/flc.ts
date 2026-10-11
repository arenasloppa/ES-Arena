/**
 * FLC and CEL: Autodesk Animator animations, Arena's cutscenes (INTRO.FLC,
 * SCROLL.FLC, VISION.FLC ...). A CEL is an FLC with a prefix chunk first.
 *
 * A 128-byte header (u32 size, u16 type 0xAF12, u16 frames, u16 width,
 * u16 height, u16 depth, u16 flags, u32 milliseconds per frame, ...), then
 * frames: u32 size, u16 type (0xF1FA a frame, 0xF100 a CEL's prefix to
 * skip), u16 chunk count, 8 reserved bytes, then the chunks: u32 size, u16
 * type and the data. The chunk types used:
 *    4  palette, 8-bit values: packets of (skip, count (0 = 256), RGB...)
 *   11  palette, 6-bit values, the same way
 *    7  delta (FLC): lines of word packets
 *   12  delta (FLI): byte packets
 *   13  black frame
 *   15  byte run: a whole frame, compressed
 *   16  a whole frame, uncompressed
 * As in the FLIC format's documentation, and as OpenTESArena reads Arena's.
 * The last frame of Arena's animations leads back into the first, so it is
 * left out.
 */

export interface FlcFrame {
  /** Palette indices, row by row. */
  pixels: Uint8Array;
  /** 256 RGB triples. */
  palette: Uint8Array;
}

export interface Flc {
  width: number;
  height: number;
  /** Milliseconds each frame shows. */
  frameMs: number;
  frames: FlcFrame[];
}

export class FlcFormatError extends Error {}

const FLC_TYPE = 0xaf12;
const FLI_TYPE = 0xaf11;
const FRAME = 0xf1fa;
const PREFIX = 0xf100;

export function parseFlc(bytes: Uint8Array): Flc {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128) throw new FlcFormatError('too short for an FLC header');
  const type = view.getUint16(4, true);
  if (type !== FLC_TYPE && type !== FLI_TYPE) throw new FlcFormatError(`not an FLC animation (type 0x${type.toString(16)})`);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  // FLI counts in 1/70 seconds, FLC in milliseconds.
  const speed = view.getUint32(16, true);
  const frameMs = type === FLI_TYPE ? (speed * 1000) / 70 : speed || 70;
  const pixels = new Uint8Array(width * height);
  const palette = new Uint8Array(768);
  const frames: FlcFrame[] = [];

  for (let p = 128; p + 16 <= bytes.length; ) {
    const size = view.getUint32(p, true);
    const kind = view.getUint16(p + 4, true);
    if (size < 16 || p + size > bytes.length + 16) break;
    if (kind === FRAME) {
      const chunks = view.getUint16(p + 6, true);
      let c = p + 16;
      let drew = false;
      for (let i = 0; i < chunks && c + 6 <= p + size; i++) {
        const chunkSize = view.getUint32(c, true);
        const chunkType = view.getUint16(c + 4, true);
        const data = c + 6;
        switch (chunkType) {
          case 4:
          case 11:
            readPalette(bytes, view, data, palette, chunkType === 11);
            break;
          case 7:
            deltaFlc(bytes, view, data, pixels, width, height);
            drew = true;
            break;
          case 12:
            deltaFli(bytes, view, data, pixels, width);
            drew = true;
            break;
          case 13:
            pixels.fill(0);
            drew = true;
            break;
          case 15:
            byteRun(bytes, data, pixels, width, height);
            drew = true;
            break;
          case 16:
            pixels.set(bytes.subarray(data, data + width * height));
            drew = true;
            break;
        }
        if (chunkSize < 6) break;
        c += chunkSize;
      }
      // A frame of only a palette change still shows: keep every frame.
      if (drew || chunks > 0 || frames.length) frames.push({ pixels: pixels.slice(), palette: palette.slice() });
    } else if (kind !== PREFIX) break;
    p += size;
  }
  if (frames.length > 1) frames.pop();
  return { width, height, frameMs, frames };
}

function readPalette(bytes: Uint8Array, view: DataView, at: number, palette: Uint8Array, sixBit: boolean): void {
  const packets = view.getUint16(at, true);
  let p = at + 2;
  let index = 0;
  for (let i = 0; i < packets; i++) {
    index += bytes[p++];
    const count = bytes[p++] || 256;
    for (let j = 0; j < count && index < 256; j++, index++) {
      for (let k = 0; k < 3; k++) {
        const v = bytes[p++];
        palette[index * 3 + k] = sixBit ? (v << 2) | (v >> 4) : v;
      }
    }
  }
}

/** A whole frame, each line a packet count then packets: n > 0 repeats a byte n times, n < 0 copies -n bytes. */
function byteRun(bytes: Uint8Array, at: number, pixels: Uint8Array, width: number, height: number): void {
  let p = at;
  for (let y = 0; y < height; y++) {
    p++; // the packet count, unreliable for wide frames
    let x = 0;
    const row = y * width;
    while (x < width) {
      const n = (bytes[p++] << 24) >> 24;
      if (n > 0) {
        const v = bytes[p++];
        pixels.fill(v, row + x, row + Math.min(width, x + n));
        x += n;
      } else if (n < 0) {
        const count = Math.min(-n, width - x);
        pixels.set(bytes.subarray(p, p + count), row + x);
        p += -n;
        x += -n;
      } else break;
    }
  }
}

/** FLC delta: per line, word opcodes (skip lines, set the last pixel, or a packet count), then packets of (skip, n): n > 0 copies n words, n < 0 repeats a word -n times. */
function deltaFlc(bytes: Uint8Array, view: DataView, at: number, pixels: Uint8Array, width: number, height: number): void {
  const lines = view.getUint16(at, true);
  let p = at + 2;
  let y = 0;
  for (let line = 0; line < lines && y < height; line++) {
    let packets = 0;
    for (;;) {
      const word = view.getUint16(p, true);
      p += 2;
      if ((word & 0xc000) === 0xc000) y += 0x10000 - word; // skip lines
      else if (word & 0x8000) pixels[y * width + width - 1] = word & 0xff;
      else {
        packets = word;
        break;
      }
    }
    if (y >= height) break;
    let x = 0;
    const row = y * width;
    for (let i = 0; i < packets; i++) {
      x += bytes[p++];
      const n = (bytes[p++] << 24) >> 24;
      if (n > 0) {
        for (let j = 0; j < n * 2; j++, x++) if (x < width) pixels[row + x] = bytes[p + j];
        p += n * 2;
      } else if (n < 0) {
        const a = bytes[p];
        const b = bytes[p + 1];
        p += 2;
        for (let j = 0; j < -n; j++) {
          if (x < width) pixels[row + x] = a;
          x++;
          if (x < width) pixels[row + x] = b;
          x++;
        }
      }
    }
    y++;
  }
}

/** FLI delta: first line and line count, then per line packets of (skip, n): n > 0 copies n bytes, n < 0 repeats a byte -n times. */
function deltaFli(bytes: Uint8Array, view: DataView, at: number, pixels: Uint8Array, width: number): void {
  const first = view.getUint16(at, true);
  const lines = view.getUint16(at + 2, true);
  let p = at + 4;
  for (let y = first; y < first + lines; y++) {
    const packets = bytes[p++];
    let x = 0;
    const row = y * width;
    for (let i = 0; i < packets; i++) {
      x += bytes[p++];
      const n = (bytes[p++] << 24) >> 24;
      if (n > 0) {
        pixels.set(bytes.subarray(p, p + Math.min(n, width - x)), row + x);
        p += n;
        x += n;
      } else if (n < 0) {
        pixels.fill(bytes[p++], row + x, row + Math.min(width, x - n));
        x -= n;
      }
    }
  }
}
