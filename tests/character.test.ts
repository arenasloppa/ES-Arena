import { describe, expect, it } from 'vitest';
import type { CharacterTables, ClassInfo } from '../src/formats/classes';
import {
  classFromAnswers,
  creationData,
  derivedAttributes,
  FALLBACK_CLASSES,
  fillText,
  forgetCharacter,
  heroFor,
  loadCharacter,
  pickQuestions,
  randomName,
  rollAttributes,
  rollClassic,
  saveCharacter,
  WILLPOWER,
  type Character,
} from '../src/game/character';
import { always } from './helpers/level';

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

  it('rolls Arena’s dice: 4d5 for each attribute and 5d5 bonus points, rolling again over the most', () => {
    expect(rollClassic(20, always(0))).toBe(4);
    expect(rollClassic(25, always(0))).toBe(5);
    expect(rollClassic(20, always(raw(4)))).toBe(20);
    expect(rollClassic(6, always(raw(11)))).toBe(5);
    // Nine is rolled as two dice of five; ten is too many, so it rolls again.
    const rolls = [raw(4), raw(4), raw(0), raw(2)];
    expect(rollClassic(9, () => rolls.shift() ?? 0)).toBe(4);
  });

  it('starts from the race’s attributes for the gender, with health, gold and bonus points rolled', () => {
    const table = Array.from({ length: 16 }, (_, r) => Array.from({ length: 8 }, (_, i) => 30 + r + i));
    const low = rollAttributes(1, 'female', TINKER, always(0), table);
    expect(low.attributes).toEqual(table[3].map((a) => a + 4));
    expect(low).toMatchObject({ bonus: 5, health: 26, gold: 50 });
    const high = rollAttributes(0, 'male', TINKER, always(raw(4)), table);
    expect(high.attributes).toEqual(table[0].map((a) => a + 20));
    expect(high.bonus).toBe(25);
    // Without the game's table, the remake's own: 40 across the board.
    expect(rollAttributes(0, 'male', TINKER, always(0)).attributes).toEqual(new Array(8).fill(44));
  });

  it('works out the sheet’s values from the attributes as Arena does', () => {
    expect(derivedAttributes([43, 50, 38, 45, 50, 50, 46, 50])).toMatchObject({ damage: 0, maxKilos: 86, magicDefence: -2, toHit: -1, toDefend: -1, charisma: 0 });
    expect(derivedAttributes([70, 50, 64, 70, 50, 50, 75, 50])).toMatchObject({ damage: 4, maxKilos: 140, magicDefence: 2, toHit: 4, charisma: 5 });
    // Endurance on Arena's scale of 256: 50 is 128, 12 over the middle less than a step of 25.
    expect(derivedAttributes([50, 50, 50, 50, 50, 50, 50, 50]).health).toBe(0);
    expect(derivedAttributes([50, 50, 50, 50, 50, 90, 50, 50])).toMatchObject({ health: 2, healMod: 2 });
    expect(derivedAttributes([50, 50, 50, 50, 50, 10, 50, 50]).health).toBe(-1);
  });

  it('works out what the character brings to a fight from the class, attributes and what was rolled', () => {
    const hero = heroFor({ ...CHARACTER, health: 31, gold: 120 }, TINKER);
    expect(hero).toMatchObject({ cls: TINKER, health: 31, gold: 120, healthDie: 9, experience: 800, damageBonus: 4, carry: 140 });
    // Fatigue is Strength plus Endurance.
    expect(hero.stamina).toBe(70 + 62);
    expect(hero.healthBonus).toBe(derivedAttributes(CHARACTER.attributes).health);
    // Agility 65 is three steps, and Luck 81 six more of a smaller share.
    expect(hero.dodge).toBeCloseTo(3 * 0.02 + 6 * 0.005);
    // Arena's base speed for Speed 30: 20 + 76 * 20 / 256, against the remake's 30.
    expect(hero.pace).toBeCloseTo(25 / 30);
    expect(hero.critical).toBeCloseTo(0.14);
    const sage = heroFor({ ...CHARACTER, attributes: CHARACTER.attributes.map((v, i) => (i === WILLPOWER ? 90 : v)) }, SAGE);
    expect(sage).toMatchObject({ critical: 0, lockpicking: 0, gold: undefined });
    expect(sage.recovery).toBeCloseTo(1.16);
    // A character from before health was rolled gets the die's highest.
    expect(heroFor(CHARACTER, TINKER).health).toBe(25 + 9);
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

  it('puts names together from the game’s pieces by race and gender', () => {
    const names = Array.from({ length: 50 }, (_, g) => [`p${g}a`, `p${g}b`]);
    expect(randomName(0, 'male', always(0), names)).toBe('P0ap1a P4ap5a');
    expect(randomName(0, 'female', always(0.9), names)).toBe('P2bp3b P4bp5b');
    expect(randomName(2, 'male', always(0), names)).toBe('P11ap12a P15ap16asen');
    expect(randomName(1, 'female', always(0), names)).toBe('P6ap7ap8ap10a');
    // Without the pieces, a name of the remake's own.
    expect(randomName(0, 'male', always(0))).toMatch(/^[A-Z][a-z]+$/);
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
