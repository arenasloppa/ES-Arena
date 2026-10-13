import {makeElite,creatureName} from './elites';
import {creatureMagic,creatureAttribute} from './creatureMagic';
import {TEST_BUFFS,TEST_DEBUFFS,testEffectDescription} from './testEffects';
import {monsterWeaponDamage} from './monsterCombat';
import {DISEASE_DAY, DISEASE_ICONS, diseaseFrom, infectDisease, diseaseDescription, type DiseaseState} from './diseases';
import type {DiseaseTables} from '../formats/diseases';
import type {ActiveStatusEffect, StatusDispelType} from './statusEffects';
import {usesModelWeaponHandling} from '../render/weaponModelDefinitions';
/**
 * One run through a dungeon: the player, the creatures, the doors and the
 * loot, and the rules that tie them together. Pure logic (no Three.js and no
 * sound) so it can be unit tested. The engine feeds it input every frame,
 * draws what it holds and plays out the events it leaves in `events`.
 *
 * Fighting works with direct controls: a click swings (each swing in a different
 * direction), holding the button makes a power attack that costs stamina
 * and does double damage, and every swing hits whatever is in front within
 * reach. Blocking takes most of the sting out of blows from the front for
 * stamina, and attacking while blocking bashes. Striking a creature that
 * has not noticed the player sneaking does triple damage. A bow shoots
 * arrows instead, flying as Arena's do and as quickly as the character's
 * Speed lets them nock the next (see shoot); one loosed from hiding does
 * double. Whether a monster's blow lands is Arena's rule: the levels on
 * both sides, the armour on the body part it strikes and both sides'
 * Agility (combat.ts's hitChance); a Lizard Man's or Spider's may paralyse
 * too (creatures.ts's paralysisFrom). The player's race, class and
 * attributes (the Hero) change how hard they hit, how fast they move and
 * climb, and more. Monster stats, weapon damage, armour and sounds come
 * from the player's own game, and so does the loot: what loot spots and
 * creatures hold is Arena's (loot.ts), with the remake's own standing in
 * when the game's tables can't be read. Taking from a loot spot takes all
 * of it, as Skyrim's "take all" does, and the spot is gone, as Arena's is
 * once emptied.
 *
 * Magic works as in Skyrim's hands with Arena's spells (see magic.ts): a
 * spell readied from the magic menu takes the place of the guard, so the
 * block button casts it. Spells on the caster work at once, touch spells on
 * the creature in reach, and the rest fly as a bolt that bursts on what it
 * hits; area spells catch every creature near the burst. How fast bolts
 * fly and how wide the areas are is the remake's own.
 */
import { steelAttackDuration, steelBowDrawTime, steelImpactAt, steelSwingSoundTime } from './weaponHandling';
import {BOW_MOTION_MARKERS,bowReleaseTiming,weaponAttackSpeed} from '../render/weaponMotion';
import {playerEyeOffset} from './playerView';
import {STEEL_ARROW_SPEED} from './projectilePhysics';
import type { ExeData, WeaponInfo } from '../formats/exe';
import type { SpellEffect, SpellRecord } from '../formats/spells';
import {
  ARENA_TICK,
  bashChance,
  DEFAULT_HERO,
  elementalDamage,
  knackDamage,
  levelDamage,
  mayCrit,
  levelUp,
  maxHealthFor,
  newPlayerStats,
  raiseTo,
  recover,
  roll,
  spendStamina,
  type Hero,
  type PlayerStats,
  type Random,
  type Weapon,
} from './combat';
import {
  CREATURE_RADIUS,
  hurtCreature,
  isAlive,
  isDefeated,
  isMagicTarget,
  isCalm,
  monsterInReach,
  paralyseCreature,
  paralysisFrom,
  spawnCreature,
  staggerCreature,
  updateCreature,
  type Creature,
  type CreatureEvents,
  type CreatureWorld,
} from './creatures';
import { Exploration } from './explore';
import {
  castable,
  attributeIndex, transferPool, terrainEffect, resistedElement,
  DESTROY, DRAIN, LEVITATE, LOCK, SILENCE, ELEMENTAL_RESISTANCE,
  SPELL_ABSORPTION, SPELL_REFLECTION, SPELL_RESISTANCE,
  CAUSE,
  CAUSE_PARALYSIS,
  CAUSE_POISON,
  chance,
  CURE,
  CURE_PARALYSIS,
  FORTIFY,
  fortification,
  usable,
  CONTINUOUS_DAMAGE,
  CONTINUOUS_EVERY,
  CREATE,
  DAMAGE,
  DAMAGE_HEALTH,
  duration,
  HEAL,
  HEALTH,
  INVISIBILITY,
  LIGHT,
  lightReach,
  magickaCost,
  magnitude,
  NON_TARGET,
  offensive,
  OPEN,
  poisonDamage,
  recoverMagicka,
  REGENERATE,
  regeneration,
  ROUND,
  spellKey,
  startingSpells,
  TRANSFER,
  amount,
} from './magic';
import { armourTables, ATTRIBUTES, Inventory, itemKey, POTION_WEIGHT, potionKey, randomGear, shownName, startingGear, weaponOf, wearable,
  makeWeapon,makeArmour,makeShield,
  makeSteelArrows,
  STEEL,
  type Item, type NewItem } from './items';
import {
  projectile,
  stepProjectile,
  METRES_TO_WORLD,
  type Projectile,
  type ProjectileHit,
  type SurfaceMaterial,
} from './projectilePhysics';
import { sweepTerrain, sweepWoodProps, sweepCreatures, cellMaterial, type MaterialOverrides } from './surfacePhysics';
import { creatureLoot, GEAR_CAST_LEVEL, POTION_CAST_LEVEL, spotLoot, type Loot, type LootRules } from './loot';
import { RESTORE_POWER } from '../formats/loot';
import type { ArmourTables } from '../formats/armour';
import {spellDamageKind,type DamageKind} from './combatText';
import {treasure,rollEquipment,EQUIPMENT_SETS,type LootContext} from './lootRoll';
import {itemColour,QUALITY_COLOURS,type LootStats,type RolledAffix} from './affixes';
import { Quest, type Objective } from './quest';
import { blockedFor,cellIndex, lineOfSight } from './grid';
import { isBlocking, ceilingHeight, floorHeight, ARENA_HEIGHT, type DoorSounds, type Level, type LevelItem } from './level';
import { airborne, groundUnder, inChasm, jump, keepInChasm, PLAYER_RADIUS, playerBlocked, settle, step, type Body, type PlayerState } from './player';
import {monsterSeesInvisible} from './monsterSenses';
import type { GameMessages } from '../formats/messages';
import type { CreatureInfo, EncounterTables } from '../formats/exe';
import { START_MINUTES } from '../formats/calendar';
import {
  chooseEncounter,
  GAME_SECONDS_PER_SECOND,
  needsRest,
  REST_STEP,
  REST_STEP_SECONDS,
  restEncounterChance,
  restHealing,
  SAFE_SLEEP_DISTANCE,
  spawnSpot,
  type Rester,
} from './camping';

export interface DoorState {
  /** 0 closed to 1 open. */
  open: number;
  /** Where it is heading: 0 or 1. */
  target: number;
}

export interface DungeonItem extends LevelItem {
  id: number;
  /** Picked up: no longer drawn. */
  taken?: boolean;
  /** Bodies and chests stay where they are once searched. */
  searched?: boolean;
}

/** The ways a weapon swings, and a bow's shot: its arrow leaves at once, and the shot lasts until the next is nocked. */
export type SwingKind = 'right' | 'left' | 'downRight' | 'downLeft' | 'chop' | 'thrust' | 'shoot';

export interface Swing {
  kind: SwingKind;
  power: boolean;
  /** A shove made while blocking: no damage, but it staggers. */
  bash?: boolean;
  /** Camera-space lateral sweep: -1 left, +1 right, opposing the initiating strafe. */
  sweepDirection?: -1 | 1;
  /** Seconds since it began. */
  time: number;
  duration: number;
  /** The normalized contact frame, shared with the Steel viewmodel. */
  hitAt?: number;
  /** A pending whoosh on the swing clock; cleared after the cutting section begins. */
  soundAt?: number;
  /** Set once the blow has landed (or met nothing). */
  struck: boolean;
  /** Steel bows draw first, then release on this same gameplay clock. */
  releaseAt?: number;
  /** Original BowAndArrow release section selected from the held attack strength. */
  bowReleaseSource?: number;
  bowStrength?: number;
}

export type TargetKind = 'door' | 'exit' | 'item' | 'body' | 'arrow' | 'spellTerrain';

/** One line in the item menus: a piece of gear, a trinket, the potions of a kind, or the keys. */
export interface MenuEntry {
  /** What use(), favourite() and setHotkey() take. */
  key: string;
  name: string;
  category: 'weapons' | 'apparel' | 'potions' | 'misc' | 'spells';
  count: number;
  item?: Item;
  spell?: SpellRecord;
  equipped: boolean;
  favourite: boolean;
  /** The number key it is on, 0 for 1. */
  hotkey?: number;
}

/** Something in front of the player that they can use. */
export interface Target {
  kind: TargetKind;
  /** Cell index for doors and exits, the item's id, or the creature's id. */
  id: number;
  name: string;
  verb: string;
  /** A second line, such as "Locked". */
  note?: string;
}

export interface LootEntry { key: string; name: string; count: number; colour?:string; }
export interface LootView { name: string; entries: LootEntry[]; }

export type DungeonEvent =
  | { type: 'terrainChanged' }
  | { type: 'loot' }
  | {type:'despawned';creature:Creature}
  | { type: 'weaponImpact'; material: SurfaceMaterial; bash: boolean }
  | { type: 'surfaceImpact'; material: SurfaceMaterial; point: ProjectileHit['point']; normal: ProjectileHit['normal'] }
  /** A sound from a place in the level; no place means the player's own. */
  | { type: 'sound'; name: string; at?: { x: number; y: number }; volume?: number }
  /** One of the dungeon's own messages. */
  | { type: 'message'; text: string }
  /** A short note in the corner, as Skyrim's "Key added". */
  | { type: 'notify'; text: string }
  | { type: 'swing'; swing: Swing }
  | { type: 'hurt'; damage: number }
  /** A blow taken on the player's guard; `damage` is what got through. */
  | { type: 'blocked'; damage: number }
  /** A blow, arrow or spell landing on a creature; `far` when it struck from a distance, so no blood splashes on the view. */
  | { type: 'hit'; creature: Creature; damage: number; killed: boolean; far?: boolean; appliedDamage?:number; critical?:boolean; damageKind?:DamageKind; periodic?:boolean }
  | { type: 'bashed'; creature: Creature }
  /** A level gained: how much more health there can be, and the bonus points to share out among the attributes. */
  | { type: 'levelUp'; level: number; health: number; points: number }
  /** A spell cast; the engine plays the cast and flashes the hand. */
  | { type: 'cast'; spell: SpellRecord }
  /** A spell bursting where it hit; `radius` is the area it catches, 0 for one creature. */
  | { type: 'burst'; spell: SpellRecord; at: { x: number; y: number }; radius: number }
  /** Not enough spell points to cast; the HUD flashes the magicka bar. */
  | { type: 'noMagicka' }
  | { type: 'questStarted'; name: string }
  | { type: 'objective'; text: string; done: boolean }
  /** Every creature in the dungeon is dead. */
  | { type: 'cleared' }
  /** Camping began; the game shows the hours as they pass (see campingText). */
  | { type: 'camping' }
  /** Camping ended, with the game's words for why when there are some. */
  | { type: 'camped'; text?: string }
  /** A monster came upon the player; the engine draws it from now on. */
  | { type: 'spawned'; creature: Creature }
  /** Ria Silmane comes to the sleeping player (see Dungeon.camp). */
  | { type: 'dream'; visions: Vision[] }
  /** The player died; `cause` is the game's words for how, when it has some (drowning). */
  | { type: 'died'; cause?: string }
  | { type: 'escaped' };

/**
 * Ria's visions in the player's dreams: the Staff of Chaos (TEMPLATE.DAT
 * #1500) and where its first piece lies, Fang Lair (#1294).
 */
export type Vision = 'staffIntro' | 'fangLair';

/** What camping says when the game's own words can't be read. */
const CAMP_WORDS = {
  enemiesNearby: 'Monsters are too close to rest.',
  campingNotAllowed: 'You cannot rest here.',
  fullyRested: 'You are already rested.',
  doneWakeUp: 'You wake.',
  doneHealed: 'You are rested.',
  enemiesWhileResting: 'Monsters are upon you!',
  hourPassed: '%u hour passed',
  hoursPassed: '%u hours passed',
  hourRemaining: '%u hour left',
  hoursRemaining: '%u hours left',
};

export interface DungeonInput {
  /** -1..1 each; sneaking and sprinting are applied here. */
  forward: number;
  strafe: number;
  sprint: boolean;
  sneaking: boolean;
  /** The block button is held. */
  block: boolean;
  /** Controller guard stays available when a spell is readied. */
  guardOnly?:boolean;
  /** The attack button: held now, and whether it went down or came up since the last update. */
  attack: { held: boolean; pressed: boolean; released: boolean };
}

export const IDLE_INPUT: DungeonInput = {
  forward: 0,
  strafe: 0,
  sprint: false,
  sneaking: false,
  block: false,
  attack: { held: false, pressed: false, released: false },
};

const DOOR_SPEED = 1.6; // of a full opening per second
const SNEAK_PACE = 0.5;
/** How close the player comes to a solid decoration's middle. */
const SOLID_FLAT_RADIUS = 0.3;
const BLOCK_PACE = 0.6;
const SPRINT_STAMINA = 12; // per second
const POWER_STAMINA = 20;
const BASH_STAMINA = 15;
const BASH_TIME = 0.3;
/** Each blow taken on the guard costs this much stamina; with none left, blows go straight through. */
const BLOCK_STAMINA = 10;
/** Share of a blocked blow's damage that still gets through. */
const BLOCK_LEAK = 0.35;
/** Blows from further round than this to either side get past the guard. */
const BLOCK_ARC = (70 * Math.PI) / 180;
export const SNEAK_ATTACK = 3;
/** Holding attack this long makes a power attack. */
const POWER_HOLD = 0.32;

/** Point of the swing, as a fraction of it, where the blow lands. */
const HIT_AT = 0.5;
/** A pause this long between swings starts the combo over. */
const COMBO_RESET = 1;
const COMBO: SwingKind[] = ['right', 'left', 'downRight', 'downLeft'];
/** From the player's centre to a creature's. */
const WEAPON_REACH = 1.35;
const WEAPON_ARC = Math.PI / 4;
const USE_REACH = 1.4;
const ITEM_REACH = 1.6;
const ITEM_ARC = Math.PI / 6;
const LOOK_EVERY = 0.15;
const STRIDE = 1.1;
/** Seconds between tries at picking the same lock. */
const PICK_TIME = 1.2;
/**
 * The weapon to fight with when the game's weapon table can't be read (and
 * then the dungeon has no monsters either). Its numbers are the remake's own.
 */
const DEFAULT_WEAPON: Weapon = { name: 'Shortsword', damage: [2, 6], cif: 'SWORD.CIF' };
/** Gold for a character from before gold was rolled at creation. */
const START_GOLD = 25;
/** A new character's experience, as the original's sheet shows it at the start (and its program sets it). */
const START_EXPERIENCE = 700;
/**
 * Swimming tires the player: Arena's waking loss of 11/64 fatigue a game
 * minute, at 13 game seconds a real one, 30 times over, on its 0-256 scale
 * (OpenTESArena's reading); about 0.44 points a second.
 */
const SWIM_TIRING = (((11 / 64) * (86400 / 6646.153846153846)) / 60) * 30 * (100 / 256);
/** Lava burns 10 health a second (OpenTESArena). */
const LAVA_BURN = 10;
/** Pushing forward against the edge this long starts a climb out of water (or lava) or a pit. */
const CLIMB_PUSH_WATER = 0.1;
const CLIMB_PUSH_PIT = 0.25;
/**
 * Seconds a climb out takes. In Arena (played in DOSBox) swimming into the
 * edge of water lifts you out onto the floor straight away; the remake takes
 * a moment so the view doesn't jump. A pit is a real climb, and a blow, or
 * attacking, throws you back in (UESP); its time is the remake's own, a
 * quarter of it for Khajiit and Acrobats (Hero.climbPace).
 */
const CLIMB_WATER = 0.35;
const CLIMB_PIT = 4;
/** Seconds after casting before another spell can be cast. */
const CAST_TIME = 0.7;
/** Spell points a potion of Restore Power gives back (Arena's program, at 0x2A563). */
const RESTORED_POWER = 25;
/** Casting from gear wears it by the spell's cost over this (0x2A525). */
const GEAR_WEAR = 15;
/** Health the remake's own healing potion restores, when the game's potions can't be read. */
const HEALING_POTION = 25;
/** An Acrobat's jumps, which gear of Jumping gives too (Arena's program, at 0x28523). */
const JUMPING_LEAP = 2;
/** Spell bolts fly this many voxels a second, and give up this far away. */
const BOLT_SPEED = 7;
const BOLT_RANGE = 25;
export const BOLT_RADIUS = 0.12;
/** How far a spell's area reaches from its burst, and from the caster. */
export const AREA_RADIUS = 1.5;
export const AREA_AROUND_CASTER = 2.5;
/** Touch spells, and the Open spell, reach this far. */
const TOUCH_REACH = 1.4;
const OPEN_REACH = 2.5;
/**
 * Arrows as Arena's program flies them (at 0x2A06F and 0x2A131), in its
 * units of 128 to a voxel: one sets off 100 in front of the player, flies 50
 * a step (about 7 voxels a second) and falls after 30 steps. A wall or a
 * shut door stops it, and the first creature it reaches takes the blow.
 * How near it must pass is the remake's own.
 */
const ARROW_START = 100 / 128;
const ARROW_SPEED = 50 / 128 / ARENA_TICK;
const ARROW_REACH = ARROW_START + (30 * 50) / 128;
export const ARROW_RADIUS = 0.1;
const ARROW_STEP = 0.1;
/** An arrow loosed from hiding at a creature that hasn't noticed the player does double damage. */
export const SNEAK_SHOT = 2;

/** A spell flying through the dungeon. */
export interface Bolt {
  id: number;
  spell: SpellRecord;
  /** The caster's level it was cast at. */
  level: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  travelled: number;
  /** Enemy caster, when this projectile is travelling toward the player. */
  source?:Creature;
  z?:number; dz?:number;
  lightUntil?:number; lightPower?:number; stopped?:boolean;
}

/** An arrow in flight. */
export interface Arrow {
  bonuses?:LootStats;
  procAffixes?:RolledAffix[];
  attacker?:Hero;
  attackerLevel?:number;
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  travelled: number;
  /** The bow it left, for the blow it strikes. */
  weapon: Weapon;
  /** Loosed while sneaking: a sneak attack if it strikes a creature that hasn't noticed the player. */
  sneak: boolean;
  /** Only Steel uses the new recoverable ballistic model; other materials keep the original presentation. */
  projectile?: Projectile;
  carrierOffset?: [number, number, number];
}

/** Harm a spell keeps doing to a creature: poison or continuous damage, a blow every so many seconds. */
interface Affliction {
  source?:Creature;
  creature: Creature;
  spell: SpellRecord;
  level: number;
  /** Damage of each blow: a fixed number, or the effect to roll. */
  damage: number | SpellRecord['effects'][number];
  every: number;
  next: number;
  until: number;
}

export class Dungeon {
  private randomizedLoot=false;
  private eliteEncounters=false;
  private readonly eliteNames=new Set<string>();
  private nameElite(c:Creature):void {
    if(!c.elite?.name)return;
    if(this.eliteNames.has(c.elite.name))c.elite.name+=` ${c.id+1}`;
    this.eliteNames.add(c.elite.name);
  }
  applyPracticeElite(c:Creature,tier:'champion'|'unique',options?:Parameters<typeof makeElite>[3]):void {
    if(this.practiceMode)makeElite(c,tier,this.random,options);
  }
  enableEliteEncounters():void {
    if(this.eliteEncounters)return;this.eliteEncounters=true;
    for(const c of [...this.creatures])if(!c.info.boss&&c.info.id!==24&&Math.hypot(c.x-this.player.x,c.y-this.player.y)>2&&this.random()<.08)this.elitePack(c);
  }
  private elitePack(c:Creature):void {
    const base=c.info,champions=this.random()<.2;
    makeElite(c,champions?'champion':'unique',this.random,{champion:'champion'});this.nameElite(c);
    const count=champions?1+Math.floor(this.random()*3):3+Math.floor(this.random()*4);
    const candidates=[];
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)if(x||y)candidates.push({x:Math.floor(c.x)+x+.5,y:Math.floor(c.y)+y+.5,order:this.random()});
    for(const at of candidates.sort((a,b)=>a.order-b.order)){
      if(c.elite&&this.creatures.filter(o=>o.elite?.leader===c.id).length>=count)break;
      const cell=cellIndex(this.level,at.x,at.y);
      if(cell<0||this.level.cells[cell].chasm||floorHeight(this.level.cells[cell],this.level)!==0||blockedFor(this.level,at.x,at.y,CREATURE_RADIUS,this.openDoors)||Math.hypot(at.x-this.player.x,at.y-this.player.y)<2||this.creatures.some(o=>Math.hypot(o.x-at.x,o.y-at.y)<.65)||!lineOfSight(this.level,c.x,c.y,at.x,at.y,this.openDoors))continue;
      const actor=spawnCreature(Math.max(-1,...this.creatures.map(o=>o.id))+1,base,at.x,at.y,this.random);
      makeElite(actor,champions?'champion':'minion',this.random,{champion:this.creatures.some(o=>o.elite?.leader===c.id)?'champion':undefined,leader:c.id,affixes:c.elite?.affixes});
      this.creatures.push(this.outfit(actor));
    }
  }
  private readonly gearPoison=new Map<Creature,{damage:number;next:number;until:number}>();
  private readonly procCooldown=new Map<string,number>();
  private readonly foundUniques=new Set<string>();
  enableRandomLoot():void {this.randomizedLoot=true;this.carried.clear();}
  lootDrops():Array<{id:number;x:number;y:number;z:number;colour:string}> {
    if(!this.randomizedLoot)return [];
    return this.creatures.flatMap(c=>{
      const contents=this.carried.get(c.id);
      if(c.state!=='dead'||this.searchedBodies.has(c.id)||!contents||!contents.gold&&!contents.items.length)return [];
      const rank=['low','normal','superior','magic','rare','set','unique'];
      const best=[...contents.items].sort((a,b)=>rank.indexOf(b.quality??'normal')-rank.indexOf(a.quality??'normal'))[0];
      return [{id:c.id,x:c.x,y:c.y,z:Math.max(0,floorHeight(this.level.cells[cellIndex(this.level,c.x,c.y)],this.level)),colour:best?itemColour(best):QUALITY_COLOURS.unique}];
    });
  }
  practiceLootItems():NewItem[] {
    if(!this.practiceMode||!this.lootRules)return [];
    const items:NewItem[]=[];
    for(let type=0;type<this.weaponTable.length;type++)for(const quality of ['magic','rare','unique'] as const){const item=rollEquipment(makeWeapon(this.weaponTable,type,STEEL,this.armourTable),{level:24},this.random,quality,this.lootRules);item.unidentified=false;items.push(item);}
    for(const set of EQUIPMENT_SETS)for(const piece of set.pieces){
      const base=piece.kind==='weapon'?makeWeapon(this.weaponTable,piece.type,STEEL,this.armourTable):piece.kind==='armour'?makeArmour(0,piece.type,STEEL,this.armourTable):piece.kind==='shield'?makeShield(piece.type,STEEL,this.armourTable):{kind:'trinket' as const,trinket:'attribute' as const,type:piece.type,name:piece.name,weight:0,value:100};
      items.push({...base,name:piece.name,quality:'set',setId:set.id,setPiece:`${piece.kind}:${piece.type}`,itemLevel:set.level,requiredLevel:Math.floor(set.level*.75),modifiers:{...piece.stats},value:base.value*8});
    }
    return items;
  }
  progress():object {
    const s=this.stats;
    return {version:1,inventory:this.inventory.snapshot(),level:s.level,experience:s.experience,gold:s.gold,baseHealth:s.baseHealth,healthRolls:[...s.healthRolls],bonusPoints:s.bonusPoints,health:s.health,stamina:s.stamina,magicka:s.magicka,spells:this.spellbook.map(spell=>spell.index),abilities:[...this.abilitySlots],foundUniques:[...this.foundUniques]};
  }
  restoreProgress(value:unknown):boolean {
    if(!value||typeof value!=='object')return false;
    const p=value as Record<string,unknown>;
    const finite=(key:string,lo:number,hi:number)=>typeof p[key]==='number'&&Number.isFinite(p[key])&&(p[key] as number)>=lo&&(p[key] as number)<=hi;
    if(p.version!==1||!finite('level',1,100)||!Number.isInteger(p.level)||!finite('experience',0,1e12)||!finite('gold',0,1e9)||!finite('baseHealth',1,10000)||!finite('bonusPoints',0,10000)||!finite('health',.01,100000)||!finite('stamina',0,100000)||!finite('magicka',0,100000)||!Array.isArray(p.healthRolls)||p.healthRolls.length!==(p.level as number)-1||p.healthRolls.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<1||n>1000))return false;
    this.inventory.level=p.level as number;
    if(!this.inventory.restore(p.inventory)){this.inventory.level=this.stats.level;return false;}
    const s=this.stats;s.level=p.level as number;s.experience=p.experience as number;s.gold=p.gold as number;s.baseHealth=p.baseHealth as number;s.healthRolls=[...p.healthRolls];s.bonusPoints=p.bonusPoints as number;
    s.weapon=weaponOf(this.inventory.weapon!);this.refreshHero();
    s.health=Math.min(s.maxHealth,p.health as number);s.stamina=Math.min(s.maxStamina,p.stamina as number);s.magicka=Math.min(s.maxMagicka,p.magicka as number);
    if(Array.isArray(p.spells)){this.spellbook.splice(0,this.spellbook.length,...this.spells.filter(spell=>(p.spells as unknown[]).includes(spell.index)));}
    if(Array.isArray(p.abilities))p.abilities.slice(0,this.abilitySlots.length).forEach((key,i)=>{if(typeof key==='string'&&(this.inventory.byKey(key)||this.spellByKey(key)))this.abilitySlots[i]=key;});
    this.foundUniques.clear();if(Array.isArray(p.foundUniques))for(const id of p.foundUniques)if(typeof id==='string')this.foundUniques.add(id);
    return true;
  }
  private lootContext(level:number,boss=false):LootContext {
    const stats=this.inventory.bonuses();return {level,magicFind:stats.magicFind,goldFind:stats.goldFind,boss,foundUniques:this.foundUniques};
  }
  /** Optional exact assignments for texture names whose material is not described by their name. */
  surfaceMaterials: MaterialOverrides = {};
  private noArrowsUntil = 0;
  readonly player: PlayerState;
  readonly stats: PlayerStats;
  readonly creatures: Creature[] = [];
  readonly items: DungeonItem[];
  readonly doors = new Map<number, DoorState>();
  readonly openDoors = new Set<number>();
  readonly explored: Exploration;
  /** Things that happened since the engine last looked; it empties this. */
  readonly events: DungeonEvent[] = [];
  /** The swing in progress. */
  swing?: Swing;
  outcome?: 'dead' | 'escaped';
  /** Seconds of play. */
  time = 0;
  /** Invalidates map caches after a successful terrain spell. */
  terrainVersion=0;
  kills = 0;
  /** How far the player has walked, for footsteps and the weapon's sway. */
  walked = 0;
  /** Holding the guard up; the engine draws the weapon raised. */
  blocking = false;
  sneaking = false;
  /** The main renderer supplies its smoothed camera offset; headless/range use the stance height. */
  viewEyeOffset: number | undefined;
  /** Camera's small lateral walking offset, also used by projectile launch. */
  viewSideOffset=0;
  /** Sprinting this moment, for the camera's widening view. */
  running = false;
  /** In water or lava. */
  swimming = false;
  /** Climbing out of water or a pit: how far along (0 to 1), and where it ends. */
  climb?: { progress: number; seconds: number; from: number; start: { x: number; y: number }; to: { x: number; y: number } };
  /** Objectives toward the way out; undefined in a dungeon without one. */
  readonly quest?: Quest;
  /** The gear the player carries and wears. */
  readonly inventory: Inventory;
  /** The spells the player knows, cheapest first. */
  readonly spellbook: SpellRecord[] = [];
  /** The spell in hand, cast with the block button. */
  readied?: SpellRecord;
  /** Four independently assigned spells; equipment stays on favourite hotkeys. */
  readonly abilitySlots:Array<string|undefined>=Array(6).fill(undefined);
  /** Spells in flight. */
  readonly bolts: Bolt[] = [];
  /** Arrows in flight. */
  readonly arrows: Arrow[] = [];
  /** Game seconds since the game began; time passes 13 times as fast as play, and in steps of 20 minutes while camping. */
  clock = 0;
  /** Resting: hours left (or, until healed, hours so far) and the time to the clock's next step. */
  camping?: { hoursLeft?: number; hoursPassed: number; tick: number };
  /** Ria has shown the player the Staff in a dream. */
  dreamt = false;

  private readonly weaponTable: WeaponInfo[];
  private readonly armourTable: ArmourTables;
  /** The undead, by creature number, when the program's list can be read. */
  private readonly undead: number[];
  private readonly unlocked = new Set<number>();
  private readonly magicalLocks = new Map<number,{until:number;strength:number}>();
  private readonly wards = new Map<string,{effect:SpellEffect;power:number;until:number;duration:number}>();
  private levitateUntil=0;
  private terrainSpell?:{spell:SpellRecord;effect:SpellEffect;remaining:number};
  private readonly pickedAt = new Map<number, number>();
  private readonly lockTried = new Set<number>();
  private readonly shownTexts = new Set<number>();
  private readonly searchedBodies = new Set<number>();
  private readonly world: CreatureWorld;
  private readonly growlAt = new Map<number, number>();
  private here = -1;
  private sinceStamina = Infinity;
  private pushing = 0;
  private readonly messages: GameMessages;
  private readonly encounters?: EncounterTables;
  private readonly creatureInfo: CreatureInfo[];
  private readonly diseaseTables?: DiseaseTables;
  private readonly creatureMaterials?: number[];
  private readonly spellAreaCells?: ExeData['spellAreaCells'];
  private disease?: DiseaseState;
  /** Cumulative raw attribute losses remain after a cure, until restored through rest. */
  private readonly diseaseLosses = Array<number>(8).fill(0);
  private readonly playerHarms = new Map<string, {name:string;icon:string;type:StatusDispelType;until:number;next:number;every:number;damage:number;element?:number;duration:number;vulnerability?:number;slow?:number}>();
  private sinceHurt = Infinity;
  private lookTimer = 0;
  private nextStep = STRIDE;
  /** Begin visible preparation on press while tap/power selection waits for release/hold. */
  get attackCharging(): boolean { return this.armedAt!==undefined&&!this.swing&&!this.stats.weapon.bow&&!this.outcome&&!this.camping&&!this.paralysed&&!this.climb; }
  private armedAt: number | undefined;
  private queued: boolean | undefined;
  private combo = 0;
  private lastSwingEnd = -Infinity;
  private moving = false;
  private movementIntent = { forward: 0, strafe: 0 };
  private cleared = false;
  private sprintHeld = false;
  private nextBolt = 0;
  private nextArrow = 0;
  private sinceCast = Infinity;
  private castHeld = false;
  private readonly afflictions: Affliction[] = [];
  /** Spells working on the player: when each ends (seconds of play) and what it holds. */
  private shieldPoints = 0;
  private readonly effectDurations=new Map<string,number>();
  private sanctuary = { chance: 0, until: 0 };
  private invisibleUntil = 0;
  private light = { reach: 1, until: 0 };
  private regen = { health: 0, every: 0, next: 0, until: 0 };
  /** Seconds of play until a paralysing blow wears off. */
  private paralysedUntil = 0;
  private paralysisType: StatusDispelType = 'poison';

  /** What the player's character brings, with what they wear; worked out again when they share out bonus points (see applyAttributes) and when what they wear changes. */
  hero: Hero;
  /**
   * Works the character out again with bonuses to their attributes, Strength
   * to Luck (from enchanted gear, trinkets and Fortify spells); the game sets
   * it. Without it, attribute bonuses change nothing.
   */
  heroWith?: (bonus: number[]) => Hero;
  /** The character without what they wear. */
  private baseHero: Hero;
  private readonly spells: SpellRecord[];
  /** Arena's loot, when the game's tables can be read. */
  private readonly lootRules?: LootRules;
  /** What each creature carries, by its id, from when it appeared. */
  private readonly carried = new Map<number, Loot>();
  private readonly spotContents = new Map<number, Loot>();
  private looting?: { name: string; contents: Loot; item?: DungeonItem; body?: number };
  /** Fortify spells working on the player: points added to an attribute, lost a few at a time. */
  private readonly fortified: Array<{ attribute: number; points: number; loss: number; every: number; next: number; until: number; duration?:number; dispel?:StatusDispelType; growth?:number }> = [];

  /**
   * `hero` is what the player's character brings; without one, the player
   * has no class and plain numbers. `spells` is the game's spell list, from
   * which a spellcaster knows some.
   */
  constructor(
    readonly level: Level,
    tables: ExeData | undefined,
    private readonly random: Random = Math.random,
    hero: Hero = DEFAULT_HERO,
    spells: SpellRecord[] = [],
  ) {
    this.hero = hero;
    this.baseHero = hero;
    this.spells = spells;
    this.player = { x: level.start.x, y: level.start.y, yaw: initialYaw(level), pitch: 0, z: 0, vz: 0 };
    this.messages = tables?.messages ?? {};
    this.encounters = tables?.encounters;
    this.diseaseTables = tables?.diseases;
    this.creatureMaterials = tables?.creatureMaterialRequirements;
    this.spellAreaCells = tables?.spellAreaCells;
    this.creatureInfo = tables?.creatures ?? [];
    this.weaponTable = tables?.weapons ?? [];
    this.armourTable = armourTables(tables?.armour);
    this.undead = tables?.hits?.undead ?? [];
    if (tables?.loot && this.weaponTable.length) {
      this.lootRules = { tables: tables.loot, weapons: this.weaponTable, armour: this.armourTable, classes: tables.character?.classes,spells };
    }
    this.inventory = new Inventory(hero.cls, tables?.character?.cannotEquip);
    for (const gear of startingGear(this.weaponTable, hero.cls)) this.inventory.equip(this.inventory.add(gear));
    const held = this.inventory.weapon;
    this.stats = newPlayerStats(held ? weaponOf(held) : DEFAULT_WEAPON, hero);
    // As in Arena, a character starts with their weapon, their gold and 700 experience: no potions, no armour.
    if (hero.cls) {
      this.stats.gold = hero.gold ?? START_GOLD;
      this.stats.experience = START_EXPERIENCE;
    }
    if (hero.magicka > 0) {
      this.spellbook.push(...startingSpells(spells));
      this.readied = this.spellbook.find(offensive) ?? this.spellbook[0];
      for (const s of this.spellbook) this.inventory.toggleFavourite(spellKey(s));
      this.spellbook.slice(0,4).forEach((s,i)=>this.abilitySlots[i]=spellKey(s));
    }
    this.items = level.items.map((item, id) => ({ ...item, id }));
    level.cells.forEach((c, i) => {
      if (c.kind === 'door') this.doors.set(i, { open: 0, target: 0 });
    });
    if (tables) {
      for (const s of level.creatures) {
        const info = tables.creatures[s.type];
        if (info) this.creatures.push(this.outfit(spawnCreature(this.creatures.length, info, s.x, s.y, random)));
      }
    }
    this.explored = new Exploration(level);
    this.quest = Quest.forLevel(level, this.exitName());
    this.world = {
      level,
      openDoors: this.openDoors,
      player: { x: this.player.x, y: this.player.y, level: this.stats.level, agility: hero.agility, protection: this.inventory.protection(), evasive: hero.evasive },
      bodyParts: tables?.hits?.bodyParts,
      sneaking: false,
      now: 0,
      random,
      creatures: this.creatures,
    };
    this.explored.look(this.player.x, this.player.y, this.openDoors);
  }

  /** Enabled only for the separate Test Area run. */
  practiceMode=false;
  practiceKeepVitalsFull=true;
  /** Test runs use the native spell list, without changing the saved character. */
  learnAllPracticeSpells():void {
    if(!this.practiceMode)return;
    this.spellbook.splice(0,this.spellbook.length,...this.spells);
    this.ensurePracticeMagicka();
  }
  private ensurePracticeMagicka():void {
    if(!this.practiceMode)return;
    this.stats.maxMagicka=Math.max(this.stats.maxMagicka,100,...this.spells.map(s=>this.spellCost(s)));
    this.stats.magicka=this.stats.maxMagicka;
  }
  removePracticeCreature(creature:Creature):void {
    if(!this.practiceMode)return;
    const index=this.creatures.indexOf(creature);if(index<0)return;
    this.creatures.splice(index,1);this.searchedBodies.delete(creature.id);this.carried.delete(creature.id);
    this.events.push({type:'despawned',creature});
  }
  addPracticeCreature(creature: Creature): void {
    if (!this.practiceMode) return;
    this.creatures.push(this.outfit(creature));
  }
  update(dt: number, input: DungeonInput): void {
    if(this.practiceMode && this.practiceKeepVitalsFull){this.stats.health=this.stats.maxHealth;this.stats.stamina=this.stats.maxStamina;this.stats.magicka=this.stats.maxMagicka;}

    this.time += dt;
    this.updateDoors(dt);
    this.sneaking = input.sneaking && !this.outcome;
    if (this.camping && !this.outcome) {
      this.updateCamping(dt);
      return;
    }
    const minute = Math.floor(this.clock / 60);
    this.clock += dt * GAME_SECONDS_PER_SECOND;
    this.updateDisease();
    if (!this.practiceMode && !this.outcome && Math.floor(this.clock / 60) !== minute) this.checkLevel();
    if (this.paralysedUntil > 0 && !this.paralysed) {
      this.paralysedUntil = 0;
      if (!this.outcome) this.events.push({ type: 'notify', text: 'You can move again' });
    }
    if (!this.outcome) {
      if (this.paralysed) this.holdStill(dt, input);
      else {
        this.move(dt, input);
        this.updateAttack(dt, input);
      }
      this.updateCell();
      // A raised guard holds stamina from coming back.
      if (this.blocking) this.sinceStamina = 0;
      recover(this.stats, dt, this.sinceStamina, this.sinceHurt, this.hero.recovery);
      if (this.hero.regainsMagicka) recoverMagicka(this.stats, dt, this.sinceCast, this.hero.recovery);
      this.sinceCast += dt;
      this.updateMagic(dt);
      for (const a of [...this.arrows]) {
        if (a.projectile) this.flySteelArrow(a, dt);
        else this.flyArrow(a, ARROW_SPEED * dt);
      }
      this.sinceStamina += dt;
      this.sinceHurt += dt;
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = LOOK_EVERY;
        this.explored.look(this.player.x, this.player.y, this.openDoors);
        this.quest?.update(this, this.events);
      }
    } else {
      this.blocking = false;
      this.running = false;
    }
    this.updateCreatures(dt, this.sneaking);
  }

  /**
   * How aware the creatures are of the player, for Skyrim's sneak eye: 0
   * hidden, rising as a creature grows suspicious, 0.6 while one hunts for
   * the player, 1 when one has them in sight.
   */
  detection(): number {
    let level = 0;
    for (const c of this.creatures) {
      if (!isAlive(c)) continue;
      if (c.state === 'chase' || c.state === 'attack') level = Math.max(level, c.unseen < 1 ? 1 : 0.6);
      else level = Math.max(level, c.awareness * 0.6);
    }
    return level;
  }

  /** The current objective's place, for the compass's quest marker. */
  get objective(): Objective | undefined {
    return this.quest?.current;
  }

  /**
   * Arena checks for a new level each game minute, and only with no monsters
   * near and the player not resting (the OpenTESArena wiki's reading of the
   * program), so a level won in a fight comes once the fight is over.
   */
  private checkLevel(): void {
    if (this.camping || this.enemiesNear()) return;
    const s = this.stats;
    const before = s.maxHealth;
    if (levelUp(s, this.random, this.hero)) {
      this.events.push({ type: 'levelUp', level: s.level, health: s.maxHealth - before, points: s.bonusPoints }, { type: 'sound', name: 'FANFARE1.VOC' });
    }
  }

  /**
   * The bonus points have been shared out: `hero` is the character worked
   * out again with their new attributes. Endurance counts back over every
   * level, so max health is worked out afresh (maxHealthFor); stamina and
   * spell points follow Strength, Endurance and Intelligence. What each
   * gains is had at once. When there was no room for points (every
   * attribute at 100), Arena heals the player instead: `heal`.
   */
  applyAttributes(hero: Hero, heal = false): void {
    this.baseHero = hero;
    this.setHero(this.geared(hero), heal);
    this.stats.bonusPoints = 0;
  }

  /** What the character wears and the Fortify spells on them changed: works the hero out again. */
  private refreshHero(): void {
    this.setHero(this.geared(this.baseHero));
  }

  /** The hero with the attribute bonuses of what is worn and of Fortify spells (heroWith), and Jumping. */
  private geared(hero: Hero): Hero {
    const bonus = this.attributeBonus();
    if (this.heroWith && bonus.some((b) => b !== 0)) hero = this.heroWith(bonus);
    const gear=this.inventory.bonuses();
    hero={...hero,stamina:hero.stamina+(gear.maxStamina??0),magicka:hero.magicka+(gear.maxMagicka??0),pace:hero.pace*(1+Math.min(50,gear.moveSpeed??0)/100),carry:this.practiceMode?Math.max(10000,hero.carry+(gear.carryWeight??0)):hero.carry+(gear.carryWeight??0)};
    return this.inventory.jumping() ? { ...hero, leap: Math.max(hero.leap, JUMPING_LEAP) } : hero;
  }

  /** What worn enchantments, trinkets and Fortify spells add to each attribute, Strength to Luck. */
  attributeBonus(): number[] {
    const bonus = this.inventory.attributeBonus();
    for (const f of this.fortified) if (f.attribute < ATTRIBUTES) bonus[f.attribute] += f.points;
    for (let i=0;i<8;i++) bonus[i] -= this.diseaseLosses[i]*100/256;
    if (this.playerHarms.has('curse')) bonus[0]-=10;
    return bonus;
  }

  /** Takes up a new hero: Endurance counts back over every level, and what each of health, stamina and spell points gains is had at once. */
  private setHero(hero: Hero, heal = false): void {
    const s = this.stats;
    const health = maxHealthFor(s, hero.healthBonus)+(this.inventory.bonuses().maxHealth??0);
    s.health = heal ? health : raiseTo(s.health, s.maxHealth, health);
    s.maxHealth = health;
    s.stamina = raiseTo(s.stamina, s.maxStamina, hero.stamina);
    s.maxStamina = hero.stamina;
    s.magicka = raiseTo(s.magicka, s.maxMagicka, hero.magicka);
    s.maxMagicka = hero.magicka;
    if(this.practiceMode)this.ensurePracticeMagicka();
    this.hero = hero;
  }

  // ---- Camping ----

  /**
   * Begins camping for a number of hours or until healed, as Arena's camp
   * button does; returns the game's words for why not when it can't. Arena
   * won't let the player rest with monsters near or anywhere but on the
   * floor, nor rest until healed when there is nothing to heal. The first
   * rest at level 2 or above brings Ria to the player's dreams once it is
   * over (the program shows the main quest's vision after resting): the
   * Staff of Chaos and then where its first piece lies, or, as in the
   * original, only the second when the player has already reached level 3
   * (UESP).
   */
  camp(hours: number | 'healed'): string | undefined {
    if (this.outcome) return undefined;
    const m = this.messages;
    if (this.enemiesNear()) return m.enemiesNearby ?? CAMP_WORDS.enemiesNearby;
    if (this.swimming || this.climb || this.paralysed || airborne(this.level, this.player)) return m.campingNotAllowed ?? CAMP_WORDS.campingNotAllowed;
    if (hours === 'healed' && !needsRest(this.stats, this.rester)) return m.fullyRested ?? CAMP_WORDS.fullyRested;
    this.camping = { hoursLeft: hours === 'healed' ? undefined : Math.max(1, Math.floor(hours)), hoursPassed: 0, tick: REST_STEP_SECONDS };
    this.blocking = false;
    this.running = false;
    this.swing = undefined;
    this.events.push({ type: 'camping' });
    return undefined;
  }

  /** Stops camping early, as pressing Arena's camp button again does (or monsters coming). */
  stopCamping(text?: string): void {
    if (!this.camping) return;
    this.camping = undefined;
    this.events.push({ type: 'camped', text });
  }

  /** A rest run its course: woken or healed, then Ria's dream if one is due. */
  private finishCamping(text: string): void {
    this.stopCamping(text);
    if (!this.dreamt && this.stats.level >= 2) {
      this.dreamt = true;
      this.events.push({ type: 'dream', visions: this.stats.level >= 3 ? ['fangLair'] : ['staffIntro', 'fangLair'] });
    }
  }

  /** "3 hours remaining..." or, resting until healed, "2 hours passed....", in the game's words. */
  /** Game minutes since the start of 3E 389, as Arena counts the time (see formats/calendar.ts). */
  get minutes(): number {
    return START_MINUTES + Math.floor(this.clock / 60);
  }

  get campingText(): string | undefined {
    const c = this.camping;
    if (!c) return undefined;
    const m = this.messages;
    const [n, text] =
      c.hoursLeft !== undefined
        ? [c.hoursLeft, c.hoursLeft === 1 ? (m.hourRemaining ?? CAMP_WORDS.hourRemaining) : (m.hoursRemaining ?? CAMP_WORDS.hoursRemaining)]
        : [c.hoursPassed, c.hoursPassed === 1 ? (m.hourPassed ?? CAMP_WORDS.hourPassed) : (m.hoursPassed ?? CAMP_WORDS.hoursPassed)];
    return text.replace('%u', String(n));
  }

  private get rester(): Rester {
    return { className: this.hero.cls?.name, healMod: this.hero.healMod ?? 0, regainsMagicka: this.hero.regainsMagicka };
  }

  /** A living monster within Arena's safe sleeping distance. */
  private enemiesNear(): boolean {
    const p = this.player;
    return this.creatures.some((c) => isAlive(c) && Math.hypot(c.x - p.x, c.y - p.y) <= SAFE_SLEEP_DISTANCE);
  }

  private updateCamping(dt: number): void {
    const c = this.camping!;
    const m = this.messages;
    for (c.tick -= dt; c.tick <= 0 && this.camping; c.tick += REST_STEP_SECONDS) {
      const hour = Math.floor(this.clock / 3600);
      this.clock += REST_STEP;
      this.updateDisease();
      if (this.outcome) { this.finishCamping('Rest interrupted'); break; }
      if (Math.floor(this.clock / 3600) === hour) continue;
      // Each hour: healing, the count, and perhaps monsters.
      restHealing(this.stats, this.rester);
      if (this.diseaseLosses.some(n=>n>0)) {
        const restored=Math.floor((this.hero.attributes?.[5] ?? 50)*256/100/10);
        for (let i=0;i<8;i++) this.diseaseLosses[i] = Math.max(0,this.diseaseLosses[i]-restored);
        this.refreshHero();
      }
      if (c.hoursLeft !== undefined) {
        c.hoursLeft--;
        if (c.hoursLeft <= 0) this.finishCamping(m.doneWakeUp ?? CAMP_WORDS.doneWakeUp);
      } else {
        c.hoursPassed++;
        if (!needsRest(this.stats, this.rester)) this.finishCamping(m.doneHealed ?? CAMP_WORDS.doneHealed);
      }
      this.encounter();
    }
    // The monsters go about their business meanwhile.
    this.updateCreatures(dt, false);
  }

  /**
   * Each hour of rest, monsters may come upon the player (OpenTESArena's
   * tickGameClock): not up on a platform, nor with monsters already near,
   * and at the chance Arena gives resting in a main quest dungeon. They
   * appear on open floor around the player, and if any are near enough,
   * the rest is over. Encounters of people rather than creatures (24 and
   * up) bring nobody yet: the remake has no human foes so far.
   */
  private encounter(): void {
    const tables = this.encounters;
    const cell = this.level.cells[cellIndex(this.level, this.player.x, this.player.y)];
    if (!tables || cell?.kind === 'raised' || this.enemiesNear()) return;
    if (restEncounterChance(tables) <= Math.floor(this.random() * 100)) return;
    const found = chooseEncounter(tables, this.stats.level, this.random);
    const info = found && found.id <= 23 && found.id <= this.creatureInfo.length ? this.creatureInfo[found.id - 1] : undefined;
    if (!found || !info) return;
    for (let i = 0; i < found.count; i++) {
      const at = spawnSpot(this.level, this.player.x, this.player.y, this.random, this.creatures);
      if (!at) break;
      const creature = this.outfit(spawnCreature(this.creatures.length, info, at.x, at.y, this.random));
      this.creatures.push(creature);
      this.events.push({ type: 'spawned', creature });
    }
    if (this.camping && this.enemiesNear()) this.stopCamping(this.messages.enemiesWhileResting ?? CAMP_WORDS.enemiesWhileResting);
  }

  // ---- Moving ----

  /** Jumps, when on the floor and not in water, a pit or a climb. */
  jump(): boolean {
    if (this.outcome || this.paralysed || this.climb || inChasm(this.level, this.player)) return false;
    return jump(this.level, this.player, this.hero.leap);
  }

  /** Held by a paralysing blow: the player can look about, but not move or fight; a paralysis cure remains usable. */
  get paralysed(): boolean {
    return this.time < this.paralysedUntil;
  }

  /** Paralyses the player for `seconds`; a player already paralysed stays so only as long as before, as in Arena. */
  private paralyse(seconds: number, type: StatusDispelType = 'poison'): void {
    if (this.outcome || this.paralysed) return;
    this.paralysedUntil = this.time + seconds;
    this.effectDurations.set('paralysis',seconds);
    this.paralysisType = type;
    this.events.push({ type: 'notify', text: 'You have contracted Paralysis (Prevents movement, attacks and casting)' });
  }

  /** Paralysed: no moving, swinging or guarding, though falling, and tiring in water, go on. */
  private holdStill(dt: number, input: DungeonInput): void {
    this.swing = undefined;
    this.armedAt = this.queued = undefined;
    this.castHeld = input.block;
    this.blocking = false;
    this.running = false;
    this.moving = false;
    this.pushing = 0;
    this.updateHeight(dt);
  }

  private move(dt: number, input: DungeonInput): void {
    const p = this.player;
    if (this.climb) {
      this.updateClimb(dt);
      return;
    }
    let forward = clamp(input.forward, -1, 1);
    let strafe = clamp(input.strafe, -1, 1);
    const moving = forward !== 0 || strafe !== 0;
    // Too laden to run, as in Skyrim.
    const laden = this.inventory.weight() > this.hero.carry;
    if (laden && input.sprint && moving && !this.sprintHeld) this.events.push({ type: 'notify', text: 'You are carrying too much to run' });
    this.sprintHeld = input.sprint && moving;
    let run = input.sprint && moving && this.stats.stamina > 0 && !this.blocking && !laden && !this.swimming;
    if (run) {
      spendStamina(this.stats, SPRINT_STAMINA * dt);
      this.sinceStamina = 0;
    }
    if (input.sneaking && !run) {
      forward *= SNEAK_PACE;
      strafe *= SNEAK_PACE;
    }
    if (this.blocking) {
      forward *= BLOCK_PACE;
      strafe *= BLOCK_PACE;
    }
    if (!moving) run = false;
    const bodies: Body[] = this.creatures.filter(isAlive).map((c) => ({ x: c.x, y: c.y, r: CREATURE_RADIUS }));
    const x0 = p.x;
    const y0 = p.y;
    for (const f of this.level.flats) if (f.solid) bodies.push({ x: f.x, y: f.y, r: SOLID_FLAT_RADIUS });
    const slow=Math.max(0,...[...this.playerHarms.values()].filter(h=>h.until>this.time).map(h=>h.slow??0));
    const pace = (this.swimming ? this.hero.swimPace : this.hero.pace)*(1-Math.min(.75,slow));
    step(this.level, p, { forward, strafe, run, pace }, dt, this.openDoors, bodies);
    const moved = Math.hypot(p.x - x0, p.y - y0);
    this.moving = moved > 0;
    this.running = run && this.moving;
    this.walked += moved;
    this.updateHeight(dt);
    // Pushing on against the edge of water or a pit climbs out of it, even at a slant: held back
    // at the edge, the player makes less than ~60% of their way forward, sliding along it or not at all.
    const edge = this.swimming || inChasm(this.level, p) ? this.climbTarget() : undefined;
    const ahead = (p.x - x0) * Math.cos(p.yaw) + (p.y - y0) * Math.sin(p.yaw);
    if (edge && input.forward > 0.5 && (moved < 0.2 * dt || ahead < 0.6 * moved)) {
      this.pushing += dt;
      if (this.pushing >= (this.swimming ? CLIMB_PUSH_WATER : CLIMB_PUSH_PIT)) this.startClimb(edge);
    } else this.pushing = 0;
    if (this.walked >= this.nextStep && !airborne(this.level, p)) {
      this.nextStep = this.walked + STRIDE;
      // Arena only ever plays the left footstep (OpenTESArena); swimming has its own stroke.
      if (this.swimming) this.events.push({ type: 'sound', name: 'SWIMMING.VOC', volume: 0.4 });
      else if (!input.sneaking) this.events.push({ type: 'sound', name: 'DIRTL.VOC', volume: 0.3 });
    }
  }

  /** Falls, lands, steps up, and goes into or out of water and lava, with what that does. */
  private updateHeight(dt: number): void {
    const p = this.player;
    if(this.time<this.levitateUntil){
      // Maintain floor-level flight across pits/water, with enough headroom for the body.
      p.z=Math.min(Math.max(p.z??0,0),Math.max(0,this.level.height-0.75));p.vz=0;
      this.swimming=false;this.climb=undefined;return;
    }
    settle(this.level, p, dt);
    keepInChasm(this.level, p, this.openDoors);
    const cell = this.level.cells[cellIndex(this.level, p.x, p.y)];
    const swimming = (cell?.chasm === 'wet' || cell?.chasm === 'lava') && inChasm(this.level, p);
    if (swimming && !this.swimming) this.events.push({ type: 'sound', name: 'SPLASH.VOC' });
    this.swimming = swimming;
    if (!swimming) return;
    // Swimming tires, and fatigue doesn't come back meanwhile; with none left the player drowns.
    this.stats.stamina = Math.max(0, this.stats.stamina - SWIM_TIRING * this.hero.swimTiring * dt);
    this.sinceStamina = 0;
    if (this.stats.stamina <= 0) {
      this.die(this.messages.drowning ?? 'You drown.');
      return;
    }
    if (cell?.chasm === 'lava') this.burn(LAVA_BURN * dt);
  }

  /** The point on firm ground ahead that a climb out of water or a pit would end at. */
  private climbTarget(): { x: number; y: number } | undefined {
    const p = this.player;
    const fx = Math.cos(p.yaw);
    const fy = Math.sin(p.yaw);
    for (const reach of [PLAYER_RADIUS + 0.12, PLAYER_RADIUS + 0.3]) {
      const x = p.x + fx * reach;
      const y = p.y + fy * reach;
      const i = cellIndex(this.level, x, y);
      const cell = this.level.cells[i];
      if (!cell || cell.chasm) continue;
      // Up onto the floor (or a low platform) beside, if there is room to stand there.
      const to = { x: p.x + fx * (PLAYER_RADIUS * 2 + 0.25), y: p.y + fy * (PLAYER_RADIUS * 2 + 0.25) };
      if (!playerBlocked(this.level, to.x, to.y, groundUnder(this.level, { ...p, ...to, z: 0 }), this.openDoors)) return to;
    }
    return undefined;
  }

  private startClimb(to: { x: number; y: number }): void {
    const p = this.player;
    const cell = this.level.cells[cellIndex(this.level, p.x, p.y)];
    this.pushing = 0;
    this.swing = undefined;
    // Out of the water's pull: the view rises with the climb, and swimming no longer tires.
    this.swimming = false;
    this.climb = { progress: 0, seconds: cell?.chasm === 'dry' ? CLIMB_PIT / this.hero.climbPace : CLIMB_WATER, from: p.z ?? 0, start: { x: p.x, y: p.y }, to };
  }

  private updateClimb(dt: number): void {
    const c = this.climb!;
    const p = this.player;
    c.progress = Math.min(1, c.progress + dt / c.seconds);
    p.z = c.from * (1 - c.progress);
    p.vz = 0;
    // Over the edge in the last part of the climb, once up out of the hole.
    const over = Math.max(0, (c.progress - 0.6) / 0.4);
    const t = over * over * (3 - 2 * over);
    p.x = c.start.x + (c.to.x - c.start.x) * t;
    p.y = c.start.y + (c.to.y - c.start.y) * t;
    this.moving = false;
    if (c.progress < 1) return;
    p.z = groundUnder(this.level, p);
    this.climb = undefined;
    this.swimming = false;
  }

  /** A blow, or attacking, while climbing out throws the player back in (UESP). */
  private fallBack(): void {
    if (!this.climb) return;
    this.player.x = this.climb.start.x;
    this.player.y = this.climb.start.y;
    this.player.z = this.climb.from;
    this.climb = undefined;
  }

  private burn(damage: number): void {
    if(this.practiceMode)return;
    this.stats.health = this.practiceMode?this.stats.maxHealth:Math.max(0, this.stats.health - damage);
    this.sinceHurt = 0;
    if (this.camping) this.stopCamping();
    if (this.stats.health <= 0) this.die();
  }

  private die(cause?: string): void {
    if(this.practiceMode && this.practiceKeepVitalsFull){this.stats.health=this.stats.maxHealth;return;}
    if (this.outcome) return;
    this.outcome = 'dead';
    this.swing = undefined;
    this.climb = undefined;
    this.events.push({ type: 'sound', name: 'MDIE.VOC' }, { type: 'died', cause });
  }

  private updateDoors(dt: number): void {
    for (const [i, door] of this.doors) {
      if (door.open === door.target) continue;
      door.open = clamp(door.open + Math.sign(door.target - door.open) * DOOR_SPEED * dt, 0, 1);
      if (door.open === 1) this.openDoors.add(i);
      const sounds = this.doorSounds(i);
      if (door.open === 0 && sounds?.closeWhenShut && sounds.close) this.events.push({ type: 'sound', name: sounds.close, at: cellCentre(this.level, i) });
    }
  }

  /** The sounds of the door in a cell, by its kind; the remake's own creak and thud for a level without them. */
  private doorSounds(cell: number): DoorSounds | undefined {
    const kind = this.level.cells[cell]?.door ?? 'raising';
    if (!this.level.doorSounds) return { open: 'OPENDOOR.VOC', close: 'CLOSDOOR.VOC', closeWhenShut: false };
    return this.level.doorSounds[kind];
  }

  /**
   * Messages and sounds for the cell the player has just walked into, as
   * Arena does: the sound each time, the text each time too unless it is one
   * to show only once ("~" in the INF).
   */
  private updateCell(): void {
    const here = cellIndex(this.level, this.player.x, this.player.y);
    if (here === this.here) return;
    this.here = here;
    this.level.triggers.forEach((t, n) => {
      if (t.y * this.level.width + t.x !== here) return;
      if (t.text && !(t.once && this.shownTexts.has(n))) {
        this.shownTexts.add(n);
        this.events.push({ type: 'message', text: t.text });
      }
      if (t.sound) this.events.push({ type: 'sound', name: t.sound, at: { x: t.x + 0.5, y: t.y + 0.5 } });
    });
  }

  // ---- Creatures ----

  private updateCreatures(dt: number, sneaking: boolean): void {
    const w = this.world;
    w.player.x = this.player.x;
    w.player.y = this.player.y;
    w.player.level = this.stats.level;
    w.player.agility = this.hero.agility;
    w.player.evasive = this.hero.evasive;
    w.player.protection = this.inventory.protection();
    w.sneaking = sneaking;
    w.invisible = this.invisible;
    w.nonTarget = this.time<this.sanctuary.until;
    w.now = this.time;
    w.round = this.clock/60;
    for(const c of this.creatures){c.auraDamage=1;c.auraPace=1;c.auraAccuracy=1;c.auraAttackRate=1;}
    for(const source of this.creatures)if(isAlive(source)&&source.elite?.aura&&source.paralysed<=0){
      const aura=source.elite.aura;
      for(const ally of this.creatures)if(isAlive(ally)&&Math.hypot(ally.x-source.x,ally.y-source.y)<=3&&lineOfSight(this.level,source.x,source.y,ally.x,ally.y,this.openDoors)){
        if(aura==='might'||aura==='fury')ally.auraDamage=Math.max(ally.auraDamage??1,aura==='might'?1.3:1.2);
        if(aura==='aim')ally.auraAccuracy=1.5;
        if(aura==='fury'){ally.auraPace=Math.max(ally.auraPace??1,1.25);ally.auraAttackRate=1.2;}
      }
    }
    for (const c of this.creatures) {
      this.updateElite(c);
      updateCreature(c, w, dt, this.creatureEvents);
      if(this.looting?.body===c.id&&(isAlive(c)||c.state==='reviving'))this.closeLoot();
      if(!c.info.timing)this.updateCreatureCasting(c);
      // Now and then a hunting creature calls out.
      if (c.state === 'chase' && this.time >= (this.growlAt.get(c.id) ?? Infinity)) {
        this.growlAt.set(c.id, this.time + 4 + this.random() * 6);
        this.creatureSound(c);
      }
    }
  }

  private eliteHarm(id:string,name:string,icon:string,type:StatusDispelType,seconds:number,extra:{damage?:number;element?:number;slow?:number;vulnerability?:number}={}):void {
    const previous=this.playerHarms.get(id);
    this.playerHarms.set(id,{name,icon,type,until:this.time+seconds,next:previous?.next??this.time+1,every:1,damage:0,duration:seconds,...extra});
    if(!previous||previous.until<=this.time)this.events.push({type:'notify',text:`You have contracted ${name}`});
  }
  private eliteHit(c:Creature,physical:number,missile=false):void {
    const e=c.elite;if(!e)return;
    if(e.affixes.includes('curse')&&this.random()<.75)this.eliteHarm('elite-hex','Frailty Hex (Doubles physical damage taken)','curse','curse',8,{vulnerability:1});
    if(e.affixes.includes('siphon'))this.stats.magicka=Math.max(0,this.stats.magicka-physical*.83);
    if(missile)return;
    let kinds:number[]=[];
    if(e.affixes.includes('flame'))kinds.push(0);
    if(e.affixes.includes('frost')||e.champion==='ghostly')kinds.push(1);
    if(e.affixes.includes('storm'))kinds.push(3);
    if(e.affixes.includes('prismatic'))kinds.push([4,0,3,1,2][Math.floor(this.random()*5)]);
    for(const kind of kinds){
      const damage=Math.max(1,Math.round(physical*(e.champion==='ghostly'?.4:.83)));
      if(kind===2)this.eliteHarm('elite-poison','Venom Strike (Poison damage over time)','poison','poison',4,{damage:Math.max(1,damage/4),element:2});
      const struck=kind!==2&&this.hurtPlayer(damage,c,kind);
      if(kind===1&&struck)this.eliteHarm('elite-chill','Chilled (Slows movement)','frost','magic',4+c.info.level*.2,{slow:.35});
    }
  }
  private updateElite(c:Creature):void {
    const e=c.elite;if(!e||!isAlive(c)||this.outcome||c.paralysed>0)return;
    const dist=Math.hypot(c.x-this.player.x,c.y-this.player.y),sees=lineOfSight(this.level,c.x,c.y,this.player.x,this.player.y,this.openDoors);
    if(e.affixes.includes('blink')&&(c.health<c.maxHealth*.3||!!c.info.spells?.length&&dist<1.5)&&this.time>=e.nextBlink&&sees){
      e.nextBlink=this.time+8;
      const candidates=[];for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
        const at={x:Math.floor(c.x)+x+.5,y:Math.floor(c.y)+y+.5},cell=cellIndex(this.level,at.x,at.y);
        if(cell<0||this.level.cells[cell].chasm||floorHeight(this.level.cells[cell],this.level)!==0||blockedFor(this.level,at.x,at.y,CREATURE_RADIUS,this.openDoors)||Math.hypot(at.x-this.player.x,at.y-this.player.y)<2||this.creatures.some(o=>o!==c&&isAlive(o)&&Math.hypot(o.x-at.x,o.y-at.y)<.6)||!lineOfSight(this.level,c.x,c.y,at.x,at.y,this.openDoors))continue;
        if(Math.hypot(at.x-c.x,at.y-c.y)>=1.5)candidates.push(at);
      }
      if(candidates.length){const at=candidates[Math.min(candidates.length-1,Math.floor(this.random()*candidates.length))];this.eliteBurst(c,4,0);Object.assign(c,at);delete c.goal;c.replan=0;c.state='chase';c.time=0;if(c.health<c.maxHealth*.3)c.health=Math.min(c.maxHealth,c.health+e.baseHealth*.25);this.eliteBurst(c,4,0);}
    }
    if(!e.aura||dist>3||!sees||this.time<e.nextPulse)return;
    e.nextPulse=this.time+1;
    if(e.aura==='flame'||e.aura==='frost'||e.aura==='storm'){
      const kind=e.aura==='flame'?0:e.aura==='frost'?1:3;
      const struck=this.hurtPlayer(Math.max(4,1+Math.floor(c.info.level/6)),c,kind);this.eliteBurst(c,kind,3);
      if(kind===1&&struck)this.eliteHarm('elite-chill','Chilled (Slows movement)','frost','magic',2,{slow:.35});
    }else if(e.aura==='weakening')this.eliteHarm('elite-frailty','Frailty Aura (Increases physical damage taken)','curse','curse',2,{vulnerability:.3});
  }
  private eliteBurst(c:Creature,element:number,radius:number):void {
    const spell=this.spells.find(s=>s.element===element&&s.effects.some(e=>e.effect===DAMAGE));
    if(spell)this.events.push({type:'burst',spell,at:{x:c.x,y:c.y},radius});
    this.events.push({type:'sound',name:radius?'EXPLODE.VOC':'BURST5.VOC',at:{x:c.x,y:c.y},volume:.5});
  }
  private eliteStruck(c:Creature):void {
    const e=c.elite;if(!e?.affixes.includes('storm')||this.time<e.nextStorm)return;
    e.nextStorm=this.time+.6;
    const damage=Math.max(1,c.info.level-1),spell:SpellRecord={index:-1,name:'Storm Discharge',target:'target',element:3,flags:0,cost:0,effects:[{effect:DAMAGE,sub:0,attribute:0,params:[damage,damage,0,0,0,0]}]};
    const floor=Math.max(0,floorHeight(this.level.cells[cellIndex(this.level,c.x,c.y)],this.level));
    for(let i=0;i<8;i++){const angle=i*Math.PI/4;this.bolts.push({id:this.nextBolt++,spell,level:1,x:c.x,y:c.y,dx:Math.cos(angle),dy:Math.sin(angle),z:floor+.3,dz:0,travelled:0,source:c});}
    this.events.push({type:'sound',name:'SLOWBALL.VOC',at:{x:c.x,y:c.y},volume:.5});
  }
  private eliteDeath(c:Creature):void {
    const e=c.elite;if(!e||e.deathTriggered)return;e.deathTriggered=true;
    for(const [affix,element]of [['flame',0],['frost',1]] as const)if(e.affixes.includes(affix)){
      this.eliteBurst(c,element,2.65);
      if(Math.hypot(c.x-this.player.x,c.y-this.player.y)>2.65||!lineOfSight(this.level,c.x,c.y,this.player.x,this.player.y,this.openDoors))continue;
      if(element===0){const total=e.baseHealth*(.1125+this.random()*.075);this.hurtPlayer(total/2,c);this.hurtPlayer(total/2,c,0);}
      else {if(this.hurtPlayer(Math.max(1,c.info.level-1),c,1))this.eliteHarm('elite-chill','Chilled (Slows movement)','frost','magic',4,{slow:.35});}
    }
  }

  /** Native casters roll once per native AI update; fallback actors use their cooldown. */
  private updateCreatureCasting(c:Creature):boolean {
    const list=c.info.spells;
    if(this.outcome||!list?.length||!isAlive(c)||c.paralysed>0||c.state==='attack'||c.state!=='chase'&&this.time>=this.sanctuary.until)return false;
    const state=creatureMagic(c);
    if(!c.info.timing&&this.time<state.nextCast||this.time<state.silencedUntil||this.invisible&&!monsterSeesInvisible(c.info.id))return false;
    // The original Medusa waits until its previous paralysis has worn off.
    if(c.info.id===21&&this.paralysed)return false;
    const dist=Math.hypot(c.x-this.player.x,c.y-this.player.y);
    if((c.info.timing?monsterInReach(c,this.player):dist<1.35)||dist>BOLT_RANGE||!lineOfSight(this.level,c.x,c.y,this.player.x,this.player.y,this.openDoors))return false;
    if(c.info.timing&&Math.floor(this.random()*65536)%c.info.timing.castDivisor!==0)return true;
    const spell=this.spells.find(s=>s.index===list[Math.floor(this.random()*list.length)]);
    if(!spell)return false;
    const level=c.info.spellLevel??c.info.level;
    // Native monsters use innate spells, without the humanoid mana check.
    if(!c.info.timing)state.nextCast=this.time+2.5+this.random()*1.5;
    const dx=(this.player.x-c.x)/dist,dy=(this.player.y-c.y)/dist;
    const floor=Math.max(0,floorHeight(this.level.cells[cellIndex(this.level,c.x,c.y)],this.level));
    const z=floor+c.info.lift*ARENA_HEIGHT+(c.collisionHeight??1)*.6;
    const aimZ=(this.player.z??0)+playerEyeOffset(this.sneaking,this.swimming);
    this.bolts.push({id:this.nextBolt++,spell,level,x:c.x+dx*.35,y:c.y+dy*.35,dx,dy,travelled:0,source:c,
      z:z+(aimZ-z)/dist*.35,dz:(aimZ-z)/dist});
    if(c.elite?.affixes.includes('volley')){
      const middle=this.bolts[this.bolts.length-1],yaw=Math.atan2(dy,dx);
      for(const angle of [-.16,.16])this.bolts.push({...middle,id:this.nextBolt++,dx:Math.cos(yaw+angle),dy:Math.sin(yaw+angle)});
    }
    this.events.push({type:'sound',name:'SLOWBALL.VOC',at:{x:c.x,y:c.y},volume:.7});
    return true;
  }

  private readonly creatureEvents: CreatureEvents = {
    casting:(c)=>this.updateCreatureCasting(c),
    fall: (c) => this.events.push({type:'sound',name:'BODYFALL.VOC',at:{x:c.x,y:c.y}}),
    notice: (c) => {
      this.creatureSound(c);
      this.growlAt.set(c.id, this.time + 3 + this.random() * 5);
    },
    swing: (c) => this.events.push({ type: 'sound', name: 'SWISH.VOC', at: { x: c.x, y: c.y }, volume: 0.5 }),
    strike: (c, damage) => {
      // Sanctuary: a chance the creature ignores the player.
      if (damage > 0 && this.time < this.sanctuary.until) return;
      if (this.outcome || damage <= 0 || !this.hurtPlayer(damage, c)) return;
      this.eliteHit(c,damage);
      const rounds = paralysisFrom(c.info, this.hero.paralysis, this.random);
      if (rounds > 0) this.paralyse(rounds * ROUND);
      else if (!this.paralysed && !this.disease) {
        const disease = diseaseFrom(c.info, this.diseaseTables, this.hero.saves[2] ?? 0, this.hero.cls?.id, this.random);
        if (disease) this.infect(disease.id);
      }
    },
  };

  /** One disease at a time, matching Arena's effect flag. */
  infect(id: number): boolean {
    if (this.disease || this.hero.cls?.id === 15) return false;
    const info=this.diseaseTables?.diseases.find(d=>d.id===id);
    if (!info) return false;
    this.disease=infectDisease(info,this.clock,this.random);
    this.events.push({type:'notify',text:`You have contracted ${info.name} (${diseaseDescription(info)})`});
    return true;
  }

  cureDisease(): void {
    if (!this.disease) return;
    const name=this.disease.info.name;
    this.disease=undefined;
    this.events.push({type:'notify',text:`${name} cured`});
  }

  private updateDisease(): void {
    const disease=this.disease;
    if (!disease || this.outcome) return;
    while (disease.next <= this.clock && (disease.until===undefined || disease.next < disease.until)) {
      disease.next+=DISEASE_DAY;
      for (let i=0;i<8;i++) this.diseaseLosses[i]+=disease.losses[i];
      this.refreshHero();
      const s=this.stats;
      if (!this.practiceMode) {
        s.health=Math.max(0,s.health-disease.losses[8]);
        s.magicka=Math.max(0,s.magicka-disease.losses[10]);
        s.stamina=Math.max(0,s.stamina-disease.losses[12]*100/256);
        if (s.health<=0 || this.baseHero.attributes?.some((value,i)=>this.diseaseLosses[i]>=Math.round(value*256/100))) { this.die(); return; }
      }
    }
    if (disease.until!==undefined && this.clock>=disease.until) this.cureDisease();
  }

  private creatureSound(c: Creature): void {
    if (c.info.sound) this.events.push({ type: 'sound', name: c.info.sound, at: { x: c.x, y: c.y } });
  }

  /**
   * A blow, or a spell of an `element` (which the player saves against, see
   * elementalDamage), reaching the player. Returns whether it struck home:
   * not taken on the guard, and not all soaked up by a shield spell.
   */
  private hurtPlayer(damage: number, from?: Creature, element?: number, resistanceChecked=false): boolean {
    const gear=this.inventory.bonuses();
    if(element===undefined)damage*=1+Math.max(0,...[...this.playerHarms.values()].filter(h=>h.until>this.time).map(h=>h.vulnerability??0));
    if (element !== undefined) {
      const ward=[...this.wards.values()].find(w=>w.effect.effect===ELEMENTAL_RESISTANCE&&resistedElement(w.effect.sub)===element&&this.time<w.until);
      if(!resistanceChecked&&ward&&this.random()*100<ward.power)return false;
      damage = elementalDamage(damage, element, this.hero, this.random);
      const key=(['resistFire','resistFrost','resistPoison','resistShock','resistMagic'] as const)[element];
      damage=Math.max(0,Math.round(damage*(1-Math.min(75,(key?gear[key]??0:0)+(gear.resistAll??0))/100))-(gear.magicReduction??0));
    }else damage=Math.max(0,damage-(gear.damageReduction??0));
    if (damage <= 0) return false;
    let guarded = false;
    if (this.blocking && from && angleTo(this.player, from.x, from.y) <= BLOCK_ARC && spendStamina(this.stats, BLOCK_STAMINA)) {
      this.sinceStamina = 0;
      guarded = true;
      damage = Math.round(damage * Math.max(.05,BLOCK_LEAK-(gear.blockReduction??0)/100));
      this.events.push({ type: 'blocked', damage }, { type: 'sound', name: 'CLANK.VOC', volume: 0.8 });
      if (damage <= 0) return false;
    }
    if (this.shieldPoints > 0) {
      const absorbed = Math.min(damage, this.shieldPoints);
      this.shieldPoints -= absorbed;
      damage -= absorbed;
      if (this.shieldPoints <= 0) this.events.push({ type: 'notify', text: 'Your shield is gone' });
      if (damage <= 0) {
        this.events.push({ type: 'blocked', damage: 0 }, { type: 'sound', name: 'CLANK.VOC', volume: 0.6 });
        return false;
      }
    }
    this.stats.health = this.practiceMode?this.stats.maxHealth:Math.max(0, this.stats.health - damage);
    this.sinceHurt = 0;
    this.events.push({ type: 'hurt', damage }, { type: 'sound', name: 'UHIT.VOC' });
    if(from&&element===undefined&&isAlive(from)){
      if(gear.thorns)this.hurtByMagic(from,gear.thorns,'magic');
      this.gearProcs(from,'struck');
    }
    this.fallBack();
    if (this.stats.health <= 0) this.die();
    return !guarded;
  }

  // ---- Fighting ----

  private updateAttack(dt: number, input: DungeonInput): void {
    if(this.terrainSpell){if(input.attack.pressed)this.changeTerrain();return;}
    this.movementIntent = { forward: input.forward, strafe: input.strafe };
    if (this.climb) {
      // Attacking too soon while climbing out drops the player back in.
      if (input.attack.pressed) this.fallBack();
      return;
    }
    // A readied spell takes the guard's place, as a spell in Skyrim's left hand does.
    const castPressed = input.block && !this.castHeld;
    this.castHeld = input.block;
    if (this.readied && !input.guardOnly) {
      if (castPressed) this.cast(this.readied);
      input = { ...input, block: false };
    }
    if (this.stats.weapon.bow) {
      this.updateBow(dt, input);
      return;
    }
    const a = input.attack;
    if (input.block) {
      // Attacking with the guard up is a bash.
      this.armedAt = this.queued = undefined;
      if (a.pressed && !this.swing) this.bash();
    } else {
      if (a.pressed) this.armedAt = this.time;
      if (this.armedAt !== undefined) {
        if (a.released || !a.held) {
          this.armedAt = undefined;
          this.attack(false);
        } else if (this.time - this.armedAt >= POWER_HOLD) {
          this.armedAt = undefined;
          this.attack(true);
        }
      }
    }
    const s = this.swing;
    if (s) {
      s.time += dt;
      if(s.soundAt!==undefined&&s.time>=s.soundAt){
        if(!s.struck)this.events.push({type:'sound',name:'SWISH.VOC'});
        s.soundAt=undefined;
      }
      if (!s.struck && s.time >= s.duration * (s.hitAt ?? HIT_AT)) {
        s.struck = true;
        this.strike(s);
      }
      if (s.time >= s.duration) {
        this.swing = undefined;
        this.lastSwingEnd = this.time;
      }
    }
    if (!this.swing && this.queued !== undefined) {
      const power = this.queued;
      this.queued = undefined;
      this.startSwing(power);
    }
    this.blocking = input.block && !this.swing;
  }

  private bash(): void {
    if (!spendStamina(this.stats, BASH_STAMINA)) return;
    this.sinceStamina = 0;
    this.swing = { kind: 'thrust', power: false, bash: true, time: 0, duration: BASH_TIME, struck: false };
    this.events.push({ type: 'swing', swing: this.swing }, { type: 'sound', name: 'SWISH.VOC', volume: 0.7 });
  }

  /** Swings now, or straight after the swing in progress. */
  private attack(power: boolean): void {
    if (this.swing) this.queued = power;
    else this.startSwing(power);
  }

  private startSwing(power: boolean): void {
    if (power && spendStamina(this.stats, POWER_STAMINA)) this.sinceStamina = 0;
    else power = false;
    if (this.time - this.lastSwingEnd > COMBO_RESET) this.combo = 0;
    // Counter the initiating strafe for both taps and power attacks.
    const direction = this.movementIntent;
    const sweepDirection: -1|1|undefined = usesModelWeaponHandling(this.stats.weapon)&&!(power&&this.stats.weapon.type===0)&&Math.abs(direction.strafe)>.1
      ? direction.strafe>0?-1:1 : undefined;
    const kind: SwingKind = power && this.stats.weapon.type===0
      ? 'thrust'
      : sweepDirection!==undefined
        ? sweepDirection<0?'left':'right'
        : power && usesModelWeaponHandling(this.stats.weapon)
          ? direction.forward > 0.1
              ? 'thrust'
              : direction.forward < -0.1
                ? 'downLeft'
                : this.stats.weapon.type===6?'right':'chop'
        : power
          ? this.moving ? 'thrust' : 'chop'
          : COMBO[this.combo++ % COMBO.length];
    const rate=1+Math.min(60,this.inventory.bonuses().attackSpeed??0)/100;
    this.swing = { kind, power, sweepDirection, time: 0, duration: steelAttackDuration(this.stats.weapon, power, kind)/rate, hitAt: steelImpactAt(this.stats.weapon, power, kind), struck: false };
    const soundAt=steelSwingSoundTime(this.stats.weapon,power,kind)/rate;
    this.events.push({type:'swing',swing:this.swing});
    if(soundAt>0)this.swing.soundAt=soundAt;
    else this.events.push({type:'sound',name:'SWISH.VOC'});
  }

  /** A solid surface intercepted the visible Steel weapon before its damage frame. */
  meleeTerrainContact(hit: ProjectileHit, swing: Swing): void {
    if (this.swing !== swing || swing.struck || !usesModelWeaponHandling(this.stats.weapon) || hit.material === 'soft') return;
    swing.struck = true;
    this.surfaceFeedback(hit,swing);
    // Probe just inside the struck face to find its door without bypassing locks.
    const cell = cellIndex(this.level, hit.point[0] - hit.normal[0] * 0.002, hit.point[2] - hit.normal[2] * 0.002);
    if (
      cell >= 0 &&
      this.level.cells[cell].kind === 'door' &&
      this.locked(cell) &&
      this.random() < bashChance(this.level.locks.get(cell) ?? 0) * (swing.power ? 2 : 1)
    ) {
      this.unlocked.add(cell);
      this.openDoor(cell);
      this.events.push({ type: 'notify', text: 'You broke the lock' });
    }
  }

  private surfaceFeedback(hit:ProjectileHit,swing:Swing):void {
    this.events.push(
      {type:'weaponImpact',material:hit.material,bash:!!swing.bash},
      {type:'surfaceImpact',material:hit.material,point:hit.point,normal:hit.normal},
      {type:'sound',name:hit.material==='wood'?'BASH.VOC':'CLANK.VOC',at:{x:hit.point[0],y:hit.point[2]},volume:.6},
    );
  }

  /** The moment a swing lands: on a creature in front, else on a door or wall. */
  private strike(s: Swing): void {
    const target = this.creatureInReach();
    if(usesModelWeaponHandling(this.stats.weapon)){
      const p=this.player,height=Math.min((p.z??0)+(this.viewEyeOffset??playerEyeOffset(this.sneaking,this.swimming)),ceilingHeight(this.level.cells[cellIndex(this.level,p.x,p.y)],this.level)-.03),cp=Math.cos(p.pitch);
      const from:ProjectileHit['point']=[p.x,height,p.y],to:ProjectileHit['point']=[p.x+Math.cos(p.yaw)*cp*WEAPON_REACH,height+Math.sin(p.pitch)*WEAPON_REACH,p.y+Math.sin(p.yaw)*cp*WEAPON_REACH];
      const prop=sweepWoodProps(this.level,from,to),terrain=prop&&sweepTerrain(this.level,this.openDoors,from,to,this.surfaceMaterials);
      if(prop&&(!terrain||prop.fraction<=terrain.fraction+1e-9)&&(!target||prop.fraction*WEAPON_REACH<Math.hypot(target.x-p.x,target.y-p.y)-.16)){
        this.surfaceFeedback(prop,s);return;
      }
    }
    if (s.bash && target) {
      staggerCreature(target, this.world, this.player);
      this.events.push({ type: 'bashed', creature: target }, { type: 'sound', name: 'BASH.VOC', at: { x: target.x, y: target.y }, volume: 0.7 });
      return;
    }
    if (target) {
      // Arena's blow, then the remake's power attacks and sneak attacks.
      const blow = this.blowDamage(this.stats.weapon, target);
      let damage = blow.damage;
      if (s.power) damage *= 2;
      if (this.sneaking && isCalm(target)) {
        damage *= SNEAK_ATTACK;
        this.events.push({ type: 'notify', text: `Sneak attack for ${SNEAK_ATTACK}x damage!` });
      }
      const before = Math.max(0,target.health);
      const killed = hurtCreature(target, damage, this.world, s.power);
      if(Math.max(0,target.health)<before&&isAlive(target))this.eliteStruck(target);
      this.events.push({ type: 'hit', creature: target, damage, killed, appliedDamage:Math.max(0,before-Math.max(0,target.health)),critical:blow.critical,damageKind:'physical' }, { type: 'sound', name: 'EHIT.VOC', at: { x: target.x, y: target.y } });
      if (killed) this.killed(target);
      this.weaponEnchantments(target,Math.max(0,before-Math.max(0,target.health)));
      return;
    }
    const ahead = this.ahead(1.1);
    if (!ahead) return;
    const material = cellMaterial(this.level, this.level.cells[ahead.cell], 'wall', this.surfaceMaterials);
    if (usesModelWeaponHandling(this.stats.weapon)) {
      this.events.push({type:'weaponImpact',material,bash:!!s.bash});
      const p=this.player,height=Math.min((p.z??0)+(this.viewEyeOffset??playerEyeOffset(this.sneaking,this.swimming)),ceilingHeight(this.level.cells[cellIndex(this.level,p.x,p.y)],this.level)-.03),cp=Math.cos(p.pitch);
      const hit=sweepTerrain(this.level,this.openDoors,[p.x,height,p.y],[p.x+Math.cos(p.yaw)*cp*WEAPON_REACH,height+Math.sin(p.pitch)*WEAPON_REACH,p.y+Math.sin(p.yaw)*cp*WEAPON_REACH],this.surfaceMaterials);
      if(hit)this.events.push({type:'surfaceImpact',material:hit.material,point:hit.point,normal:hit.normal});
    }
    if (ahead.kind === 'door' && this.locked(ahead.cell)) {
      this.events.push({ type: 'sound', name: 'BASH.VOC', at: ahead.at });
      if (this.random() < bashChance(this.level.locks.get(ahead.cell) ?? 0) * (s.power ? 2 : 1)) {
        this.unlocked.add(ahead.cell);
        this.events.push({ type: 'notify', text: 'You broke the lock' });
        this.openDoor(ahead.cell);
      }
    } else this.events.push({ type: 'sound', name: material === 'metal' || material === 'stone' ? 'CLANK.VOC' : 'BASH.VOC',
        at: ahead.at, volume: 0.6 });
  }

  /**
   * A blow's damage as Arena works it out (its program at 0x2AEB5), from a
   * swing or an arrow: the weapon's roll, Strength and the race's knack,
   * doubled for a critical hit, then a Ranger's level.
   */
  private blowDamage(weapon: Weapon, target: Creature,gear=this.inventory.bonuses(),hero=this.hero,level=this.stats.level): {damage:number;critical:boolean} {
    const bow = weapon.bow === true;
    const bonus = hero.damageBonus + knackDamage(hero.knack, level, bow);
    let damage = Math.max(1, roll(this.random, ...weapon.damage) + bonus);
    const criticalChance=Math.min(1,(mayCrit(hero,bow)?hero.critical:0)+(gear.critical??0)/100);
    const critical = criticalChance>0 && this.random() < criticalChance;
    if (critical) {
      damage = Math.round(damage*(2+Math.max(0,gear.criticalDamage??0)/100));
      this.events.push({ type: 'notify', text: 'Critical strike!' });
    }
    const undead=target.info.id!==undefined&&this.undead.includes(target.info.id)||/ghost|wraith|skeleton|ghoul|zombie|vampire|lich/i.test(target.info.name);
    const distance=Math.hypot(target.x-this.player.x,target.y-this.player.y);
    const extra=(undead?gear.undeadDamage??0:/daedroth|dremora|fire demon/i.test(target.info.name)?gear.daedraDamage??0:0)
      +(distance<=2?gear.closeDamage??0:gear.distantDamage??0)
      +(target.health<target.maxHealth*.35?gear.woundedDamage??0:0);
    return {damage:monsterWeaponDamage(Math.max(1,Math.round((damage + levelDamage(hero, level, target.info.id, this.undead))*(1+extra/100))), weapon, target.info, this.undead, this.creatureMaterials),critical};
  }

  /**
   * A bow in hand: an arrow is loosed whenever the attack button is down and
   * the last one is gone, as in Arena. There is no guard, bash or power
   * attack with a bow.
   */
  private updateBow(dt: number, input: DungeonInput): void {
    const attack = input.attack;
    if (this.stats.weapon.material === STEEL) {
      this.updateSteelBow(dt, input);
      return;
    }
    this.blocking = false;
    this.armedAt = this.queued = undefined;
    const s = this.swing;
    if (s) {
      s.time += dt;
      if (s.time >= s.duration) this.swing = undefined;
    }
    if (!this.swing && (attack.held || attack.pressed)) this.shoot();
  }

  private updateSteelBow(dt: number, input: DungeonInput): void {
    this.blocking = input.block;
    this.armedAt = this.queued = undefined;
    const attack = input.attack;
    // Block cancels a held draw without consuming ammunition; a tap while blocking bashes.
    if (input.block) {
      if (this.swing?.kind === 'shoot' && !this.swing.struck) this.swing = undefined;
      if (attack.pressed && !this.swing) this.bash();
    }
    const s = this.swing;
    if (s) {
      s.time += dt;
      if (s.bash) {
        if (!s.struck && s.time >= s.duration * (s.hitAt ?? HIT_AT)) {
          s.struck = true;
          this.strike(s);
        }
        if (s.time >= s.duration) this.swing = undefined;
      } else {
        const type=this.stats.weapon.type??16,speed=weaponAttackSpeed(type);
        const minimum=(BOW_MOTION_MARKERS['shoot min attack']-BOW_MOTION_MARKERS['shoot start'])/speed;
        if(s.bowReleaseSource===undefined && (attack.released||!attack.held) && s.time>=minimum) {
          const release=bowReleaseTiming(type,s.time);s.bowReleaseSource=release.start;s.bowStrength=release.strength;s.time=0;s.duration=release.duration;s.hitAt=release.hit/release.duration;
        }
        if(s.bowReleaseSource!==undefined){
          const release=bowReleaseTiming(type,0),hit=(BOW_MOTION_MARKERS['shoot release']-s.bowReleaseSource)/speed;
          if(!s.struck&&s.time>=hit){s.struck=true;this.looseSteelArrow(s.bowStrength??release.strength);}
          if(s.time>=s.duration)this.swing=undefined;
        }
      }
    }
    if(!this.swing&&!input.block&&attack.pressed)this.shoot();
  }

  /** Looses an arrow the way the player faces; the bow is ready again once the character's reload time is up. */
  private shoot(): void {
    if (this.stats.weapon.material === STEEL) {
      if (!this.inventory.steelArrowCount()) {
        if (this.time >= this.noArrowsUntil) {
          this.events.push({ type: 'notify', text: 'You need Steel Arrows' });
          this.noArrowsUntil = this.time + 0.8;
        }
        return;
      }
      this.swing = {
        kind: 'shoot',
        power: false,
        time: 0,
        duration: Infinity,
        struck: false,
        releaseAt: steelBowDrawTime(this.stats.weapon),
      };
      this.events.push({ type: 'swing', swing: this.swing });
      return;
    }
    const p = this.player;
    this.swing = { kind: 'shoot', power: false, time: 0, duration: this.hero.reload, struck: true };
    this.events.push({ type: 'swing', swing: this.swing }, { type: 'sound', name: 'ARROWFR.VOC' });
    const arrow: Arrow = { id: this.nextArrow++, x: p.x, y: p.y, dx: Math.cos(p.yaw), dy: Math.sin(p.yaw), travelled: 0, weapon: this.stats.weapon, sneak: this.sneaking,attacker:{...this.hero},attackerLevel:this.stats.level,bonuses:this.inventory.bonuses(),procAffixes:this.inventory.wornItems().flatMap(i=>i.affixes??[]) };
    this.arrows.push(arrow);
    // It sets off a little in front, striking anything nearer on the way.
    this.flyArrow(arrow, ARROW_START);
  }

  private looseSteelArrow(strength = 1): void {
    if (!this.inventory.takeSteelArrow()) return;
    const p = this.player,
      speed = STEEL_ARROW_SPEED * (0.4 + 0.6 * strength),
      cp = Math.cos(p.pitch),
      height = Math.min((p.z ?? 0) + (this.viewEyeOffset ?? playerEyeOffset(this.sneaking,this.swimming)),ceilingHeight(this.level.cells[cellIndex(this.level,p.x,p.y)],this.level)-.03);
    const originX=p.x-Math.sin(p.yaw)*this.viewSideOffset,originZ=p.y+Math.cos(p.yaw)*this.viewSideOffset;
    const arrow: Arrow = {
      id: this.nextArrow++,
      x: p.x,
      y: p.y,
      dx: Math.cos(p.yaw) * cp,
      dy: Math.sin(p.yaw) * cp,
      travelled: 0,
      weapon: {
        ...this.stats.weapon,
        damage: this.stats.weapon.damage.map((d) => Math.max(1, Math.round(d * (0.25 + 0.75 * strength)))) as [number, number],
      },
      sneak: this.sneaking,
      bonuses:this.inventory.bonuses(),procAffixes:this.inventory.wornItems().flatMap(i=>i.affixes??[]),attacker:{...this.hero},attackerLevel:this.stats.level,
      projectile: projectile([originX, height, originZ], [Math.cos(p.yaw) * cp * speed, Math.sin(p.pitch) * speed, Math.sin(p.yaw) * cp * speed]),
    };
    this.arrows.push(arrow);
    this.events.push({ type: 'sound', name: 'ARROWFR.VOC' });
    // Sweep the short initial muzzle advance too; near walls cannot be skipped.
    this.flySteelArrow(arrow, 0.1 / speed);
  }

  private flySteelArrow(a: Arrow, dt: number): void {
    const state = a.projectile!;
    if (state.hitCreature !== undefined) {
      const c = this.creatures.find((c) => c.id === state.hitCreature);
      if (c && a.carrierOffset) {
        state.position[0] = c.x + a.carrierOffset[0];
        state.position[2] = c.y + a.carrierOffset[2];
      }
      return;
    }
    if (state.phase !== 'flying') return;
    stepProjectile(
      state,
      dt,
      (from, to) => {
        const terrain = sweepTerrain(this.level, this.openDoors, from, to, this.surfaceMaterials),
          creature = sweepCreatures(this.level, this.creatures, from, to);
        return terrain && (!creature || terrain.fraction <= creature.fraction) ? terrain : creature;
      },
      (hit) => {
        if (hit.creature !== undefined) {
          const c = this.creatures.find((c) => c.id === hit.creature);
          if (c) {
            this.arrowStrikes(a, c);
            a.carrierOffset = [hit.point[0] - c.x, 0, hit.point[2] - c.y];
          }
        } else {
          this.events.push({type:'surfaceImpact',material:hit.material,point:hit.point,normal:hit.normal});
          this.events.push({
            type: 'sound',
            name: hit.material === 'metal' ? 'CLANK.VOC' : hit.material === 'stone' ? 'NHIT.VOC' : 'ARROWHT.VOC',
            at: { x: hit.point[0], y: hit.point[2] },
            volume: 0.55,
          });
        }
      },
    );
    a.x = state.position[0];
    a.y = state.position[2];
    a.travelled = state.travelled;
    // Lost outside the level or in a bottomless pit: retire it instead of leaving a floating pickup.
    if (state.age > 30 || state.position[1] < -this.level.height * 2) {
      state.phase = 'recovered';
      this.arrows.splice(this.arrows.indexOf(a), 1);
    }
  }

  /** Moves an arrow `distance` on: into the first creature in its way, unless a wall or shut door stops it first or it falls. */
  private flyArrow(a: Arrow, distance: number): void {
    const gone = () => this.arrows.splice(this.arrows.indexOf(a), 1);
    for (let left = distance; left > 0; left -= ARROW_STEP) {
      const step = Math.min(ARROW_STEP, left);
      const nx = a.x + a.dx * step;
      const ny = a.y + a.dy * step;
      const hit = this.creatures.find((c) => isAlive(c) && Math.hypot(c.x - nx, c.y - ny) < CREATURE_RADIUS + ARROW_RADIUS);
      if (hit) {
        gone();
        this.arrowStrikes(a, hit);
        return;
      }
      const cell = cellIndex(this.level, nx, ny);
      if (cell < 0 || isBlocking(this.level.cells[cell], this.openDoors, cell)) {
        gone();
        return;
      }
      a.x = nx;
      a.y = ny;
      a.travelled += step;
      if (a.travelled >= ARROW_REACH) {
        gone();
        return;
      }
    }
  }

  private arrowStrikes(a: Arrow, target: Creature): void {
    const blow = this.blowDamage(a.weapon, target,a.bonuses,a.attacker,a.attackerLevel);
    let damage = blow.damage;
    if (a.sneak && isCalm(target)) {
      damage *= SNEAK_SHOT;
      this.events.push({ type: 'notify', text: `Sneak attack for ${SNEAK_SHOT}x damage!` });
    }
    const before = Math.max(0,target.health);
    const killed = hurtCreature(target, damage, this.world);
    if(Math.max(0,target.health)<before&&isAlive(target))this.eliteStruck(target);
    this.events.push({ type: 'hit', creature: target, damage, killed, far: true, appliedDamage:Math.max(0,before-Math.max(0,target.health)),critical:blow.critical,damageKind:'physical' }, { type: 'sound', name: 'ARROWHT.VOC', at: { x: target.x, y: target.y } });
    if (killed) this.killed(target);
    this.weaponEnchantments(target,Math.max(0,before-Math.max(0,target.health)),a.bonuses,a.procAffixes);
  }

  private weaponEnchantments(target:Creature,physical:number,gear=this.inventory.bonuses(),procs?:RolledAffix[]):void {
    this.stats.health=Math.min(this.stats.maxHealth,this.stats.health+physical*Math.min(30,gear.lifeLeech??0)/100+(physical>0?Math.max(0,gear.healthOnHit??0):0));
    this.stats.magicka=Math.min(this.stats.maxMagicka,this.stats.magicka+physical*Math.min(30,gear.magickaLeech??0)/100);
    if(!isAlive(target))return;
    const damageTypes:Array<[keyof LootStats,DamageKind,number]>=[['fireDamage','fire',4],['frostDamage','frost',8],['shockDamage','shock',16],['magicDamage','magic',0]];
    for(const [key,kind,immune]of damageTypes)if((gear[key]??0)>0&&!(target.info.flags&immune)&&isAlive(target))this.hurtByMagic(target,gear[key]!,kind,false,false);
    if(isAlive(target)&&(gear.poisonDamage??0)>0&&!(target.info.flags&64)){
      const old=this.gearPoison.get(target);
      this.gearPoison.set(target,{damage:Math.max(old?.damage??0,gear.poisonDamage!/4),next:old?.next??this.time+1,until:this.time+4});
    }
    this.gearProcs(target,'hit',procs);
  }

  private gearProcs(target:Creature,trigger:'hit'|'struck',affixes=this.inventory.wornItems().flatMap(i=>i.affixes??[])):void {
    for(const a of affixes){
      if(!a.proc||(a.proc.trigger??'hit')!==trigger||a.spell===undefined||!isAlive(target))continue;
      const key=`${a.id}:${trigger}`;
      if(this.time<(this.procCooldown.get(key)??0)||this.random()*100>=a.proc.chance)continue;
      const spell=this.spellRecord(a.spell);if(!spell)continue;
      this.procCooldown.set(key,this.time+.5);
      if(spell.target==='caster')this.onCaster(spell,undefined,a.proc.level);
      else this.burst(spell,target,a.proc.level,target);
    }
  }

  private killed(c: Creature,credited=true): void {
    const gear=this.inventory.bonuses();
    if(credited&&this.stats.health>0)this.stats.health=Math.min(this.stats.maxHealth,this.stats.health+Math.max(0,gear.healthOnKill??0));
    if(credited)this.stats.magicka=Math.min(this.stats.maxMagicka,this.stats.magicka+Math.max(0,gear.magickaOnKill??0));
    if(this.randomizedLoot&&this.lootRules&&c.info.id!==undefined&&!this.carried.has(c.id))this.carried.set(c.id,treasure(this.lootRules,this.lootRules.tables.creatures[c.info.id]??[0,0,0,0],this.lootContext(c.info.level+1,!!c.elite&&c.elite.tier!=='minion'||/jagar|tharn/i.test(c.info.name)),this.random));
    if(this.randomizedLoot&&this.lootRules&&c.elite&&c.elite.tier!=='minion'){
      const contents=this.carried.get(c.id)??{gold:0,items:[]};
      const extra=treasure(this.lootRules,[100,0,100,0],this.lootContext(c.info.level+1,true),this.random);
      contents.gold+=extra.gold;contents.items.push(...extra.items);this.carried.set(c.id,contents);
    }
    this.eliteDeath(c);
    if(credited)this.kills++;
    // The level comes later, once a game minute passes with no monsters near (checkLevel).
    if(credited)this.stats.experience += Math.round((c.experienceValue??(c.info.experience + c.info.experiencePerHealth * c.maxHealth))*(1+Math.max(0,gear.experiencePct??0)/100));
    if (!this.practiceMode && !this.cleared && this.creatures.every(isDefeated)) {
      this.cleared = true;
      this.events.push({ type: 'cleared' });
    }
  }

  /** The nearest living creature the swing can reach. */
  private creatureInReach(reach = WEAPON_REACH, magical = false): Creature | undefined {
    const p = this.player;
    let best: Creature | undefined;
    let bestDist = Infinity;
    for (const c of this.creatures) {
      if (!(magical?isMagicTarget(c):isAlive(c))) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > reach || d >= bestDist) continue;
      if (d > PLAYER_RADIUS + CREATURE_RADIUS && angleTo(p, c.x, c.y) > WEAPON_ARC) continue;
      if (!lineOfSight(this.level, p.x, p.y, c.x, c.y, this.openDoors)) continue;
      best = c;
      bestDist = d;
    }
    return best;
  }

  // ---- Magic ----

  /** Invisible: the creatures can't see the player. */
  get invisible(): boolean {
    return this.time < this.invisibleUntil;
  }

  /** How far the dungeon can be seen, as a multiple of the usual: more under a Light spell. */
  get lightReach(): number {
    let reach=this.time < this.light.until ? this.light.reach : 1;
    reach=Math.max(reach,1+Math.min(10,this.inventory.bonuses().lightRadius??0)*.1);
    for(const b of this.bolts)if(b.lightUntil&&this.time<b.lightUntil){
      const distance=Math.hypot(b.x-this.player.x,b.y-this.player.y);
      if(lineOfSight(this.level,this.player.x,this.player.y,b.x,b.y,this.openDoors))reach=Math.max(reach,1+(b.lightPower??1)*Math.max(0,1-distance/6));
    }
    return reach;
  }

  /** Hit points left on a shield spell. */
  get shield(): number {
    return this.shieldPoints;
  }

  /** The spells working on the player now, and paralysis, for the HUD and the magic menu. */
  activeEffects(): string[] {
    return this.statusEffects().map(effect => effect.name);
  }

  /** Structured effects for generated HUD icons and real remaining durations. */
  statusEffects(): ActiveStatusEffect[] {
    const effects: ActiveStatusEffect[] = [];
    const timed = (id: string, name: string, icon: string, until: number, dispelType?: StatusDispelType,total?:number) => {
      if(until<=this.time)return;
      const duration=total??this.effectDurations.get(id)??until-this.time;
      if(total===undefined&&!this.effectDurations.has(id))this.effectDurations.set(id,duration);
      effects.push({id,name,icon,kind:dispelType?'debuff':'buff',dispelType,remaining:until-this.time,duration});
    };
    timed('paralysis', 'Paralyzed', 'paralysis', this.paralysedUntil, this.paralysisType);
    if (this.disease) {
      const disease=this.disease;
      effects.push({id:'disease', name:disease.info.name, icon:DISEASE_ICONS[disease.info.id-10], kind:'debuff', dispelType:'disease', remaining:disease.until===undefined?undefined:Math.max(0,(disease.until-this.clock)/GAME_SECONDS_PER_SECOND),duration:disease.until===undefined?undefined:(disease.until-disease.started)/GAME_SECONDS_PER_SECOND});
    }
    if (this.shieldPoints > 0) effects.push({id: 'shield', name: `Shield (${this.shieldPoints})`, icon: 'shield', kind: 'buff', persistentLabel: `${this.shieldPoints} HP`});
    timed('sanctuary', 'Sanctuary', 'sanctuary', this.sanctuary.until);
    timed('invisibility', 'Invisible', 'invisibility', this.invisibleUntil);
    timed('light', 'Light', 'light', this.light.until);
    for(const b of this.bolts)if(b.lightUntil)timed(`wanderlight-${b.id}`,'Wanderlight','light',b.lightUntil,undefined,b.spell.effects.map(e=>duration(e,this.stats.level))[0]);
    timed('regeneration', 'Regenerating', 'regeneration', this.regen.until);
    timed('levitate','Levitation','light',this.levitateUntil);
    for(const [id,w] of this.wards){
      const name=w.effect.effect===ELEMENTAL_RESISTANCE?`Resist ${['Fire','Cold','Shock','','Poison'][w.effect.sub]}`:
        w.effect.effect===SPELL_ABSORPTION?'Spell Absorption':w.effect.effect===SPELL_REFLECTION?'Spell Reflection':'Spell Resistance';
      timed(id,name,'shield',w.until,undefined,w.duration);
    }
    this.fortified.forEach((f, i) => timed(`fortify-${f.attribute}-${i}`, `${f.points<0?'Drained':'Fortified'} (${f.points>0?'+':''}${f.points})`, 'fortify', f.until,f.points<0?f.dispel??'magic':undefined,f.duration));
    for (const [id,harm] of this.playerHarms) if(harm.until>this.time) effects.push({id,name:harm.name,icon:harm.icon,kind:'debuff',dispelType:harm.type,remaining:harm.until-this.time,duration:harm.duration});
    return effects;
  }

  get availablePracticeDiseases():number[]{return this.diseaseTables?.diseases.map(d=>d.id)??[];}

  /** Repeatable probes for Effect Testing; these mutate the same state that gameplay reads. */
  applyPracticeEffect(id:string,seconds=60):boolean {
    const applied=this.applyPracticeEffectState(id,seconds);
    if(applied)this.effectDurations.set(id,id==='paralysis'?Math.min(8,seconds):seconds);
    if(applied && !id.startsWith('disease:')){
      const effect=[...TEST_BUFFS,...TEST_DEBUFFS].find(e=>e.id===id)!;
      this.events.push({type:'notify',text:`${effect.kind==='buff'?'You gained':'You have contracted'} ${effect.name} (${testEffectDescription(id)})`});
    }
    return applied;
  }

  private applyPracticeEffectState(id:string,seconds:number):boolean {
    if (!this.practiceMode) return false;
    if (id.startsWith('disease:')) {
      const disease=Number(id.slice(8));
      if (!this.diseaseTables?.diseases.some(d=>d.id===disease)) return false;
      this.disease=undefined;
      return this.infect(disease);
    }
    const until=this.time+seconds;
    if(id==='levitation'){this.levitateUntil=until;this.player.z=Math.max(0,this.player.z??0);this.player.vz=0;return true;}
    const wardTypes:Record<string,[number,number]>={
      'resist-fire':[ELEMENTAL_RESISTANCE,0],'resist-cold':[ELEMENTAL_RESISTANCE,1],
      'resist-shock':[ELEMENTAL_RESISTANCE,2],'resist-poison':[ELEMENTAL_RESISTANCE,4],
      'spell-absorption':[SPELL_ABSORPTION,0],'spell-reflection':[SPELL_REFLECTION,0],'spell-resistance':[SPELL_RESISTANCE,0],
    };
    const ward=wardTypes[id];
    if(ward){
      const [effect,sub]=ward;this.wards.set(`ward-${effect}-${sub}`,{effect:{effect,sub,attribute:0,params:[100,0,1,0,1,1]},power:100,until,duration:seconds});return true;
    }
    switch(id) {
      case 'shield':this.shieldPoints=60;return true;
      case 'sanctuary':this.sanctuary={chance:100,until};return true;
      case 'invisibility':this.invisibleUntil=until;return true;
      case 'light':this.light={reach:3,until};return true;
      case 'regeneration':
        this.stats.health=Math.max(1,Math.floor(this.stats.maxHealth*.5));
        this.regen={health:3,every:2,next:this.time+2,until};return true;
      case 'fortify':
        for(let i=this.fortified.length-1;i>=0;i--)if(this.fortified[i].attribute===0)this.fortified.splice(i,1);
        this.fortified.push({attribute:0,points:10,loss:0,every:5,next:this.time+5,until,duration:seconds});this.refreshHero();return true;
      case 'paralysis':this.paralysedUntil=this.time+Math.min(8,seconds);this.paralysisType='magic';return true;
      default:{
        const effect=TEST_DEBUFFS.find(e=>e.id===id);
        if(!effect)return false;
        const icon=id==='curse'?'calirons-curse':id;
        const type:StatusDispelType=id==='poison'?'poison':id==='curse'?'curse':'magic';
        this.playerHarms.set(id,{name:effect.name,icon,type,until,duration:seconds,next:this.time+2,every:2,damage:['fire','frost','shock'].includes(id)?12:['poison','drain'].includes(id)?2:0,element:({fire:0,frost:1,shock:3} as Record<string,number>)[id]});
        this.refreshHero();return true;
      }
    }
  }

  /** Restore the isolated tester without touching the saved character or normal run. */
  clearPracticeEffects():void {
    if(!this.practiceMode)return;
    this.playerHarms.clear();this.effectDurations.clear();this.disease=undefined;this.diseaseLosses.fill(0);
    this.paralysedUntil=this.invisibleUntil=this.shieldPoints=this.levitateUntil=0;this.wards.clear();this.terrainSpell=undefined;for(let i=this.bolts.length-1;i>=0;i--)if(this.bolts[i].lightUntil)this.bolts.splice(i,1);
    this.sanctuary={chance:0,until:0};this.light={reach:1,until:0};
    this.regen={health:0,every:0,next:0,until:0};this.fortified.length=0;
    this.refreshHero();this.stats.health=this.stats.maxHealth;this.stats.magicka=this.stats.maxMagicka;this.stats.stamina=this.stats.maxStamina;
  }

  /** Spell points the spell costs at the player's level. */
  spellCost(spell: SpellRecord): number {
    return Math.max(0,Math.ceil(magickaCost(spell, this.stats.level)*(1-Math.min(60,this.inventory.bonuses().spellCost??0)/100)));
  }

  /** Casts a spell, if there are spell points enough and it has something to work on. */
  cast(spell: SpellRecord): boolean {
    if (!this.mayCast(spell)) return false;
    if (!castable(spell)) return false;
    const cost = this.spellCost(spell);
    if (this.stats.magicka < cost) {
      this.events.push({ type: 'noMagicka' }, { type: 'notify', text: `You need ${cost} spell points to cast ${spell.name}` });
      return false;
    }
    return this.release(spell, this.stats.level, () => (this.stats.magicka -= cost));
  }

  /** Casting is blocked during swings and cooldowns; paralysis still allows its own cure. */
  private mayCast(spell?:SpellRecord): boolean {
    const releasesParalysis=spell?.effects.some(e=>e.effect===CURE&&(e.sub===CURE_PARALYSIS||e.sub===1));
    return !this.outcome && (!this.paralysed||!!releasesParalysis) && !this.playerHarms.has('silence') && !this.swing && this.sinceCast >= CAST_TIME;
  }

  /**
   * Casts the spell at a caster's `level`, if it has something to work on:
   * `pay` is called once it is sure to go (spell points, a charge, wear).
   * Says in a note why not when it can't.
   */
  private release(spell: SpellRecord, level: number, pay: () => void): boolean {
    const notify = (text: string) => this.events.push({ type: 'notify', text });
    let touched: Creature | undefined;
    if (spell.target === 'touch') {
      touched = this.creatureInReach(TOUCH_REACH,true);
      if (!touched) {
        notify('There is nothing in reach to touch');
        return false;
      }
    }
    const opens = spell.effects.some((e) => e.effect === OPEN);
    const locks = spell.effects.some((e) => e.effect === LOCK);
    const terrain=spell.effects.find(terrainEffect);
    const door = opens||locks ? this.ahead(OPEN_REACH) : undefined;
    if(locks&&door?.kind!=='door'){notify('There is no door in front of you');return false;}
    if(locks&&door?.kind==='door'&&[this.player,...this.creatures.filter(isAlive)].some(c=>cellIndex(this.level,c.x,c.y)===door.cell)){
      notify('The doorway is occupied');return false;
    }
    if (opens && spell.effects.length === 1 && !(door?.kind === 'door' && this.locked(door.cell))) {
      notify('There is no locked door in front of you');
      return false;
    }

    pay();
    if(this.time<this.sanctuary.until&&spell.target!=='caster'&&spell.effects.some(e=>[CAUSE,DAMAGE,CONTINUOUS_DAMAGE,DRAIN,TRANSFER,SILENCE].includes(e.effect))){
      this.sanctuary.until=0;this.events.push({type:'notify',text:'Your attack breaks Sanctuary'});
    }
    this.sinceCast = 0;
    this.terrainSpell=terrain?{spell,effect:terrain,remaining:terrain.params[0]}:undefined;
    if(terrain)this.events.push({type:'notify',text:`${spell.name}: aim and interact to select ${terrain.params[0]} sections. Cast another spell to cancel.`});
    this.events.push({ type: 'cast', spell }, { type: 'sound', name: spell.target === 'caster' ? 'BURST5.VOC' : 'SLOWBALL.VOC', volume: 0.7 });
    const p = this.player;
    if(terrain)return true;
    switch (spell.target) {
      case 'caster':
        this.onCaster(spell, door?.kind === 'door' ? door.cell : undefined, level);
        break;
      case 'touch':
        this.burst(spell, { x: touched!.x, y: touched!.y }, level, touched);
        break;
      case 'areaCaster':
        this.burst(spell, { x: p.x, y: p.y }, level, undefined, AREA_AROUND_CASTER);
        break;
      default: {
        // From just in front of the eyes, the way the player faces.
        const dx = Math.cos(p.yaw);
        const dy = Math.sin(p.yaw);
        this.bolts.push({ id: this.nextBolt++, spell, level, x: p.x + dx * 0.3, y: p.y + dy * 0.3, dx, dy, travelled: 0, z:(p.z??0)+playerEyeOffset(this.sneaking,this.swimming),dz:Math.tan(p.pitch) });
      }
    }
    return true;
  }

  /** A spell on the caster: healing, a shield, sanctuary, invisibility, light, opening a lock, regenerating, curing paralysis or fortifying an attribute. */
  private onCaster(spell: SpellRecord, door: number | undefined, level: number): void {
    const s = this.stats;
    for (const e of spell.effects) {
      switch (e.effect) {
        case HEAL:
          if (e.sub === HEALTH) s.health = Math.min(s.maxHealth, s.health + magnitude(e, level, this.random));
          else if(e.sub===0)s.stamina = Math.min(s.maxStamina, s.stamina + magnitude(e, level, this.random));
          else if(e.sub===2)s.magicka = Math.min(s.maxMagicka,s.magicka+magnitude(e,level,this.random));
          else {
            const attr=attributeIndex(e),restored=Math.min(magnitude(e,level,this.random),this.diseaseLosses[attr]*100/256);
            this.diseaseLosses[attr]=Math.max(0,this.diseaseLosses[attr]-restored*256/100);this.refreshHero();
          }
          break;
        case LEVITATE:
          this.levitateUntil=this.time+duration(e,level);this.effectDurations.set('levitate',duration(e,level));
          this.player.z=Math.max(0,this.player.z??0);this.player.vz=0;this.swimming=false;this.climb=undefined;
          this.events.push({type:'notify',text:'You gained Levitation (Allows you to cross pits and water)'});break;
        case ELEMENTAL_RESISTANCE: case SPELL_ABSORPTION: case SPELL_REFLECTION: case SPELL_RESISTANCE: {
          const lasts=duration(e,level),id=`ward-${e.effect}-${e.sub}`;
          this.wards.set(id,{effect:e,power:chance(e,level),until:this.time+lasts,duration:lasts});
          this.events.push({type:'notify',text:`You gained ${this.statusEffects().find(w=>w.id===id)?.name??'protection'}`});break;
        }
        case LOCK:
          if(door!==undefined&&this.random()*100<Math.min(100,e.params[0])){
            this.magicalLocks.set(door,{until:this.time+duration(e,level),strength:e.params[1]*Math.floor(level/Math.max(1,e.params[4]))});
            this.doors.get(door)!.target=0;this.openDoors.delete(door);
            this.events.push({type:'notify',text:'The door locks'});
          }else this.events.push({type:'notify',text:'The lock fails'});
          break;
        case CREATE:
          this.shieldPoints = Math.max(this.shieldPoints, amount(e, level));
          this.events.push({ type: 'notify', text: `You gained Shield (Absorbs ${this.shieldPoints} points of incoming damage)` });
          break;
        case NON_TARGET:
          if(this.random()*100>=chance(e,level)){this.events.push({type:'notify',text:'Sanctuary failed'});break;}
          this.effectDurations.set('sanctuary',duration(e,level));
          this.sanctuary = { chance: 100, until: this.time + duration(e, level) };
          this.events.push({type:'notify',text:`You gained Sanctuary (Gives enemies a ${this.sanctuary.chance}% chance to ignore you)`});
          break;
        case INVISIBILITY:
          this.effectDurations.set('invisibility',duration(e,level));
          this.invisibleUntil = this.time + duration(e, level);
          this.events.push({ type: 'notify', text: 'You gained Invisibility (Makes you invisible to creatures that cannot see invisible targets)' });
          break;
        case LIGHT:
          if(spell.flags&0x80){
            const p=this.player,dx=Math.cos(p.yaw),dy=Math.sin(p.yaw);
            this.bolts.push({id:this.nextBolt++,spell,level,x:p.x+dx*.3,y:p.y+dy*.3,dx,dy,z:(p.z??0)+playerEyeOffset(this.sneaking,this.swimming),dz:Math.tan(p.pitch),travelled:0,lightUntil:this.time+duration(e,level),lightPower:lightReach(e)-1});
            this.events.push({type:'notify',text:'You gained Wanderlight (Sends a globe of light ahead)'});break;
          }
          this.effectDurations.set('light',duration(e,level));
          this.light = { reach: lightReach(e), until: this.time + duration(e, level) };
          this.events.push({type:'notify',text:'You gained Light (Extends your vision in dark areas)'});
          break;
        case REGENERATE: {
          this.effectDurations.set('regeneration',duration(e,level));
          const r = regeneration(e);
          const every = r.everyRounds * ROUND;
          this.regen = { health: r.health, every, next: this.time + every, until: this.time + duration(e, level) };
          this.events.push({type:'notify',text:`You gained Regeneration (Restores ${r.health} health every ${every} seconds)`});
          break;
        }
        case OPEN:
          if (door === undefined || !this.locked(door)) break;
          if (this.random() * 100 < chance(e, level)) {
            this.magicalLocks.delete(door);
            this.unlocked.add(door);
            this.events.push({ type: 'notify', text: 'The lock opens' });
            this.openDoor(door);
          } else this.events.push({ type: 'notify', text: 'The lock holds' }, { type: 'sound', name: 'LOCK.VOC', at: cellCentre(this.level, door) });
          break;
        case CURE:
          if (this.random() * 100 < chance(e, level)) {
            if (e.sub === CURE_PARALYSIS || e.sub === 1) this.paralysedUntil = this.time;
            if (e.sub === 1) {for(const [id,h]of this.playerHarms)if(h.type==='poison')this.playerHarms.delete(id);}
            if (e.sub === 3) {for(const [id,h]of this.playerHarms)if(h.type==='curse')this.playerHarms.delete(id);this.playerHarms.delete('curse');this.playerHarms.delete('spell-curse');for(let i=this.fortified.length-1;i>=0;i--)if(this.fortified[i].dispel==='curse')this.fortified.splice(i,1);this.refreshHero();}
            else if (e.sub === 0) this.cureDisease();
          }
          break;
        case FORTIFY: {
          const f = fortification(e);
          const lasts = duration(e, level);
          if (f.points <= 0 || lasts <= 0) break;
          const every = f.everyRounds * ROUND;
          this.fortified.push({ attribute: attributeIndex(e), points: f.points, loss: f.loss, every, next: this.time + every, until: this.time + lasts,duration:lasts });
          this.refreshHero();
          this.events.push({type:'notify',text:`You gained Fortify (Raises ${['Strength','Intelligence','Willpower','Agility','Speed','Endurance','Personality','Luck'][attributeIndex(e)]??'an attribute'} by ${f.points} points)`});
          break;
        }
      }
    }
  }

  /** A spell cast at `level` bursting at `at`: on `hit`, or on every creature in `radius` that the burst can reach. */
  private burst(spell: SpellRecord, at: { x: number; y: number }, level: number, hit?: Creature, radius = spell.target === 'areaTarget' ? AREA_RADIUS : 0,source?:Creature): void {
    this.events.push({ type: 'burst', spell, at, radius }, { type: 'sound', name: radius ? 'EXPLODE.VOC' : 'BURST5.VOC', at });
    const nativeArea=radius>0&&!!this.spellAreaCells;
    const reaches=(target:{x:number;y:number},padding=0)=>{
      if(nativeArea){
        const x=Math.floor(target.x)-Math.floor(at.x),y=Math.floor(target.y)-Math.floor(at.y);
        return this.spellAreaCells!.some(c=>c.x===x&&c.y===y);
      }
      return Math.hypot(target.x-at.x,target.y-at.y)<=(radius||.4)+padding&&lineOfSight(this.level,at.x,at.y,target.x,target.y,this.openDoors);
    };
    // Native target 3 excludes its caster; target 4 may also hit its caster.
    if((source||nativeArea)&&!(spell.target==='areaCaster'&&!source)&&reaches(this.player))this.receiveSpell(spell,level,source);
    if (radius === 0) {
      if (hit) this.onCreature(spell, hit, level,source);
      return;
    }
    for (const c of this.creatures) {
      // Native 3cdd:090e omits death-flat actors, including subdued bodies.
      if (!(nativeArea?isAlive(c):isMagicTarget(c)) || spell.target==='areaCaster'&&c===source || !reaches(c,CREATURE_RADIUS)) continue;
      this.onCreature(spell, c, level,source);
    }
  }

  /** A spell's effects on a creature it reached, cast at `level`. */
  private onCreature(spell: SpellRecord, c: Creature, level: number,source?:Creature): void {
    if(!isMagicTarget(c))return;
    let damage = 0;
    const state=creatureMagic(c);
    const modifier=(attribute:number,points:number,e:SpellEffect,lasts=duration(e,level))=>{
      state.modifiers.push({attribute,points,loss:e.params[1],every:Math.max(1,e.params[4])*ROUND,next:this.time+Math.max(1,e.params[4])*ROUND,until:this.time+lasts});
    };
    for (const e of spell.effects) {
      switch (e.effect) {
        case DAMAGE: {
          const n=magnitude(e,level,this.random);
          if(e.sub===DAMAGE_HEALTH&&!(c.info.flags&([4,8,64,16][spell.element]??0)))damage+=Math.round(n*(1+(source?0:this.inventory.bonuses().spellPower??0)/100));
          else if(e.sub===1)state.stamina=Math.max(0,state.stamina-n);
          else if(e.sub===2)state.magicka=Math.max(0,state.magicka-n);
          break;
        }
        case CONTINUOUS_DAMAGE:
          this.afflict(c, spell, level, e, CONTINUOUS_EVERY * ROUND, duration(e, level),source);break;
        case SILENCE:
          if(this.random()*100<chance(e,level)){
            state.silencedUntil=this.time+duration(e,level);
            this.events.push({type:'notify',text:`The ${c.info.name} is silenced`});
          }break;
        case DRAIN:
          modifier(attributeIndex(e),-Math.min(e.params[0],creatureAttribute(c,attributeIndex(e))),e);break;
        case TRANSFER: {
          if(e.sub===0){
            const attribute=attributeIndex(e),taken=Math.min(e.params[0],creatureAttribute(c,attribute));
            modifier(attribute,-taken,{...e,params:[e.params[0],0,0,0,1,e.params[5]]},duration(e,level));
            const lasts=duration(e,level),every=Math.max(1,e.params[4])*ROUND;
            if(source)creatureMagic(source).modifiers.push({attribute,points:taken,loss:0,every,next:this.time+every,until:this.time+lasts});
            else{this.fortified.push({attribute,points:taken,loss:0,every,next:this.time+every,until:this.time+lasts,duration:lasts});this.refreshHero();}
          }else {
            const pool=transferPool(e),available=pool===0?Math.max(0,c.health-damage):pool===1?state.stamina:state.magicka;
            const taken=Math.min(e.params[0],available);
            if(pool===0){damage+=taken;if(source)source.health=Math.min(source.maxHealth,source.health+taken);else this.stats.health=Math.min(this.stats.maxHealth,this.stats.health+taken);}
            else if(pool===1){state.stamina-=taken;if(source){const pool=creatureMagic(source);pool.stamina=Math.min(pool.maxStamina,pool.stamina+taken);}else this.stats.stamina=Math.min(this.stats.maxStamina,this.stats.stamina+taken);}
            else if(pool===2){state.magicka-=taken;if(source){const pool=creatureMagic(source);pool.magicka=Math.min(pool.maxMagicka,pool.magicka+taken);}else this.stats.magicka=Math.min(this.stats.maxMagicka,this.stats.magicka+taken);}
          }break;
        }
        case CAUSE:
          if (this.random() * 100 >= chance(e, level)) {
            this.events.push({ type: 'notify', text: `The ${c.info.name} resists` });break;
          }
          if (e.sub === CAUSE_PARALYSIS) {
            paralyseCreature(c, duration(e, level), this.world);
            this.events.push({ type: 'notify', text: `The ${creatureName(c)} is ${c.elite&&c.elite.tier!=='minion'?'chilled':'paralyzed'}` });
          } else if (e.sub === CAUSE_POISON) {
            if(c.info.flags&64)break;
            const p = poisonDamage(e);
            this.afflict(c, spell, level, p.damage, p.everyRounds * ROUND, duration(e, level),source);
            this.events.push({ type: 'notify', text: `The ${c.info.name} is poisoned` });
          } else if(e.sub===0||e.sub===3){
            if(e.sub===3&&c.elite?.curseImmune)break;
            for(const attribute of e.sub===0?[0,3,4,5]:[1,2,6,7])state.modifiers.push({attribute,points:-Math.min(e.params[2],creatureAttribute(c,attribute)),loss:0,growth:e.params[2],every:ROUND,next:this.time+ROUND,until:this.time+duration(e,level)});
            this.events.push({type:'notify',text:`The ${c.info.name} is ${e.sub===0?'diseased':'cursed'}`});
          } else if(e.sub===4)damage=c.health;
          break;
      }
    }
    this.hurtByMagic(c, damage,spellDamageKind(spell.element),false,true,!source);
  }

  /** Incoming monster spells share the same records as player spells. Reflection is resolved once. */
  receiveSpell(spell:SpellRecord,level:number,source?:Creature):void {
    if(this.outcome)return;
    for(const type of [SPELL_REFLECTION,SPELL_ABSORPTION,SPELL_RESISTANCE]){
      const ward=[...this.wards.values()].find(w=>w.effect.effect===type&&this.time<w.until);
      if(!ward||this.random()*100>=ward.power)continue;
      if(type===SPELL_REFLECTION){
        if(!source)continue;
        this.onCreature(spell,source,level);this.events.push({type:'notify',text:'Spell reflected'});
      }else if(type===SPELL_ABSORPTION){
        this.stats.magicka=Math.min(this.stats.maxMagicka,this.stats.magicka+magickaCost(spell,level));
        this.events.push({type:'notify',text:'Spell absorbed'});
      }else this.events.push({type:'notify',text:'Spell resisted'});
      return;
    }
    const resist=[...this.wards.values()].find(w=>w.effect.effect===ELEMENTAL_RESISTANCE&&resistedElement(w.effect.sub)===spell.element&&this.time<w.until);
    if(resist&&this.random()*100<resist.power){this.events.push({type:'notify',text:'Elemental spell resisted'});return;}
    if(source?.elite&&spell.effects.some(e=>e.effect===DAMAGE))this.eliteHit(source,Math.max(1,Math.round((source.elite.baseDamage[0]+source.elite.baseDamage[1])/2)),true);
    for(const e of spell.effects){
      const lasts=duration(e,level),until=this.time+lasts;
      const harm=(id:string,name:string,icon:string,type:StatusDispelType,damage=0,every=ROUND)=>{
        this.playerHarms.set(id,{name,icon,type,until,next:this.time+every,every,damage,element:spell.element,duration:lasts});
        this.events.push({type:'notify',text:`You have contracted ${name}`});
      };
      switch(e.effect){
        case DAMAGE:
          if(e.sub===0)this.hurtPlayer(magnitude(e,level,this.random),undefined,spell.element,true);
          else if(e.sub===1)this.stats.stamina=Math.max(0,this.stats.stamina-magnitude(e,level,this.random));
          else if(e.sub===2)this.stats.magicka=Math.max(0,this.stats.magicka-magnitude(e,level,this.random));
          break;
        case CONTINUOUS_DAMAGE:
          harm(`continuous-${e.sub}`,e.sub===0?'Continuous Damage':e.sub===1?'Fatigue Drain':'Spell Point Drain',e.sub===0?'fire':'drain','magic',magnitude(e,level,this.random),CONTINUOUS_EVERY*ROUND);break;
        case SILENCE:
          if(this.random()*100<chance(e,level))harm('silence','Silence','silence','magic');break;
        case DRAIN: case TRANSFER:{
          if(e.effect===TRANSFER&&e.sub===1){
            const pool=transferPool(e),taken=Math.min(e.params[0],pool===0?this.stats.health:pool===1?this.stats.stamina:this.stats.magicka);
            if(pool===0){this.hurtPlayer(taken);if(source)source.health=Math.min(source.maxHealth,source.health+taken);}
            else if(pool===1){this.stats.stamina-=taken;if(source)creatureMagic(source).stamina=Math.min(creatureMagic(source).maxStamina,creatureMagic(source).stamina+taken);}
            else if(pool===2){this.stats.magicka-=taken;if(source)creatureMagic(source).magicka=Math.min(creatureMagic(source).maxMagicka,creatureMagic(source).magicka+taken);}
          }else {
            const attr=attributeIndex(e),every=Math.max(1,e.params[4])*ROUND;
            this.fortified.push({attribute:attr,points:-e.params[0],loss:e.params[1],every,next:this.time+every,until,duration:lasts});this.refreshHero();
          }break;
        }
        case CAUSE:
          if(this.random()*100>=chance(e,level))break;
          if(e.sub===CAUSE_PARALYSIS){if(this.random()*100<this.hero.paralysis)this.paralyse(lasts);}
          else if(e.sub===CAUSE_POISON){
            if(this.hero.cls?.id===15)break;
            const poison=poisonDamage(e);harm('poison','Poison','poison','poison',poison.damage,poison.everyRounds*ROUND);
          }else if(e.sub===0){
            const diseases=this.availablePracticeDiseases.filter(id=>[10,11,12,14,15,17,19,20,21,22,24,25,26].includes(id));
            if(diseases.length)this.infect(diseases[Math.floor(this.random()*diseases.length)]);
          }else if(e.sub===3){
            harm('spell-curse','Curse','calirons-curse','curse');
            for(const attr of [1,2,6,7])this.fortified.push({attribute:attr,points:-e.params[2],loss:0,every:ROUND,next:this.time+ROUND,until,duration:lasts,dispel:'curse',growth:e.params[2]});this.refreshHero();
          }else if(e.sub===4&&!this.practiceMode)this.die();
          break;
      }
    }
  }

  private afflict(c: Creature, spell: SpellRecord, level: number, damage: Affliction['damage'], every: number, lasts: number,source?:Creature): void {
    if (lasts <= 0) return;
    this.afflictions.push({ source,creature: c, spell, level, damage, every, next: this.time + every, until: this.time + lasts });
  }

  private hurtByMagic(c: Creature, damage: number, damageKind:DamageKind='magic',periodic=false,sound=true,credited=true): void {
    const before = Math.max(0,c.health);
    const killed = hurtCreature(c, damage, this.world, false, true,damageKind);
    if (damage > 0) {
      if(isAlive(c))this.eliteStruck(c);
      this.events.push({ type: 'hit', creature: c, damage, killed, far: true,appliedDamage:Math.max(0,before-Math.max(0,c.health)),damageKind,periodic });
      if(sound)this.events.push({ type: 'sound', name: 'EHIT.VOC', at: { x: c.x, y: c.y } });
    }
    if (killed) this.killed(c,credited);
  }

  /** Bolts in flight, harm that lasts, and spells on the player wearing off. */
  private updateMagic(dt: number): void {
    const gear=this.inventory.bonuses();
    if(!this.outcome&&this.stats.health>0){
      this.stats.health=Math.min(this.stats.maxHealth,this.stats.health+(gear.healthRegen??0)*dt/10);
      this.stats.magicka=Math.min(this.stats.maxMagicka,this.stats.magicka+(gear.magickaRegen??0)*dt/10);
      this.stats.stamina=Math.min(this.stats.maxStamina,this.stats.stamina+(gear.staminaRegen??0)*dt/10);
    }
    for(const [creature,poison] of this.gearPoison){
      if(!isMagicTarget(creature)||this.time>poison.until){this.gearPoison.delete(creature);continue;}
      while(this.time>=poison.next&&poison.next<=poison.until){poison.next++;this.hurtByMagic(creature,poison.damage,'poison',true,false);}
    }
    for(const [cell,lock] of this.magicalLocks)if(this.time>=lock.until)this.magicalLocks.delete(cell);
    for(const [id,ward] of this.wards)if(this.time>=ward.until)this.wards.delete(id);
    for (const [id,harm] of this.playerHarms) {
      if (this.time>=harm.until) { this.playerHarms.delete(id);if(id==='curse')this.refreshHero();continue; }
      while(harm.damage>0 && this.time>=harm.next) {
        harm.next+=harm.every;
        if(id==='continuous-1')this.stats.stamina=Math.max(0,this.stats.stamina-harm.damage);
        else if(id==='drain'||id==='continuous-2')this.stats.magicka=Math.max(0,this.stats.magicka-harm.damage);
        else this.hurtPlayer(harm.damage,undefined,harm.element);
      }
    }
    for (const b of [...this.bolts]) {
      if(b.lightUntil&&this.time>=b.lightUntil){this.bolts.splice(this.bolts.indexOf(b),1);continue;}
      this.flyBolt(b, dt);
    }
    for (const a of [...this.afflictions]) {
      if (!isMagicTarget(a.creature) || this.time > a.until + 1e-6) {
        this.afflictions.splice(this.afflictions.indexOf(a), 1);
        continue;
      }
      if (this.time < a.next) continue;
      a.next += a.every;
      const damage = typeof a.damage === 'number' ? a.damage : magnitude(a.damage, a.level, this.random);
      if(typeof a.damage!=='number'&&a.damage.sub!==0){
        const state=creatureMagic(a.creature);
        if(a.damage.sub===1)state.stamina=Math.max(0,state.stamina-damage);
        else state.magicka=Math.max(0,state.magicka-damage);
      }else if(!(a.creature.info.flags&([4,8,64,16][a.spell.element]??0)))this.hurtByMagic(a.creature, Math.round(damage*(1+(a.source?0:gear.spellPower??0)/100)),spellDamageKind(a.spell.element),true,true,!a.source);
    }
    let fortified = false;
    for (const f of [...this.fortified]) {
      while(f.growth&&this.time>=f.next&&f.next<f.until){f.points-=f.growth;f.next+=f.every;fortified=true;}
      // Fortify wears off a few points at a time.
      while (f.loss > 0 && f.points !== 0 && this.time >= f.next) {
        f.points = Math.sign(f.points)*Math.max(0,Math.abs(f.points)-f.loss);
        f.next += f.every;
        fortified = true;
      }
      if (f.points === 0 || this.time >= f.until) {
        this.fortified.splice(this.fortified.indexOf(f), 1);
        fortified = true;
      }
    }
    if (fortified) this.refreshHero();
    const r = this.regen;
    if (r.until > 0) {
      while (this.time >= r.next && r.next <= r.until) {
        this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + r.health);
        r.next += r.every;
      }
      if (this.time >= r.until) r.until = 0;
    }
    if (this.invisibleUntil > 0 && this.time >= this.invisibleUntil) {
      this.invisibleUntil = 0;
      this.events.push({ type: 'notify', text: 'You are visible again' });
    }
  }

  /** Monster dispatch (39cf:016c) launches every positive target type;
   * impact collection (39cf:09b8) expands both targets 3 and 4 to an area.
   */
  private boltBurstRadius(spell:SpellRecord):number {
    return spell.target==='areaTarget'||spell.target==='areaCaster'?AREA_RADIUS:0;
  }

  private flyBolt(b: Bolt, dt: number): void {
    if(b.stopped)return;
    const remove = () => this.bolts.splice(this.bolts.indexOf(b), 1);
    for (let left = BOLT_SPEED * dt; left > 0; left -= 0.1) {
      const stepLen = Math.min(0.1, left);
      const nx = b.x + b.dx * stepLen;
      const ny = b.y + b.dy * stepLen;
      const nz=b.z===undefined?undefined:b.z+(b.dz??0)*stepLen;
      const playerFloor=this.player.z??0,playerTop=playerFloor+playerEyeOffset(this.sneaking,this.swimming)+.15;
      if(b.source&&Math.hypot(this.player.x-nx,this.player.y-ny)<PLAYER_RADIUS+BOLT_RADIUS&&
        (nz===undefined||nz>=playerFloor-BOLT_RADIUS&&nz<=playerTop+BOLT_RADIUS)){
        remove();this.burst(b.spell,{x:nx,y:ny},b.level,undefined,this.boltBurstRadius(b.spell),b.source);return;
      }
      const hit = b.lightUntil?undefined:this.creatures.find((c) => isMagicTarget(c) && c!==b.source && Math.hypot(c.x - nx, c.y - ny) < CREATURE_RADIUS + BOLT_RADIUS&&
        (nz===undefined||nz>=0&&nz<=(isAlive(c)?(c.collisionHeight??this.level.height):.3)));
      if (hit) {
        remove();
        this.burst(b.spell, { x: nx, y: ny }, b.level, hit,this.boltBurstRadius(b.spell),b.source);
        return;
      }
      const cell = cellIndex(this.level, nx, ny);
      if (cell < 0 || isBlocking(this.level.cells[cell], this.openDoors, cell)||nz!==undefined&&(nz<0||nz>ceilingHeight(this.level.cells[cell],this.level))) {
        if(b.lightUntil){b.stopped=true;return;}
        remove();
        this.burst(b.spell, { x: b.x, y: b.y }, b.level,undefined,this.boltBurstRadius(b.spell),b.source);
        return;
      }
      b.x = nx;
      b.y = ny;
      b.z = nz;
      b.travelled += stepLen;
      if (b.travelled > BOLT_RANGE) {
        if(b.lightUntil){b.stopped=true;return;}
        remove();
        return;
      }
    }
  }

  private terrainTarget():number|undefined {
    const pending=this.terrainSpell;if(!pending)return;
    const p=this.player,e=pending.effect,wall=e.effect===DESTROY&&e.sub===0;
    if(wall){const hit=this.ahead(6);return hit?.kind==='wall'?hit.cell:undefined;}
    // Looking down selects a floor section. Looking level selects the section two steps ahead.
    const reach=p.pitch<-.05?Math.min(6,Math.max(1,((p.z??0)+playerEyeOffset(this.sneaking,this.swimming))/-Math.tan(p.pitch))):2;
    const index=cellIndex(this.level,p.x+Math.cos(p.yaw)*reach,p.y+Math.sin(p.yaw)*reach);
    if(index<0||isBlocking(this.level.cells[index],this.openDoors,index))return;
    const centre=cellCentre(this.level,index);
    if(!lineOfSight(this.level,p.x,p.y,centre.x,centre.y,this.openDoors))return;
    return index;
  }

  /** Terrain changes preserve map boundaries, exits, triggers and occupied sections. */
  private changeTerrain():boolean {
    const pending=this.terrainSpell,index=this.terrainTarget();if(!pending)return false;
    const fail=()=>{this.events.push({type:'notify',text:'That section cannot be changed'});return false;};
    if(index===undefined)return fail();
    const {width,depth}=this.level,x=index%width,y=Math.floor(index/width),cell=this.level.cells[index];
    if(x<=0||y<=0||x>=width-1||y>=depth-1||cell.exit||cell.kind==='door'||this.level.triggers.some(t=>cellIndex(this.level,t.x,t.y)===index))return fail();
    if([this.player,...this.creatures.filter(isAlive),...this.items.filter(i=>!i.taken),...this.level.flats].some(o=>cellIndex(this.level,o.x,o.y)===index))return fail();
    const e=pending.effect;
    if(e.effect===DESTROY&&e.sub===0){
      if(cell.kind!=='wall')return fail();cell.kind='empty';
    }else if(e.effect===DESTROY){
      if(cell.kind!=='empty'||cell.chasm)return fail();cell.chasm='dry';
    }else if(e.sub===1){
      if(cell.kind!=='empty'||cell.chasm)return fail();
      cell.kind='wall';
      const neighbour=[index-1,index+1,index-width,index+width].map(i=>this.level.cells[i]).find(c=>c?.kind==='wall');
      if(neighbour)cell.wallTex=neighbour.wallTex;
    }else {
      if(!cell.chasm)return fail();delete cell.chasm;
    }
    this.terrainVersion++;
    pending.remaining--;
    if(pending.remaining<=0)this.terrainSpell=undefined;
    this.events.push({type:'terrainChanged'},{type:'sound',name:'BURST5.VOC',at:cellCentre(this.level,index)},
      {type:'notify',text:pending.remaining?`${pending.spell.name}: ${pending.remaining} sections left`:`${pending.spell.name} complete`});
    return true;
  }

  /** The spells the player knows, as the magic menu lists them. */
  spellEntries(): MenuEntry[] {
    const inv = this.inventory;
    return this.spellbook.map((spell) => {
      const key = spellKey(spell);
      return { key, name: spell.name, category: 'spells', count: 1, spell, equipped: spell === this.readied, favourite: inv.isFavourite(key), hotkey: inv.hotkeyOf(key) };
    });
  }

  assignAbility(slot:number,key:string):boolean {
    if(!Number.isInteger(slot)||slot<0||slot>=6||!this.hotbarAssignable(key))return false;
    this.abilitySlots[slot]=key;return true;
  }
  hotbarAssignable(key:string):boolean {
    const item=this.inventory.byKey(key);
    return !!this.spellByKey(key)||!!item&&(item.kind==='potion'||item.kind==='trinket'&&!wearable(item)&&this.casts(item));
  }
  assignHotbar(slot:number,key:string):boolean {
    if(!Number.isInteger(slot)||slot<0||slot>6||!this.hotbarAssignable(key))return false;
    if(slot===0)this.inventory.hotkeys[0]=key;else this.abilitySlots[slot-1]=key;
    return true;
  }
  clearHotbar(slot:number):void {
    if(slot===0)this.inventory.hotkeys[0]=undefined;
    else if(slot>0&&slot<=6)this.abilitySlots[slot-1]=undefined;
  }
  hotbarEntry(slot:number):MenuEntry|undefined {
    const key=slot===0?this.inventory.hotkeys[0]:this.abilitySlots[slot-1];
    if(key===undefined)return undefined;
    if(!this.hotbarAssignable(key)){this.clearHotbar(slot);return undefined;}
    return this.entries().concat(this.spellEntries()).find(e=>e.key===key);
  }
  private activateHotbarKey(key:string):boolean {
    if(!this.hotbarAssignable(key))return false;
    const spell=this.spellByKey(key);if(spell)return this.cast(spell);
    const item=this.inventory.byKey(key);if(!item||this.outcome)return false;
    const text=this.use(key);if(text)this.events.push({type:'notify',text});
    return !!text;
  }
  abilitySpell(slot:number):SpellRecord|undefined {
    const key=this.abilitySlots[slot];return key===undefined?undefined:this.spellByKey(key);
  }
  get spellCooldown():number {return Math.max(0,CAST_TIME-this.sinceCast);}
  get spellCooldownDuration():number {return CAST_TIME;}
  get canUseAbilities():boolean {return this.mayCast();}
  canCast(spell:SpellRecord):boolean {return this.mayCast(spell)&&castable(spell)&&this.stats.magicka>=this.spellCost(spell);}
  castAbility(slot:number):boolean {
    if(!Number.isInteger(slot)||slot<0||slot>=6||this.outcome)return false;
    const key=this.abilitySlots[slot];
    if(!key){this.events.push({type:'notify',text:'Choose an item or spell and use Assign hotbar in Items or Magic'});return false;}
    return this.activateHotbarKey(key);
  }
  /** D-pad Up uses the first favourite directly, including casting an assigned spell. */
  useQuickslot():void {
    const key=this.inventory.hotkeys[0];
    if(key)this.activateHotbarKey(key);else this.events.push({type:'notify',text:'Choose an item or spell and assign it to the first hotbar slot'});
  }

  private spellByKey(key: string): SpellRecord | undefined {
    return this.spellbook.find((s) => spellKey(s) === key);
  }

  // ---- Using things ----

  /** What the player would use now, if anything. */
  target(): Target | undefined {
    if (this.outcome) return undefined;
    if(this.terrainSpell){
      const cell=this.terrainTarget();
      return cell===undefined?undefined:{kind:'spellTerrain',id:cell,name:this.terrainSpell.spell.name,verb:'Apply',note:`${this.terrainSpell.remaining} sections left`};
    }
    const ahead = this.ahead(USE_REACH);
    let best: Target | undefined;
    let bestDist = ahead?.distance ?? Infinity;
    if (ahead?.kind === 'door') best = this.doorTarget(ahead.cell);
    else if (ahead?.kind === 'exit') best = { kind: 'exit', id: ahead.cell, name: this.exitName(), verb: 'Enter' };
    else bestDist = Infinity;
    const p = this.player;
    const consider = (x: number, y: number, make: () => Target) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > ITEM_REACH || d >= bestDist || (d > 0.25 && angleTo(p, x, y) > ITEM_ARC)) return;
      if (!lineOfSight(this.level, p.x, p.y, x, y, this.openDoors)) return;
      best = make();
      bestDist = d;
    };
    for (const item of this.items) {
      if (item.taken || item.searched) continue;
      consider(item.x, item.y, () => ({ kind: 'item', id: item.id, ...ITEM_PROMPTS[item.kind] }));
    }
    for (const c of this.creatures) {
      if (c.state !== 'dead' || this.searchedBodies.has(c.id)) continue;
      if(c.info.noCorpse){const loot=this.carried.get(c.id);if(!this.randomizedLoot||!loot||!loot.gold&&!loot.items.length)continue;}
      consider(c.x, c.y, () => ({ kind: 'body', id: c.id, name: creatureName(c), verb: 'Search' }));
    }
    for (const a of this.arrows) {
      const state = a.projectile;
      if (!state || state.phase === 'flying' || state.phase === 'recovered') continue;
      const carrier = this.creatures.find((c) => c.id === state.hitCreature);
      if (carrier && isAlive(carrier)) continue;
      if (Math.abs(state.position[1] - ((p.z ?? 0) + 0.35)) > USE_REACH) continue;
      const x = state.position[0] - state.direction[0] * 0.35 * METRES_TO_WORLD,
        y = state.position[2] - state.direction[2] * 0.35 * METRES_TO_WORLD;
      consider(x, y, () => ({
        kind: 'arrow',
        id: a.id,
        name: 'Steel Arrow',
        verb: 'Take',
        note: state.phase === 'embedded' ? 'Embedded' : 'On the ground',
      }));
    }
    return best;
  }

  /** "Shift Gate" in the dungeon Arena starts in, whose messages speak of it. */
  exitName(): string {
    return /shift gate/i.test(this.level.triggers.map((t) => t.text ?? '').join(' ')) ? 'Shift Gate' : 'Way out';
  }

  private doorTarget(cell: number): Target {
    const door = this.doors.get(cell)!;
    const name = this.level.cells[cell].seeThrough ? 'Cell door' : 'Door';
    if (door.target === 1) return { kind: 'door', id: cell, name, verb: 'Close' };
    if (!this.locked(cell)) return { kind: 'door', id: cell, name, verb: 'Open' };
    if ((!this.magicalLocks.has(cell)&&this.stats.keys.has(this.level.locks.get(cell)!))) return { kind: 'door', id: cell, name, verb: 'Unlock' };
    if (this.hero.lockpicking > 0) return { kind: 'door', id: cell, name, verb: 'Pick lock', note: 'Locked' };
    return { kind: 'door', id: cell, name, verb: 'Open', note: 'Locked' };
  }

  /** Chance of picking a lock: thieves get better with each level, and harder locks take more. */
  pickChance(cell: number): number {
    if (this.hero.lockpicking <= 0) return 0;
    const chance = this.hero.lockpicking + 0.05 * (this.stats.level - 1) - (this.magicalLocks.get(cell)?.strength??this.level.locks.get(cell) ?? 0) / 100;
    return Math.min(0.95, Math.max(0.05, chance));
  }

  activate(): void {
    const t = this.paralysed ? undefined : this.target();
    if (!t) return;
    if(t.kind==='spellTerrain'){this.changeTerrain();return;}
    if (t.kind === 'door') this.useDoor(t.id);
    else if (t.kind === 'exit') {
      this.outcome = 'escaped';
      this.swing = undefined;
      this.quest?.update(this, this.events);
      this.events.push({ type: 'sound', name: 'FANFARE2.VOC' }, { type: 'escaped' });
    } else if (t.kind === 'arrow') {
      const a = this.arrows.find((a) => a.id === t.id);
      if (a?.projectile && a.projectile.phase !== 'recovered' && a.projectile.phase !== 'flying') {
        a.projectile.phase = 'recovered';
        this.inventory.add(makeSteelArrows());
        this.events.push({ type: 'notify', text: 'Steel Arrow recovered' });
        this.arrows.splice(this.arrows.indexOf(a), 1);
      }
    } else if (t.kind === 'item') this.useItem(this.items[t.id]);
    else { const body = this.creatures.find(c => c.id === t.id); if (body) this.searchBody(body); }
  }

  locked(cell: number): boolean {
    return this.magicalLocks.has(cell)||this.level.locks.has(cell) && !this.unlocked.has(cell);
  }

  private useDoor(cell: number): void {
    const door = this.doors.get(cell)!;
    const at = cellCentre(this.level, cell);
    if(this.magicalLocks.has(cell)){
      this.events.push({type:'notify',text:'The door is magically locked'},{type:'sound',name:'LOCK.VOC',at});return;
    }
    if (door.target === 1) {
      // Not on anyone standing in the doorway.
      const blocked = [this.player, ...this.creatures.filter(isAlive)].some((b) => cellIndex(this.level, b.x, b.y) === cell);
      if (blocked) return;
      door.target = 0;
      this.openDoors.delete(cell);
      const sounds = this.doorSounds(cell);
      if (sounds?.close && !sounds.closeWhenShut) this.events.push({ type: 'sound', name: sounds.close, at });
      return;
    }
    if (this.locked(cell)) {
      if (!(!this.magicalLocks.has(cell)&&this.stats.keys.has(this.level.locks.get(cell)!)) && this.hero.lockpicking > 0) {
        if (this.time - (this.pickedAt.get(cell) ?? -Infinity) < PICK_TIME) return;
        this.pickedAt.set(cell, this.time);
        this.events.push({ type: 'sound', name: 'LOCK.VOC', at });
        if (this.random() >= this.pickChance(cell)) {
          this.events.push({ type: 'notify', text: 'You failed to pick the lock' });
          return;
        }
        this.magicalLocks.delete(cell);
        this.unlocked.add(cell);
        this.events.push({ type: 'notify', text: 'You picked the lock' });
      } else if (!(!this.magicalLocks.has(cell)&&this.stats.keys.has(this.level.locks.get(cell)!))) {
        this.events.push({ type: 'sound', name: 'LOCK.VOC', at });
        this.events.push({
          type: 'notify',
          text: this.lockTried.has(cell) ? 'The door is locked' : 'The door is locked. Find its key, or attack the lock to break it',
        });
        this.lockTried.add(cell);
        return;
      } else {
        this.unlocked.add(cell);
        this.events.push({ type: 'sound', name: 'LOCK.VOC', at }, { type: 'notify', text: 'Unlocked with the key' });
      }
    }
    this.openDoor(cell);
  }

  private openDoor(cell: number): void {
    const door = this.doors.get(cell)!;
    if (door.target === 1) return;
    door.target = 1;
    const open = this.doorSounds(cell)?.open;
    if (open) this.events.push({ type: 'sound', name: open, at: cellCentre(this.level, cell) });
  }

  private useItem(item: DungeonItem): void {
    const notify = (text: string) => this.events.push({ type: 'notify', text });
    if (item.kind === 'key') {
      this.stats.keys.add(item.key ?? 0);
      item.taken = true;
      notify('Key added');
      return;
    }
    let contents = this.spotContents.get(item.id);
    if (!contents) {
      if (this.lootRules) contents = this.randomizedLoot
        ?treasure(this.lootRules,this.lootRules.tables.places[3],this.lootContext((this.level.floor??0)*5+5),this.random)
        :spotLoot(this.lootRules, this.level.floor ?? 0, this.random, this.hero.cls);
      else {
        contents = { gold: 0, items: [] };
        switch (item.kind) {
          case 'treasure':
            if (this.random() < 0.3) contents.items.push(healingPotion());
            else contents.gold = roll(this.random, 10, 40);
            break;
          case 'equipment':
            if (this.weaponTable.length && this.random() < 0.75) contents.items.push(randomGear(this.weaponTable, this.stats.level, this.random, this.armourTable));
            else if (this.random() < 0.5) contents.items.push(healingPotion());
            else contents.gold = roll(this.random, 5, 25);
            break;
          case 'corpse':
            if (this.random() < 0.5) contents.gold = roll(this.random, 1, 20);
            break;
          case 'chest':
            contents.gold = roll(this.random, 20, 80);
            if (this.random() < 0.4) contents.items.push(healingPotion());
            if (this.weaponTable.length && this.random() < 0.3) contents.items.push(randomGear(this.weaponTable, this.stats.level + 1, this.random, this.armourTable));
            break;
        }
      }
      this.spotContents.set(item.id, contents);
    }
    this.looting = { name: item.kind === 'corpse' ? 'Remains' : item.kind === 'chest' ? 'Chest' : 'Items', contents, item };
    if (!contents.gold && !contents.items.length) { this.finishLoot(); notify('Nothing of value'); }
    else this.events.push({ type: 'loot' });
  }

  /** Gives a creature what it carries as it appears, by Arena's rules. */
  private outfit(c: Creature): Creature {
    c.regenerationRound=Math.floor(this.clock/60);
    if(this.eliteEncounters&&!c.elite&&!c.info.boss&&c.info.id!==24&&this.random()<.08)makeElite(c,this.random()<.2?'champion':'unique',this.random);
    if (!this.randomizedLoot&&this.lootRules && c.info.id !== undefined) this.carried.set(c.id, creatureLoot(this.lootRules, c.info.id, c.info.level, this.random));
    this.nameElite(c);
    return c;
  }

  private searchBody(c: Creature): void {
    let contents = this.carried.get(c.id);
    if (!contents) {
      contents = this.randomizedLoot&&this.lootRules&&c.info.id!==undefined?treasure(this.lootRules,this.lootRules.tables.creatures[c.info.id]??[0,0,0,0],this.lootContext(c.info.level+1,!!c.elite&&c.elite.tier!=='minion'),this.random):{ gold: 0, items: [] };
      if (!this.lootRules && this.random() < Math.min(0.6, 0.15 * c.info.level)) contents.gold = roll(this.random, 1, 10 * c.info.level);
      this.carried.set(c.id, contents);
    }
    this.looting = { name: creatureName(c), contents, body: c.id };
    if (!contents.gold && !contents.items.length) {
      this.finishLoot();
      this.events.push({ type: 'notify', text: this.messages.nothingUsable?.replace('%s', c.info.name) ?? 'Nothing of value' });
    } else this.events.push({ type: 'loot' });
  }

  /** The remaining contents; closing the window never rerolls or consumes them. */
  get lootView(): LootView | undefined {
    const source = this.looting;
    if (!source) return undefined;
    const entries: LootEntry[] = source.contents.gold > 0 ? [{ key: 'gold', name: 'Gold', count: source.contents.gold }] : [];
    source.contents.items.forEach((item, i) => entries.push({ key: `item:${i}`, name: shownName(item), count: item.quantity ?? 1,colour:itemColour(item) }));
    return { name: source.name, entries };
  }

  closeLoot(): void { this.looting = undefined; }

  takeLoot(key?: string): void {
    const source = this.looting;
    if (!source) return;
    const contents = source.contents;
    if (key === undefined || key === 'gold') {
      if (contents.gold > 0) this.addGold(contents.gold);
      contents.gold = 0;
    }
    if (key === undefined) {
      for (const item of contents.items) this.addItem(item);
      contents.items.length = 0;
    } else if (/^item:\d+$/.test(key)) {
      const index = Number(key.slice(5));
      const item = contents.items[index];
      if (item) { this.addItem(item); contents.items.splice(index, 1); }
    }
    if (!contents.gold && !contents.items.length) this.finishLoot();
  }

  private finishLoot(): void {
    const source = this.looting;
    if (!source) return;
    if (source.item) {
      if (source.item.kind === 'corpse' || source.item.kind === 'chest') source.item.searched = true;
      else source.item.taken = true;
    }
    if (source.body !== undefined) this.searchedBodies.add(source.body);
    this.looting = undefined;
  }

  private addGold(n: number): void {
    this.stats.gold += n;
    this.events.push({ type: 'notify', text: `${n} gold added` });
  }

  private addItem(gear: NewItem): void {
    const item = this.inventory.add(gear);
    this.events.push({ type: 'notify', text: `${shownName(item)} added` });
    if (item.kind === 'weapon' || item.kind === 'armour' || item.kind === 'shield') this.events.push({ type: 'sound', name: 'CLANK.VOC', volume: 0.6 });
    if (item.kind === 'weapon' && item.material === STEEL && [16, 17].includes(item.type)) {
      this.inventory.add(makeSteelArrows(12));
      this.events.push({ type: 'notify', text: '12 Steel Arrows added' });
    }
  }

  /** The game's spell in that place in its list. */
  spellRecord(index: number | undefined): SpellRecord | undefined {
    return index === undefined ? undefined : this.spells.find((s) => s.index === index);
  }

  /**
   * Drinks a potion: it casts its spell on the player at level 15, as in
   * Arena, and every potion of its kind is known from then on. A potion of
   * Restore Power gives back 25 spell points instead. One whose magic the
   * remake can't do yet (Levitation) is kept.
   */
  private drink(potion: Item): string {
    const s = this.stats;
    const name = shownName(potion);
    if (potion.heals !== undefined) {
      if (s.health >= s.maxHealth) return 'Your health is full';
      s.health = Math.min(s.maxHealth, s.health + potion.heals);
    } else if (potion.spell === RESTORE_POWER) {
      s.magicka = Math.min(s.maxMagicka, s.magicka + RESTORED_POWER);
    } else {
      const spell = this.spellRecord(potion.spell);
      if (!spell || !usable(spell)) return `What the ${name} does isn’t in the game yet`;
      this.onCaster(spell, undefined, potion.castLevel ?? POTION_CAST_LEVEL);
    }
    this.inventory.identify(potion);
    this.inventory.remove(potion);
    return `${potion.name} drunk`;
  }

  /**
   * Casts the spell a trinket or a piece of gear holds, at its level and for
   * no spell points: a trinket spends a charge, and gear a 15th of the spell's
   * cost in wear, as in Arena. Arena calls one with nothing left broken.
   */
  private castFrom(item: Item): string | undefined {
    const name = shownName(item);
    const spell = this.spellRecord(item.spell);
    if (!spell) return `The ${name} has no spell to cast`;
    if (!usable(spell)) return `What the ${name} casts isn’t in the game yet`;
    if (!this.mayCast(spell)) return undefined;
    const broken = () => (this.messages.broken ?? 'The %s is worn out').replace('%s', name);
    const level = item.castLevel ?? GEAR_CAST_LEVEL;
    const wear = Math.floor(magickaCost(spell, level) / GEAR_WEAR);
    if (item.charges !== undefined && item.charges <= 0) return broken();
    if (item.charges === undefined && item.condition !== undefined && wear > item.condition) {
      item.condition = 0;
      return broken();
    }
    const before = this.events.length;
    const cast = this.release(spell, level, () => {
      if (item.charges !== undefined) item.charges--;
      else if (item.condition !== undefined) item.condition -= wear;
    });
    if (!cast) {
      // Says why where the player is looking: the item menu, or the game for a number key.
      const why = this.events.findIndex((e, i) => i >= before && e.type === 'notify');
      return why < 0 ? undefined : (this.events.splice(why, 1)[0] as { text: string }).text;
    }
    this.inventory.identify(item);
    return `${spell.name} cast with the ${shownName(item)}`;
  }

  /** Whether the item casts a spell when used: trinkets that do, and enchanted gear. */
  private casts(item: Item): boolean {
    return item.spell !== undefined && item.kind !== 'potion';
  }

  // ---- The item menus ----

  /** Everything the player carries, as the item menus list it. */
  entries(): MenuEntry[] {
    const inv = this.inventory;
    const entry = (key: string, name: string, category: MenuEntry['category'], count: number, item?: Item): MenuEntry => ({
      key,
      name,
      category,
      count,
      item,
      equipped: !!item && inv.isEquipped(item),
      favourite: inv.isFavourite(key),
      hotkey: inv.hotkeyOf(key),
    });
    const list: MenuEntry[] = [];
    // Potions are counted by kind, the rest listed one by one.
    const potions = new Map<number, Item[]>();
    for (const item of inv.items) {
      if (item.kind === 'potion') potions.set(item.type, [...(potions.get(item.type) ?? []), item]);
      else list.push(entry(itemKey(item), shownName(item), categoryOf(item), item.quantity ?? 1, item));
    }
    for (const [type, kind] of potions) list.push(entry(potionKey(type), shownName(kind[0]), 'potions', kind.length, kind[0]));
    if (this.stats.keys.size) list.push(entry('keys', 'Key', 'misc', this.stats.keys.size));
    return list;
  }

  /**
   * Uses an entry from the item or magic menus: equips a piece of gear or a
   * trinket or takes it off, drinks a potion, casts a trinket's spell, or
   * readies a spell or puts it away. Gear and trinkets turn out to be what
   * they are once worn or used. Returns what happened, to tell the player.
   */
  use(key: string): string | undefined {
    if (this.outcome) return undefined;
    const spell = this.spellByKey(key);
    if (spell) {
      if (this.readied === spell) {
        this.readied = undefined;
        return `${spell.name} put away`;
      }
      this.readied = spell;
      return `${spell.name} readied`;
    }
    const item = this.inventory.byKey(key);
    if (!item) return undefined;
    if (item.kind === 'ammunition') return 'Steel arrows are used automatically when firing a Steel bow';
    if (item.kind === 'potion') return this.drink(item);
    if (!wearable(item)) return this.castFrom(item);
    const wasOn = this.inventory.isEquipped(item);
    this.inventory.level=this.practiceMode?100:this.stats.level;
    const before = this.inventory.weapon;
    const result = this.inventory.toggle(item);
    if (!result.ok) return result.message;
    const held = this.inventory.weapon;
    if (held && held !== before) {
      this.stats.weapon = weaponOf(held);
      // A new weapon cuts short a swing or a shot.
      this.swing = undefined;
      this.armedAt = this.queued = undefined;
    }
    if (!wasOn) this.inventory.identify(item);
    this.refreshHero();
    const done = wasOn ? `${item.name} removed` : `${item.name} equipped`;
    return result.message ? `${done}. ${result.message}` : done;
  }

  identify(key:string):string|undefined {
    const item=this.inventory.byKey(key);if(!item||!item.unidentified)return undefined;
    this.inventory.identify(item);return `${item.name} identified`;
  }

  /** Casts the spell of a piece of gear, as Arena's "use" does; returns what happened. */
  castWith(key: string): string | undefined {
    if (this.outcome) return undefined;
    const item = this.inventory.byKey(key);
    return item && this.casts(item) ? this.castFrom(item) : undefined;
  }

  /** Whether the entry's item casts a spell: a trinket that does, or enchanted gear. */
  castsSpell(key: string): boolean {
    const item = this.inventory.byKey(key);
    return !!item && this.casts(item);
  }

  /**
   * Leaves a piece of gear behind for good, to carry less: there is no
   * putting things down in the dungeon to pick up again yet. Returns what
   * happened, to tell the player.
   */
  drop(key: string): string | undefined {
    if (this.outcome) return undefined;
    const item = this.inventory.byKey(key);
    if (!item) return undefined;
    if (item === this.inventory.weapon) return 'Equip another weapon before you drop this one';
    const worn = this.inventory.isEquipped(item);
    this.inventory.remove(item);
    if (worn) this.refreshHero();
    return `${shownName(item)} dropped`;
  }

  /** Adds the entry to the favourites or takes it off; true when it is one now. Only gear, potions and spells can be. */
  favourite(key: string): boolean {
    if (!this.favourable(key)) return false;
    return this.inventory.toggleFavourite(key);
  }

  /** Puts a favourite on number key n + 1 (0 for 1). */
  setHotkey(n: number, key: string): void {
    if(n===0&&!this.hotbarAssignable(key)){this.events.push({type:'notify',text:'The hotbar is for usable items and spells. Equip weapons and armour in Items.'});return;}
    if (this.favourable(key)) this.inventory.setHotkey(n, key);
  }

  private favourable(key: string): boolean {
    return !!this.inventory.byKey(key) || !!this.spellByKey(key);
  }

  /** Uses what is on number key n + 1 (0 for 1), with a note to say what happened. */
  hotkey(n: number): void {
    if (this.outcome) return;
    const key = this.inventory.hotkeys[n];
    // A spell's key readies it, as in Skyrim, rather than putting it away again.
    const spell = key === undefined ? undefined : this.spellByKey(key);
    if (spell && this.readied === spell) return;
    // Worn gear that casts a spell casts it, as Arena's "use" does; to take it off, use the item menu.
    const item = key === undefined ? undefined : this.inventory.byKey(key);
    const casting = item && wearable(item) && this.casts(item) && this.inventory.isEquipped(item);
    const text = key === undefined ? `Nothing is on ${n + 1}: choose a favourite and press ${n + 1} to put it there` : casting ? this.castFrom(item) : this.use(key);
    if (text) this.events.push({ type: 'notify', text });
  }

  /** The door, exit or wall straight ahead within `reach`, if any. Open doors are looked through unless the player stands in one. */
  private ahead(reach: number): { kind: 'door' | 'exit' | 'wall'; cell: number; distance: number; at: { x: number; y: number } } | undefined {
    const p = this.player;
    const fx = Math.cos(p.yaw);
    const fy = Math.sin(p.yaw);
    const standing = cellIndex(this.level, p.x, p.y);
    for (let t = 0.1; t <= reach; t += 0.05) {
      const cell = cellIndex(this.level, p.x + fx * t, p.y + fy * t);
      if (cell < 0) return undefined;
      const c = this.level.cells[cell];
      const at = { x: p.x + fx * t, y: p.y + fy * t };
      if (c.kind === 'door' && cell !== standing) return { kind: 'door', cell, distance: t, at };
      if (c.kind === 'wall') return { kind: c.exit ? 'exit' : 'wall', cell, distance: t, at };
      if (c.kind === 'transparent' || c.kind === 'diagonal') return { kind: 'wall', cell, distance: t, at };
    }
    return undefined;
  }
}

/** Which list of the item menu an item is in: trinkets that cast are used rather than worn, so they go with the rest. */
function categoryOf(item: Item): MenuEntry['category'] {
  if (item.kind === 'weapon' || item.kind === 'ammunition') return 'weapons';
  return wearable(item) ? 'apparel' : 'misc';
}

/** The remake's own healing potion, for a game whose potions can't be read. */
function healingPotion(): NewItem {
  return { kind: 'potion', name: 'Healing Potion', type: -1, heals: HEALING_POTION, weight: POTION_WEIGHT, value: 25 };
}

const ITEM_PROMPTS: Record<DungeonItem['kind'], { name: string; verb: string }> = {
  key: { name: 'Key', verb: 'Take' },
  treasure: { name: 'Treasure', verb: 'Take' },
  equipment: { name: 'Equipment', verb: 'Search' },
  corpse: { name: 'Body', verb: 'Search' },
  chest: { name: 'Chest', verb: 'Open' },
};

/** Faces the most open direction from the start. */
function initialYaw(level: Level): number {
  let best = 0;
  let bestRun = -1;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    let run = 0;
    for (let t = 1; t < 8; t++) {
      const i = cellIndex(level, level.start.x + Math.cos(yaw) * t, level.start.y + Math.sin(yaw) * t);
      if (i < 0 || level.cells[i].kind !== 'empty') break;
      run++;
    }
    if (run > bestRun) {
      bestRun = run;
      best = yaw;
    }
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Angle between where the player faces and the direction to (x, y). */
function angleTo(p: PlayerState, x: number, y: number): number {
  const a = Math.atan2(y - p.y, x - p.x) - p.yaw;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
}

function cellCentre(level: Level, cell: number): { x: number; y: number } {
  return { x: (cell % level.width) + 0.5, y: Math.floor(cell / level.width) + 0.5 };
}
