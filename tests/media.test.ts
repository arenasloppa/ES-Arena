import { describe, expect, it } from 'vitest';
import {spectralRgba} from '../src/formats/palette';
import { parseCfa } from '../src/formats/cfa';
import { parseCif } from '../src/formats/cif';
import { parseVoc } from '../src/formats/voc';
import { ascii, makeCfa, makeImg, makeVoc } from './helpers/encode';

describe('CFA', () => {
  it('unpacks every frame through the colour table', () => {
    const w = 7;
    const h = 3;
    const frameA = Array.from({ length: w * h }, (_, i) => (i % 3 === 0 ? 0 : 40 + (i % 5)));
    const frameB = Array.from({ length: w * h }, (_, i) => (i < 7 ? 200 : 0));
    const cfa = parseCfa(makeCfa(w, h, [frameA, frameB]));
    expect(cfa).toMatchObject({ width: w, height: h, x: 5, y: 6 });
    expect(cfa.frames.map((f) => [...f])).toEqual([frameA, frameB]);
  });

  it('handles other bit depths', () => {
    const pixels = [0, 9, 9, 0, 17, 0];
    expect([...parseCfa(makeCfa(3, 2, [pixels], 2)).frames[0]]).toEqual(pixels);
    expect([...parseCfa(makeCfa(3, 2, [pixels], 7)).frames[0]]).toEqual(pixels);
  });

  it('decodes 8-bit direct palette frames without a colour table (ghosts and wraiths)', () => {
    const data = new Uint8Array(0x4c + 10);
    const header = new DataView(data.buffer);
    header.setUint16(0, 2, true); header.setUint16(2, 2, true);
    header.setUint16(4, 2, true); data[10] = 8; data[11] = 2;
    header.setUint16(12, 0x4c, true); header.setUint16(14, 0x4c + 5, true);
    header.setUint16(0x4a, data.length, true);
    data.set([3, 0, 13, 14, 15, 3, 7, 8, 255, 0], 0x4c);
    expect(parseCfa(data).frames.map(frame => [...frame])).toEqual([[0,13,14,15],[7,8,255,0]]);
  });

  it('rejects broken headers', () => {
    expect(() => parseCfa(new Uint8Array(10))).toThrow();
    const bad = makeCfa(2, 2, [[1, 2, 3, 4]]);
    bad[11] = 0; // no frames
    expect(() => parseCfa(bad)).toThrow();
  });
});

describe('CIF', () => {
  it('splits images and keeps their screen offsets', () => {
    const data = new Uint8Array([...makeImg(10, 20, 2, 2, [1, 2, 3, 4]), ...makeImg(300, 140, 3, 1, [5, 6, 7])]);
    const images = parseCif(data);
    expect(images.map((i) => [i.xOffset, i.yOffset, i.width, i.height, [...i.pixels]])).toEqual([
      [10, 20, 2, 2, [1, 2, 3, 4]],
      [300, 140, 3, 1, [5, 6, 7]],
    ]);
  });

  it('rejects an image that runs past the end', () => {
    expect(() => parseCif(new Uint8Array(makeImg(0, 0, 4, 4, [1, 2, 3])).subarray(0, 14))).toThrow();
  });
});

describe('VOC', () => {
  it('reads 8-bit sound and its rate', () => {
    const sound = parseVoc(makeVoc(131, [128, 255, 0, 192]));
    expect(sound.sampleRate).toBe(8000);
    expect([...sound.samples]).toEqual([0, 127 / 128, -1, 0.5]);
  });

  it('skips marker blocks', () => {
    const repeat = [6, 2, 0, 0, 0xff, 0xff];
    expect(parseVoc(makeVoc(166, [128], repeat)).samples).toHaveLength(1);
  });

  it('rejects other files', () => {
    expect(() => parseVoc(new Uint8Array(ascii('RIFF....WAVE')))).toThrow();
  });
});

describe('spectral creature pixels', () => {
  it('uses translucent shadow levels and original eye colours instead of the UI palette', () => {
    const palette = new Uint8Array(1024).fill(255);
    palette.set([180,20,10,255],158*4); palette.set([250,60,30,255],159*4);
    const rgba = spectralRgba(new Uint8Array([0,1,7,13,14,15,200]),palette);
    expect([...rgba]).toEqual([255,255,255,0, 0,0,0,0, 0,0,0,128, 0,0,0,255, 180,20,10,255, 250,60,30,255, 255,255,255,255]);
  });
});
