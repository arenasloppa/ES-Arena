/**
 * Gear and the inventory that holds it: weapons from the game's weapon
 * table, armour and shields, in Arena's materials from Iron to Ebony, and
 * Arena's magic: potions, trinkets and enchanted gear. Pure logic so it can
 * be unit tested.
 *
 * A weapon's damage, weight and price come from the player's own game
 * (formats/exe.ts), its damage raised or lowered by its material as
 * Arena's program does it: Iron takes 2 off the most it can do, and the
 * finer metals add a fifth of what they add to armour. Armour and shields
 * protect, weigh and cost what the game says (formats/armour.ts), as in
 * Arena: each piece keeps blows off the body part it is worn on, and a
 * shield off the parts it covers, by its protection in percent (see
 * combat.ts's hitChance); only plate and shields come in the metals, which
 * add to it. Arena shows a fifth of the protection as the armour rating.
 * What turns up where is game/loot.ts's.
 *
 * Trinkets that raise an attribute or protect are worn, one of each kind
 * (bracelet, belt, torc, amulet); a protective one protects every body part.
 * Enchanted gear raises its attribute by 10 while worn, as Arena's program
 * does, and gear, trinkets and potions that cast a spell are used to cast it.
 * Magic that turns up unidentified shows its plain name until it is used or
 * worn (Arena identifies it at the Mages Guild, which the remake doesn't
 * have yet). Potions are counted by kind, and once one of a kind has been
 * drunk every potion of that kind is known.
 */
import type { ArmourTables } from '../formats/armour';
import type { ClassInfo } from '../formats/classes';
import type { WeaponInfo } from '../formats/exe';
import { BOWS, weaponCif, type Random, type Weapon } from './combat';
import {itemStats,addStats,ATTRIBUTE_STATS,QUALITY_COLOURS,type ItemQuality,type RolledAffix,type LootStats} from './affixes';
import {setBonuses} from './lootRoll';

/** Arena's materials, from the plainest to the finest. */
export const MATERIALS = ['Iron', 'Steel', 'Silver', 'Elven', 'Dwarven', 'Mithril', 'Adamantium', 'Ebony'];
export const IRON = 0;
export const STEEL = 1;
/** What Iron takes off the most a weapon can do (Arena's program, at 0x209A3). */
const IRON_DULLS = 2;

/** Armour types, heaviest first, numbered as the class tables number them. */
export const ARMOUR_TYPES = ['Plate', 'Chain', 'Leather'];
export const PLATE = 0;
export const CHAIN = 1;
export const LEATHER = 2;
/** The pieces of a suit, in the order the game's pictures come in. */
export const PIECES = ['Cuirass', 'Gauntlets', 'Greaves', 'Left Pauldron', 'Right Pauldron', 'Helm', 'Boots'];
export const SHIELDS = ['Buckler', 'Round Shield', 'Kite Shield', 'Tower Shield'];

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Each piece's share of a suit, for the remake's own weights and prices. */
const PIECE_SHARE = [3, 1, 2, 1, 1, 1, 1];
/** Per share of a suit, by armour type. */
const ARMOUR_WEIGHT = [2.4, 1.6, 0.8];
const ARMOUR_VALUE = [40, 25, 10];
const SHIELD_WEIGHT = [2, 4, 6, 9];
const SHIELD_VALUE = [15, 30, 50, 80];

/** The remake's own armour numbers, for whatever of the game's can't be read (formats/armour.ts says what each holds). */
export const FALLBACK_ARMOUR: ArmourTables = {
  protection: [40, 25, 10],
  materialProtection: [-4, 0, 2, 4, 8, 12, 16, 20],
  materialChances: [15, 55, 72, 84, 91, 95, 98, 101],
  materialPrices: [2, 4, 8, 16, 24, 36, 52, 80],
  shieldProtection: [4, 8, 12, 16],
  shieldCovers: [[0], [0, 1], [0, 1, 3], [0, 1, 2, 3]],
  weights: ARMOUR_WEIGHT.map((w) => [...PIECE_SHARE.map((share) => round1(w * share)), ...SHIELD_WEIGHT]),
  prices: ARMOUR_VALUE.map((v) => [...PIECE_SHARE.map((share) => v * share), ...SHIELD_VALUE]),
};

/** The game's armour tables, with the remake's own standing in for any it lacks. */
export function armourTables(read?: Partial<ArmourTables>): ArmourTables {
  return { ...FALLBACK_ARMOUR, ...read };
}

/** For a game whose weapon table has no weights and prices: the remake's own, by place in the weapon list. */
const WEAPON_WEIGHT = [2.2, 0.6, 2.6, 3.7, 3.3, 4.1, 6.3, 0.9, 2.3, 3.6, 5.8, 4.6, 5.1, 7.2, 5.3, 7.6, 1.3, 1.9];
const WEAPON_VALUE = [12, 14, 35, 55, 48, 70, 95, 22, 45, 85, 120, 40, 52, 66, 58, 88, 60, 90];
/** A potion's weight in kilograms; the remake's own. */
export const POTION_WEIGHT = 0.5;
/** What an enchantment of gear adds to its attribute while worn (Arena's program, at 0x169B4). */
export const GEAR_BOOST = 10;
/** Attributes go no higher than this, however much is worn. */
export const ATTRIBUTE_MAX = 100;
/** The attributes, Strength to Luck. */
export const ATTRIBUTES = 8;

export type ItemKind = 'weapon' | 'armour' | 'shield' | 'trinket' | 'potion' | 'ammunition';

/** Trinkets that cast a spell (Arena's marks, crystals, bracers and rings), raise an attribute, or protect. */
export type TrinketKind = 'spell' | 'attribute' | 'protective';

export interface Item {
  quality?:ItemQuality;
  itemLevel?:number;
  requiredLevel?:number;
  affixes?:RolledAffix[];
  modifiers?:LootStats;
  setId?:string;
  setPiece?:string;
  uniqueId?:string;
  id: number;
  kind: ItemKind;
  name: string;
  /**
   * Weapons: the place in the game's weapon list. Armour: the piece, 0
   * cuirass to 6 boots. Shields: 0 buckler to 3 tower. Trinkets: the kind
   * in its list (0 mark to 3 ring, or 0 bracelet to 3 amulet). Potions:
   * the kind in the game's list (-1 the remake's own healing potion).
   */
  type: number;
  /** 0 Iron to 7 Ebony; chain, leather and plain plate have none. */
  material?: number;
  /** Ammunition is one stack; other equipment remains individual items. */
  quantity?: number;
  /** Armour: 0 plate, 1 chain, 2 leather. */
  armour?: number;
  damage?: [number, number];
  twoHanded?: boolean;
  /** Armour and shields: how much less often, in percent, a blow lands where it is worn. */
  protection?: number;
  /** Shields: the body parts they cover. */
  covers?: number[];
  /** Kilograms. */
  weight: number;
  value: number;
  /** Which sort of trinket. */
  trinket?: TrinketKind;
  /** The spell it casts, by its place in the game's spell list (a potion's RESTORE_POWER restores spell points instead). */
  spell?: number;
  /** The caster's level its spell is cast at. */
  castLevel?: number;
  /** A trinket's spell can be cast this many more times. */
  charges?: number;
  /** Gear's wear left for casting its spell: each cast takes a 15th of the spell's cost, and at 0 it is broken. */
  condition?: number;
  /** The attribute it raises while worn (0 Strength to 7 Luck), and by how much. */
  attribute?: number;
  boost?: number;
  /** The wearer jumps as an Acrobat does. */
  jumping?: boolean;
  /** The remake's own healing potion: health it restores. */
  heals?: number;
  /** Not yet known: shown as `plainName` until used or worn. */
  unidentified?: boolean;
  plainName?: string;
}

export type NewItem = Omit<Item, 'id'>;

/** Where an item is worn: the weapon hand, the shield arm, an armour piece or a trinket of each kind. */
export type Slot = 'weapon' | 'shield' | `armour${number}` | `trinket${number}`;

/** The name the player sees: the plain one while it is unidentified. */
export function shownName(item: Pick<Item, 'name' | 'unidentified' | 'plainName'>): string {
  return item.unidentified ? (item.plainName ?? item.name) : item.name;
}

/** Whether the item is worn rather than used up: gear, and trinkets that raise or protect. */
export function wearable(item: Pick<Item, 'kind' | 'trinket'>): boolean {
  return (
    item.kind === 'weapon' || item.kind === 'armour' || item.kind === 'shield' || (item.kind === 'trinket' && item.trinket !== 'spell')
  );
}

/**
 * A weapon, plain or of a material. As in Arena's program, Iron takes 2 off
 * the most it can do and the finer metals add a fifth of what they add to
 * armour to both ends; a material changes the price but not the weight.
 */
export function makeWeapon(weapons: WeaponInfo[], type: number, material?: number, t: ArmourTables = FALLBACK_ARMOUR): NewItem {
  const info = weapons[type];
  let [low, high] = info.damage;
  if (material === IRON) high = Math.max(low, high - IRON_DULLS);
  else if (material !== undefined) {
    const more = Math.max(0, Math.trunc(t.materialProtection[material] / 5));
    low += more;
    high += more;
  }
  return {
    kind: 'weapon',
    name: material === undefined ? info.name : `${MATERIALS[material]} ${info.name}`,
    type,
    material,
    damage: [low, high],
    twoHanded: info.twoHanded,
    weight: round1(info.weight ?? WEAPON_WEIGHT[type] ?? 3),
    value: materialPrice(info.price ?? WEAPON_VALUE[type] ?? 30, material, t),
  };
}

/** A material's price: the plain item's times the material's multiplier, in quarters, as Arena works it out (at least 1). */
function materialPrice(price: number, material: number | undefined, t: ArmourTables): number {
  return material === undefined ? price : Math.max(1, Math.floor((price * t.materialPrices[material]) / 4));
}

/**
 * A piece of armour. As in Arena, only plate comes in a metal (from Iron to
 * Ebony), which adds to how well it protects and to its price but not to
 * its weight; chain and leather, and plain plate, have none. A metal piece
 * is named by its metal alone, "Ebony Helm", as Arena names it.
 */
export function makeArmour(armour: number, piece: number, material?: number, t: ArmourTables = FALLBACK_ARMOUR): NewItem {
  const metal = armour === PLATE ? material : undefined;
  return {
    kind: 'armour',
    name: metal === undefined ? `${ARMOUR_TYPES[armour]} ${PIECES[piece]}` : `${MATERIALS[metal]} ${PIECES[piece]}`,
    type: piece,
    armour,
    material: metal,
    protection: t.protection[armour] + (metal === undefined ? 0 : t.materialProtection[metal]),
    weight: t.weights[armour][piece],
    value: materialPrice(t.prices[armour][piece], metal, t),
  };
}

/** A shield, plain or of a metal; however good the metal, no shield protects more than plate (Arena's rule). */
export function makeShield(shield: number, material?: number, t: ArmourTables = FALLBACK_ARMOUR): NewItem {
  const part = PIECES.length + shield;
  return {
    kind: 'shield',
    name: `${material === undefined ? '' : `${MATERIALS[material]} `}${SHIELDS[shield]}`,
    type: shield,
    material,
    protection: Math.min(t.protection[PLATE], t.shieldProtection[shield] + (material === undefined ? 0 : t.materialProtection[material])),
    covers: [...t.shieldCovers[shield]],
    weight: t.weights[PLATE][part],
    value: materialPrice(t.prices[PLATE][part], material, t),
  };
}

/** The armour rating Arena shows for a piece or shield: a fifth of its protection. */
export function armourRating(item: Pick<Item, 'protection'>): number {
  return Math.floor(effectiveProtection(item) / 5);
}
export function effectiveProtection(item:Pick<Item,'protection'>&Partial<Pick<Item,'affixes'|'modifiers'>>):number {
  const stats=itemStats(item);return Math.max(0,Math.round((item.protection??0)*(1+(stats.armourPct??0)/100)+(stats.armourFlat??0)));
}

/** The weapon as the fighting rules and the first-person view need it. */
export function weaponOf(item: Item): Weapon {
  const stats=itemStats(item),damage=(item.damage??[1,2]).map(n=>Math.max(1,Math.round((n+(stats.damageFlat??0))*(1+(stats.damagePct??0)/100)))) as [number,number];
  return { name: item.name, damage, cif: weaponCif(item.type) ?? 'SWORD.CIF', bow: BOWS.includes(item.type),
    type: item.type,
    material: item.material,
    twoHanded: item.twoHanded,
  };
}

export function makeSteelArrows(quantity = 1): NewItem {
  return {
    kind: 'ammunition',
    name: 'Steel Arrow',
    type: 0,
    material: STEEL,
    quantity: Math.max(1, Math.trunc(quantity)),
    weight: 0.03,
    value: 1,
  };
}

/** The weapons that can be used, by place in the game's list: every one Arena has pictures to fight with, the bows too. */
export function usableWeapons(weapons: WeaponInfo[]): number[] {
  return weapons.flatMap((_, i) => (weaponCif(i) ? [i] : []));
}

/** The frame of the item's picture in the game's equipment pictures (0EQUIP.CIF for men, 1EQUIP.CIF for women); trinkets and potions have none. */
export function itemFrame(item: Pick<Item, 'kind' | 'type' | 'armour'>): number | undefined {
  if (item.kind === 'weapon') return item.type;
  if (item.kind === 'shield') return 25 + item.type;
  if (item.kind === 'armour') return [18, 29, 36][item.armour ?? 0] + item.type;
  return undefined;
}

/** Whether the class may use the item: its weapons, shields and armour (Arena's program, at 0x190B2). Trinkets and potions anyone may. */
export function classMayUse(cls: ClassInfo | undefined, item: Pick<Item, 'kind' | 'type' | 'armour'>): boolean {
  if (!cls) return true;
  switch (item.kind) {
    case 'weapon':
      return !cls.weapons || cls.weapons.includes(item.type);
    case 'shield':
      return cls.shields.includes(item.type);
    case 'armour':
      return cls.armour !== 3 && (item.armour ?? 0) >= cls.armour;
    default:
      return true;
  }
}

/** A material that gets better, and rarer, the higher the player's level. */
export function materialFor(level: number, random: Random): number {
  const reach = Math.min(MATERIALS.length, 2 + level);
  return Math.min(reach - 1, Math.floor(Math.min(random(), random()) * reach));
}

/** A piece of gear found in the dungeon: mostly weapons, then armour, sometimes a shield. */
export function randomGear(weapons: WeaponInfo[], level: number, random: Random, armour: ArmourTables = FALLBACK_ARMOUR): NewItem {
  const kind = random();
  const usable = usableWeapons(weapons);
  const material = materialFor(level, random);
  if (kind < 0.55 && usable.length) return makeWeapon(weapons, usable[Math.floor(random() * usable.length)], material, armour);
  if (kind < 0.9 || !usable.length) {
    const type = Math.floor(random() * ARMOUR_TYPES.length);
    return makeArmour(type, Math.floor(random() * PIECES.length), material, armour);
  }
  return makeShield(Math.floor(random() * SHIELDS.length), material, armour);
}

/** Places in the game's weapon list. */
const DAGGER = 1;
const SHORTSWORD = 2;
const BROADSWORD = 3;

/**
 * What a new character carries, as in Arena (its giveWeapon, and the
 * original's own inventory at the start): one plain weapon by the class's
 * place in the list (a dagger for the first six, a shortsword for the next
 * six, a broadsword for the rest) and nothing else. A class without its place
 * (the remake's own) gets the first of those it may use.
 */
export function startingGear(weapons: WeaponInfo[], cls?: ClassInfo): NewItem[] {
  const usable = usableWeapons(weapons);
  let choice: number | undefined;
  if (cls?.id !== undefined) choice = cls.id >= 12 ? BROADSWORD : cls.id >= 6 ? SHORTSWORD : DAGGER;
  else choice = [SHORTSWORD, DAGGER, BROADSWORD].find((i) => usable.includes(i) && (!cls?.weapons || cls.weapons.includes(i))) ?? usable[0];
  return choice !== undefined && weapons[choice] ? [makeWeapon(weapons, choice)] : [];
}

/** The key the menus use for an entry: an item's, or for potions their kind's, since they are counted by kind. */
export const itemKey = (item: Pick<Item, 'id' | 'kind' | 'type'>) => (item.kind === 'potion' ? potionKey(item.type) : `item:${item.id}`);
export const potionKey = (type: number) => `potion:${type}`;
export const HOTKEYS = 8;

export interface EquipResult {
  ok: boolean;
  /** Why not, or what else came off. */
  message?: string;
}
export interface InventoryState {
  items:Item[];
  worn:Array<[Slot,number]>;
  favourites:string[];
  hotkeys:Array<string|undefined>;
  knownPotions:number[];
}

export class Inventory {
  level=1;
  readonly items: Item[] = [];
  /** The keys of the entries in the favourites list, in the order they were added. */
  readonly favourites: string[] = [];
  /** What each number key uses: hotkeys[0] is 1. */
  readonly hotkeys: Array<string | undefined> = new Array<undefined>(HOTKEYS).fill(undefined);
  /** The kinds of potion the player knows, from drinking one or finding one known. */
  readonly knownPotions = new Set<number>();
  private readonly worn = new Map<Slot, number>();
  private nextId = 1;
  snapshot():InventoryState {
    return {items:JSON.parse(JSON.stringify(this.items)) as Item[],worn:[...this.worn],favourites:[...this.favourites],hotkeys:[...this.hotkeys],knownPotions:[...this.knownPotions]};
  }
  restore(value:unknown):boolean {
    if(!value||typeof value!=='object')return false;
    const state=value as InventoryState;
    if(!Array.isArray(state.items)||state.items.length>2048||!Array.isArray(state.worn)||!Array.isArray(state.hotkeys)||!Array.isArray(state.favourites)||!Array.isArray(state.knownPotions))return false;
    const finite=(n:unknown,lo:number,hi:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;
    const ids=new Set<number>();
    for(const item of state.items){
      if(!item||!Number.isInteger(item.id)||item.id<1||ids.has(item.id)||!['weapon','armour','shield','trinket','potion','ammunition'].includes(item.kind)||!Number.isInteger(item.type)||item.type< -1||item.type>255||typeof item.name!=='string'||item.name.length>200||!finite(item.weight,0,10000)||!finite(item.value,0,1e9))return false;
      if(item.damage&&(!Array.isArray(item.damage)||item.damage.length!==2||item.damage.some(n=>!finite(n,0,10000))))return false;
      if(item.requiredLevel!==undefined&&!finite(item.requiredLevel,0,100))return false;
      if(item.quality!==undefined&&!(item.quality in QUALITY_COLOURS))return false;
      if(item.material!==undefined&&(!Number.isInteger(item.material)||item.material<0||item.material>7))return false;
      if(item.quantity!==undefined&&(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>1000000))return false;
      if(item.covers&&(!Array.isArray(item.covers)||item.covers.some(n=>!Number.isInteger(n)||n<0||n>6)))return false;
      if(item.affixes&&(!Array.isArray(item.affixes)||item.affixes.length>8||item.affixes.some(a=>!a||!['prefix','suffix'].includes(a.side)||typeof a.id!=='string'||typeof a.name!=='string'||!a.stats||Object.values(a.stats).some(n=>!finite(n,-10000,10000)))))return false;
      if(item.modifiers&&Object.values(item.modifiers).some(n=>!finite(n,-10000,10000)))return false;
      if(item.affixes?.some(a=>a.proc&&(!finite(a.proc.chance,0,100)||!finite(a.proc.level,1,100))))return false;
      ids.add(item.id);
    }
    const items=JSON.parse(JSON.stringify(state.items)) as Item[],worn=new Map<Slot,number>();
    for(const entry of state.worn){
      if(!Array.isArray(entry)||entry.length!==2)return false;
      const item=items.find(i=>i.id===entry[1]);
      if(!item||!wearable(item)||this.slot(item)!==entry[0]||this.forbidden(item)||worn.has(entry[0]))return false;
      worn.set(entry[0],entry[1]);
    }
    const weapon=items.find(i=>i.id===worn.get('weapon'));
    if(!weapon||weapon.twoHanded&&worn.has('shield'))return false;
    this.items.splice(0,this.items.length,...items);this.worn.clear();worn.forEach((id,slot)=>this.worn.set(slot,id));
    this.nextId=Math.max(0,...ids)+1;
    this.favourites.splice(0,this.favourites.length,...state.favourites.filter(k=>typeof k==='string'));
    this.hotkeys.fill(undefined);state.hotkeys.slice(0,HOTKEYS).forEach((key,i)=>{if(typeof key==='string')this.hotkeys[i]=key;});
    this.knownPotions.clear();for(const type of state.knownPotions)if(Number.isInteger(type))this.knownPotions.add(type);
    return true;
  }

  /**
   * `cannotEquip` is the game's "%ss cannot equip this item." for when the
   * class may not use something; with no class, anything goes.
   */
  constructor(
    private readonly cls?: ClassInfo,
    private readonly cannotEquip = 'A %s cannot use that.',
  ) {}

  add(item: NewItem): Item {
    if (item.kind === 'ammunition') {
      const stack = this.items.find((i) => i.kind === 'ammunition' && i.material === item.material && i.type === item.type);
      if (stack) {
        stack.quantity = (stack.quantity ?? 1) + (item.quantity ?? 1);
        return stack;
      }
    }
    const added = { ...item, id: this.nextId++ };
    if (added.kind === 'potion') {
      if (!added.unidentified) this.knownPotions.add(added.type);
      else if (this.knownPotions.has(added.type)) added.unidentified = false;
    }
    this.items.push(added);
    return added;
  }

  get(id: number): Item | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** The item a menu key stands for: for a kind of potion, one of them. */
  byKey(key: string): Item | undefined {
    const m = /^(item|potion):(-?\d+)$/.exec(key);
    if (!m) return undefined;
    const n = Number(m[2]);
    return m[1] === 'item' ? this.get(n) : this.items.find((i) => i.kind === 'potion' && i.type === n);
  }

  /** How many potions of the kind are carried. */
  potions(type: number): number {
    return this.items.filter((i) => i.kind === 'potion' && i.type === type).length;
  }

  /** Learns what the item is; for a potion, every one of its kind. */
  identify(item: Item): void {
    if (item.kind !== 'potion') {
      item.unidentified = false;
      return;
    }
    this.knownPotions.add(item.type);
    for (const i of this.items) if (i.kind === 'potion' && i.type === item.type) i.unidentified = false;
  }

  slot(item: Item): Slot {
    if (item.kind === 'armour') return `armour${item.type}`;
    if (item.kind === 'trinket') return `trinket${item.type}`;
    return item.kind === 'shield' ? 'shield' : 'weapon';
  }

  isEquipped(item: Item): boolean {
    return wearable(item) && this.worn.get(this.slot(item)) === item.id;
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

  /** The armour ratings of everything worn, added up, for the menus. */
  armourRating(): number {
    return this.wornItems().reduce((sum, i) => sum + armourRating(i), 0)+Math.floor((this.bonuses().ward??0)/5);
  }

  /**
   * How well each body part is protected, in percent (cuirass, gauntlets,
   * greaves, left and right pauldron, helm, boots): the piece worn there,
   * the shield if it covers that part and the protective trinkets worn, as
   * Arena adds them up.
   */
  protection(): number[] {
    const shield = this.equipped('shield');
    const trinkets = this.wornItems().reduce((sum, i) => sum + (i.kind==='trinket'?effectiveProtection(i):0), 0)+(this.bonuses().ward??0);
    return PIECES.map(
      (_, part) => (this.equipped(`armour${part}`)?effectiveProtection(this.equipped(`armour${part}`)!):0) + (shield?.covers?.includes(part) ? effectiveProtection(shield) : 0) + trinkets,
    );
  }

  /** What the worn enchantments and trinkets add to each attribute, Strength to Luck. */
  attributeBonus(): number[] {
    const bonus = new Array<number>(ATTRIBUTES).fill(0);
    for (const i of this.wornItems()) if (i.attribute !== undefined && i.attribute < ATTRIBUTES) bonus[i.attribute] += i.boost ?? 0;
    const stats=this.bonuses();ATTRIBUTE_STATS.forEach((stat,i)=>bonus[i]+=stats[stat]??0);
    return bonus;
  }
  bonuses():LootStats {
    const worn=this.wornItems(),stats:LootStats={};
    for(const item of worn)addStats(stats,itemStats(item));
    return addStats(stats,setBonuses(worn));
  }

  /** Something worn makes the wearer jump as an Acrobat does. */
  jumping(): boolean {
    return this.wornItems().some((i) => i.jumping);
  }

  /** Kilograms carried. */
  weight(): number {
    return round1(this.items.reduce((sum, i) => sum + i.weight * (i.quantity ?? 1), 0));
  }

  steelArrowCount(): number {
    return this.items.filter((i) => i.kind === 'ammunition' && i.material === STEEL).reduce((s, i) => s + (i.quantity ?? 1), 0);
  }
  takeSteelArrow(): boolean {
    const stack = this.items.find((i) => i.kind === 'ammunition' && i.material === STEEL);
    if (!stack) return false;
    stack.quantity = (stack.quantity ?? 1) - 1;
    if (!stack.quantity) this.remove(stack);
    return true;
  }

  /** Why the class may not use the item, or undefined when it may. */
  forbidden(item: Item): string | undefined {
    if((item.requiredLevel??0)>this.level)return `Requires level ${item.requiredLevel}`;
    return classMayUse(this.cls, item) ? undefined : this.cannotEquip.replace('%s', this.cls!.name);
  }

  equip(item: Item): EquipResult {
    if (!wearable(item)) return { ok: false };
    const why = this.forbidden(item);
    if (why) return { ok: false, message: why };
    if (item.kind === 'shield' && this.weapon?.twoHanded) return { ok: false, message: `Your ${shownName(this.weapon)} needs both hands` };
    let message: string | undefined;
    if (item.kind === 'weapon' && item.twoHanded) {
      const shield = this.equipped('shield');
      if (shield) {
        this.worn.delete('shield');
        message = `${shownName(shield)} put away: the ${shownName(item)} needs both hands`;
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

  /** Drops an item from the pack (and, when it was the last of its entry, from the favourites and hotkeys). */
  remove(item: Item): void {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    if (this.isEquipped(item)) this.worn.delete(this.slot(item));
    this.items.splice(i, 1);
    if (!this.byKey(itemKey(item))) this.forget(itemKey(item));
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
      const frame = item && itemFrame(item);
      return frame === undefined ? [] : [frame];
    });
  }

  private forget(key: string): void {
    const i = this.favourites.indexOf(key);
    if (i >= 0) this.favourites.splice(i, 1);
    this.hotkeys.forEach((k, n) => k === key && (this.hotkeys[n] = undefined));
  }
}
