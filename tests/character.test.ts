import { describe, expect, it } from 'vitest';
import type { CharacterTables, ClassInfo } from '../src/formats/classes';
import {
  AGILITY,
  attributeBonus,
  classFromAnswers,
  creationData,
  ENDURANCE,
  FALLBACK_CLASSES,
  fillText,
  forgetCharacter,
  heroFor,
  INTELLIGENCE,
  loadCharacter,
  LUCK,
  PERSONALITY,
  pickQuestions,
  randomName,
  rollAttributes,
  saveCharacter,
  SPEED,
  STRENGTH,
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

  it('rolls each attribute from 28 to 55, plus the race’s two gifts, and 17 to 35 bonus points', () => {
    const low = rollAttributes(0, always(0));
    expect(low.attributes).toEqual([28, 40, 28, 28, 28, 28, 40, 28]);
    expect(low.bonus).toBe(17);
    const high = rollAttributes(1, always(0.999));
    expect(high.attributes[STRENGTH]).toBe(67);
    expect(high.attributes[AGILITY]).toBe(67);
    expect(high.attributes[INTELLIGENCE]).toBe(55);
    expect(high.bonus).toBe(35);
    expect(rollAttributes(0, always(0)).attributes[PERSONALITY]).toBe(40);
  });

  it('counts a point of bonus for every full ten above or below 50', () => {
    expect([50, 59, 60, 81, 41, 40, 25].map(attributeBonus)).toEqual([0, 0, 1, 3, 0, -1, -2]);
  });

  it('works out what the character brings to a fight from the class and attributes', () => {
    const hero = heroFor(CHARACTER, TINKER);
    expect(hero).toMatchObject({ cls: TINKER, healthDie: 9, healthBonus: 1, experience: 800, damageBonus: 2, carry: 240 });
    expect(hero.health).toBe(20 + 9 + 2);
    expect(hero.stamina).toBe(70 + Math.round((62 + 55) * 0.3));
    expect(hero.dodge).toBeCloseTo(0.06);
    expect(hero.pace).toBeCloseTo(0.88 + 30 * 0.0024);
    expect(hero.critical).toBeCloseTo(0.11);
    expect(hero.lockpicking).toBeCloseTo(0.4);
    expect(hero.fortune).toBeCloseTo(1.3);
    const sage = heroFor({ ...CHARACTER, attributes: CHARACTER.attributes.map((v, i) => (i === WILLPOWER ? 90 : i === SPEED ? 50 : v)) }, SAGE);
    expect(sage).toMatchObject({ critical: 0, lockpicking: 0 });
    expect(sage.pace).toBeCloseTo(1);
    expect(sage.recovery).toBeCloseTo(1.16);
    expect(heroFor({ ...CHARACTER, attributes: CHARACTER.attributes.map((v, i) => (i === ENDURANCE ? 20 : i === LUCK ? 10 : v)) }, TINKER)).toMatchObject({
      health: 20 + 9 - 6,
      healthBonus: -3,
    });
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
