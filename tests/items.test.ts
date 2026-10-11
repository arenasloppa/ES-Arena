import { describe, expect, it } from 'vitest';
import type { ArmourTables } from '../src/formats/armour';
import type { ClassInfo } from '../src/formats/classes';
import type { WeaponInfo } from '../src/formats/exe';
import {
  armourRating,
  armourTables,
  CHAIN,
  FALLBACK_ARMOUR,
  Inventory,
  itemFrame,
  itemKey,
  LEATHER,
  makeArmour,
  makeShield,
  makeWeapon,
  materialFor,
  PLATE,
  POTION,
  randomGear,
  startingGear,
  usableWeapons,
} from '../src/game/items';
import { always } from './helpers/level';

/** A made-up weapon table in the game's order; none of these numbers come from the game. */
const NAMES = ['Staff', 'Dagger', 'Shortsword', 'Broadsword', 'Saber', 'Longsword', 'Claymore', 'Tanto', 'Wakizashi', 'Katana', 'Dai-Katana', 'Mace', 'Flail', 'War Hammer', 'War Axe', 'Battle Axe', 'Short Bow', 'Long Bow'];
const WEAPONS: WeaponInfo[] = NAMES.map((name, i) => ({ name, damage: [1 + (i % 4), 10 + i], twoHanded: [0, 6, 10, 15, 16, 17].includes(i), weight: 1 + i / 2, price: 20 + i }));

/** Made-up armour tables; none of these numbers come from the game. */
const ARMOUR: ArmourTables = {
  protection: [52, 33, 17],
  materialProtection: [-6, 0, 1, 6, 11, 16, 21, 26],
  materialChances: [12, 50, 70, 80, 90, 94, 97, 101],
  materialPrices: [2, 4, 12, 24, 60, 120, 240, 1200],
  shieldProtection: [6, 11, 16, 30],
  shieldCovers: [[0], [0, 3], [0, 1, 3], [0, 1, 2, 3, 6]],
  weights: [
    [13, 7, 11, 6, 6, 9, 7, 3, 4, 7, 11],
    [7, 3, 5, 4, 4, 5, 3, 3, 4, 7, 11],
    [3, 1, 2, 2, 2, 2, 2, 3, 4, 7, 11],
  ],
  prices: [
    [90, 40, 70, 50, 50, 70, 45, 12, 22, 33, 55],
    [45, 25, 35, 25, 25, 35, 25, 12, 22, 33, 55],
    [20, 12, 18, 12, 12, 18, 12, 12, 22, 33, 55],
  ],
};

function cls(overrides: Partial<ClassInfo> = {}): ClassInfo {
  return { name: 'Tinker', healthDie: 9, experience: 800, spellcaster: false, critical: false, thief: false, armour: CHAIN, shields: [0, 1], weapons: [1, 2, 6], ...overrides };
}

describe('gear', () => {
  it('makes weapons from the game’s table, in a material that changes their damage, weight and value', () => {
    expect(makeWeapon(WEAPONS, 3, 1)).toEqual({ kind: 'weapon', name: 'Steel Broadsword', type: 3, material: 1, damage: [4, 13], twoHanded: false, weight: 2.5, value: 23 });
    const ebony = makeWeapon(WEAPONS, 3, 7);
    expect(ebony).toMatchObject({ name: 'Ebony Broadsword', damage: [4, 25], weight: 3.3, value: 460 });
    expect(makeWeapon(WEAPONS, 0, 0).damage).toEqual([1, 9]);
  });

  it('makes armour and shields from the game’s tables, with only plate and shields in metals that protect better', () => {
    expect(makeArmour(PLATE, 0, 1, ARMOUR)).toEqual({ kind: 'armour', name: 'Steel Plate Cuirass', type: 0, armour: PLATE, material: 1, protection: 52, weight: 13, value: 90 });
    expect(makeArmour(PLATE, 5, 7, ARMOUR)).toMatchObject({ name: 'Ebony Plate Helm', protection: 78, weight: 9, value: 21000 });
    expect(makeArmour(PLATE, 5, undefined, ARMOUR)).toMatchObject({ name: 'Plate Helm', material: undefined, protection: 52, value: 70 });
    expect(makeArmour(CHAIN, 5, 0, ARMOUR)).toMatchObject({ name: 'Chain Helm', material: undefined, protection: 33, weight: 5, value: 35 });
    expect(makeArmour(LEATHER, 6, 7, ARMOUR)).toMatchObject({ name: 'Leather Boots', material: undefined, protection: 17, weight: 2 });
    expect(makeShield(3, 5, ARMOUR)).toEqual({ kind: 'shield', name: 'Mithril Tower Shield', type: 3, material: 5, protection: 46, covers: [0, 1, 2, 3, 6], weight: 11, value: 1650 });
    expect(makeShield(0, undefined, ARMOUR)).toMatchObject({ name: 'Buckler', protection: 6, covers: [0] });
    // No shield protects more than plate.
    expect(makeShield(3, 7, ARMOUR).protection).toBe(52);
    // Arena shows a fifth of the protection as the armour rating.
    expect(armourRating(makeArmour(PLATE, 5, 7, ARMOUR))).toBe(15);
    expect(armourTables({ protection: [70, 50, 30] })).toEqual({ ...FALLBACK_ARMOUR, protection: [70, 50, 30] });
  });

  it('finds each item’s picture among the game’s equipment pictures', () => {
    expect(itemFrame(makeWeapon(WEAPONS, 11, 1) as never)).toBe(11);
    expect(itemFrame(makeArmour(PLATE, 5, 1) as never)).toBe(23);
    expect(itemFrame(makeShield(2, 1) as never)).toBe(27);
    expect(itemFrame(makeArmour(CHAIN, 0, 1) as never)).toBe(29);
    expect(itemFrame(makeArmour(LEATHER, 6, 1) as never)).toBe(42);
  });

  it('turns up better materials at higher levels, and never bows', () => {
    expect(usableWeapons(WEAPONS)).toEqual([...Array(16).keys()]);
    expect(materialFor(1, always(0.999))).toBe(2);
    expect(materialFor(9, always(0.999))).toBe(7);
    for (let i = 0; i < 200; i++) {
      const r = ((i * 37) % 100) / 100;
      const gear = randomGear(WEAPONS, 3, () => r);
      if (gear.kind === 'weapon') expect(gear.type).toBeLessThan(16);
    }
  });

  it('starts a class with one plain weapon by its place in the list, as Arena does', () => {
    expect([0, 5, 6, 11, 12, 17].map((id) => startingGear(WEAPONS, cls({ id })).map((g) => g.name))).toEqual([
      ['Dagger'],
      ['Dagger'],
      ['Shortsword'],
      ['Shortsword'],
      ['Broadsword'],
      ['Broadsword'],
    ]);
    // A class of the remake's own, with no place in the list: the first it may use.
    expect(startingGear(WEAPONS, cls({ weapons: [0, 1] })).map((g) => g.name)).toEqual(['Dagger']);
    expect(startingGear(WEAPONS).map((g) => g.name)).toEqual(['Shortsword']);
  });
});

describe('the inventory', () => {
  it('equips only what the class may use, in the game’s words', () => {
    const inv = new Inventory(cls(), '%ss cannot equip this.');
    const axe = inv.add(makeWeapon(WEAPONS, 14, 1));
    const plate = inv.add(makeArmour(PLATE, 0, 1));
    const leather = inv.add(makeArmour(LEATHER, 0, 1));
    const tower = inv.add(makeShield(3, 1));
    expect(inv.equip(axe)).toEqual({ ok: false, message: 'Tinkers cannot equip this.' });
    expect(inv.equip(plate).ok).toBe(false);
    expect(inv.equip(leather).ok).toBe(true);
    expect(inv.equip(tower).ok).toBe(false);
    expect(new Inventory().equip(axe).ok).toBe(true);
  });

  it('wears one thing in each place, and adds up the armour', () => {
    const inv = new Inventory();
    const a = inv.add(makeArmour(CHAIN, 0, 1));
    const b = inv.add(makeArmour(PLATE, 0, 1));
    const helm = inv.add(makeArmour(PLATE, 5, 1));
    inv.equip(a);
    inv.equip(b);
    inv.equip(helm);
    expect(inv.isEquipped(a)).toBe(false);
    expect(inv.wornItems()).toEqual([b, helm]);
    expect(inv.armourRating()).toBe(armourRating(b) + armourRating(helm));
    expect(inv.toggle(helm)).toEqual({ ok: true });
    expect(inv.armourRating()).toBe(armourRating(b));
  });

  it('protects each body part with the piece worn there and the shield if it covers it', () => {
    const inv = new Inventory();
    inv.equip(inv.add(makeArmour(PLATE, 0, 1, ARMOUR)));
    inv.equip(inv.add(makeArmour(LEATHER, 5, undefined, ARMOUR)));
    inv.equip(inv.add(makeShield(1, undefined, ARMOUR)));
    expect(inv.protection()).toEqual([52 + 11, 0, 0, 11, 0, 17, 0]);
    expect(inv.armourRating()).toBe(10 + 3 + 2);
  });

  it('puts the shield away for a two-handed weapon, and keeps a weapon in hand', () => {
    const inv = new Inventory();
    const sword = inv.add(makeWeapon(WEAPONS, 2, 1));
    const shield = inv.add(makeShield(1, 1));
    const claymore = inv.add(makeWeapon(WEAPONS, 6, 1));
    inv.equip(sword);
    inv.equip(shield);
    expect(inv.equip(claymore)).toEqual({ ok: true, message: 'Steel Round Shield put away: the Steel Claymore needs both hands' });
    expect(inv.isEquipped(shield)).toBe(false);
    expect(inv.equip(shield)).toEqual({ ok: false, message: 'Your Steel Claymore needs both hands' });
    expect(inv.unequip(claymore)).toEqual({ ok: false, message: 'You need a weapon in hand' });
    expect(inv.weapon).toBe(claymore);
  });

  it('keeps favourites and puts them on number keys, the potion first', () => {
    const inv = new Inventory();
    const sword = inv.add(makeWeapon(WEAPONS, 2, 1));
    expect(inv.favourites).toEqual([POTION]);
    expect(inv.hotkeyOf(POTION)).toBe(0);
    expect(inv.toggleFavourite(itemKey(sword))).toBe(true);
    inv.setHotkey(2, itemKey(sword));
    inv.setHotkey(4, itemKey(sword));
    expect(inv.hotkeys[2]).toBeUndefined();
    expect(inv.hotkeyOf(itemKey(sword))).toBe(4);
    expect(inv.toggleFavourite(itemKey(sword))).toBe(false);
    expect(inv.hotkeyOf(itemKey(sword))).toBeUndefined();
    inv.setHotkey(1, itemKey(sword));
    expect(inv.isFavourite(itemKey(sword))).toBe(true);
    inv.remove(sword);
    expect(inv.isFavourite(itemKey(sword))).toBe(false);
    expect(inv.byKey(itemKey(sword))).toBeUndefined();
  });

  it('lists the pictures of what is worn in the order they are drawn', () => {
    const inv = new Inventory();
    for (const item of [makeArmour(PLATE, 5, 1), makeWeapon(WEAPONS, 2, 1), makeArmour(PLATE, 0, 1), makeShield(0, 1), makeArmour(LEATHER, 2, 1)]) {
      inv.equip(inv.add(item));
    }
    expect(inv.pictureFrames()).toEqual([38, 18, 23, 2, 25]);
  });

  it('weighs what it holds, potions included', () => {
    const inv = new Inventory();
    inv.add(makeWeapon(WEAPONS, 2, 1));
    inv.add(makeArmour(LEATHER, 0, 1));
    expect(inv.weight(2)).toBe(2 + 2.4 + 1);
  });
});
