import { describe, expect, it } from 'vitest';
import { renderSong } from '../src/audio/adlib';
import { songFile } from '../src/audio/music';
import { Opl2, wave } from '../src/audio/opl';
import { findTimbre, parseTimbres, TimbreFormatError, type Timbre } from '../src/formats/timbres';
import { parseXmi, XmiFormatError } from '../src/formats/xmi';

// ---- Made-up files; none of these come from the game ----

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const chunk = (id: string, body: number[]) => [...ascii(id), ...be32(body.length), ...body, ...(body.length & 1 ? [0] : [])];

/** An XMI file around `events`, asking for the given (patch, bank) pairs. */
function xmi(events: number[], timbres: Array<[number, number]> = []): Uint8Array {
  const timb = chunk('TIMB', [timbres.length & 0xff, timbres.length >> 8, ...timbres.flat()]);
  const song = chunk('FORM', [...ascii('XMID'), ...timb, ...chunk('EVNT', events)]);
  return new Uint8Array([...chunk('FORM', [...ascii('XDIR'), ...chunk('INFO', [1, 0])]), ...chunk('CAT ', [...ascii('XMID'), ...song])]);
}

/** A timbre library of 14-byte instruments. */
function library(entries: Array<{ patch: number; bank: number; bytes: number[] }>): Uint8Array {
  const header = entries.length * 6 + 2;
  const out: number[] = [];
  let at = header;
  for (const e of entries) {
    out.push(e.patch, e.bank, at & 0xff, (at >> 8) & 0xff, 0, 0);
    at += 2 + e.bytes.length;
  }
  out.push(0xff, 0xff);
  for (const e of entries) out.push(14, 0, ...e.bytes);
  return new Uint8Array(out);
}

/** A plain sine instrument: the carrier alone, full volume, sustained until let go, then fading fast; the modulator silent. */
const SINE = [0, 0x21, 0x3f, 0xf0, 0x00, 0, 0x00, 0x21, 0x00, 0xf0, 0x0f, 0];

describe('XMI songs', () => {
  it('reads delays as sums of bytes, notes with their own lengths, and the timbres asked for', () => {
    const song = parseXmi(
      xmi(
        [
          0xc0, 5, // program 5 on channel 1
          0x7f, 0x01, // a delay of 128 ticks
          0x90, 60, 100, 0x81, 0x00, // middle C for 128 ticks
          0xb0, 7, 90, // volume
          0xff, 0x2f, 0x00, // end of track
        ],
        [[5, 0]],
      ),
    );
    expect(song.timbres).toEqual([{ patch: 5, bank: 0 }]);
    expect(song.events).toEqual([
      { tick: 0, type: 'program', channel: 0, program: 5 },
      { tick: 128, type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      { tick: 128, type: 'control', channel: 0, controller: 7, value: 90 },
      { tick: 256, type: 'noteOff', channel: 0, note: 60 },
    ]);
    expect(song.length).toBe(256);
  });

  it('rejects a file with no events', () => {
    expect(() => parseXmi(new Uint8Array(chunk('FORM', ascii('XDIR'))))).toThrow(XmiFormatError);
  });

  it('prefers the FM arrangement of a song', () => {
    const files = (names: string[]) => ({ has: (n: string) => names.includes(n) });
    expect(songFile(files(['SHEET.XMI', 'SHEET.XFM']), 'SHEET')).toBe('SHEET.XFM');
    expect(songFile(files(['SHEET.XMI']), 'SHEET')).toBe('SHEET.XMI');
    expect(songFile(files([]), 'SHEET')).toBeUndefined();
  });
});

describe('the timbre library', () => {
  it('reads each instrument’s transposition and registers, and finds them by bank and patch', () => {
    const t = parseTimbres(library([{ patch: 3, bank: 127, bytes: [-12 & 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }]));
    expect(t).toEqual([
      { patch: 3, bank: 127, transposition: -12, op1: { r20: 1, r40: 2, r60: 3, r80: 4, rE0: 5 }, c0: 6, op2: { r20: 7, r40: 8, r60: 9, r80: 10, rE0: 11 } },
    ]);
    expect(findTimbre(t, 127, 3)).toBe(t[0]);
    expect(findTimbre(t, 0, 3)).toBeUndefined();
  });

  it('rejects a list with no end', () => {
    expect(() => parseTimbres(new Uint8Array([1, 0]))).toThrow(TimbreFormatError);
  });
});

/** The frequency of a sound, from how often it crosses zero going up. */
function pitch(samples: Float32Array, rate: number, from = 0.2): number {
  let crossings = 0;
  const start = Math.floor(samples.length * from);
  for (let i = start + 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return (crossings * rate) / (samples.length - start);
}

describe('the AdLib', () => {
  it('draws its four waves', () => {
    expect(wave(0, 0.75)).toBeCloseTo(-1, 2);
    expect(wave(1, 0.75)).toBe(0);
    expect(wave(2, 0.75)).toBeCloseTo(1, 2);
    expect(wave(3, 0.3)).toBe(0);
    expect(wave(3, 0.2)).toBeGreaterThan(0.9);
  });

  it('is silent until a key is pressed, and sounds the frequency written', () => {
    const rate = 44100;
    const opl = new Opl2(rate);
    const quiet = new Float32Array(1000);
    opl.render(quiet);
    expect(quiet.every((s) => s === 0)).toBe(true);
    // Channel 0: a sustained sine carrier, frequency number 0x244 in block 4 (about 440 Hz).
    for (const [r, v] of [[0x01, 0x20], [0x23, 0x21], [0x43, 0x00], [0x63, 0xf0], [0x83, 0x00], [0x40, 0x3f], [0xc0, 0x00], [0xa0, 0x44], [0xb0, 0x20 | (4 << 2) | 0x02]]) opl.write(r, v);
    const out = new Float32Array(rate / 2);
    opl.render(out);
    expect(Math.max(...out)).toBeGreaterThan(0.5);
    expect(pitch(out, rate)).toBeCloseTo((0x244 * 16 * 49716) / 2 ** 20, -1);
  });

  it('plays a song’s A at 440 Hz, with the instrument of its program, and lets it fade after the note ends', () => {
    const timbres: Timbre[] = parseTimbres(library([{ patch: 0, bank: 0, bytes: SINE }]));
    const song = parseXmi(xmi([0xc0, 0, 0x90, 69, 127, 0x81, 0x40 /* 192 ticks: 1.6 s */, 0x7f, 0x7f, 0x7f]));
    const { samples, sampleRate } = renderSong(song, timbres, 22050);
    const held = samples.subarray(0, Math.floor(1.5 * sampleRate));
    expect(pitch(held, sampleRate)).toBeGreaterThan(430);
    expect(pitch(held, sampleRate)).toBeLessThan(450);
    const after = samples.subarray(Math.floor(2.6 * sampleRate));
    expect(Math.max(...after.map(Math.abs))).toBeLessThan(0.01);
  });

  it('plays nothing for a program the library doesn’t have', () => {
    const song = parseXmi(xmi([0xc0, 9, 0x90, 60, 127, 0x40]));
    const { samples } = renderSong(song, [], 8000);
    expect(samples.every((s) => s === 0)).toBe(true);
  });
});
