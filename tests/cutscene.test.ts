import { describe, expect, it } from 'vitest';
import { FlcFormatError, parseFlc } from '../src/formats/flc';
import { fillTemplate, pages, parseTemplates } from '../src/formats/template';
import { deathVision, firstVision, NEW_GAME, OPENING } from '../src/ui/cutscene';

// ---- A made-up 4x2 FLC; none of it comes from the game ----

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];
const chunk = (type: number, body: number[]) => [...le32(6 + body.length), ...le16(type), ...body];
const frame = (...chunks: number[][]) => {
  const body = chunks.flat();
  return [...le32(16 + body.length), ...le16(0xf1fa), ...le16(chunks.length), 0, 0, 0, 0, 0, 0, 0, 0, ...body];
};

function flc(...frames: number[][]): Uint8Array {
  const header = new Array(128).fill(0);
  header.splice(4, 2, ...le16(0xaf12));
  header.splice(6, 2, ...le16(frames.length));
  header.splice(8, 4, ...le16(4), ...le16(2));
  header.splice(16, 4, ...le32(100));
  const body = frames.flat();
  header.splice(0, 4, ...le32(128 + body.length));
  return new Uint8Array([...header, ...body]);
}

/** Palette: one packet setting colours 1 and 2. */
const palette = chunk(4, [...le16(1), 1, 2, 10, 20, 30, 40, 50, 60]);
/** A whole frame by byte runs: row 0 is four 1s, row 1 copies 2, 2, 1, 1. */
const full = chunk(15, [1, 4, 1, 1, -4 & 0xff, 2, 2, 1, 1]);
/** A delta: one line with one packet, skipping a pixel and copying one word (2, 2). */
const delta = chunk(7, [...le16(1), ...le16(1), 1, 1, 2, 2]);

describe('FLC animations', () => {
  it('decodes palettes, whole frames and deltas, leaving out the last frame that leads back to the first', () => {
    const anim = parseFlc(flc(frame(palette, full), frame(delta), frame(full)));
    expect([anim.width, anim.height, anim.frameMs]).toEqual([4, 2, 100]);
    expect(anim.frames).toHaveLength(2);
    expect([...anim.frames[0].pixels]).toEqual([1, 1, 1, 1, 2, 2, 1, 1]);
    expect([...anim.frames[1].pixels]).toEqual([1, 2, 2, 1, 2, 2, 1, 1]);
    expect([...anim.frames[1].palette.subarray(3, 9)]).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('rejects other files', () => {
    expect(() => parseFlc(new Uint8Array(200))).toThrow(FlcFormatError);
  });
});

describe('the game’s texts', () => {
  const text = [
    '#1400',
    'Do not fear, %pcf.',
    'Line two',
    'Line three',
    'Line four&',
    '',
    '#1402',
    'Goodbye, %pcf...&',
    '#1403a',
    'Not this one',
  ].join('\r\n');

  it('reads each text under its key, up to the &', () => {
    const t = parseTemplates(text);
    expect(t.get('1400')).toBe('Do not fear, %pcf.\nLine two\nLine three\nLine four');
    expect(t.get('1402')).toBe('Goodbye, %pcf...');
    expect(t.get('1403a')).toBe('Not this one');
  });

  it('puts the name in and splits the text into pages of three lines', () => {
    const t = parseTemplates(text);
    expect(pages(fillTemplate(t.get('1400')!, 'Ysolda'))).toEqual(['Do not fear, Ysolda.\nLine two\nLine three', 'Line four']);
  });
});

describe('the cutscenes', () => {
  it('opens with the book, the title, the quote and the scroll, as Arena does', () => {
    expect(OPENING.map((s) => s.file)).toEqual(['INTRO.FLC', 'TITLE.IMG', 'QUOTE.IMG', 'SCROLL.FLC', 'SCROLL01.IMG', 'SCROLL02.IMG', 'SCROLL03.IMG']);
  });

  it('tells the story in nine pages before a new character, and has Ria Silmane speak after and at death', () => {
    expect(NEW_GAME.filter((s) => s.kind === 'picture')).toHaveLength(9);
    expect(firstVision('Ysolda')).toEqual([expect.objectContaining({ file: 'VISION.FLC', text: '1400', name: 'Ysolda' })]);
    expect(deathVision('Ysolda')).toEqual([expect.objectContaining({ text: '1402' })]);
  });
});
