import {eliteResistance,type EliteState} from './elites';
import type {DamageKind} from './combatText';
import {creatureAttribute,updateCreatureMagic,type CreatureMagic} from './creatureMagic';
import {monsterSeesInvisible} from './monsterSenses';
import {ROUND} from './magic';
/**
 * Creatures and what they do each moment. Pure logic (no Three.js) so it
 * can be unit tested; the renderer asks creatureFrame() which sprite to draw.
 *
 * A creature stands about, looks around and wanders to nearby cells. Once
 * it sees the player it gives chase: straight at them in the open, the
 * shortest way round corners otherwise. A player who sneaks is seen only
 * from close by, and then only bit by bit, as in Skyrim: slowly from behind
 * the creature, quickly in front of it. In reach it swings, and it gives up
 * when it has not seen the player for a while. Hurting a creature always
 * makes it chase, and a bash knocks it back out of its swing. Dying plays
 * the death frames and leaves a body, unless the creature has none (ghosts).
 *
 * Arena's creature sprites: in each of the five view files, frames 0-5 walk,
 * 6 and 7 look left and right, and 8 on (in the front view at least) attack.
 * The sixth file is the death: two frames of falling, then the body.
 */
import type { CreatureInfo } from '../formats/exe';
import { blowLands, MIDDLING_AGILITY, roll } from './combat';
import { blockedFor, cellIndex, lineOfSight, nextStep } from './grid';
import { isBlocking, type Level } from './level';

export type CreatureState = 'idle' | 'look' | 'wander' | 'chase' | 'attack' | 'dying' | 'dead' | 'reviving';

export interface Creature {
  elite?:EliteState;
  auraPace?:number;
  auraDamage?:number;
  auraAccuracy?:number;
  auraAttackRate?:number;
  /** Native fixed-step accumulator and previous AI casting/body-fall flags. */
  native?:{elapsed:number;casting:boolean;fallen:boolean};
  id: number;
  magic?:CreatureMagic;
  /** Actual sprite height, filled by CreatureView, for vertical projectile collisions. */
  collisionHeight?: number;
  info: CreatureInfo;
  x: number;
  y: number;
  /** Radians, like the player's yaw: 0 faces +x (east). */
  facing: number;
  health: number;
  maxHealth: number;
  /** Reward calculated at spawn, before magical damage reduces maximum HP. */
  experienceValue?: number;
  /** Native game-minute counter at the previous regeneration update. */
  regenerationRound?: number;
  /** Death frame from which a resurrection reverses. */
  reviveFrame?: number;
  state: CreatureState;
  /** Seconds since the state began. */
  time: number;
  /** How long the current idle or look lasts. */
  span: number;
  /** Walk cycle position, in frames. */
  stride: number;
  /** Where the creature is walking to. */
  goal?: { x: number; y: number };
  /** Seconds before it may swing again. */
  cooldown: number;
  /** Seconds since it last saw the player. */
  unseen: number;
  /** Set once the current swing has landed or missed. */
  struck: boolean;
  /** Seconds since it was last hurt. */
  hurt: number;
  /** When (world seconds) a chase re-plans its route round corners. */
  replan: number;
  /** How close a calm creature is to noticing a sneaking player, 0 to 1. */
  awareness: number;
  /** Seconds it is still held by a paralysis spell. */
  paralysed: number;
}

export interface CreatureWorld {
  level: Level;
  openDoors: Set<number>;
  /**
   * Where the player is, and what decides whether a blow lands on them (see
   * hitChance): their level and Agility (0 to 255; 50 out of 100 when not
   * given), the protection on each body part (none when not given), and
   * whether they are a Monk or Acrobat.
   */
  player: { x: number; y: number; level: number; agility?: number; protection?: number[]; evasive?: boolean };
  /** Where blows land, from the program when it can be read (see bodyPart). */
  bodyParts?: number[];
  /** Sneaking players are noticed from closer. */
  sneaking: boolean;
  /** Invisibility hides the player except from the native detecting monsters. */
  invisible?: boolean;
  nonTarget?:boolean;
  /** Seconds of game time. */
  now: number;
  /** Native spell rounds advance with the calendar's game minutes. */
  round?: number;
  random: () => number;
  /** Every creature, to keep out of each other's way. */
  creatures: Creature[];
}

export interface CreatureEvents {
  /** Runs on native AI updates; true means the creature is in a casting stance. */
  casting?(c:Creature):boolean;
  /** Spotted the player and starts the chase. */
  notice?(c: Creature): void;
  /** Starts a swing. */
  swing?(c: Creature): void;
  /** The swing lands for `damage`, or misses (0). */
  strike?(c: Creature, damage: number): void;
  /** Reaches the final death frame, once per fall, if it leaves a body. */
  fall?(c: Creature): void;
}

export const CREATURE_RADIUS = 0.25;
/** Closest a creature comes to the player's centre. */
const PERSONAL_SPACE = 0.55;
const SIGHT = 7;
/** A sneaking player is seen only this close, and not at once. */
export const SNEAK_SIGHT = 4.5;
/** Awareness gained per second at the edge of SNEAK_SIGHT and, added, right next to the creature. */
const NOTICE_FAR = 0.35;
const NOTICE_NEAR = 1.6;
/** Behind a creature (past this angle from where it faces), a sneaking player is noticed this much slower. */
const BEHIND = (100 * Math.PI) / 180;
const BEHIND_FACTOR = 0.35;
/** Awareness lost per second while the creature cannot see the player. */
const FORGET = 0.25;
const REACH = 1.05;
const WANDER_SPEED = 0.9;
const CHASE_SPEED = 1.7;
export const ATTACK_TIME = 0.7;
const STRIKE_AT = 0.4;
const GIVE_UP = 8;
const DYING_TIME = 0.5;
const STAGGER_TIME = 0.8;
/** How far a bash shoves a creature back. */
const SHOVE = 0.35;
/** Walk frames per voxel walked. */
const STRIDE = 5;

/** IBM PIT timer / BIOS divisor, confirmed against the isolated original IRQ timer. */
export const monsterStepSeconds=(c:Creature)=> (c.info.timing?.timerTicks??2)*65536/1193182/(c.auraAttackRate??c.elite?.attackRate??1);
const deathFrameSeconds=(c:Creature)=>c.info.timing?monsterStepSeconds(c):DYING_TIME/2;
/** Native AI distance: the larger delta plus one quarter of the smaller. */
export function monsterInReach(c:Creature,player:{x:number;y:number}):boolean {
  if(!c.info.timing)return Math.hypot(player.x-c.x,player.y-c.y)<=REACH;
  const x=Math.abs(Math.trunc(player.x*128)-Math.trunc(c.x*128)),y=Math.abs(Math.trunc(player.y*128)-Math.trunc(c.y*128));
  return Math.max(x,y)+(Math.min(x,y)>>2)<=c.info.timing.reach;
}

export function spawnCreature(id: number, info: CreatureInfo, x: number, y: number, random: () => number): Creature {
  const health = roll(random, info.health[0], info.health[1]);
  return {
    id,
    info,
    x,
    y,
    facing: random() * Math.PI * 2,
    health,
    maxHealth: health,
    experienceValue: info.experience+info.experiencePerHealth*health,
    regenerationRound: 0,
    state: 'idle',
    time: 0,
    span: 1 + random() * 3,
    stride: 0,
    cooldown: 0,
    unseen: Infinity,
    struck: false,
    hurt: Infinity,
    replan: 0,
    awareness: 0,
    paralysed: 0,
  };
}

export const isAlive = (c: Creature) => c.state !== 'dying' && c.state !== 'dead' && c.state !== 'reviving';
/** A subdued regenerator remains an encounter until its maximum HP is spent. */
export const canRevive = (c:Creature) => !!c.info.regeneration?.revives && c.maxHealth>0;
export const isDefeated = (c:Creature) => !isAlive(c) && !canRevive(c);
export const isMagicTarget = (c:Creature) => isAlive(c) || canRevive(c);

/**
 * Holds a creature still for `seconds`, and makes it hunt the player once
 * it can move again. A swing it had started does not land.
 */
export function paralyseCreature(c: Creature, seconds: number, w: CreatureWorld): void {
  if (!isMagicTarget(c)) return;
  if(c.elite&&c.elite.tier!=='minion'){
    c.elite.chilledUntil=Math.max(c.elite.chilledUntil??0,w.now+seconds);return;
  }
  c.paralysed = Math.max(c.paralysed, seconds);
  if(!isAlive(c))return;
  if (c.state === 'attack') {
    setState(c, 'chase');
    c.cooldown = c.info.timing?0:Math.max(c.cooldown, 0.5);
  } else if (c.state !== 'chase') alert(c, w);
  c.unseen = 0;
}

/** Going about its business, unaware of the player. */
export const isCalm = (c: Creature) => c.state === 'idle' || c.state === 'look' || c.state === 'wander';

function setState(c: Creature, state: CreatureState, span = 0): void {
  c.state = state;
  c.time = 0;
  c.span = span;
}

/** Cells creatures won't walk into: pits, water and lava. They wait at the edge instead, as in Arena (UESP: monsters stand at the exit of a pool). */
function avoids(level: Level, cell: number,c:Creature): boolean {
  // Native sprite Y is initialized from the lift table (35ca:007f).
  // Nonzero Y bypasses the chasm-floor check at 1000:2117.
  return !!level.cells[cell]?.chasm&&!(c.info.timing&&c.info.lift!==0);
}

function canSee(c: Creature, w: CreatureWorld, range: number): boolean {
  if (w.invisible&&!monsterSeesInvisible(c.info.id)||w.nonTarget) return false;
  const d = Math.hypot(w.player.x - c.x, w.player.y - c.y);
  return d <= range && lineOfSight(w.level, c.x, c.y, w.player.x, w.player.y, w.openDoors);
}

export function updateCreature(c: Creature, w: CreatureWorld, dt: number, events: CreatureEvents = {}): void {
  if(!c.info.timing){stepCreature(c,w,dt,events);return;}
  if(dt<=0)return;
  const seconds=monsterStepSeconds(c),native=c.native??={elapsed:seconds,casting:false,fallen:false};
  native.elapsed+=dt;
  while(native.elapsed+1e-9>=seconds){
    native.elapsed=Math.max(0,native.elapsed-seconds);
    const wasAttacking=c.state==='attack';
    stepCreature(c,w,seconds,events);
    // Native AI returns early for attacks; the later view pass cancels an
    // attack shown from a side angle (1000:19b8), permitting a lateral dodge.
    if(c.state==='attack'&&viewAngle(c.x,c.y,c.facing,w.player.x,w.player.y).file>0){
      setState(c,'chase');c.cooldown=0;
    }
    native.casting=wasAttacking||c.state==='attack'?false:events.casting?.(c)??false;
  }
}

function stepCreature(c:Creature,w:CreatureWorld,dt:number,events:CreatureEvents):void {
  updateCreatureMagic(c,w.now,dt);
  const round=Math.floor(w.round??w.now/ROUND),previous=c.regenerationRound??round;
  c.regenerationRound=previous;
  const regen=c.info.regeneration;
  if(regen&&!isDefeated(c)&&round>previous){
    const ticks=Math.floor((round-previous)/regen.everyRounds);
    c.health=Math.min(c.maxHealth,c.health+ticks*regen.health);
    c.regenerationRound=previous+ticks*regen.everyRounds;
  }else if(!regen||isDefeated(c)||round<previous)c.regenerationRound=round;
  const previousDeathFrame=!isAlive(c)?creatureFrame(c,0).frame:0;
  c.time += dt;
  c.hurt += dt;
  c.cooldown = Math.max(0, c.cooldown - dt);
  const frozen=c.paralysed>0;
  c.paralysed = Math.max(0, c.paralysed - dt);
  if(!isAlive(c)&&canRevive(c)&&c.health>0&&!frozen&&c.state!=='reviving'){
    const frame=c.info.timing?previousDeathFrame:creatureFrame(c,0).frame;
    setState(c,'reviving');c.reviveFrame=frame;
    if(c.info.timing)c.time=dt;
  }
  if(c.state==='reviving'){
    if(frozen)c.time-=dt;
    else if(c.time+1e-9>=(1+(c.reviveFrame??2))*deathFrameSeconds(c))alert(c,w);
    return;
  }
  if (c.state === 'dead') return;
  if (c.state === 'dying') {
    // Native 1000:2292 returns before the death/revival animation branch.
    if(frozen){c.time-=dt;return;}
    if (c.time+1e-9 >= (c.info.timing?c.info.timing.deathEnd*deathFrameSeconds(c):DYING_TIME)) {
      setState(c, 'dead');
      if(!c.info.noCorpse&&!c.native?.fallen)events.fall?.(c);
      if(c.native)c.native.fallen=true;
    }
    return;
  }
  // Paralysed: frozen where it stands, in the middle of whatever it was doing.
  if (frozen) {
    c.time -= dt;
    return;
  }

  if(w.nonTarget&&(c.state==='chase'||c.state==='attack'))setState(c,'idle',2);
  const dist = Math.hypot(w.player.x - c.x, w.player.y - c.y);
  if (isCalm(c)) {
    if (!w.sneaking && canSee(c, w, SIGHT)) c.awareness = 1;
    else if (w.sneaking && canSee(c, w, SNEAK_SIGHT)) {
      let rate = NOTICE_FAR + NOTICE_NEAR * (1 - dist / SNEAK_SIGHT);
      const toPlayer = Math.atan2(w.player.y - c.y, w.player.x - c.x) - c.facing;
      if (Math.abs(Math.atan2(Math.sin(toPlayer), Math.cos(toPlayer))) > BEHIND) rate *= BEHIND_FACTOR;
      c.awareness = Math.min(1, c.awareness + rate * dt);
    } else c.awareness = Math.max(0, c.awareness - FORGET * dt);
    if (c.awareness >= 1) {
      alert(c, w);
      events.notice?.(c);
    }
  }

  switch (c.state) {
    case 'idle':
      if (c.time >= c.span) {
        if (w.random() < 0.35) setState(c, 'look', 1.2);
        else wanderSomewhere(c, w);
      }
      break;
    case 'look':
      if (c.time >= c.span) setState(c, 'idle', 1.5 + w.random() * 3);
      break;
    case 'wander': {
      const goal = c.goal;
      if (!goal || c.time > 6 || !moveToward(c, goal.x, goal.y, WANDER_SPEED, dt, w)) setState(c, 'idle', 1.5 + w.random() * 3);
      break;
    }
    case 'chase': {
      const sees = canSee(c, w, SIGHT * 1.5);
      c.unseen = sees ? 0 : c.unseen + dt;
      if (c.unseen > GIVE_UP) {
        setState(c, 'idle', 2);
        break;
      }
      if (monsterInReach(c,w.player) && sees) {
        c.facing = Math.atan2(w.player.y - c.y, w.player.x - c.x);
        if (c.cooldown <= 0 && (c.info.timing||!c.magic||c.magic.stamina>c.magic.maxStamina*.1)&&
          (!c.info.timing||(Math.floor(w.random()*65536)&c.info.timing.meleeMask)===0)) {
          setState(c, 'attack');
          if(c.info.timing)c.time=dt; // AI starts frame 8; same update advances it to 9.
          c.struck = false;
          events.swing?.(c);
        }
        break;
      }
      const arrived = c.goal && Math.hypot(c.goal.x - c.x, c.goal.y - c.y) < 0.1;
      if (sees) c.goal = { x: w.player.x, y: w.player.y };
      else if (w.now >= c.replan || !c.goal || arrived) {
        c.replan = w.now + 0.4;
        const step = nextStep(w.level, cellIndex(w.level, c.x, c.y), cellIndex(w.level, w.player.x, w.player.y), (i) => !isBlocking(w.level.cells[i], w.openDoors, i) && !avoids(w.level, i,c));
        if (step !== undefined) c.goal = { x: (step % w.level.width) + 0.5, y: Math.floor(step / w.level.width) + 0.5 };
      }
      if (c.goal&&!c.native?.casting) moveToward(c, c.goal.x, c.goal.y, CHASE_SPEED, dt, w);
      break;
    }
    case 'attack':
      if(!c.info.timing)c.facing = Math.atan2(w.player.y - c.y, w.player.x - c.x);
      if (!c.struck && c.time+1e-9 >= (c.info.timing?(c.info.timing.strikeFrame-c.info.timing.attackFirst+1)*dt:STRIKE_AT)) {
        c.struck = true;
        const p = w.player;
        const defender = { level: p.level, agility: p.agility ?? MIDDLING_AGILITY, protection: p.protection ?? [], evasive: !!p.evasive };
        // Original 3aa1:00d8/058b resolves the attempted blow's hit chance;
        // it does not repeat a spatial check after the AI starts the attack.
        const lands = (c.info.timing||dist <= REACH + 0.35) && blowLands({ level: c.info.level, agility: (c.magic ? creatureAttribute(c,3)*256/100 : c.info.agility ?? MIDDLING_AGILITY)*(c.auraAccuracy??1) }, defender, w.random, w.bodyParts);
        const strength=c.magic ? creatureAttribute(c,0)/Math.max(1,(c.info.attributes?.[0]??128)*100/256) : 1;
        events.strike?.(c, lands ? Math.max(0,Math.round(roll(w.random, c.info.damage[0], c.info.damage[1])*strength*(c.auraDamage??1)*(c.magic?Math.min(1,c.magic.stamina/Math.max(1,c.magic.maxStamina)):1))) : 0);
      }
      if (c.time+1e-9 >= (c.info.timing?(c.info.timing.attackEnd-c.info.timing.attackFirst)*dt:ATTACK_TIME)) {
        setState(c, 'chase');
        c.cooldown = c.info.timing?0:0.5 + w.random() * 0.9;
      }
      break;
  }
}

function alert(c: Creature, w: CreatureWorld): void {
  setState(c, 'chase');
  c.unseen = 0;
  c.awareness = 1;
  c.goal = { x: w.player.x, y: w.player.y };
}

/** The creatures whose blows can paralyse, by their number in the game's list: Lizard Men and Spiders. */
const PARALYSING = [3, 9];

/**
 * Rounds of paralysis a creature's landed blow brings, as Arena works it out
 * (its program at 0x2AD6D), or 0: a creature that paralyses does so on a
 * roll out of 100 no more than its chance of special harm, and then only on
 * a second roll below the player's chance of being paralysed, for 1 to 6
 * rounds. Disease transmission is handled separately in diseases.ts.
 */
export function paralysisFrom(info: CreatureInfo, chance: number, random: () => number): number {
  if (!PARALYSING.includes(info.id ?? 0) || info.special <= 0) return 0;
  if (Math.floor(random() * 100) > info.special || Math.floor(random() * 100) >= chance) return 0;
  return 1 + Math.floor(random() * 6);
}

/**
 * Hurts a creature; returns true only for a permanent kill. A staggering blow
 * (a power attack) also stops a swing that has not landed yet.
 */
export function hurtCreature(c: Creature, damage: number, w: CreatureWorld, stagger = false, magical = false,kind:DamageKind=magical?'magic':'physical'): boolean {
  if (!(magical?isMagicTarget(c):isAlive(c)) || damage<=0) return false;
  damage=eliteResistance(c,damage,kind);
  const standing=isAlive(c);
  if(magical&&c.info.regeneration)c.maxHealth-=damage;
  c.health -= damage;
  c.hurt = 0;
  if (c.health <= 0) {
    // Signed overkill is retained for regenerators, as in the original words.
    if(!c.info.regeneration)c.health=0;
    if(standing||c.state==='reviving')setState(c, 'dying');
    return isDefeated(c);
  }
  if(!standing)return false;
  if (stagger && (!c.elite||c.elite.tier==='minion'||w.random()<.1) && c.state === 'attack' && !c.struck) {
    setState(c, 'chase');
    c.cooldown = STAGGER_TIME;
  } else if (c.state !== 'attack' && c.state !== 'chase') alert(c, w);
  c.unseen = 0;
  return false;
}

/**
 * A bash: knocks the creature back a little from `from` and out of a swing
 * that has not landed yet, and makes it wait before swinging again.
 */
export function staggerCreature(c: Creature, w: CreatureWorld, from: { x: number; y: number }): void {
  if (!isAlive(c)) return;
  if (c.state !== 'chase' && c.state !== 'attack') alert(c, w);
  else if (c.state === 'attack' && !c.struck) setState(c, 'chase');
  c.cooldown = Math.max(c.cooldown, STAGGER_TIME);
  c.unseen = 0;
  const d = Math.hypot(c.x - from.x, c.y - from.y) || 1;
  const nx = c.x + ((c.x - from.x) / d) * SHOVE;
  const ny = c.y + ((c.y - from.y) / d) * SHOVE;
  const avoid = (i: number) => avoids(w.level, i,c);
  if (!blockedFor(w.level, nx, c.y, CREATURE_RADIUS, w.openDoors, avoid)) c.x = nx;
  if (!blockedFor(w.level, c.x, ny, CREATURE_RADIUS, w.openDoors, avoid)) c.y = ny;
}

function wanderSomewhere(c: Creature, w: CreatureWorld): void {
  const { level } = w;
  let cell = cellIndex(level, c.x, c.y);
  // A short random walk of one or two cells.
  for (let steps = 1 + Math.floor(w.random() * 2); steps > 0; steps--) {
    const options = [cell - level.width, cell + level.width, cell - 1, cell + 1].filter(
      (n) => n >= 0 && n < level.cells.length && !isBlocking(level.cells[n], w.openDoors, n) && !avoids(level, n,c),
    );
    if (!options.length) break;
    cell = options[Math.floor(w.random() * options.length)];
  }
  c.goal = { x: (cell % level.width) + 0.2 + w.random() * 0.6, y: Math.floor(cell / level.width) + 0.2 + w.random() * 0.6 };
  setState(c, 'wander');
}

/**
 * Walks toward a point, sliding along walls, keeping out of other creatures
 * and the player. Returns false once there (or stuck against something).
 */
function moveToward(c: Creature, gx: number, gy: number, speed: number, dt: number, w: CreatureWorld): boolean {
  const dx = gx - c.x;
  const dy = gy - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return false;
  c.facing = Math.atan2(dy, dx);
  const timing=c.info.timing;
  const speedStat=Math.max(0,Math.min(255,Math.floor(c.magic?creatureAttribute(c,4)*256/100:c.info.attributes?.[4]??128)));
  if(timing)speed=2*(timing.speedBase+((speedStat*timing.speedMultiplier)>>8))/128/monsterStepSeconds(c);
  const pace=timing?1:c.magic ? Math.min(2,creatureAttribute(c,4)/Math.max(1,(c.info.attributes?.[4]??128)*100/256)) : 1;
  const stepLen = Math.min(d, speed * pace * (c.elite?.pace??1) * (c.auraPace??1) * (w.now<(c.elite?.chilledUntil??0)?.5:1) * dt);
  let mx = (dx / d) * stepLen;
  let my = (dy / d) * stepLen;
  // Keep a little apart from the others.
  for (const o of w.creatures) {
    if (o === c || !isAlive(o)) continue;
    const ox = c.x - o.x;
    const oy = c.y - o.y;
    const od = Math.hypot(ox, oy);
    if (od > 0 && od < CREATURE_RADIUS * 2) {
      mx += (ox / od) * stepLen * 0.5;
      my += (oy / od) * stepLen * 0.5;
    }
  }
  const avoid = (i: number) => avoids(w.level, i,c);
  const free = (x: number, y: number) => {
    if (blockedFor(w.level, x, y, CREATURE_RADIUS, w.openDoors, avoid)) return false;
    const pd = Math.hypot(w.player.x - x, w.player.y - y);
    return pd >= PERSONAL_SPACE || pd >= Math.hypot(w.player.x - c.x, w.player.y - c.y);
  };
  const x0 = c.x;
  const y0 = c.y;
  if (free(c.x + mx, c.y)) c.x += mx;
  if (free(c.x, c.y + my)) c.y += my;
  const moved = Math.hypot(c.x - x0, c.y - y0);
  c.stride += moved * STRIDE;
  return moved > stepLen * 0.1;
}

/** Which sprite to draw: a frame of the view files, or of the death file. */
export function creatureFrame(c: Creature, attackFrames: number): { death: boolean; frame: number } {
  if(c.native?.casting&&isAlive(c)&&c.state!=='attack')return {death:false,frame:0};
  switch (c.state) {
    case 'dying':
      return { death: true, frame: Math.min(c.info.timing?2:1, Math.floor(c.time/deathFrameSeconds(c)+1e-9)) };
    case 'dead':
      return { death: true, frame: 2 };
    case 'reviving':
      return {death:true,frame:Math.max(0,(c.reviveFrame??2)-Math.floor(c.time/deathFrameSeconds(c)+1e-9))};
    case 'attack': {
      if (attackFrames <= 0) return { death: false, frame: 0 };
      if(c.info.timing)return {death:false,frame:Math.min(c.info.timing.attackEnd-1,c.info.timing.attackFirst+Math.floor(c.time/monsterStepSeconds(c)+1e-9))};
      const f = Math.min(attackFrames - 1, Math.floor((c.time / ATTACK_TIME) * attackFrames));
      return { death: false, frame: 8 + f };
    }
    case 'look':
      return { death: false, frame: [6, 0, 7, 0][Math.floor((c.time / c.span) * 4) % 4] };
    case 'wander':
    case 'chase':
      return { death: false, frame: Math.floor(c.stride) % 6 };
    default:
      return { death: false, frame: 0 };
  }
}

/**
 * Which of the five view files shows a creature facing `facing` to a viewer
 * looking from (vx, vy): 0 front, 1 front-side, 2 side, 3 back-side, 4 back.
 * The views between are mirrored when the creature faces the viewer's right.
 * The front and back views never are: a creature coming straight at the
 * viewer is a hair to one side or the other from one moment to the next,
 * and would flip back and forth.
 */
export function viewAngle(cx: number, cy: number, facing: number, vx: number, vy: number): { file: number; mirror: boolean } {
  const toViewer = Math.atan2(vy - cy, vx - cx);
  let rel = facing - toViewer;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // -PI..PI; 0 = facing the viewer
  const sector = Math.round(Math.abs(rel) / (Math.PI / 4)); // 0..4
  return { file: sector, mirror: sector > 0 && sector < 4 && rel < 0 };
}
