import { describe, expect, it } from 'vitest';
import { readCreatures, readExeData, readWeapons } from '../src/formats/exe';
import { inflate, unpackExe, UnsupportedExeError } from '../src/formats/pklite';
import { encodePklite, makeExeImage, makePkliteExe, type FakeCreature, type PkliteToken } from './helpers/encode';

/** Applies tokens directly, to know what the unpacker should produce. */
function expected(tokens: PkliteToken[]): number[] {
  const out: number[] = [];
  for (const t of tokens) {
    if ('literal' in t) out.push(t.literal);
    else if ('offset' in t) for (let i = 0; i < t.length; i++) out.push(out[out.length - t.offset]);
  }
  return out;
}

function sampleTokens(): PkliteToken[] {
  const tokens: PkliteToken[] = [];
  // Enough output for offsets with every high byte up to 0x1F.
  for (let i = 0; i < 8300; i++) tokens.push({ literal: (i * 73 + (i >> 7)) & 0xff });
  for (let length = 2; length <= 24; length++) tokens.push({ offset: length === 2 ? 200 : 37 * length, length });
  tokens.push({ segment: true });
  tokens.push({ offset: 1, length: 40 }); // overlapping run, long-length escape
  tokens.push({ offset: 3, length: 278 }); // the longest copy
  for (let high = 0; high <= 0x1f; high++) tokens.push({ offset: (high << 8) | 0x21, length: 3 });
  tokens.push({ literal: 0 }, { literal: 255 });
  tokens.push({ end: true });
  return tokens;
}

describe('PKLITE', () => {
  it('unpacks literals, every copy length and offset, segment steps and the end marker', () => {
    const tokens = sampleTokens();
    const packed = encodePklite(tokens);
    expect([...inflate(packed, 0, true)]).toEqual(expected(tokens));
  });

  it('unpacks without the literal XOR when the stub has none', () => {
    const tokens: PkliteToken[] = [{ literal: 1 }, { literal: 2 }, { offset: 2, length: 6 }, { end: true }];
    expect([...inflate(encodePklite(tokens, false), 0, false)]).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });

  it('finds the packed data after the stub of a packed program', () => {
    const tokens: PkliteToken[] = [{ literal: 0x41 }, { literal: 0x42 }, { offset: 2, length: 4 }, { end: true }];
    expect(String.fromCharCode(...unpackExe(makePkliteExe(encodePklite(tokens))))).toBe('ABABAB');
    const plain = makePkliteExe(encodePklite(tokens, false), false);
    expect(String.fromCharCode(...unpackExe(plain))).toBe('ABABAB');
  });

  it('rejects programs it cannot unpack', () => {
    expect(() => unpackExe(new Uint8Array(100))).toThrow(UnsupportedExeError);
    const notPacked = makePkliteExe(new Uint8Array(10));
    notPacked.fill(0x20, 0x1e, 0x2a);
    expect(() => unpackExe(notPacked)).toThrow(UnsupportedExeError);
    // A copy that reaches before the start of the output.
    expect(() => inflate(encodePklite([{ literal: 1 }, { offset: 5, length: 3 }, { end: true }]), 0, true)).toThrow();
    // Data that stops before the end marker.
    expect(() => inflate(encodePklite([{ literal: 1 }]).subarray(0, 3), 0, true)).toThrow();
  });
});

/** Made-up tables: none of these numbers come from the game. */
const CREATURES: FakeCreature[] = [
  { name: 'Rat', anim: 'rat', level: 6, health: [2, 5], damage: [1, 3], sound: 1, lift: 5 },
  { name: 'Goblin', anim: 'goblin', level: 8, health: [3, 9], damage: [2, 4], sound: 0, lift: 12, noCorpse: true },
  ...Array.from({ length: 21 }, (_, i): FakeCreature => ({ name: `Beast ${i}`, anim: `beast${i}`, level: 3 + i, health: [10, 20], damage: [1, 9], sound: 2 })),
];
const SOUNDS = ['firedaem.voc', 'squeak.voc', 'beast.voc'];
const WEAPONS = Array.from({ length: 18 }, (_, i) => ({
  name: i === 0 ? 'Staff' : i === 1 ? 'Dagger' : `Blade ${i}`,
  damage: [1 + (i % 3), 6 + i] as [number, number],
  hands: (i % 4 === 0 ? 2 : 1) as 1 | 2,
}));

describe('program tables', () => {
  it('reads creature stats next to the animation list', () => {
    const creatures = readCreatures(makeExeImage(CREATURES, SOUNDS, WEAPONS));
    expect(creatures).toHaveLength(23);
    expect(creatures[0]).toMatchObject({ name: 'Rat', animation: 'RAT', level: 6, health: [2, 5], damage: [1, 3], sound: 'SQUEAK.VOC', lift: 5, noCorpse: false });
    expect(creatures[1]).toMatchObject({ name: 'Goblin', animation: 'GOBLIN', sound: 'FIREDAEM.VOC', lift: 12, noCorpse: true, experience: 10, experiencePerHealth: 2 });
    expect(creatures[22].name).toBe('Beast 20');
  });

  it('reads weapon names, damage and hands', () => {
    const weapons = readWeapons(makeExeImage(CREATURES, SOUNDS, WEAPONS));
    expect(weapons).toHaveLength(18);
    expect(weapons[0]).toEqual({ name: 'Staff', damage: [1, 6], twoHanded: true });
    expect(weapons[1]).toEqual({ name: 'Dagger', damage: [2, 7], twoHanded: false });
    expect(weapons[17]).toEqual({ name: 'Blade 17', damage: [3, 23], twoHanded: false });
  });

  it('rejects tables with implausible values', () => {
    const broken = CREATURES.map((c, i) => (i === 5 ? { ...c, health: [9, 2] as [number, number] } : c));
    expect(() => readExeData(makeExeImage(broken, SOUNDS, WEAPONS))).toThrow(/implausible/);
    expect(() => readExeData(new Uint8Array(100))).toThrow(/could not find/);
  });
});
