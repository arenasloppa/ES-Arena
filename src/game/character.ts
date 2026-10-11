/**
 * The player's character, made as in Arena: a class, a gender, a name, a
 * race (chosen by the province they come from), eight attributes rolled and
 * topped up with bonus points, and a face. Pure logic so it can be unit
 * tested; the screens that ask for each choice are in ui/creation.ts.
 *
 * The classes, races and words come from the player's own game when they can
 * be read (formats/classes.ts, formats/creation.ts). Otherwise the remake
 * uses three classes and plain words of its own. How the attributes are
 * rolled and what they do in play (heroFor) are the remake's own rules.
 */
import type { CharacterTables, ClassInfo, CreationTexts, RaceInfo } from '../formats/classes';
import type { ClassChooser, Question } from '../formats/creation';
import { roll, type Hero, type Random } from './combat';
import { regainsMagicka, startingMagicka } from './magic';

export type Gender = 'male' | 'female';

/** The attributes, in the game's order. */
export const STRENGTH = 0;
export const INTELLIGENCE = 1;
export const WILLPOWER = 2;
export const AGILITY = 3;
export const SPEED = 4;
export const ENDURANCE = 5;
export const PERSONALITY = 6;
export const LUCK = 7;
export const ATTRIBUTE_COUNT = 8;
/** The races, in the game's order. */
export const ARGONIAN = 7;
/** No attribute goes above this, bonus points included. */
export const ATTRIBUTE_MAX = 100;
/** Faces each race has to choose from. */
export const FACES = 10;

export interface Character {
  name: string;
  gender: Gender;
  /** Place in the race list, 0 to 7. */
  race: number;
  /** Place in the class list. */
  cls: number;
  /** The eight attributes, bonus points included, in the game's order. */
  attributes: number[];
  /** Which of the race's faces, 0 to 9. */
  face: number;
}

/** Everything character creation needs, from the game or the remake's own fallbacks. */
export interface CreationData {
  classes: ClassInfo[];
  races: RaceInfo[];
  attributes: string[];
  texts: CreationTexts;
  /** "%ss cannot equip this item.": %s class. */
  cannotEquip: string;
  /** The questions that pick a class; empty when the game's are missing. */
  questions: Question[];
  /** Which class a tally of answers leads to (CLASSES.DAT). */
  chooser?: ClassChooser;
  /** Groups of name pieces (NAMECHNK.DAT). */
  names?: string[][];
}

/** The remake's own classes, for when the game's can't be read. */
export const FALLBACK_CLASSES: ClassInfo[] = [
  { name: 'Warrior', healthDie: 15, experience: 1100, spellcaster: false, critical: true, thief: false, armour: 0, shields: [0, 1, 2, 3], needs: 'mighty and tough' },
  {
    name: 'Mage',
    healthDie: 7,
    experience: 1100,
    spellcaster: true,
    critical: false,
    thief: false,
    armour: 3,
    shields: [],
    weapons: [0, 1],
    needs: 'learned and strong of will',
  },
  {
    name: 'Thief',
    healthDie: 11,
    experience: 1100,
    spellcaster: false,
    critical: true,
    thief: true,
    armour: 2,
    shields: [0],
    weapons: [1, 2, 3, 4, 5, 7, 8, 11],
    needs: 'nimble and quick of hand',
  },
];

export const FALLBACK_RACES: RaceInfo[] = [
  { name: 'Breton', plural: 'Bretons', province: 'High Rock' },
  { name: 'Redguard', plural: 'Redguards', province: 'Hammerfell' },
  { name: 'Nord', plural: 'Nords', province: 'Skyrim' },
  { name: 'Dark Elf', plural: 'Dark Elves', province: 'Morrowind' },
  { name: 'High Elf', plural: 'High Elves', province: 'Summerset Isle' },
  { name: 'Wood Elf', plural: 'Wood Elves', province: 'Valenwood' },
  { name: 'Khajiit', plural: 'Khajiit', province: 'Elsweyr' },
  { name: 'Argonian', plural: 'Argonians', province: 'Black Marsh' },
];

export const FALLBACK_ATTRIBUTES = ['Strength', 'Intelligence', 'Willpower', 'Agility', 'Speed', 'Endurance', 'Personality', 'Luck'];

/** The remake's own words for each step, with the same names in the same places as the game's. */
export const FALLBACK_TEXTS: CreationTexts = {
  method: 'Choose your class from the list, or answer some questions and let the answers choose it for you.',
  questions: 'Answer each question as your character would.',
  name: 'What name will your %s go by?',
  gender: 'Is your character a man or a woman?',
  race: 'Where was %s the %s born?',
  classResult: 'Your answers suit the %s best.',
  home: 'Born in %s, among the %s?',
  knownAs: 'So be it: the %s %s of %s, kin to the %s.',
  needs: 'To do well you must be %s, as every %s is.',
  farewell: 'Your story begins in a cell beneath the Imperial City. Find a way out.',
  distribute: 'Share out your bonus points among your attributes.',
  appearance: 'Choose a face.',
};

const FALLBACK_CANNOT_EQUIP = 'A %s cannot use that.';

/** Gathers the game's character tables and creation files, filling gaps with the remake's own. */
export function creationData(
  tables: CharacterTables | undefined,
  files: { questions?: Question[]; chooser?: ClassChooser; names?: string[][] } = {},
): CreationData {
  return {
    classes: tables?.classes ?? FALLBACK_CLASSES,
    races: tables?.races ?? FALLBACK_RACES,
    attributes: tables?.attributes ?? FALLBACK_ATTRIBUTES,
    texts: tables?.texts ?? FALLBACK_TEXTS,
    cannotEquip: tables?.cannotEquip ?? FALLBACK_CANNOT_EQUIP,
    // Without the game's classes, the game's answers would lead to classes that aren't there.
    questions: tables ? (files.questions ?? []) : [],
    chooser: tables ? files.chooser : undefined,
    names: files.names,
  };
}

/**
 * Puts names into one of the creation texts in order, and speaks of a woman
 * as "her" where the game's text says "his".
 */
export function fillText(text: string, slots: string[], gender: Gender = 'male'): string {
  let i = 0;
  let out = text.replace(/%s/g, () => slots[i++] ?? '');
  if (gender === 'female') out = out.replace(/\b([Hh])is\b/g, (_, h: string) => (h === 'H' ? 'Her' : 'her'));
  return out;
}

// ---- Attributes ----

/** Each race's two gifts: attributes that start higher. */
const RACE_GIFTS: number[][] = [
  [INTELLIGENCE, PERSONALITY],
  [STRENGTH, AGILITY],
  [STRENGTH, ENDURANCE],
  [INTELLIGENCE, SPEED],
  [INTELLIGENCE, WILLPOWER],
  [AGILITY, SPEED],
  [AGILITY, LUCK],
  [ENDURANCE, SPEED],
];
const GIFT = 12;

export function raceGifts(race: number): number[] {
  return RACE_GIFTS[race] ?? [];
}

export interface AttributeRoll {
  attributes: number[];
  /** Points to share out on top. */
  bonus: number;
}

/** Rolls 25 plus three ten-sided dice for each attribute, plus the race's gifts, and 15 plus two dice of bonus points. */
export function rollAttributes(race: number, random: Random): AttributeRoll {
  const gifts = raceGifts(race);
  const attributes = Array.from({ length: ATTRIBUTE_COUNT }, (_, i) => {
    const rolled = 25 + roll(random, 1, 10) + roll(random, 1, 10) + roll(random, 1, 10);
    return Math.min(ATTRIBUTE_MAX, rolled + (gifts.includes(i) ? GIFT : 0));
  });
  return { attributes, bonus: 15 + roll(random, 1, 10) + roll(random, 1, 10) };
}

/** What an attribute adds or takes away: every full ten points above or below 50 counts one. */
export function attributeBonus(value: number): number {
  return Math.trunc((value - 50) / 10) || 0;
}

/** What the character brings to a fight, worked out from their class and attributes. */
export function heroFor(character: Character, cls: ClassInfo): Hero {
  const a = character.attributes;
  const bonus = (i: number) => attributeBonus(a[i]);
  return {
    cls,
    health: 20 + cls.healthDie + 2 * bonus(ENDURANCE),
    stamina: 70 + Math.round((a[ENDURANCE] + a[WILLPOWER]) * 0.3),
    healthDie: cls.healthDie,
    healthBonus: bonus(ENDURANCE),
    experience: cls.experience,
    damageBonus: bonus(STRENGTH),
    dodge: (a[AGILITY] - 50) * 0.004,
    pace: 0.88 + a[SPEED] * 0.0024,
    recovery: 0.8 + a[WILLPOWER] * 0.004,
    critical: cls.critical ? Math.max(0.02, 0.08 + 0.01 * bonus(LUCK)) : 0,
    lockpicking: cls.thief ? Math.max(0.1, 0.35 + 0.05 * bonus(AGILITY)) : 0,
    fortune: Math.max(0.5, 1 + 0.1 * bonus(LUCK)),
    carry: 100 + 2 * a[STRENGTH],
    magicka: startingMagicka(cls, a[INTELLIGENCE]),
    regainsMagicka: regainsMagicka(cls),
    // OpenTESArena's values for the original: everyone swims at half speed and 30 times their usual tiring, Argonians at full speed and 12 times.
    swimPace: character.race === ARGONIAN ? 1 : 0.5,
    swimTiring: character.race === ARGONIAN ? 12 / 30 : 1,
  };
}

// ---- Choosing a class ----

/** `count` questions picked at random, in random order. */
export function pickQuestions(questions: Question[], count: number, random: Random): Question[] {
  const pool = [...questions];
  const picked: Question[] = [];
  while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return picked;
}

/** The class the answers lead to: `paths` holds each answer's path (0 warrior, 1 thief, 2 mage). */
export function classFromAnswers(paths: number[], data: CreationData): number {
  const counts = [0, 1, 2].map((p) => paths.filter((x) => x === p).length);
  const chosen = data.chooser?.(counts);
  if (chosen !== undefined && chosen < data.classes.length) return chosen;
  // Without the game's table, the path most answers took.
  const path = counts.indexOf(Math.max(...counts));
  return Math.max(0, data.classes.findIndex((c) => c.name === ['Warrior', 'Thief', 'Mage'][path]));
}

// ---- Names ----

/**
 * How each race's names are put together from the groups of name pieces:
 * a piece from each numbered group in turn, with the words between.
 */
const NAME_RULES: Array<Record<Gender, Array<number | string>>> = [
  { male: [0, 1, ' ', 4, 5], female: [2, 3, ' ', 4, 5] },
  { male: [6, 7, 8, 9], female: [6, 7, 8, 10] },
  { male: [11, 12, ' ', 15, 16, 'sen'], female: [13, 14, ' ', 15, 16, 'sen'] },
  { male: [17, 18, ' ', 21, 22], female: [19, 20, ' ', 21, 22] },
  { male: [23, 24, ' ', 27, 28], female: [25, 26, ' ', 27, 28] },
  { male: [29, 30, ' ', 33, 34], female: [31, 32, ' ', 33, 34] },
  { male: [35, 36], female: [37, 38] },
  { male: [47, 48, 49], female: [47, 48, 49] },
];

/** The remake's own syllables, for when the game's name pieces are missing. */
const SYLLABLES = [
  ['Al', 'Bran', 'Cor', 'Dar', 'El', 'Fen', 'Gar', 'Hal', 'Isk', 'Jor', 'Kel', 'Lor', 'Mar', 'Ner', 'Or', 'Rav', 'Sel', 'Tor', 'Ul', 'Vel'],
  ['a', 'e', 'i', 'o', 'u', 'ae', 'ia'],
  ['dric', 'mund', 'ric', 'vald', 'wen', 'th', 'ra', 'nor', 'mir', 'dan', 'lis', 'gar'],
];

/** A random name for the race and gender, from the game's name pieces when there are some. */
export function randomName(race: number, gender: Gender, random: Random, names?: string[][]): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length)] ?? '';
  const rule = NAME_RULES[race]?.[gender];
  if (names && rule && rule.every((part) => typeof part === 'string' || names[part]?.length)) {
    const name = rule.map((part) => (typeof part === 'string' ? part : pick(names[part]))).join('');
    return name.replace(/(^|\s)([a-z])/g, (_, space: string, c: string) => space + c.toUpperCase()).trim();
  }
  return pick(SYLLABLES[0]) + pick(SYLLABLES[1]) + pick(SYLLABLES[2]);
}

// ---- Keeping the character ----

const STORAGE_KEY = 'es-arena.character';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function saveCharacter(character: Character, cls: ClassInfo, store = storage()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify({ ...character, className: cls.name }));
  } catch {
    // Private windows may refuse; the character then lasts until the page closes.
  }
}

/** The character made last time, if it is still a valid one for these classes and races. */
export function loadCharacter(data: CreationData, store = storage()): Character | undefined {
  let saved: Partial<Character> & { className?: string };
  try {
    saved = JSON.parse(store?.getItem(STORAGE_KEY) ?? 'null') ?? {};
  } catch {
    return undefined;
  }
  const byName = data.classes.findIndex((c) => c.name === saved.className);
  const cls = byName >= 0 ? byName : saved.cls;
  const whole = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < max;
  const attributes = saved.attributes;
  if (
    typeof saved.name !== 'string' ||
    !saved.name.trim() ||
    (saved.gender !== 'male' && saved.gender !== 'female') ||
    !whole(saved.race, data.races.length) ||
    !whole(cls, data.classes.length) ||
    !whole(saved.face, FACES) ||
    !Array.isArray(attributes) ||
    attributes.length !== ATTRIBUTE_COUNT ||
    !attributes.every((v) => whole(v, ATTRIBUTE_MAX + 1))
  ) {
    return undefined;
  }
  return { name: saved.name.trim().slice(0, 32), gender: saved.gender, race: saved.race!, cls: cls!, attributes: [...attributes], face: saved.face! };
}

export function forgetCharacter(store = storage()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}
