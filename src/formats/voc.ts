/**
 * Creative Voice File reader, for Arena's sound effects.
 *
 * "Creative Voice File" + 0x1A, a u16 header size, version and check word,
 * then blocks of u8 type + u24 size + body until a type 0 block:
 *   1  sound: u8 rate code (rate = 1000000 / (256 - code)), u8 codec
 *      (0 = 8-bit unsigned PCM), samples
 *   2  more samples at the same rate
 *   3  silence: u16 length - 1, u8 rate code
 *   9  sound, newer form: u32 rate, u8 bits, u8 channels, u16 codec, 4
 *      reserved bytes, samples
 * Other blocks (markers, repeats, text) are skipped. Arena's files are all
 * one type 1 block of 8-bit mono sound.
 */

export interface Sound {
  sampleRate: number;
  /** Mono, -1..1. */
  samples: Float32Array;
}

const SIGNATURE = 'Creative Voice File';

export function parseVoc(data: Uint8Array): Sound {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (data[i] !== SIGNATURE.charCodeAt(i)) throw new Error('VOC: not a Creative Voice File');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parts: Float32Array[] = [];
  let sampleRate = 0;
  let o = view.getUint16(20, true);
  const rateOf = (code: number) => Math.round(1_000_000 / (256 - code));

  while (o + 4 <= data.length) {
    const type = data[o];
    if (type === 0) break;
    const size = data[o + 1] | (data[o + 2] << 8) | (data[o + 3] << 16);
    const body = o + 4;
    const end = Math.min(data.length, body + size);
    if (type === 1 && size >= 2) {
      if (data[body + 1] !== 0) throw new Error('VOC: only 8-bit sound is supported');
      sampleRate ||= rateOf(data[body]);
      parts.push(pcm8(data.subarray(body + 2, end)));
    } else if (type === 2) {
      parts.push(pcm8(data.subarray(body, end)));
    } else if (type === 3 && size >= 3) {
      sampleRate ||= rateOf(data[body + 2]);
      parts.push(new Float32Array(view.getUint16(body, true) + 1));
    } else if (type === 9 && size >= 12) {
      const bits = data[body + 4];
      const channels = data[body + 5];
      const codec = view.getUint16(body + 6, true);
      if (bits !== 8 || channels !== 1 || codec !== 0) throw new Error('VOC: only 8-bit mono sound is supported');
      sampleRate ||= view.getUint32(body, true);
      parts.push(pcm8(data.subarray(body + 12, end)));
    }
    o = body + size;
  }
  if (!sampleRate) throw new Error('VOC: no sound data');
  const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    samples.set(p, at);
    at += p.length;
  }
  return { sampleRate, samples };
}

function pcm8(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] - 128) / 128;
  return out;
}
