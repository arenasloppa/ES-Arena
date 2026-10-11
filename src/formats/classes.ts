/**
 * Character tables read from the unpacked program (see pklite.ts): Arena's
 * eighteen classes and what each may use, the races and their provinces,
 * the attribute names, and the game's words for each step of character
 * creation. Like the creature tables (exe.ts), they are found from the
 * lists of names next to them and checked before use.
 *
 * Classes come in the game's order, Mage to Knight, in three places:
 *   - The class names, a spare "BattleMage", then 18 u16: the experience
 *     each class needs to reach level 2.
 *   - The class names again, after 18 flag bytes: the low five bits hold
 *     the class's place in the list, 0x20 marks spellcasters, 0x40 classes
 *     that land critical hits and 0x80 those that pick locks. After these
 *     names come 18 bytes giving the classes in alphabetical order, the
 *     attribute names, the races (plural, then singular) and 18 bytes: the
 *     die each class rolls for health.
 *   - After the message "%ss cannot equip this item." and the one after
 *     it: 18 u16 pointers to lists of the weapons each class may use (0 for
 *     any), the lists (each ending in 0xff), 18 pointers to lists of
 *     shields (7 buckler to 10 tower), those lists, and 18 bytes for the
 *     heaviest armour allowed (0 plate, 1 chain, 2 leather, 3 none), just
 *     before the colour names ("Green", "Black", ...). The pointers are
 *     offsets into the program's data segment, which starts where the
 *     smallest weapon pointer lands on the first list.
 * The provinces ("High Rock", "Hammerfell", ...) are in the races' order.
 * The creation texts are twelve messages, from the one that asks how to
 * choose a class on, then 18 phrases for what each class needs to be, then
 * the question that asks which class to choose.
 */
import { cString, ExeLayoutError, find, stringsAt, stringsLength } from './cstrings';

const CLASSES = 18;
const RACES = 8;
const ATTRIBUTES = 8;

export interface ClassInfo {
  /** e.g. "Spellsword". */
  name: string;
  /** Health each level adds is rolled from 1 to this. */
  healthDie: number;
  /** Experience needed to reach level 2. */
  experience: number;
  spellcaster: boolean;
  /** Lands critical hits. */
  critical: boolean;
  /** Picks locks. */
  thief: boolean;
  /** Heaviest armour allowed: 0 plate, 1 chain, 2 leather, 3 none. */
  armour: number;
  /** Shields it may carry: 0 buckler, 1 round, 2 kite, 3 tower. */
  shields: number[];
  /** Weapons it may use, by place in the game's weapon list; undefined for any. */
  weapons?: number[];
  /** What the class needs to be, in the game's words, for the creation text that says so. */
  needs?: string;
}

export interface RaceInfo {
  /** "Nord". */
  name: string;
  /** "Nords". */
  plural: string;
  /** Its home province: "Skyrim". */
  province: string;
}

/** The game's message for each step of character creation; %s marks where names go. */
export interface CreationTexts {
  /** How to choose a class. */
  method: string;
  /** Before the questions. */
  questions: string;
  /** Asks the name: %s class. */
  name: string;
  gender: string;
  /** Asks where the character comes from: %s name, %s class. */
  race: string;
  /** The class the answers chose: %s class. */
  classResult: string;
  /** Confirms the province: %s province, %s race (plural). */
  home: string;
  /** Sums the character up: %s class, %s name, %s province, %s race (plural). */
  knownAs: string;
  /** What the class needs: %s phrase, %s class. */
  needs: string;
  farewell: string;
  /** Before the bonus points are shared out. */
  distribute: string;
  /** Before the face is chosen. */
  appearance: string;
}

export interface CharacterTables {
  /** In the game's order: classes[i] is class i. */
  classes: ClassInfo[];
  /** Breton, Redguard, Nord, Dark Elf, High Elf, Wood Elf, Khajiit, Argonian. */
  races: RaceInfo[];
  /** Strength, Intelligence, Willpower, Agility, Speed, Endurance, Personality, Luck. */
  attributes: string[];
  texts?: CreationTexts;
  /** "%ss cannot equip this item.": %s class. */
  cannotEquip?: string;
}

/** How many %s each creation text holds, in the order the program keeps them. */
const TEXTS: Array<[keyof CreationTexts, number]> = [
  ['method', 0],
  ['questions', 0],
  ['name', 1],
  ['gender', 0],
  ['race', 2],
  ['classResult', 1],
  ['home', 2],
  ['knownAs', 4],
  ['needs', 2],
  ['farewell', 0],
  ['distribute', 0],
  ['appearance', 0],
];

export function readCharacterTables(image: Uint8Array): CharacterTables {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);

  // The first list of class names, and the experience each needs.
  const first = find(image, 'Mage\0Spellsword\0', 'class names');
  const names = stringsAt(image, first, CLASSES);
  let p = first + stringsLength(names);
  const spare = cString(image, p);
  if (spare.toLowerCase() !== 'battlemage') throw new ExeLayoutError('the class experience table is missing');
  p += spare.length + 1;
  const experience = names.map((_, i) => view.getUint16(p + i * 2, true));

  // The second list, after the flags, and what follows it.
  const second = find(image, 'Mage\0Spellsword\0', 'class flags', p + CLASSES * 2);
  const flags = image.subarray(second - CLASSES, second);
  if (!flags.every((f, i) => (f & 0x1f) === i)) throw new ExeLayoutError('the class flags are implausible');
  p = second + stringsLength(stringsAt(image, second, CLASSES)) + CLASSES;
  const attributes = stringsAt(image, p, ATTRIBUTES);
  p += stringsLength(attributes);
  const plural = stringsAt(image, p, RACES);
  p += stringsLength(plural);
  const singular = stringsAt(image, p, RACES);
  p += stringsLength(singular);
  const dice = image.subarray(p, p + CLASSES);
  const provinces = stringsAt(image, find(image, 'High Rock\0Hammerfell\0', 'province names'), RACES);

  const word = /^[A-Za-z][A-Za-z' ()-]*$/;
  if (![...names, ...attributes, ...plural, ...singular, ...provinces].every((s) => word.test(s))) {
    throw new ExeLayoutError('the class and race names are implausible');
  }
  if (!experience.every((xp) => xp >= 100 && xp <= 20000) || !dice.every((d) => d >= 2 && d <= 64)) {
    throw new ExeLayoutError('the class tables are implausible');
  }

  const classes: ClassInfo[] = names.map((name, i) => ({
    name,
    healthDie: dice[i],
    experience: experience[i],
    spellcaster: (flags[i] & 0x20) !== 0,
    critical: (flags[i] & 0x40) !== 0,
    thief: (flags[i] & 0x80) !== 0,
    // Until the equipment tables say otherwise: anything.
    armour: 0,
    shields: [0, 1, 2, 3],
  }));
  const tables: CharacterTables = {
    classes,
    races: singular.map((name, i) => ({ name, plural: plural[i], province: provinces[i] })),
    attributes,
  };

  // What each class may use, and its message; without them, every class may use anything.
  try {
    tables.cannotEquip = readEquipment(image, view, classes);
  } catch (err) {
    if (!(err instanceof ExeLayoutError)) throw err;
    console.warn('Could not read what each class may use:', err.message);
  }
  try {
    const { texts, phrases } = readTexts(image);
    tables.texts = texts;
    classes.forEach((c, i) => (c.needs = phrases[i]));
  } catch (err) {
    if (!(err instanceof ExeLayoutError)) throw err;
    console.warn('Could not read the character creation texts:', err.message);
  }
  return tables;
}

/** Fills in the weapons, shields and armour each class may use; returns the "cannot equip" message. */
function readEquipment(image: Uint8Array, view: DataView, classes: ClassInfo[]): string {
  // "%ss cannot equip this item.": table data runs right up to it, so look back for its "%s".
  const at = find(image, 'cannot equip this item', 'class equipment');
  const start = image.lastIndexOf(0x25, at);
  const message = cString(image, start);
  if (start < 0 || at - start > 8 || !message.startsWith('%s')) throw new ExeLayoutError('the equipment message is implausible');
  let p = start + message.length + 1;
  p += cString(image, p).length + 1;

  const pointers = (at: number) => classes.map((_, i) => view.getUint16(at + i * 2, true));
  /** Reads the lists the pointers lead to; returns them and where the last one ends. */
  const lists = (ptrs: number[], base: number, from: number, valid: (v: number) => boolean) => {
    let end = from;
    const out = ptrs.map((ptr) => {
      if (!ptr) return undefined;
      const list: number[] = [];
      let q = ptr + base;
      if (q < from) throw new ExeLayoutError('the class equipment lists are implausible');
      for (; image[q] !== 0xff; q++) {
        if (q >= image.length || list.length >= 24 || !valid(image[q])) throw new ExeLayoutError('the class equipment lists are implausible');
        list.push(image[q]);
      }
      end = Math.max(end, q + 1);
      return list;
    });
    return { out, end };
  };

  const weaponPtrs = pointers(p);
  const weaponLists = p + CLASSES * 2;
  const used = weaponPtrs.filter((ptr) => ptr);
  let base = used.length ? weaponLists - Math.min(...used) : undefined;
  const weapons = lists(weaponPtrs, base ?? 0, weaponLists, (v) => v < 18);

  const shieldPtrs = pointers(weapons.end);
  const shieldLists = weapons.end + CLASSES * 2;
  const carried = shieldPtrs.filter((ptr) => ptr);
  if (carried.length) {
    const fromShields = shieldLists - Math.min(...carried);
    if (base !== undefined && base !== fromShields) throw new ExeLayoutError('the class equipment pointers disagree');
    base = fromShields;
  }
  const shields = lists(shieldPtrs, base ?? 0, shieldLists, (v) => v >= 7 && v <= 10);

  const armour = image.subarray(shields.end, shields.end + CLASSES);
  if (!armour.every((a) => a <= 3) || cString(image, shields.end + CLASSES) !== 'Green') {
    throw new ExeLayoutError('the class armour table is implausible');
  }
  classes.forEach((c, i) => {
    c.weapons = weapons.out[i];
    c.shields = (shields.out[i] ?? []).map((s) => s - 7);
    c.armour = armour[i];
  });
  return message.replace(/\r/g, ' ').trim();
}

function readTexts(image: Uint8Array): { texts: CreationTexts; phrases: string[] } {
  const start = find(image, 'How do you wish', 'creation texts');
  const list = stringsAt(image, start, TEXTS.length);
  const phrases = stringsAt(image, start + stringsLength(list), CLASSES);
  const closing = cString(image, start + stringsLength(list) + stringsLength(phrases));
  const texts = {} as CreationTexts;
  TEXTS.forEach(([key, slots], i) => {
    if ((list[i].match(/%[a-z]/g) ?? []).length !== slots || (slots && (list[i].match(/%s/g) ?? []).length !== slots)) {
      throw new ExeLayoutError(`the creation text "${key}" is implausible`);
    }
    // Arena breaks its lines to fit its scrolls; the remake lays them out itself.
    texts[key] = list[i].replace(/\s*\r\s*/g, ' ').trim();
  });
  if (!phrases.every((s) => /^[a-z]+( [a-z]+)*$/.test(s)) || !closing.trim().endsWith('?')) {
    throw new ExeLayoutError('the class needs are implausible');
  }
  return { texts, phrases };
}
