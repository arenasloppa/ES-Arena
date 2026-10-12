import { describe, expect, it } from 'vitest';
import type { ExeData } from '../src/formats/exe';
import { ATTRIBUTE, JUMPING, RESTORE_POWER, type LootChances, type LootTables, type MagicInfo } from '../src/formats/loot';
import { parseSpells } from '../src/formats/spells';
import { DEFAULT_HERO, type Hero } from '../src/game/combat';
import { Dungeon, IDLE_INPUT, type DungeonEvent, type DungeonInput } from '../src/game/dungeon';
import { FALLBACK_ARMOUR, itemKey, type NewItem } from '../src/game/items';
import { conditionFor, creatureLoot, fineArmour, fineWeapon, plainArmour, potion, spotLoot, trinket, type LootRules } from '../src/game/loot';
import { ROUND } from '../src/game/magic';
import type { ClassInfo } from '../src/formats/classes';
import { always, fakeCreature, textLevel } from './helpers/level';
import { file, record } from './helpers/spells';

// Made-up tables throughout; none of these numbers or names come from the game.
const magic = (name: string, spell: number, level: number, price: number): MagicInfo => ({ name, spell, level, price });
const none: LootChances = [0, 0, 0, 0];

const TABLES: LootTables = {
  places: [none, none, none, [50, 40, 30, 20], none],
  creatures: [none, [0, 0, 100, 0], [30, 0, 0, 0], none],
  creatureClasses: [1, 9],
  potions: [
    { name: 'Potion of Testing', spell: 1, price: 30 },
    { name: 'Potion of Vigour', spell: RESTORE_POWER, price: 40 },
  ],
  spellTrinkets: [
    { name: 'Charm', chance: 60, castLevel: 5, price: 100, charges: [2, 4] },
    { name: 'Token', chance: 101, castLevel: 9, price: 300, charges: [3, 5] },
  ],
  trinketSpells: [
    [magic('of Sparks', 0, 1, 10), magic('of Storms', 2, 20, 50)],
    [magic('of Calm', 1, 1, 12)],
    [magic('of Light', 5, 1, 14)],
  ],
  trinkets: [
    { name: 'Band', chance: 50, price: 1000, boost: 5 },
    { name: 'Sash', chance: 101, price: 2000, boost: 7 },
  ],
  trinketAttributes: ['Might', 'Wit', 'Will', 'Grace', 'Haste', 'Grit', 'Charm', 'Fate'].map((n, i) => magic(`of ${n}`, ATTRIBUTE, 7, 100 + i)),
  qualities: [
    { chance: 80, price: 2 },
    { chance: 90, price: 3 },
    { chance: 100, price: 4 },
  ],
  weaponLevels: [1, 1, 1, 1, 30],
  fineSplit: [4, 8, 11],
  weaponEnchantments: [magic('of Sparks', 0, 1, 500), magic('of Might', ATTRIBUTE, 30, 900)],
  armourEnchantments: [magic('of Leaping', JUMPING, 1, 700), magic('of Wit', ATTRIBUTE, 1, 800)],
  armourLevels: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40],
    [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40],
  ],
  fineArmourLevels: [40, 40, 40, 40, 40, 1, 40, 40, 40, 40, 40],
};
const WEAPONS = [
  { name: 'Staff', damage: [1, 2] as [number, number], twoHanded: true, weight: 2, price: 10 },
  { name: 'Dagger', damage: [1, 3] as [number, number], twoHanded: false, weight: 0.5, price: 20 },
  { name: 'Shortsword', damage: [4, 4] as [number, number], twoHanded: false, weight: 1, price: 30 },
  { name: 'Broadsword', damage: [5, 9] as [number, number], twoHanded: false, weight: 3, price: 40 },
  { name: 'Saber', damage: [9, 20] as [number, number], twoHanded: false, weight: 3, price: 50 },
];
const cls = (overrides: Partial<ClassInfo> = {}): ClassInfo => ({ name: 'Tinker', healthDie: 9, experience: 800, spellcaster: false, critical: false, thief: false, armour: 3, shields: [], weapons: [1], ...overrides });
const RULES: LootRules = { tables: TABLES, weapons: WEAPONS, armour: FALLBACK_ARMOUR };

/** Hands out `values` in turn, then `rest`. */
function script(values: number[], rest = 0): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : rest);
}
/** The random number that makes a roll of `lo` to `hi - 1` come out as `n`. */
const as = (n: number, lo: number, hi: number) => (n - lo + 0.5) / (hi - lo);
/** A roll of 1 to 100 of `n`. */
const pc = (n: number) => as(n, 1, 101);

describe('loot spots', () => {
  it('rolls for gold, magic, plain gear and fine gear against the dungeon’s chances, all unidentified', () => {
    const loot = spotLoot(RULES, 2, always(0));
    // 1 to 100, plus the floor squared.
    expect(loot.gold).toBe(1 + 4);
    expect(loot.items.map((i) => i.name)).toEqual(['Charm of Sparks', 'Staff', 'Iron Staff']);
    expect(loot.items[0]).toMatchObject({ trinket: 'spell', unidentified: true, plainName: 'Charm', castLevel: 4, charges: 2, value: 120 });
    expect(loot.items.filter((i) => i.unidentified).length).toBe(1);
  });

  it('turns up nothing when every roll is above its chance', () => {
    expect(spotLoot(RULES, 0, script([pc(51), pc(41), pc(31), pc(21)]))).toEqual({ gold: 0, items: [] });
  });

  it('finds fine gear the player’s class can use, or none after 200 tries', () => {
    const rolls = [pc(100), pc(100), pc(100), pc(1), 0.1];
    expect(spotLoot(RULES, 0, script(rolls), cls()).items).toEqual([]);
    // The second weapon tried is a dagger.
    const dagger = spotLoot(RULES, 0, script([...rolls, as(0, 0, 4), as(1, 1, 11), as(1, 1, 100), as(1, 0, 4)]), cls());
    expect(dagger.items.map((i) => i.name)).toEqual(['Iron Dagger']);
  });
});

describe('what creatures carry', () => {
  it('gives gold only when a second roll is at least the chance, 1 to 10 times one more than the level', () => {
    const rolls = (second: number) => script([pc(30), pc(100), pc(100), pc(100), as(second, 0, 101), as(3, 1, 11)]);
    expect(creatureLoot(RULES, 2, 4, rolls(30)).gold).toBe(15);
    expect(creatureLoot(RULES, 2, 4, rolls(29)).gold).toBe(0);
    expect(creatureLoot(RULES, 3, 4, always(0))).toEqual({ gold: 0, items: [] });
  });

  it('carries the first plain gear its class may use, skipping armour for a class that wears none', () => {
    const rules = { ...RULES, classes: [cls({ weapons: [1] }), cls({ weapons: [3] })] };
    const tries = script([pc(100), pc(100), pc(1), pc(100), 0.1, as(0, 0, 4), 0.9, 0.1, as(1, 0, 4)]);
    expect(creatureLoot(rules, 1, 1, tries).items).toMatchObject([{ name: 'Dagger' }]);
    // With nothing it may use, the last of 20 tries is carried anyway.
    const never = { ...RULES, classes: [cls({ weapons: [] })] };
    expect(creatureLoot(never, 1, 1, script([pc(100), pc(100), pc(1), pc(100)], 0.1)).items).toMatchObject([{ name: 'Staff' }]);
  });

  it('gives the later creatures their own class, and none past the list', () => {
    const rules = { ...RULES, classes: [cls({ weapons: [1] }), cls({ weapons: [3] })] };
    const tables = { ...TABLES, creatures: [...TABLES.creatures, ...Array<LootChances>(13).fill([0, 0, 100, 0])] };
    const first = script([pc(100), pc(100), pc(1), pc(100)], 0.1);
    expect(creatureLoot({ ...rules, tables }, 15, 1, first).items).toMatchObject([{ name: 'Staff' }]);
    expect(creatureLoot({ ...rules, tables }, 16, 1, script([pc(100), pc(100), pc(1), pc(100), 0.1, as(0, 0, 4)])).items).toMatchObject([{ name: 'Staff' }]);
  });

  it('carries potions and trinkets, identified, only above level 3, and fine gear only above level 7', () => {
    const t = { ...TABLES, creatures: [none, [0, 100, 0, 100] as LootChances] };
    expect(creatureLoot({ ...RULES, tables: t }, 1, 2, always(0.6)).items).toEqual([]);
    const items = creatureLoot({ ...RULES, tables: t }, 1, 7, script([pc(1), pc(1), pc(1), pc(1), 0.6, as(0, 0, 2)], 0)).items;
    expect(items.map((i) => [i.name, !!i.unidentified])).toEqual([
      ['Potion of Testing', false],
      ['Iron Staff', false],
    ]);
  });
});

describe('potions and trinkets', () => {
  it('makes any of the game’s potions, a plain “Potion” until known', () => {
    expect(potion(RULES, always(0.9))).toMatchObject({ kind: 'potion', name: 'Potion of Vigour', plainName: 'Potion', spell: RESTORE_POWER, castLevel: 15, value: 40 });
  });

  it('makes spell trinkets with charges, priced by them, casting one level below the table’s', () => {
    const item = trinket(RULES, 10, script([as(0, 0, 3), as(70, 0, 100), as(0, 0, 3), 0, as(4, 3, 5)]));
    expect(item).toMatchObject({ name: 'Token of Sparks', plainName: 'Token', trinket: 'spell', spell: 0, castLevel: 8, charges: 4, value: 340 });
  });

  it('makes attribute trinkets only from level 7', () => {
    const rolls = () => script([as(1, 0, 3), as(30, 0, 100), as(1, 0, 8)]);
    expect(trinket(RULES, 6, rolls())).toBeUndefined();
    expect(trinket(RULES, 7, rolls())).toMatchObject({ name: 'Band of Wit', trinket: 'attribute', attribute: 1, boost: 5, value: 1101 });
  });

  it('makes protective trinkets of a metal from Elven up, by a quality roll of 76 to 99', () => {
    const item = trinket(RULES, 1, script([as(2, 0, 3), as(1, 0, 2), as(85, 76, 100)]));
    expect(item).toMatchObject({ name: 'Dwarven Sash', trinket: 'protective', material: 4, protection: FALLBACK_ARMOUR.materialProtection[4], value: 150 });
  });
});

describe('gear', () => {
  it('walks on from the piece rolled to the next found at the level, going back round to the first', () => {
    expect(plainArmour(RULES, 5, script([as(1, 0, 3), as(7, 0, 11)]))).toMatchObject({ name: 'Chain Cuirass' });
    expect(plainArmour(RULES, 5, script([as(2, 0, 3), 0]))).toBeUndefined();
  });

  it('makes fine gear of a material, enchanted, or both, by a roll of 1 to 10 against the split', () => {
    // 1 to 3: material only.
    expect(fineWeapon(RULES, 16, script([as(3, 0, 4), as(3, 1, 11), as(99, 1, 100)]))).toMatchObject({ name: 'Ebony Broadsword', damage: [9, 13] });
    // 4 to 7: enchanted only; 8 up: both.
    const sparks = fineWeapon(RULES, 16, script([as(3, 0, 4), as(4, 1, 11), 0]));
    expect(sparks).toMatchObject({ name: 'Broadsword of Sparks', plainName: 'Broadsword', spell: 0, castLevel: 14, value: 540, condition: 540 });
    expect(fineWeapon(RULES, 16, script([as(3, 0, 4), as(8, 1, 11), as(1, 1, 100), 0]))).toMatchObject({ name: 'Iron Broadsword of Sparks', damage: [5, 7] });
  });

  it('names fine plate by its metal and piece, and gives armour its enchantments', () => {
    expect(fineArmour(RULES, 16, script([0, as(1, 1, 11), as(99, 1, 100)]))).toMatchObject({ name: 'Ebony Helm', armour: 0, material: 7 });
    const leaping: NewItem | undefined = fineArmour(RULES, 16, script([0, as(5, 1, 11), as(0, 0, 2)]));
    expect(leaping).toMatchObject({ name: 'Helm of Leaping', jumping: true });
    expect(fineArmour(RULES, 16, script([0, as(5, 1, 11), as(1, 0, 2)]))).toMatchObject({ name: 'Helm of Wit', attribute: 1, boost: 10 });
  });

  it('sets the wear for casting by weight, or by price for magic gear, up to 50000', () => {
    expect([conditionFor(0.5, 10), conditionFor(0.25, 3), conditionFor(3.7, 120), conditionFor(1, 60000)]).toEqual([50, 25, 300, 50000]);
  });
});

// Made-up spells for the dungeon: a bolt, a heal and a fortify.
const SPELLS = parseSpells(
  file(
    record({ name: 'Dart', target: 2, element: 0, params: [[5, 5, 0, 0, 0, 0]], cost: 10 }),
    record({ name: 'Mend', target: 0, element: 5, effects: [12], subs: [1], params: [[10, 10, 0, 0, 0, 0]], cost: 8 }),
    record({ name: 'Might', target: 0, element: 5, effects: [11], attributes: [0], params: [[20, 5, 0, 0, 2, 3]], cost: 20 }),
  ),
);
const EXE: ExeData = {
  creatures: [fakeCreature({ id: 1, health: [3, 3] }), fakeCreature({ id: 3, health: [3, 3] })],
  weapons: WEAPONS,
  loot: TABLES,
};
const notes = (events: DungeonEvent[]) => events.flatMap((e) => (e.type === 'notify' ? [e.text] : []));
const hero = (overrides: Partial<Hero> = {}): Hero => ({ ...DEFAULT_HERO, ...overrides });
function tick(d: Dungeon, seconds: number, i: DungeonInput = IDLE_INPUT): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) d.update(0.05, i);
}
const click = { ...IDLE_INPUT, attack: { held: false, pressed: true, released: true } };

describe('loot in the dungeon', () => {
  it('fills a loot spot as it is opened and takes all of it', () => {
    const level = textLevel(['######', '#@...#', '######'], { items: [{ x: 2.5, y: 1.5, name: 'TREASURE.IMG', kind: 'treasure' }], floor: 2 });
    const d = new Dungeon(level, { ...EXE, loot: { ...TABLES, places: [none, none, none, [100, 0, 0, 0], none] } }, always(0));
    d.activate();
    expect(notes(d.events)).toEqual(['5 gold added']);
    expect(d.items[0].taken).toBe(true);
  });

  it('finds what a creature carried on its body, or Arena’s word that there is nothing', () => {
    const level = (type: number) => textLevel(['#######', '#@....#', '#######'], { creatures: [{ x: 2.7, y: 1.5, type }] });
    for (const [type, found] of [
      [0, 'Staff added'],
      [1, 'Nothing of value'],
    ] as const) {
      const d = new Dungeon(level(type), EXE, always(0), hero());
      tick(d, 0.3, click);
      tick(d, 1);
      d.activate();
      expect(notes(d.events)).toContain(found);
    }
  });

  it('drinks a potion, casting its spell, and knows every potion of its kind from then on', () => {
    const d = new Dungeon(textLevel(['####', '#@.#', '####']), EXE, always(0), hero({ health: 40 }), SPELLS);
    d.stats.health = 20;
    const plain = { kind: 'potion', name: 'Potion of Testing', type: 0, spell: 1, castLevel: 15, weight: 0.5, value: 1, plainName: 'Potion' } as const;
    d.inventory.add({ ...plain, unidentified: true });
    d.inventory.add({ ...plain, unidentified: true });
    expect(d.entries().find((e) => e.category === 'potions')).toMatchObject({ name: 'Potion', count: 2 });
    expect(d.use(itemKey({ id: 0, kind: 'potion', type: 0 }))).toBe('Potion of Testing drunk');
    expect(d.stats.health).toBe(30);
    expect(d.entries().find((e) => e.category === 'potions')).toMatchObject({ name: 'Potion of Testing', count: 1 });
  });

  it('gives back spell points with a potion of restoring them', () => {
    const d = new Dungeon(textLevel(['####', '#@.#', '####']), EXE, always(0), hero({ magicka: 100 }), SPELLS);
    d.stats.magicka = 50;
    const p = d.inventory.add({ kind: 'potion', name: 'Potion of Vigour', type: 1, spell: RESTORE_POWER, weight: 0.5, value: 1 });
    d.use(itemKey(p));
    expect(d.stats.magicka).toBe(75);
  });

  it('casts a trinket’s spell for a charge rather than spell points, until it has none', () => {
    const d = new Dungeon(textLevel(['#######', '#@....#', '#######']), EXE, always(0), hero(), SPELLS);
    const charm = d.inventory.add({ kind: 'trinket', trinket: 'spell', name: 'Charm of Darts', plainName: 'Charm', unidentified: true, type: 0, spell: 0, castLevel: 4, charges: 1, weight: 0, value: 1 });
    expect(d.entries().find((e) => e.key === itemKey(charm))).toMatchObject({ name: 'Charm', category: 'misc' });
    expect(d.use(itemKey(charm))).toBe('Dart cast with the Charm of Darts');
    expect(d.bolts).toHaveLength(1);
    expect(charm.charges).toBe(0);
    tick(d, 2);
    expect(d.use(itemKey(charm))).toBe('The Charm of Darts is worn out');
  });

  it('says why a trinket’s spell can’t go, and keeps the charge', () => {
    const d = new Dungeon(textLevel(['#######', '#@....#', '#######']), EXE, always(0), hero(), SPELLS);
    const charm = d.inventory.add({ kind: 'trinket', trinket: 'spell', name: 'Charm of Darts', type: 0, spell: 0, castLevel: 4, charges: 3, weight: 0, value: 1 });
    (d as unknown as { sanctuary: { until: number } }).sanctuary.until = Infinity;
    expect(d.use(itemKey(charm))).toBe('You can’t cast that in sanctuary');
    expect(notes(d.events)).toEqual([]);
    expect(charm.charges).toBe(3);
  });

  it('raises attributes while trinkets and Fortify spells are on the player, and works the character out again', () => {
    const d = new Dungeon(textLevel(['####', '#@.#', '####']), EXE, always(0), hero({ carry: 100 }), SPELLS);
    d.heroWith = (bonus) => hero({ carry: 100 + bonus[0] * 2 + bonus[1] });
    const band = d.inventory.add({ kind: 'trinket', trinket: 'attribute', name: 'Band of Wit', plainName: 'Band', unidentified: true, type: 0, attribute: 1, boost: 5, weight: 0, value: 1 });
    expect(d.use(itemKey(band))).toBe('Band of Wit equipped');
    expect(d.hero.carry).toBe(105);
    const might = d.inventory.add({ kind: 'potion', name: 'Potion of Might', type: 2, spell: 2, castLevel: 1, weight: 0.5, value: 1 });
    d.use(itemKey(might));
    expect(d.attributeBonus().slice(0, 2)).toEqual([20, 5]);
    expect(d.hero.carry).toBe(145);
    // 5 lost every 2 rounds, for 3 rounds at level 1.
    tick(d, 2 * ROUND + 0.1);
    expect(d.attributeBonus()[0]).toBe(15);
    tick(d, ROUND);
    expect(d.attributeBonus()[0]).toBe(0);
    d.use(itemKey(band));
    expect(d.hero.carry).toBe(100);
  });
});
