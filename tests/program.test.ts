import { describe, expect, it, vi } from 'vitest';
import { readCharacterTables } from '../src/formats/classes';
import { readCreatures, readExeData, readWeapons } from '../src/formats/exe';
import { inflate, unpackExe, UnsupportedExeError } from '../src/formats/pklite';
import {
  encodePklite,
  makeCharacterTables,
  makeExeImage,
  makePkliteExe,
  type FakeCharacterTables,
  type FakeClass,
  type FakeCreature,
  type PkliteToken,
} from './helpers/encode';

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

  it('reads weapon weights and prices where the CD version keeps them', () => {
    const weighed = WEAPONS.map((w, i) => ({ ...w, weight: 0.75 + i / 4, price: 7 + 3 * i }));
    const weapons = readWeapons(makeExeImage(CREATURES, SOUNDS, weighed));
    expect(weapons[0]).toEqual({ name: 'Staff', damage: [1, 6], twoHanded: true, weight: 0.75, price: 7 });
    expect(weapons[17]).toMatchObject({ weight: 5, price: 58 });
    // One price of 0 makes them all untrustworthy.
    const broken = weighed.map((w, i) => (i === 4 ? { ...w, price: 0 } : w));
    expect(readWeapons(makeExeImage(CREATURES, SOUNDS, broken))[0]).toEqual({ name: 'Staff', damage: [1, 6], twoHanded: true });
  });
});

/** Made-up classes and races: none of these values come from the game. */
const CLASS_NAMES = ['Mage', 'Spellsword', 'Tinker', 'Sailor', 'Farmer', 'Brewer', 'Weaver', 'Potter', 'Miller', 'Cooper', 'Mason', 'Fletcher', 'Herald', 'Jester', 'Smith', 'Tanner', 'Hunter', 'Guard'];
const CLASSES: FakeClass[] = CLASS_NAMES.map((name, i) => ({
  name,
  experience: 610 + 45 * i,
  healthDie: 3 + ((i * 5) % 13),
  flags: (i % 3 === 0 ? 0x20 : 0) | (i % 4 === 1 ? 0x40 : 0) | (i % 5 === 2 ? 0x80 : 0),
  weapons: i % 6 === 0 ? undefined : i % 6 === 1 ? [2, 4, 17] : [i, (i + 9) % 18],
  shields: [7, 8, 9, 10].slice(0, i % 5),
  armour: i % 4,
}));
const RACES = [
  { name: 'Hillman', plural: 'Hillmen', province: 'High Rock' },
  { name: 'Dunesman', plural: 'Dunesmen', province: 'Hammerfell' },
  { name: 'Frostling', plural: 'Frostlings', province: 'Northmark' },
  { name: 'Ashborn', plural: 'Ashborn', province: 'Cinderland' },
  { name: 'Tall Elf', plural: 'Tall Elves', province: 'Isles' },
  { name: 'Leaf Elf', plural: 'Leaf Elves', province: 'Greenwood' },
  { name: 'Catfolk', plural: 'Catfolk', province: 'Sandreach' },
  { name: 'Lizardfolk', plural: 'Lizardfolk', province: 'Mirefen' },
];
const ATTRIBUTES = ['Might', 'Wits', 'Resolve', 'Grace', 'Haste', 'Grit', 'Charm', 'Fortune'];
const TEXTS = {
  messages: [
    'How do you wish\rto find your calling?',
    'Answer these riddles.',
    'What are you called, %s?',
    'Man or woman?',
    'Where were you born, %s the %s?',
    'The riddles make you a %s.',
    'So you hail from %s,\r home of the %s?',
    'You are %s %s of %s, one of the %s.',
    'You must be %s, as every %s is.',
    'Fare well.',
    'Share out your points.',
    'Choose a face.',
  ],
  phrases: CLASS_NAMES.map((_, i) => ['quick and sly', 'stout', 'wise and calm'][i % 3]),
  closing: 'Which will it be?',
};

function characterTables(spec: Partial<FakeCharacterTables> = {}) {
  const bytes = makeCharacterTables({ classes: CLASSES, races: RACES, attributes: ATTRIBUTES, texts: TEXTS, ...spec });
  return readCharacterTables(new Uint8Array(bytes));
}

describe('character tables', () => {
  it('reads the classes: experience, health dice and what they are good at', () => {
    const t = characterTables();
    expect(t.classes.map((c) => c.name)).toEqual(CLASS_NAMES);
    expect(t.classes[0]).toMatchObject({ experience: 610, healthDie: 3, spellcaster: true, critical: false, thief: false });
    expect(t.classes[1]).toMatchObject({ experience: 655, healthDie: 8, spellcaster: false, critical: true, thief: false });
    expect(t.classes[2]).toMatchObject({ healthDie: 13, spellcaster: false, critical: false, thief: true });
  });

  it('reads the races, their provinces and the attributes', () => {
    const t = characterTables();
    expect(t.races[2]).toEqual({ name: 'Frostling', plural: 'Frostlings', province: 'Northmark' });
    expect(t.races[7].province).toBe('Mirefen');
    expect(t.attributes).toEqual(ATTRIBUTES);
  });

  it('reads the weapons, shields and armour each class may use', () => {
    const t = characterTables();
    expect(t.classes[0].weapons).toBeUndefined();
    expect(t.classes[1].weapons).toEqual([2, 4, 17]);
    expect(t.classes[7].weapons).toEqual([2, 4, 17]);
    expect(t.classes[2].weapons).toEqual([2, 11]);
    expect(t.classes.map((c) => c.shields.length)).toEqual(CLASS_NAMES.map((_, i) => i % 5));
    expect(t.classes[4].shields).toEqual([0, 1, 2, 3]);
    expect(t.classes.map((c) => c.armour)).toEqual(CLASS_NAMES.map((_, i) => i % 4));
    expect(t.cannotEquip).toBe('%ss cannot equip this item, sorry.');
  });

  it('reads the words of character creation, laid out on one line', () => {
    const t = characterTables();
    expect(t.texts?.method).toBe('How do you wish to find your calling?');
    expect(t.texts?.home).toBe('So you hail from %s, home of the %s?');
    expect(t.texts?.knownAs).toBe('You are %s %s of %s, one of the %s.');
    expect(t.texts?.appearance).toBe('Choose a face.');
    expect(t.classes[1].needs).toBe('stout');
  });

  it('lets every class use anything when those tables are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = characterTables({ noEquipment: true, texts: undefined });
    expect(t.classes.every((c) => !c.weapons && c.armour === 0 && c.shields.length === 4)).toBe(true);
    expect(t.cannotEquip).toBeUndefined();
    expect(t.texts).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('leaves out texts that do not have the names they should', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const messages = TEXTS.messages.map((m, i) => (i === 2 ? 'What are you called?' : m));
    expect(characterTables({ texts: { ...TEXTS, messages } }).texts).toBeUndefined();
    warn.mockRestore();
  });

  it('rejects implausible class tables', () => {
    expect(() => characterTables({ classes: CLASSES.map((c, i) => (i === 3 ? { ...c, experience: 50 } : c)) })).toThrow(/implausible/);
    expect(() => characterTables({ classes: CLASSES.map((c, i) => (i === 3 ? { ...c, healthDie: 0 } : c)) })).toThrow(/implausible/);
  });

  it('comes with the rest of the program, or is left out', () => {
    const data = readExeData(makeExeImage(CREATURES, SOUNDS, WEAPONS, makeCharacterTables({ classes: CLASSES, races: RACES, attributes: ATTRIBUTES })));
    expect(data.character?.classes).toHaveLength(18);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readExeData(makeExeImage(CREATURES, SOUNDS, WEAPONS)).character).toBeUndefined();
    warn.mockRestore();
  });
});
