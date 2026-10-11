import { describe, expect, it } from 'vitest';
import type { CharacterTables, ClassInfo } from '../src/formats/classes';
import {
  classFromAnswers,
  creationData,
  derivedAttributes,
  ACROBAT,
  AGILITY,
  BRETON,
  DARK_ELF,
  ENDURANCE,
  HIGH_ELF,
  KHAJIIT,
  KNIGHT,
  NORD,
  PERSONALITY,
  REDGUARD,
  saves,
  WOOD_ELF,
  STRENGTH,
  FALLBACK_CLASSES,
  fillText,
  forgetCharacter,
  heroFor,
  loadCharacter,
  pickQuestions,
  rollAttributes,
  arenaRoll,
  attributeRoom,
  startingHealth,
  to100,
  to256,
  saveCharacter,
  WILLPOWER,
  type Character,
} from '../src/game/character';
import { arenaName, loreName, randomName } from '../src/game/names';
import { COLD, MAGIC } from '../src/game/combat';
import { always } from './helpers/level';

/** Returns the numbers given in turn, then the last one over and over. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

/** Made-up classes and races: none of these values come from the game. */
const TINKER: ClassInfo = { name: 'Tinker', healthDie: 9, experience: 800, spellcaster: false, critical: true, thief: true, armour: 1, shields: [0] };
const SAGE: ClassInfo = { name: 'Sage', healthDie: 5, experience: 1200, spellcaster: true, critical: false, thief: false, armour: 3, shields: [] };
const TABLES: CharacterTables = {
  classes: [TINKER, SAGE],
  races: [
    { name: 'Hillman', plural: 'Hillmen', province: 'High Rock' },
    { name: 'Dunesman', plural: 'Dunesmen', province: 'Hammerfell' },
  ],
  attributes: ['Might', 'Wits', 'Resolve', 'Grace', 'Haste', 'Grit', 'Charm', 'Fortune'],
};

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const CHARACTER: Character = { name: 'Brin Tallow', gender: 'female', race: 1, cls: 0, attributes: [70, 40, 55, 65, 30, 62, 50, 81], face: 3 };

describe('character creation', () => {
  it('uses the game’s tables and files, or the remake’s own words and three classes without them', () => {
    const data = creationData(TABLES, { questions: [{ text: 'Q', answers: [] }] });
    expect(data.classes.map((c) => c.name)).toEqual(['Tinker', 'Sage']);
    expect(data.questions).toHaveLength(1);
    const fallback = creationData(undefined, { questions: [{ text: 'Q', answers: [] }] });
    expect(fallback.classes).toBe(FALLBACK_CLASSES);
    expect(fallback.races).toHaveLength(8);
    expect(fallback.questions).toEqual([]);
    expect(fallback.texts.knownAs.match(/%s/g)).toHaveLength(4);
  });

  it('fills in the names, and speaks of a woman as her', () => {
    expect(fillText('%s, the %s of his clan', ['Brin', 'Tinker'])).toBe('Brin, the Tinker of his clan');
    expect(fillText('His %s and his %s', ['axe', 'shield'], 'female')).toBe('Her axe and her shield');
    expect(fillText('This is history', [], 'female')).toBe('This is history');
  });

  /** A random number that Arena's dice turn into the given whole number. */
  const raw = (n: number) => (n + 0.5) / 0x10000;

  it('rolls Arena’s dice: dice of six or five counting from 0, rolled again over the most', () => {
    // 20 is four dice of 0 to 5; 25 five; 12 two of 0 to 6; up to 8 a plain 0 to n - 1.
    expect(arenaRoll(20, always(0))).toBe(0);
    expect(arenaRoll(20, always(raw(5)))).toBe(20);
    expect(arenaRoll(25, always(raw(5)))).toBe(25);
    expect(arenaRoll(12, always(raw(6)))).toBe(12);
    expect(arenaRoll(6, always(raw(11)))).toBe(5);
    // 14 is rounded up to 15, three dice of 0 to 5; over 14 rolls again.
    const rolls = [raw(5), raw(5), raw(5), raw(1), raw(2), raw(3)];
    expect(arenaRoll(14, () => rolls.shift() ?? 0)).toBe(6);
  });

  it('turns between the sheet’s hundred and Arena’s 256 as the game does', () => {
    expect([0, 1, 4, 20, 21, 50].map(to256)).toEqual([0, 3, 10, 51, 54, 128]);
    expect([77, 89, 102, 128, 182, 255].map(to100)).toEqual([30, 35, 40, 50, 71, 100]);
  });

  it('starts from the race’s attributes for the gender, adding a roll of 20 and one more on Arena’s scale', () => {
    // Made-up rows on Arena's scale: row 3 is race 1's women.
    const table = Array.from({ length: 16 }, (_, r) => Array.from({ length: 8 }, (_, i) => 77 + r + i));
    const low = rollAttributes(1, 'female', TINKER, always(0), table);
    expect(low.attributes).toEqual(table[3].map((a) => to100(a + 3)));
    expect(low).toMatchObject({ bonus: 0, gold: 50 });
    // Every die at its most for the attributes (8 x 4) and bonus points (5), then the health roll at nothing.
    const high = rollAttributes(0, 'male', TINKER, sequence(...new Array(37).fill(raw(5)), 0), table);
    expect(high.attributes).toEqual(table[0].map((a) => to100(a + 54)));
    expect(high.bonus).toBe(25);
    // Without the game's table, the remake's own: 40 across the board, plus the roll.
    expect(rollAttributes(0, 'male', TINKER, always(0)).attributes).toEqual(new Array(8).fill(41));
  });

  it('starts with 25 health plus the hit die and Endurance’s bonus, those at least 1', () => {
    // Tinker's die of 9 is two dice of 0 to 5, rolled again over 9.
    expect(rollAttributes(0, 'male', TINKER, sequence(...new Array(37).fill(0), raw(4), raw(4))).healthRoll).toBe(8);
    expect(startingHealth(8, 0)).toBe(25 + 8);
    expect(startingHealth(0, -2)).toBe(26);
  });

  it('counts the room left in the attributes, which caps the bonus points', () => {
    expect(attributeRoom([100, 99, 40, 100, 100, 100, 100, 100])).toBe(61);
    expect(attributeRoom(new Array(8).fill(100))).toBe(0);
  });

  it('works out the sheet’s numbers as the original shows them', () => {
    // Pairs seen on the original's sheet: Strength 36 to 68 against damage, and so on.
    const sheet = (a: Partial<Record<number, number>>) => derivedAttributes(Array.from({ length: 8 }, (_, i) => a[i] ?? 50));
    expect([36, 38, 42, 43, 48, 54, 57, 58, 63, 68].map((v) => sheet({ [STRENGTH]: v }).damage)).toEqual([-2, -1, -1, 0, 0, 1, 1, 2, 3, 4]);
    expect([35, 36, 40, 41, 45, 46, 55].map((v) => sheet({ [AGILITY]: v }).toHit)).toEqual([-3, -2, -2, -1, -1, 0, 1]);
    expect([35, 41, 46].map((v) => sheet({ [WILLPOWER]: v }).magicDefence)).toEqual([-3, -1, 0]);
    expect([37, 54, 55, 64, 65].map((v) => sheet({ [ENDURANCE]: v }).health)).toEqual([0, 0, 1, 1, 2]);
    // Endurance's on Arena's scale, as the program works it out: a step for every 25 from 116, here 94 and 6.
    expect([6, 94].map((v) => sheet({ [ENDURANCE]: v }).health)).toEqual([-4, 5]);
    expect([45, 54, 55].map((v) => sheet({ [PERSONALITY]: v }).charisma)).toEqual([-1, 0, 1]);
    expect(sheet({ [STRENGTH]: 71 }).maxKilos).toBe(142);
  });

  it('works out what the character brings to a fight from the class, attributes and what was rolled', () => {
    const hero = heroFor({ ...CHARACTER, health: 31, gold: 120 }, TINKER);
    expect(hero).toMatchObject({ cls: TINKER, health: 31, gold: 120, healthDie: 9, experience: 800, damageBonus: 4, carry: 140 });
    // Fatigue is Strength plus Endurance.
    expect(hero.stamina).toBe(70 + 62);
    expect(hero.healthBonus).toBe(derivedAttributes(CHARACTER.attributes).health);
    // Agility 65 is 166 on Arena's scale; only Monks and Acrobats are hard to hit for their level.
    expect(hero).toMatchObject({ agility: 166, evasive: false });
    expect([9, 12, 13].map((id) => heroFor(CHARACTER, { ...TINKER, id }).evasive)).toEqual([true, true, false]);
    // Arena's base speed for Speed 30: 20 + 76 * 20 / 256, against the remake's 30.
    expect(hero.pace).toBeCloseTo(25 / 30);
    expect(hero.critical).toBeCloseTo(0.14);
    const sage = heroFor({ ...CHARACTER, attributes: CHARACTER.attributes.map((v, i) => (i === WILLPOWER ? 90 : v)) }, SAGE);
    expect(sage).toMatchObject({ critical: 0, lockpicking: 0, gold: undefined });
    expect(sage.recovery).toBeCloseTo(1.16);
    // A character from before health was rolled gets the die's highest.
    expect(heroFor(CHARACTER, TINKER).health).toBe(25 + 9);
  });

  it('gives each race its knack with weapons, its resistance and its immunities', () => {
    const as = (race: number, cls = TINKER) => heroFor({ ...CHARACTER, race }, cls);
    // Redguards with anything but bows, Dark Elves with anything, Wood Elves with bows.
    expect(as(REDGUARD).knack).toEqual({ levels: 3, weapons: 'melee' });
    expect(as(DARK_ELF).knack).toEqual({ levels: 4, weapons: 'any' });
    expect(as(WOOD_ELF).knack).toEqual({ levels: 3, weapons: 'bows' });
    expect(as(NORD).knack).toBeUndefined();
    expect([as(NORD).resists, as(BRETON).resists, as(KHAJIIT).resists]).toEqual([COLD, MAGIC, undefined]);
    // Endurance 62 is 159 on Arena's scale: a quarter of it, 39, is 15 in a hundred at creation, and stays 39 after a level.
    expect(as(REDGUARD).paralysis).toBe(15);
    expect(heroFor(CHARACTER, TINKER, { levelled: true }).paralysis).toBe(39);
    // High Elves and Knights can't be paralysed.
    expect(as(HIGH_ELF).paralysis).toBe(0);
    expect(heroFor(CHARACTER, { ...TINKER, id: KNIGHT }).paralysis).toBe(0);
    // Khajiit and Acrobats climb four times as fast.
    expect([as(KHAJIIT).climbPace, as(NORD).climbPace, heroFor(CHARACTER, { ...TINKER, id: ACROBAT }).climbPace]).toEqual([4, 1, 4]);
  });

  it('works out the saves against each element as Arena keeps them', () => {
    // Willpower 55 is past the middle, so magic is always saved against; 40 (102) falls 26 short, 10 in a hundred at creation.
    expect(saves(CHARACTER.attributes)).toEqual([0, 0, 15, 0, 0]);
    const weak = CHARACTER.attributes.map((v, i) => (i === WILLPOWER ? 40 : v));
    expect(saves(weak)).toEqual([0, 0, 15, 0, 10]);
    expect(saves(weak, true)).toEqual([0, 0, 39, 0, 26]);
    expect(heroFor({ ...CHARACTER, attributes: weak }, TINKER).willpower).toBe(102);
  });

  it('picks the class the answers lead to, by the game’s table or else by the path most taken', () => {
    const data = { ...creationData(TABLES), chooser: (counts: readonly number[]) => (counts[0] >= 5 ? 0 : 1) };
    expect(classFromAnswers([0, 0, 0, 0, 0, 1, 1, 2, 2, 2], data)).toBe(0);
    expect(classFromAnswers([2, 2, 2, 2, 2, 2, 1, 1, 0, 0], data)).toBe(1);
    const fallback = creationData(undefined);
    expect(fallback.classes[classFromAnswers([1, 1, 1, 0, 2], fallback)].name).toBe('Thief');
    expect(fallback.classes[classFromAnswers([2, 2, 0], fallback)].name).toBe('Mage');
  });

  it('asks a number of questions picked at random', () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({ text: `Q${i}`, answers: [] }));
    const picked = pickQuestions(questions, 10, always(0));
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((q) => q.text)).size).toBe(10);
    expect(picked[0].text).toBe('Q0');
    expect(pickQuestions(questions.slice(0, 3), 10, always(0))).toHaveLength(3);
  });

  it('puts names together from the game’s pieces by race and gender, as Arena does', () => {
    const names = Array.from({ length: 50 }, (_, g) => [`p${g}a`, `p${g}b`]);
    expect(arenaName(0, 'male', always(0), names)).toBe('P0ap1a P4ap5a');
    expect(arenaName(0, 'female', always(0.9), names)).toBe('P2bp3b P4bp5b');
    expect(arenaName(2, 'male', always(0), names)).toBe('P11ap12a P15ap16asen');
    expect(arenaName(1, 'female', always(0), names)).toBe('P6ap7ap8ap10a');
    expect(arenaName(0, 'male', always(0))).toBeUndefined();
  });

  it('makes names by each race’s customs too, half the time when the game’s pieces are there', () => {
    const names = Array.from({ length: 50 }, (_, g) => [`p${g}a`, `p${g}b`]);
    expect(randomName(0, 'male', always(0), names)).toBe('P0ap1a P4ap5a');
    expect(randomName(0, 'male', always(0.9), names)).toBe(loreName(0, 'male', always(0.9)));
    // Without the pieces, always by the customs.
    expect(randomName(0, 'male', always(0))).toBe(loreName(0, 'male', always(0)));
    const many = (race: number, gender: 'male' | 'female') => Array.from({ length: 200 }, (_, i) => loreName(race, gender, sequence(...Array.from({ length: 8 }, (_, k) => ((i * 37 + k * 11) % 100) / 100))));
    // Nords: a father's name with -sen, or an epithet.
    expect(many(2, 'female').every((n) => /^[A-Z][a-z]+ ([A-Z][a-z]+sen|[A-Z][a-z]+-[A-Z][a-z]+)$/.test(n))).toBe(true);
    // Khajiit: a prefix of rank, or none.
    expect(many(6, 'male').some((n) => /^[A-Z][a-z]*'[a-z]+$/.test(n))).toBe(true);
    expect(many(6, 'male').some((n) => /^[A-Z][a-z]+$/.test(n))).toBe(true);
    // Argonians: a Jel name, or one like Swims-in-Reeds.
    expect(many(7, 'female').some((n) => /^[A-Z][a-z]+-[a-z]+-[A-Z][a-z]+$/.test(n))).toBe(true);
    // Every name starts with a capital and fits the name box.
    for (let race = 0; race < 8; race++) {
      for (const gender of ['male', 'female'] as const) expect(many(race, gender).every((n) => /^[A-Z]/.test(n) && n.length <= 24)).toBe(true);
    }
  });

  it('keeps the character for next time, and refuses one that does not fit the classes', () => {
    const store = new MemoryStorage() as unknown as Storage;
    const data = creationData(TABLES);
    expect(loadCharacter(data, store)).toBeUndefined();
    saveCharacter(CHARACTER, TINKER, store);
    expect(loadCharacter(data, store)).toEqual(CHARACTER);
    // Found by its class's name when the list has changed.
    expect(loadCharacter({ ...data, classes: [SAGE, TINKER] }, store)?.cls).toBe(1);
    store.setItem('es-arena.character', JSON.stringify({ ...CHARACTER, attributes: [1, 2, 3] }));
    expect(loadCharacter(data, store)).toBeUndefined();
    store.setItem('es-arena.character', '{not json');
    expect(loadCharacter(data, store)).toBeUndefined();
    saveCharacter(CHARACTER, TINKER, store);
    forgetCharacter(store);
    expect(loadCharacter(data, store)).toBeUndefined();
  });
});
