/**
 * DFA: Arena's animated decorations (braziers, candles, altars). A 12-byte
 * header (u16 frame count, two u16 unknown, u16 width, u16 height, u16
 * length of the first frame), the first frame compressed as IMG's RLE, then
 * for each later frame a u16 size and u16 count of patches, each a u16
 * offset, a u16 length and that many palette indices written over a copy of
 * the first frame. As OpenTESArena's DFAFile reads it.
 */
import { decodeRle, type IndexedImage } from './img';

export function parseDfa(data: Uint8Array): IndexedImage[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12) throw new Error('DFA: file is too small');
  const count = view.getUint16(0, true);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const firstLength = view.getUint16(10, true);
  if (!count || !width || !height || width > 1024 || height > 1024) throw new Error(`DFA: implausible size ${width}x${height}`);
  const first = decodeRle(data.subarray(12, 12 + firstLength), width * height);
  const frames: IndexedImage[] = [{ width, height, xOffset: 0, yOffset: 0, pixels: first }];
  let p = 12 + firstLength;
  for (let f = 1; f < count && p + 4 <= data.length; f++) {
    const pixels = first.slice();
    const patches = view.getUint16(p + 2, true);
    p += 4;
    for (let i = 0; i < patches && p + 4 <= data.length; i++) {
      const at = view.getUint16(p, true);
      const length = view.getUint16(p + 2, true);
      p += 4;
      pixels.set(data.subarray(p, p + Math.min(length, pixels.length - at)), at);
      p += length;
    }
    frames.push({ width, height, xOffset: 0, yOffset: 0, pixels });
  }
  return frames;
}
