/**
 * Test-only encoders that build synthetic Arena files, so the parsers can be
 * tested without any of Bethesda's data.
 */
import { D_CODE, D_LEN, HuffTree, LZHUF } from '../../src/formats/compression';

class BitWriter {
  private bytes: number[] = [];
  private buf = 0;
  private len = 0;
  /** Writes the top `n` bits of a 16-bit code, MSB first. */
  put(n: number, code: number) {
    for (let i = 0; i < n; i++) {
      this.buf = (this.buf << 1) | ((code >> (15 - i)) & 1);
      if (++this.len === 8) {
        this.bytes.push(this.buf);
        this.buf = 0;
        this.len = 0;
      }
    }
  }
  finish(): Uint8Array {
    if (this.len) this.bytes.push(this.buf << (8 - this.len));
    return new Uint8Array(this.bytes);
  }
}

export type LzhufToken = { literal: number } | { distance: number; length: number };

/** Encodes an explicit token list with LZHUF (Arena "type 08"). */
export function encodeLzhuf(tokens: LzhufToken[]): Uint8Array {
  const { T, R, THRESHOLD } = LZHUF;
  const tree = new HuffTree();
  const w = new BitWriter();
  const encodeChar = (c: number) => {
    let code = 0;
    let len = 0;
    let k = tree.prnt[c + T];
    do {
      code >>= 1;
      if (k & 1) code |= 0x8000;
      len++;
      k = tree.prnt[k];
    } while (k !== R);
    w.put(len, code);
    tree.update(c);
  };
  const encodePosition = (p: number) => {
    const upper = p >> 6;
    const first = D_CODE.indexOf(upper);
    const bits = D_LEN[first];
    w.put(bits, (first >> (8 - bits)) << (16 - bits));
    w.put(6, (p & 0x3f) << 10);
  };
  for (const t of tokens) {
    if ('literal' in t) encodeChar(t.literal);
    else {
      encodeChar(t.length + 255 - THRESHOLD);
      encodePosition(t.distance - 1);
    }
  }
  return w.finish();
}

export function encodeLzhufLiterals(data: Uint8Array): Uint8Array {
  return encodeLzhuf([...data].map((literal) => ({ literal })));
}

/** Encodes LZSS (Arena "type 04") using only literals. */
export function encodeLzssLiterals(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    out.push(0xff);
    for (const b of data.subarray(i, i + 8)) out.push(b);
  }
  return new Uint8Array(out);
}

export function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

export function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** Builds a GLOBAL.BSA-style archive. */
export function makeBsa(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files);
  const out: number[] = [...u16(names.length)];
  for (const n of names) out.push(...files[n]);
  for (const n of names) {
    const name = ascii(n).concat(new Array(12).fill(0)).slice(0, 12);
    const size = files[n].length;
    out.push(...name, 0, 0, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff);
  }
  return new Uint8Array(out);
}

/** Encrypts INF text the way GLOBAL.BSA stores it. */
export function encryptInf(text: string): Uint8Array {
  const key = [0xea, 0x7b, 0x4e, 0xbd, 0x19, 0xc9, 0x38, 0x99];
  return new Uint8Array(ascii(text).map((b, i) => b ^ ((key[i % 8] + i) & 0xff)));
}

export interface MifSpec {
  width: number;
  depth: number;
  start?: { x: number; y: number };
  name?: string;
  info?: string;
  map1: number[];
  flor: number[];
  triggers?: Array<[number, number, number, number]>;
}

/** Builds a one-level MIF with LZHUF-compressed grids. */
export function makeMif(spec: MifSpec): Uint8Array {
  const header = new Array(61).fill(0);
  const start = spec.start ?? { x: 0, y: 0 };
  header.splice(2, 2, ...u16(Math.round(start.x * 128)));
  header.splice(10, 2, ...u16(Math.round(start.y * 128)));
  header[19] = 1;
  header.splice(21, 2, ...u16(spec.width));
  header.splice(23, 2, ...u16(spec.depth));

  const chunk = (tag: string, body: number[]) => [...ascii(tag), ...u16(body.length), ...body];
  const grid = (values: number[]) => {
    const raw = new Uint8Array(values.flatMap(u16));
    return [...u16(raw.length), ...encodeLzhufLiterals(raw)];
  };
  const zstr = (s: string) => [...ascii(s), 0];

  const children = [
    ...chunk('NAME', zstr(spec.name ?? 'test level')),
    ...chunk('INFO', zstr(spec.info ?? 'test.inf')),
    ...chunk('NUMF', [1]),
    ...chunk('TRIG', (spec.triggers ?? []).flat()),
    ...chunk('MAP1', grid(spec.map1)),
    ...chunk('FLOR', grid(spec.flor)),
  ];
  return new Uint8Array([...chunk('MHDR', header), ...ascii('LEVL'), ...u16(children.length), ...children]);
}
