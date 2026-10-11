/**
 * Gear and the inventory that holds it: weapons from the game's weapon
 * table, armour and shields, in Arena's materials from Iron to Ebony. Pure
 * logic so it can be unit tested.
 *
 * A weapon's damage, weight and price come from the player's own game
 * (formats/exe.ts), its damage raised or lowered by its material. Armour and
 * shield ratings, weights and values, what each material is worth and what
 * turns up where are the remake's own numbers. Worn armour takes blows down
 * by its rating: 100 points halve them.
 */
import type { ClassInfo } from '../formats/classes';
import type { WeaponInfo } from '../formats/exe';
import { weaponCif, type Random, type Weapon } from './combat';

export interface Material {
  name: string;
  /** Multiplies a weapon's highest damage and an armour's rating. */
  quality: number;
  /** Multiplies weight. */
  weight: number;
  /** Multiplies value. */
  value: number;
}

export const MATERIALS: Material[] = [
  { name: 'Iron', quality: 0.85, weight: 1.1, value: 0.6 },
  { name: 'Steel', quality: 1, weight: 1, value: 1 },
  { name: 'Silver', quality: 1.1, weight: 1, value: 2 },
  { name: 'Elven', quality: 1.25, weight: 0.7, value: 4 },
  { name: 'Dwarven', quality: 1.4, weight: 1.2, value: 6 },
  { name: 'Mithril', quality: 1.55, weight: 0.8, value: 9 },
  { name: 'Adamantium', quality: 1.7, weight: 1.1, value: 13 },
  { name: 'Ebony', quality: 1.9, weight: 1.3, value: 20 },
];
export const IRON = 0;
export const STEEL = 1;

/** Armour types, heaviest first, numbered as the class tables number them. */
export const ARMOUR_TYPES = ['Plate', 'Chain', 'Leather'];
export const PLATE = 0;
export const CHAIN = 1;
export const LEATHER = 2;
/** The pieces of a suit, in the order the game's pictures come in. */
export const PIECES = ['Cuirass', 'Gauntlets', 'Greaves', 'Left Pauldron', 'Right Pauldron', 'Helm', 'Boots'];
export const SHIELDS = ['Buckler', 'Round Shield', 'Kite Shield', 'Tower Shield'];

/** Each piece's share of a suit. */
const PIECE_SHARE = [3, 1, 2, 1, 1, 1, 1];
/** Per share of a suit, by armour type. */
const ARMOUR_RATING = [6, 4, 2.5];
const ARMOUR_WEIGHT = [2.4, 1.6, 0.8];
const ARMOUR_VALUE = [40, 25, 10];
const SHIELD_RATING = [4, 6, 8, 11];
const SHIELD_WEIGHT = [2, 4, 6, 9];
const SHIELD_VALUE = [15, 30, 50, 80];
/** For a game whose weapon table has no weights and prices: the remake's own, by place in the weapon list. */
const WEAPON_WEIGHT = [2.2, 0.6, 2.6, 3.7, 3.3, 4.1, 6.3, 0.9, 2.3, 3.6, 5.8, 4.6, 5.1, 7.2, 5.3, 7.6, 1.3, 1.9];
const WEAPON_VALUE = [12, 14, 35, 55, 48, 70, 95, 22, 45, 85, 120, 40, 52, 66, 58, 88, 60, 90];
export const POTION_WEIGHT = 0.5;
/** Arena's dungeons have bows, but no way to shoot them here yet. */
const BOWS = new Set(['Short Bow', 'Long Bow']);

export type ItemKind = 'weapon' | 'armour' | 'shield';

export interface Item {
  id: number;
  kind: ItemKind;
  name: string;
  /**
   * Weapons: the place in the game's weapon list. Armour: the piece, 0
   * cuirass to 6 boots. Shields: 0 buckler to 3 tower.
   */
  type: number;
  /** 0 Iron to 7 Ebony; leather has none. */
  material?: number;
  /** Armour: 0 plate, 1 chain, 2 leather. */
  armour?: number;
  damage?: [number, number];
  twoHanded?: boolean;
  /** What it adds to the armour rating when worn. */
  rating?: number;
  /** Kilograms. */
  weight: number;
  value: number;
}

export type NewItem = Omit<Item, 'id'>;

/** Where an item is worn: the weapon hand, the shield arm or an armour piece. */
export type Slot = 'weapon' | 'shield' | `armour${number}`;

const round1 = (v: number) => Math.round(v * 10) / 10;

export function makeWeapon(weapons: WeaponInfo[], type: number, material: number): NewItem {
  const info = weapons[type];
  const m = MATERIALS[material];
  return {
    kind: 'weapon',
    name: `${m.name} ${info.name}`,
    type,
    material,
    damage: [info.damage[0], Math.max(info.damage[0], Math.round(info.damage[1] * m.quality))],
    twoHanded: info.twoHanded,
    weight: round1((info.weight ?? WEAPON_WEIGHT[type] ?? 3) * m.weight),
    value: Math.round((info.price ?? WEAPON_VALUE[type] ?? 30) * m.value),
  };
}

export function makeArmour(armour: number, piece: number, material: number): NewItem {
  const share = PIECE_SHARE[piece];
  // Leather is leather: it comes in no metal.
  const m = armour === LEATHER ? MATERIALS[STEEL] : MATERIALS[material];
  return {
    kind: 'armour',
    name: armour === LEATHER ? `Leather ${PIECES[piece]}` : `${m.name} ${ARMOUR_TYPES[armour]} ${PIECES[piece]}`,
    type: piece,
    armour,
    material: armour === LEATHER ? undefined : material,
    rating: Math.max(1, Math.round(ARMOUR_RATING[armour] * share * m.quality)),
    weight: round1(ARMOUR_WEIGHT[armour] * share * m.weight),
    value: Math.round(ARMOUR_VALUE[armour] * share * m.value),
  };
}

export function makeShield(shield: number, material: number): NewItem {
  const m = MATERIALS[material];
  return {
    kind: 'shield',
    name: `${m.name} ${SHIELDS[shield]}`,
    type: shield,
    material,
    rating: Math.round(SHIELD_RATING[shield] * m.quality),
    weight: round1(SHIELD_WEIGHT[shield] * m.weight),
    value: Math.round(SHIELD_VALUE[shield] * m.value),
  };
}

/** The weapon as the fighting rules and the first-person view need it. */
export function weaponOf(item: Item): Weapon {
  return { name: item.name, damage: item.damage ?? [1, 2], cif: weaponCif(item.type) ?? 'SWORD.CIF' };
}

/** The weapons that can be used, by place in the game's list: all but the bows. */
export function usableWeapons(weapons: WeaponInfo[]): number[] {
  return weapons.flatMap((w, i) => (BOWS.has(w.name) || i >= 16 ? [] : [i]));
}

/** The frame of the item's picture in the game's equipment pictures (0EQUIP.CIF for men, 1EQUIP.CIF for women). */
export function itemFrame(item: Pick<Item, 'kind' | 'type' | 'armour'>): number {
  if (item.kind === 'weapon') return item.type;
  if (item.kind === 'shield') return 25 + item.type;
  return [18, 29, 36][item.armour ?? 0] + item.type;
}

/** Damage after the armour worn takes its share: 100 points of armour halve it. Always at least 1. */
export function armourReduce(damage: number, rating: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round((damage * 100) / (100 + Math.max(0, rating))));
}

/** A material that gets better, and rarer, the higher the player's level. */
export function materialFor(level: number, random: Random): number {
  const reach = Math.min(MATERIALS.length, 2 + level);
  return Math.min(reach - 1, Math.floor(Math.min(random(), random()) * reach));
}

/** A piece of gear found in the dungeon: mostly weapons, then armour, sometimes a shield. */
export function randomGear(weapons: WeaponInfo[], level: number, random: Random): NewItem {
  const kind = random();
  const usable = usableWeapons(weapons);
  const material = materialFor(level, random);
  if (kind < 0.55 && usable.length) return makeWeapon(weapons, usable[Math.floor(random() * usable.length)], material);
  if (kind < 0.9 || !usable.length) {
    const type = Math.floor(random() * ARMOUR_TYPES.length);
    return makeArmour(type, Math.floor(random() * PIECES.length), material);
  }
  return makeShield(Math.floor(random() * SHIELDS.length), material);
}

/**
 * What a class starts with: a weapon it may use (a shortsword when it can)
 * and, if it may wear any, a cuirass of the heaviest armour allowed.
 */
export function startingGear(weapons: WeaponInfo[], cls?: ClassInfo): NewItem[] {
  const usable = usableWeapons(weapons).filter((i) => !cls?.weapons || cls.weapons.includes(i));
  const choice = [2, 11, 1, 0].find((i) => usable.includes(i)) ?? usable[0];
  const gear: NewItem[] = [];
  if (choice !== undefined) gear.push(makeWeapon(weapons, choice, STEEL));
  if (cls && cls.armour < 3) gear.push(makeArmour(cls.armour, 0, IRON));
  return gear;
}

/** The key the menus use for an entry: an item's, or the healing potions'. */
export const POTION = 'potion';
export const itemKey = (item: Item) => `item:${item.id}`;
export const HOTKEYS = 8;

export interface EquipResult {
  ok: boolean;
  /** Why not, or what else came off. */
  message?: string;
}

export class Inventory {
  readonly items: Item[] = [];
  /** The keys of the entries in the favourites list, in the order they were added. */
  readonly favourites: string[] = [POTION];
  /** What each number key uses: hotkeys[0] is 1. */
  readonly hotkeys: Array<string | undefined> = [POTION, ...new Array<undefined>(HOTKEYS - 1)];
  private readonly worn = new Map<Slot, number>();
  private nextId = 1;

  /**
   * `cannotEquip` is the game's "%ss cannot equip this item." for when the
   * class may not use something; with no class, anything goes.
   */
  constructor(
    private readonly cls?: ClassInfo,
    private readonly cannotEquip = 'A %s cannot use that.',
  ) {}

  add(item: NewItem): Item {
    const added = { ...item, id: this.nextId++ };
    this.items.push(added);
    return added;
  }

  get(id: number): Item | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** The item a menu key stands for. */
  byKey(key: string): Item | undefined {
    const m = /^item:(\d+)$/.exec(key);
    return m ? this.get(Number(m[1])) : undefined;
  }

  slot(item: Item): Slot {
    return item.kind === 'armour' ? `armour${item.type}` : item.kind;
  }

  isEquipped(item: Item): boolean {
    return this.worn.get(this.slot(item)) === item.id;
  }

  equipped(slot: Slot): Item | undefined {
    const id = this.worn.get(slot);
    return id === undefined ? undefined : this.get(id);
  }

  /** Everything worn and wielded. */
  wornItems(): Item[] {
    return [...this.worn.values()].map((id) => this.get(id)!);
  }

  get weapon(): Item | undefined {
    return this.equipped('weapon');
  }

  armourRating(): number {
    return this.wornItems().reduce((sum, i) => sum + (i.rating ?? 0), 0);
  }

  /** Kilograms carried, potions included. */
  weight(potions = 0): number {
    return round1(this.items.reduce((sum, i) => sum + i.weight, 0) + potions * POTION_WEIGHT);
  }

  /** Why the class may not use the item, or undefined when it may. */
  forbidden(item: Item): string | undefined {
    const cls = this.cls;
    if (!cls) return undefined;
    const allowed =
      item.kind === 'weapon'
        ? !cls.weapons || cls.weapons.includes(item.type)
        : item.kind === 'shield'
          ? cls.shields.includes(item.type)
          : cls.armour !== 3 && (item.armour ?? 0) >= cls.armour;
    return allowed ? undefined : this.cannotEquip.replace('%s', cls.name);
  }

  equip(item: Item): EquipResult {
    const why = this.forbidden(item);
    if (why) return { ok: false, message: why };
    if (item.kind === 'shield' && this.weapon?.twoHanded) return { ok: false, message: `Your ${this.weapon.name} needs both hands` };
    let message: string | undefined;
    if (item.kind === 'weapon' && item.twoHanded) {
      const shield = this.equipped('shield');
      if (shield) {
        this.worn.delete('shield');
        message = `${shield.name} put away: the ${item.name} needs both hands`;
      }
    }
    this.worn.set(this.slot(item), item.id);
    return { ok: true, message };
  }

  unequip(item: Item): EquipResult {
    if (!this.isEquipped(item)) return { ok: false };
    // There is no fighting with bare hands.
    if (item.kind === 'weapon') return { ok: false, message: 'You need a weapon in hand' };
    this.worn.delete(this.slot(item));
    return { ok: true };
  }

  /** Equips the item, or takes it off when it is worn already. */
  toggle(item: Item): EquipResult {
    return this.isEquipped(item) ? this.unequip(item) : this.equip(item);
  }

  /** Drops an item from the pack (and from the favourites and hotkeys). */
  remove(item: Item): void {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    if (this.isEquipped(item)) this.worn.delete(this.slot(item));
    this.items.splice(i, 1);
    this.forget(itemKey(item));
  }

  isFavourite(key: string): boolean {
    return this.favourites.includes(key);
  }

  /** Adds the entry to the favourites, or takes it off them; true when it is a favourite now. */
  toggleFavourite(key: string): boolean {
    const i = this.favourites.indexOf(key);
    if (i >= 0) {
      this.favourites.splice(i, 1);
      this.hotkeys.forEach((k, n) => k === key && (this.hotkeys[n] = undefined));
      return false;
    }
    this.favourites.push(key);
    return true;
  }

  /** Puts the entry on number key n + 1 (taking it off any other); a favourite, since Skyrim's hotkeys are. */
  setHotkey(n: number, key: string): void {
    if (n < 0 || n >= HOTKEYS) return;
    this.hotkeys.forEach((k, i) => k === key && (this.hotkeys[i] = undefined));
    this.hotkeys[n] = key;
    if (!this.isFavourite(key)) this.favourites.push(key);
  }

  hotkeyOf(key: string): number | undefined {
    const n = this.hotkeys.indexOf(key);
    return n >= 0 ? n : undefined;
  }

  /**
   * The pictures of what is worn, as frames of the game's equipment
   * pictures, in the order they are drawn over each other on the character:
   * greaves, boots, cuirass, gauntlets, pauldrons, helm, then the weapon and
   * the shield.
   */
  pictureFrames(): number[] {
    const order: Slot[] = ['armour2', 'armour6', 'armour0', 'armour1', 'armour3', 'armour4', 'armour5', 'weapon', 'shield'];
    return order.flatMap((slot) => {
      const item = this.equipped(slot);
      return item ? [itemFrame(item)] : [];
    });
  }

  private forget(key: string): void {
    const i = this.favourites.indexOf(key);
    if (i >= 0) this.favourites.splice(i, 1);
    this.hotkeys.forEach((k, n) => k === key && (this.hotkeys[n] = undefined));
  }
}
