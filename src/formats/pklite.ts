/**
 * PKLITE unpacker, for the game's own program file.
 *
 * ACD.EXE is a DOS program packed with PKLITE 1.12 and its "extra"
 * compression. The remake reads game tables (creature stats, weapon damage)
 * out of the unpacked program, so it needs the original bytes back.
 *
 * Layout: an MZ header, then a small stub that copies itself and the packed
 * data higher up in memory and unpacks the program to where it loads. The
 * packed data starts right after the stub, and the stub's own copy loop
 * (mov cx,words; xor di,di; push di; mov si,start; cld; rep movsw) says how
 * long the stub is.
 *
 * The packed stream mixes 16-bit little-endian bit words, read lowest bit
 * first, with plain bytes. A new bit word is fetched as soon as the last bit
 * of the previous one is used, before any byte that follows. Each step reads
 * a flag bit:
 *   0  a literal byte; in "extra" mode it is XORed with the number of bits
 *      left in the current word.
 *   1  a copy from earlier output: a length code, then an offset whose high
 *      byte is coded in bits and whose low byte is a plain byte. Two-byte
 *      copies use a one-byte offset. The length code for 25 reads a byte n:
 *      0xFE marks a segment step (no output), 0xFF ends the data, anything
 *      else is a copy of n + 25 bytes.
 */

const LENGTHS_A = [4, 0, 5, 6, 7, 0, 0, 0, 0, 0, 8, 9, 10];
const LENGTHS_B = [0, 0, 11, 12, 25, 0, 0, 0, 0, 0, 13, 14, 15];
const LENGTHS_C = [0, 0, 16, 17, 18, 0, 0, 0, 0, 0, 19, 20, 21, 22, 23, 24];
const OFFSET_HIGH = [1, 2, 0, 0, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 7, 8, 9, 10, 11, 12, 13];
/** More than a DOS program can hold; a bad stream stops here instead of running on. */
const MAX_OUTPUT = 1 << 20;

export class UnsupportedExeError extends Error {}

/** Unpacks the program image (what DOS loads, without the MZ header) of a PKLITE-packed EXE. */
export function unpackExe(exe: Uint8Array): Uint8Array {
  if (exe[0] !== 0x4d || exe[1] !== 0x5a) throw new UnsupportedExeError('not a DOS program');
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const headerSize = view.getUint16(8, true) * 16;
  if (!ascii(exe.subarray(0x1c, Math.min(headerSize, 0x60))).includes('PKLITE')) {
    throw new UnsupportedExeError('the program is not packed with PKLITE');
  }
  const stub = exe.subarray(headerSize, Math.min(exe.length, headerSize + 0x400));
  const copy = findCopyLoop(stub);
  if (!copy) throw new UnsupportedExeError('unknown PKLITE version');
  // The stub runs at offset 0x100 of its segment (after the DOS program prefix).
  const start = headerSize + copy.source - 0x100 + copy.words * 2;
  if (start <= headerSize || start >= exe.length) throw new UnsupportedExeError('unknown PKLITE version');
  return inflate(exe, start, hasLiteralXor(stub));
}

/** Decodes a packed stream that starts at `start` (see the module comment). */
export function inflate(src: Uint8Array, start: number, xorLiterals: boolean): Uint8Array {
  let pos = start;
  const byte = () => {
    if (pos >= src.length) throw new Error('PKLITE: packed data ends early');
    return src[pos++];
  };
  const word = () => byte() | (byte() << 8);
  let bits = word();
  let left = 16;
  const bit = () => {
    const b = bits & 1;
    bits >>= 1;
    if (--left === 0) {
      bits = word();
      left = 16;
    }
    return b;
  };
  const more = (v: number) => (v << 1) | bit();

  let out = new Uint8Array(65536);
  let n = 0;
  const put = (v: number) => {
    if (n === out.length) {
      if (n >= MAX_OUTPUT) throw new Error('PKLITE: output is too large');
      const bigger = new Uint8Array(n * 2);
      bigger.set(out);
      out = bigger;
    }
    out[n++] = v;
  };

  for (;;) {
    if (bit() === 0) {
      put(xorLiterals ? byte() ^ left : byte());
      continue;
    }
    let length: number;
    let v = more(bit());
    if (v >= 2) length = v;
    else {
      v = more(v);
      if (v === 0) length = LENGTHS_A[0];
      else {
        v = more(v);
        if (v < 5) length = LENGTHS_A[v];
        else {
          v = more(v);
          if (v <= 12) length = LENGTHS_A[v];
          else {
            v = more(v & 3);
            if (v >= 5) v = more(v);
            if (v <= 12) length = LENGTHS_B[v];
            else {
              v = more(v & 3);
              if (v >= 5) v = more(v);
              length = LENGTHS_C[v];
            }
          }
        }
      }
    }
    if (length === 25) {
      const extra = byte();
      if (extra === 0xfe) continue; // segment step: nothing to output
      if (extra === 0xff) break;
      length += extra;
    }
    let high = 0;
    if (length !== 2 && bit() === 0) {
      let h = more(more(bit()));
      if (h >= 2) {
        h = more(h);
        if (h >= 8) {
          h = more(h);
          if (h >= 23) h = more(h) & 0xdf;
          else h = OFFSET_HIGH[h];
        } else h = OFFSET_HIGH[h];
      } else h = OFFSET_HIGH[h];
      high = h;
    }
    const offset = (high << 8) | byte();
    if (offset === 0 || offset > n) throw new Error('PKLITE: copy reaches before the start of the data');
    for (let i = 0; i < length; i++) put(out[n - offset]);
  }
  return out.slice(0, n);
}

function findCopyLoop(code: Uint8Array): { words: number; source: number } | undefined {
  // B9 lo hi    mov cx,words
  // 33 FF       xor di,di
  // 57          push di
  // BE lo hi    mov si,source
  // FC          cld
  // F3 A5       rep movsw
  for (let i = 0; i + 12 <= code.length; i++) {
    if (
      code[i] === 0xb9 &&
      code[i + 3] === 0x33 &&
      code[i + 4] === 0xff &&
      code[i + 5] === 0x57 &&
      code[i + 6] === 0xbe &&
      code[i + 9] === 0xfc &&
      code[i + 10] === 0xf3 &&
      code[i + 11] === 0xa5
    ) {
      return { words: code[i + 1] | (code[i + 2] << 8), source: code[i + 7] | (code[i + 8] << 8) };
    }
  }
  return undefined;
}

/** "Extra" compression XORs literals: lodsb; xor al,dl; stosb. */
function hasLiteralXor(code: Uint8Array): boolean {
  for (let i = 0; i + 4 <= code.length; i++) {
    if (code[i] === 0xac && code[i + 1] === 0x32 && code[i + 2] === 0xc2 && code[i + 3] === 0xaa) return true;
  }
  return false;
}

function ascii(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
