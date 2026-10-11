/**
 * Decompressors used by Arena's data files.
 *
 * - Type 04 is plain LZSS (Okumura): 4 KB ring buffer pre-filled with spaces,
 *   flag bits LSB first, 1 = literal, 0 = 12-bit position + 4-bit length.
 * - Type 08 is LZHUF (Okumura/Yoshizaki): LZSS with a 60-byte lookahead whose
 *   literals and lengths are coded with an adaptive Huffman tree, and whose
 *   positions use a fixed prefix table. MIF map layers and many IMGs use it.
 */

export function decodeType04(src: Uint8Array, outLength: number): Uint8Array {
  const out = new Uint8Array(outLength);
  const ring = new Uint8Array(4096).fill(0x20);
  let r = 0xfee;
  let s = 0;
  let d = 0;
  let flags = 0;

  while (d < outLength && s < src.length) {
    flags >>= 1;
    if ((flags & 0x100) === 0) flags = src[s++] | 0xff00;
    if (flags & 1) {
      if (s >= src.length) break;
      const c = src[s++];
      out[d++] = c;
      ring[r] = c;
      r = (r + 1) & 0xfff;
    } else {
      if (s + 1 >= src.length) break;
      const b1 = src[s++];
      const b2 = src[s++];
      const pos = b1 | ((b2 & 0xf0) << 4);
      const len = (b2 & 0x0f) + 3;
      for (let k = 0; k < len && d < outLength; k++) {
        const c = ring[(pos + k) & 0xfff];
        out[d++] = c;
        ring[r] = c;
        r = (r + 1) & 0xfff;
      }
    }
  }
  return out;
}

// ---- LZHUF ("type 08") ----

const N = 4096;
const F = 60;
const THRESHOLD = 2;
const N_CHAR = 256 - THRESHOLD + F;
const T = N_CHAR * 2 - 1;
const R = T - 1;
const MAX_FREQ = 0x8000;

export const LZHUF = { N, F, THRESHOLD, N_CHAR, T, R } as const;

/** Position prefix tables: upper 6 bits of a match position and its code length, indexed by the next input byte. */
export const D_CODE = new Uint8Array(256);
export const D_LEN = new Uint8Array(256);
(() => {
  // [entries per code, number of codes, bit length]
  const groups: Array<[number, number, number]> = [
    [32, 1, 3],
    [16, 3, 4],
    [8, 8, 5],
    [4, 12, 6],
    [2, 24, 7],
    [1, 16, 8],
  ];
  let i = 0;
  let code = 0;
  for (const [per, count, len] of groups) {
    for (let c = 0; c < count; c++, code++) {
      for (let k = 0; k < per; k++, i++) {
        D_CODE[i] = code;
        D_LEN[i] = len;
      }
    }
  }
})();

/** The adaptive Huffman tree LZHUF uses for literals and match lengths. */
export class HuffTree {
  readonly freq = new Uint32Array(T + 1);
  readonly prnt = new Int32Array(T + N_CHAR);
  readonly son = new Int32Array(T);

  constructor() {
    const { freq, son, prnt } = this;
    for (let i = 0; i < N_CHAR; i++) {
      freq[i] = 1;
      son[i] = i + T;
      prnt[i + T] = i;
    }
    let i = 0;
    let j = N_CHAR;
    while (j <= R) {
      freq[j] = freq[i] + freq[i + 1];
      son[j] = i;
      prnt[i] = prnt[i + 1] = j;
      i += 2;
      j++;
    }
    freq[T] = 0xffff;
    prnt[R] = 0;
  }

  private reconst(): void {
    const { freq, son, prnt } = this;
    let j = 0;
    for (let i = 0; i < T; i++) {
      if (son[i] >= T) {
        freq[j] = (freq[i] + 1) >> 1;
        son[j] = son[i];
        j++;
      }
    }
    for (let i = 0, jj = N_CHAR; jj < T; i += 2, jj++) {
      const f = (freq[jj] = freq[i] + freq[i + 1]);
      let k = jj - 1;
      while (f < freq[k]) k--;
      k++;
      freq.copyWithin(k + 1, k, jj);
      freq[k] = f;
      son.copyWithin(k + 1, k, jj);
      son[k] = i;
    }
    for (let i = 0; i < T; i++) {
      const k = son[i];
      if (k >= T) prnt[k] = i;
      else prnt[k] = prnt[k + 1] = i;
    }
  }

  /** Bumps the frequency of symbol c0 and keeps the tree ordered. */
  update(c0: number): void {
    const { freq, son, prnt } = this;
    if (freq[R] === MAX_FREQ) this.reconst();
    let c = prnt[c0 + T];
    do {
      const k = ++freq[c];
      let l = c + 1;
      if (k > freq[l]) {
        while (k > freq[++l]);
        l--;
        freq[c] = freq[l];
        freq[l] = k;

        const i = son[c];
        prnt[i] = l;
        if (i < T) prnt[i + 1] = l;

        const j = son[l];
        son[l] = i;
        prnt[j] = c;
        if (j < T) prnt[j + 1] = c;
        son[c] = j;

        c = l;
      }
      c = prnt[c];
    } while (c !== 0);
  }
}

class LzhufReader {
  private readonly tree = new HuffTree();
  private getbuf = 0;
  private getlen = 0;
  private pos = 0;

  constructor(private readonly src: Uint8Array) {}

  private fill(): void {
    while (this.getlen <= 8) {
      const b = this.pos < this.src.length ? this.src[this.pos++] : 0;
      this.getbuf = (this.getbuf | (b << (8 - this.getlen))) & 0xffff;
      this.getlen += 8;
    }
  }

  private getBit(): number {
    this.fill();
    const i = this.getbuf;
    this.getbuf = (this.getbuf << 1) & 0xffff;
    this.getlen--;
    return (i & 0x8000) >> 15;
  }

  private getByte(): number {
    this.fill();
    const i = this.getbuf;
    this.getbuf = (this.getbuf << 8) & 0xffff;
    this.getlen -= 8;
    return (i & 0xff00) >> 8;
  }

  decodeChar(): number {
    const { son } = this.tree;
    let c = son[R];
    while (c < T) {
      c += this.getBit();
      c = son[c];
    }
    c -= T;
    this.tree.update(c);
    return c;
  }

  decodePosition(): number {
    let i = this.getByte();
    const c = D_CODE[i] << 6;
    let j = D_LEN[i] - 2;
    while (j--) i = (i << 1) + this.getBit();
    return c | (i & 0x3f);
  }
}

export function decodeType08(src: Uint8Array, outLength: number): Uint8Array {
  const out = new Uint8Array(outLength);
  const ring = new Uint8Array(N).fill(0x20);
  let r = N - F;
  const h = new LzhufReader(src);
  let count = 0;
  while (count < outLength) {
    const c = h.decodeChar();
    if (c < 256) {
      out[count++] = c;
      ring[r] = c;
      r = (r + 1) & (N - 1);
    } else {
      const i = (r - h.decodePosition() - 1) & (N - 1);
      const len = c - 255 + THRESHOLD;
      for (let k = 0; k < len && count < outLength; k++) {
        const b = ring[(i + k) & (N - 1)];
        out[count++] = b;
        ring[r] = b;
        r = (r + 1) & (N - 1);
      }
    }
  }
  return out;
}
