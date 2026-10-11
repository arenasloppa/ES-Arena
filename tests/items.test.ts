import { describe, expect, it } from 'vitest';
import type { ClassInfo } from '../src/formats/classes';
import type { WeaponInfo } from '../src/formats/exe';
import {
  armourReduce,
  CHAIN,
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

  it('makes armour of plate, chain and leather, and shields, rated by what they are made of', () => {
    expect(makeArmour(PLATE, 0, 1)).toMatchObject({ kind: 'armour', name: 'Steel Plate Cuirass', type: 0, armour: PLATE, rating: 18 });
    expect(makeArmour(CHAIN, 5, 0)).toMatchObject({ name: 'Iron Chain Helm', rating: 3 });
    expect(makeArmour(LEATHER, 6, 7)).toMatchObject({ name: 'Leather Boots', material: undefined, rating: 3 });
    expect(makeShield(3, 5)).toMatchObject({ kind: 'shield', name: 'Mithril Tower Shield', rating: 17 });
    expect(makeArmour(PLATE, 0, 7).rating!).toBeGreaterThan(makeArmour(PLATE, 0, 1).rating!);
  });

  it('finds each item’s picture among the game’s equipment pictures', () => {
    expect(itemFrame(makeWeapon(WEAPONS, 11, 1) as never)).toBe(11);
    expect(itemFrame(makeArmour(PLATE, 5, 1) as never)).toBe(23);
    expect(itemFrame(makeShield(2, 1) as never)).toBe(27);
    expect(itemFrame(makeArmour(CHAIN, 0, 1) as never)).toBe(29);
    expect(itemFrame(makeArmour(LEATHER, 6, 1) as never)).toBe(42);
  });

  it('takes blows down by the armour worn: 100 points halve them, and some always get through', () => {
    expect(armourReduce(10, 0)).toBe(10);
    expect(armourReduce(10, 100)).toBe(5);
    expect(armourReduce(1, 400)).toBe(1);
    expect(armourReduce(0, 50)).toBe(0);
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

  it('starts a class with a weapon it may use and a cuirass of the heaviest armour it may wear', () => {
    expect(startingGear(WEAPONS, cls()).map((g) => g.name)).toEqual(['Steel Shortsword', 'Iron Chain Cuirass']);
    expect(startingGear(WEAPONS, cls({ weapons: [0, 1], armour: 3 })).map((g) => g.name)).toEqual(['Steel Dagger']);
    expect(startingGear(WEAPONS).map((g) => g.name)).toEqual(['Steel Shortsword']);
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
    expect(inv.armourRating()).toBe(b.rating! + helm.rating!);
    expect(inv.toggle(helm)).toEqual({ ok: true });
    expect(inv.armourRating()).toBe(b.rating);
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
