/**
 * MIF map reader.
 *
 * A MIF is a list of tagged chunks: 4 ASCII bytes + u16 payload size.
 * "MHDR" holds the start points and map size; each "LEVL" chunk opens a level
 * and is followed by its own chunks (NAME, INFO, MAP1, MAP2, FLOR, ...).
 * MAP1 (walls/objects), MAP2 (second storey) and FLOR (floors) are
 * u16-per-voxel grids, stored as a u16 uncompressed size followed by
 * LZHUF ("type 08") data.
 */
import { decodeType08 } from './compression';
import { readFixedString } from './bsa';

/** Arena measures positions in units of 1/128 voxel. */
export const ARENA_UNITS = 128;

export interface MifTrigger {
  x: number;
  y: number;
  textIndex: number;
  soundIndex: number;
}

export interface MifLevel {
  name: string;
  /** INF file this level uses, upper-cased (e.g. "START.INF"). */
  info: string;
  numFloors: number;
  map1: Uint16Array;
  map2?: Uint16Array;
  flor: Uint16Array;
  triggers: MifTrigger[];
}

export interface MifFile {
  width: number;
  depth: number;
  startingLevelIndex: number;
  /** Start points in voxel coordinates (fractional; .5 is a voxel centre). */
  startPoints: Array<{ x: number; y: number }>;
  levels: MifLevel[];
}

export function parseMif(data: Uint8Array): MifFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (o: number) => String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);

  if (tag(0) !== 'MHDR') throw new Error('MIF: missing MHDR');
  const headerSize = view.getUint16(4, true);
  const h = 6;
  const startPoints: MifFile['startPoints'] = [];
  for (let i = 0; i < 4; i++) {
    const x = view.getUint16(h + 2 + i * 2, true);
    const y = view.getUint16(h + 10 + i * 2, true);
    if (x !== 0 || y !== 0) startPoints.push({ x: x / ARENA_UNITS, y: y / ARENA_UNITS });
  }
  const startingLevelIndex = data[h + 18];
  const width = view.getUint16(h + 21, true);
  const depth = view.getUint16(h + 23, true);
  if (width === 0 || depth === 0) throw new Error('MIF: zero map size');

  const levels: MifLevel[] = [];
  let level: MifLevel | undefined;
  let o = h + headerSize;
  const cells = width * depth;

  const grid = (start: number, size: number): Uint16Array => {
    const uncompressed = view.getUint16(start, true);
    const bytes = decodeType08(data.subarray(start + 2, start + size), Math.max(uncompressed, cells * 2));
    const out = new Uint16Array(cells);
    for (let i = 0; i < cells; i++) out[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    return out;
  };

  while (o + 6 <= data.length) {
    const t = tag(o);
    const size = view.getUint16(o + 4, true);
    const p = o + 6;
    if (t === 'LEVL') {
      level = { name: '', info: '', numFloors: 1, map1: new Uint16Array(cells), flor: new Uint16Array(cells), triggers: [] };
      levels.push(level);
      o = p; // LEVL's size covers its children; walk into them.
      continue;
    }
    if (p + size > data.length) throw new Error(`MIF: chunk ${t} runs past end of file`);
    if (level) {
      switch (t) {
        case 'NAME':
          level.name = readFixedString(data, p, size);
          break;
        case 'INFO':
          level.info = readFixedString(data, p, size).toUpperCase();
          break;
        case 'NUMF':
          level.numFloors = data[p];
          break;
        case 'MAP1':
          level.map1 = grid(p, size);
          break;
        case 'MAP2':
          level.map2 = grid(p, size);
          break;
        case 'FLOR':
          level.flor = grid(p, size);
          break;
        case 'TRIG':
          for (let i = 0; i + 4 <= size; i += 4) {
            level.triggers.push({ x: data[p + i], y: data[p + i + 1], textIndex: data[p + i + 2], soundIndex: data[p + i + 3] });
          }
          break;
      }
    }
    o = p + size;
  }

  return { width, depth, startingLevelIndex, startPoints, levels };
}
