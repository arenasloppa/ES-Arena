import {creatureName,eliteDescription} from './elites';
import { SceneEffects } from '../render/sceneEffects';
import { SceneLighting } from '../render/sceneLighting';
import {CombatText,type CombatLabel} from './combatText';
import {LootDropView} from '../render/lootDropView';
import {experienceFor} from './combat';
import {HOTBAR_ORDER} from '../input/hotbar';
import {statusEffectsKey, type ActiveStatusEffect} from './statusEffects';
import * as THREE from 'three';
import type {TestArea} from './testArea';
import {SurfaceImpactView} from '../render/surfaceImpactView';
import {AttackHold} from '../input/rangeGamepad';
import { GAMEPLAY_BUTTON, GAMEPLAY_LOOK, keyboardMovement, gamepadHolds } from '../input/gameplayControls';
import type { SoundBank } from '../audio/sound';
import type { GamepadInput } from '../input/gamepad';
import type { CreatureView } from '../render/creatureView';
import type { FilmView } from '../render/film';
import { poseDoor, type LevelScene } from '../render/levelScene';
import type { MapView } from '../render/mapView';
import { abilityIcon } from './abilityBar';
import { spellColour, type SpellView } from '../render/spellView';
import type { ArrowView } from '../render/arrowView';
import type { WeaponView } from '../render/weaponView';
import { terrainSphere, sweepTerrain, sweepCreatures } from './surfacePhysics';
import { METRES_TO_WORLD } from './projectilePhysics';
import type { Minimap } from '../ui/minimap';
import { isAlive, type Creature } from './creatures';
import type { Dungeon, Vision } from './dungeon';
import { lineOfSight, cellIndex } from './grid';
import { ARENA_HEIGHT, ceilingHeight, floorHeight } from './level';
import {STANDING_EYE as EYE,SNEAKING_EYE as SNEAK_EYE,SWIMMING_EYE as SWIM_EYE,DEAD_EYE} from './playerView';
import {WalkingCameraMotion} from './walkingCamera';
import {airborne} from './player';

/** How quickly the view catches up with a step up onto a platform: most of the way in a tenth of a second. */
const STEP_CATCH_UP = 18;
/** A rise of the feet in one frame bigger than this, standing, is a step up (3 Arena units). */
const STEP_RISE = 3 * ARENA_HEIGHT;
const MOUSE_SENSITIVITY = GAMEPLAY_LOOK.mouse;
const TURN_SPEED = GAMEPLAY_LOOK.keyboardTurn; // radians per second for arrow keys
const STICK_TURN = GAMEPLAY_LOOK.yaw; // radians per second at full right-stick tilt
const STICK_PITCH = GAMEPLAY_LOOK.pitch;
const FOV = 70;
/** Sprinting widens the view by this many degrees. */
const SPRINT_FOV = 7;
/** Seconds from the killing blow to the death screen, and to the screen starting to darken. */
const DEATH_SCREEN = 2.6;
const DEATH_FADE = 1.3;
/** Seconds from stepping through the way out to the screen that follows, while the view fades to black. */
const ESCAPE_SCREEN = 1.1;
/** Creatures hunting the player show on the compass this far away. */
const COMPASS_RANGE = 16;
/** The fog: where it begins and where it hides everything, in voxels, before a Light spell lengthens both. */
const FOG_NEAR = 1.25;
const FOG_FAR = 6.5;
/** The menu's film leaves out creatures this close to its camera, which can pass where one stands. */
const FILM_NEAREST = 0.45;

/** Something in front of the player that they can use, as the HUD shows it. */
export interface HudTarget {
  name: string;
  verb: string;
  /** A second line, such as "Locked". */
  note?: string;
}

export interface Vitals {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  /** Spell points; a max of 0 hides the bar. */
  magicka: number;
  maxMagicka: number;
}

/** The spell in hand, as the HUD shows it. */
export interface ReadiedSpell {
  name: string;
  cost: number;
  colour: string;
}

export interface AbilitySlotView {key?:string;name?:string;icon?:string;cost?:number;cooldown:number;duration:number;available:boolean;}
/** The menus over the game: Skyrim's menu of menus, the item and magic menus, the character sheet and the favourites. */
export type GameMenu = 'tween' | 'items' | 'magic' | 'character' | 'favourites';

/** Something shown on the compass: a creature hunting the player, or where the current objective is. */
export interface CompassMarker {
  kind: 'enemy' | 'quest';
  /** Compass bearing in degrees: 0 north, 90 east. */
  bearing: number;
  /** 1 close by, toward 0 far away. */
  near: number;
}

/** What the engine tells the on-screen HUD. */
export interface EngineHud {
  message(text: string): void;
  resting(text: string | undefined): void;
  target(target: HudTarget | undefined): void;
  heading(yaw: number, markers?: CompassMarker[]): void;
  vitals(v: Vitals): void;
  level?(level:number):void;
  experience?(current:number,required:number):void;
  notify(text: string): void;
  hurt(): void;
  enemy(name: string, health: number, maxHealth: number, id?: number,description?:string,quality?:string): void;
  damageNumbers?(labels: CombatLabel[]): void;
  /** A title across the top: a place, a quest started, a level gained. */
  banner(title: string, kicker?: string, sub?: string): void;
  /** A quest objective given, or done. */
  objective(text: string, done: boolean,questName?:string): void;
  /** Skyrim's sneak eye: how aware the creatures are (0 to 1), or undefined when not sneaking. */
  detection(level: number | undefined): void;
  /** Darkens the screen to `opacity` over `seconds`. */
  fade(opacity: number, seconds: number): void;
  /** The spell in hand, or none. */
  readied(spell: ReadiedSpell | undefined): void;
  abilities?(slots:AbilitySlotView[],quickslot:{key?:string;name:string;icon?:string}|undefined):void;
  /** A spell cast: the hand glows. */
  cast(colour: string): void;
  /** Too few spell points: the magicka bar flashes. */
  noMagicka(): void;
  /** The spells working on the player, such as "Shield (12)". */
  effects(effects: ActiveStatusEffect[]): void;
}

/** The player's settings; shared with the menu, which changes them while the game runs. */
export interface ControlSettings {
  /** Multiplies mouse and stick look speed. */
  lookSpeed: number;
  invertLook: boolean;
  /** Controller rumble. */
  vibration: boolean;
  /** Sound volume, 0 to 1. */
  volume: number;
  /** Music volume, 0 to 1. */
  music: number;
  /** Plays Arena's opening cutscenes when the game folder is opened. */
  intro: boolean;
  graphicsMode?: 'original' | 'remake';
  bumpMaps?: boolean;
  lighting?: boolean;
  shadows?: boolean;
  glow?: boolean;
  specular?: boolean;
  ambientOcclusion?: boolean;
  volumetric?: number;
}

export interface EngineOptions {
  testArea?:TestArea;
  /** Slowly turns the camera with no input; used for the backdrop behind the menu. */
  autopilot?: boolean;
  /** With autopilot: plays this film of the dungeon instead of turning. */
  film?: FilmView;
  pad?: GamepadInput;
  hud?: EngineHud;
  controls?: ControlSettings;
  creatures?: CreatureView;
  weapon?: WeaponView;
  sounds?: SoundBank;
  map?: MapView;
  minimap?: Minimap;
  spells?: SpellView;
  arrows?: ArrowView;
}

/**
 * Runs one dungeon: reads the keyboard, mouse and controller, steps the game,
 * plays its sounds and draws it. The controls follow Skyrim's: on a
 * controller, the left stick moves, the right stick looks, RT attacks (hold
 * for a power attack), LT blocks, A uses things, Y jumps,
 * left-stick click sprints and right-stick click sneaks. X, B, LB and RB
 * cast four assigned spells, D-pad Up uses a favourite and Down opens
 * favourites, View opens the character menus and Start pauses; on a keyboard,
 * the left mouse button attacks and the right one blocks, E uses things,
 * Space jumps, Shift sprints, C sneaks, Q opens the favourites and 1 to 8 use
 * the favourites put on them, Tab opens the menu of menus, I the items, P the
 * magic, M the map and Esc the pause menu.
 */
export class Engine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 100);
  private readonly keys = new Set<string>();
  private readonly graphics: SceneEffects;
  private readonly lighting: SceneLighting;
  private readonly combatText = new CombatText();
  private readonly lootDrops=new LootDropView();
  private running = false;
  private frameRequest = 0;
  private last = 0;
  private sneaking = false;
  private eye = EYE;
  private readonly walkingCamera=new WalkingCameraMotion();
  /** How far the view lags below the feet after a step up, so it rises instead of jumping. */
  private stepLag = 0;
  private lastFeet = 0;
  private targetKey = '';
  private enemy: Creature | undefined;
  private enemyKey = '';
  private enemyHitUntil = 0;
  /**
   * Failed mouse captures in a row. One can be a fluke (asking again right after Esc releases it); after two
   * we take it that the page may not capture the mouse (e.g. some embedded frames) and stay with drag-to-look.
   */
  private pointerLockFailures = 'requestPointerLock' in HTMLElement.prototype ? 0 : 2;
  private dragging = false;
  private dragDistance = 0;
  private mouseHeld = false;
  private blockHeld = false;
  private attackPressed = false;
  private attackReleased = false;
  private readonly attackHold = new AttackHold();
  private readonly impacts = new SurfaceImpactView();
  private mapOpen = false;
  private mapDrag: number | undefined;
  /**
   * Esc is down. Browsers let go of a captured mouse when Esc comes back up,
   * even one captured while it was down (closing the map or the menu with
   * Esc), so capturing waits for it.
   */
  private escapeHeld = false;
  private lockOnEscapeUp = false;
  private diedAt: number | undefined;
  private deathShown = false;
  private deathFaded = false;
  private escapedAt: number | undefined;
  private deathCause: string | undefined;
  private readiedKey = '';
  private padSprinting=false;
  private effectsKey = '';
  onPause?: () => void;
  onLoot?: () => void;
  /** The player asked for one of the menus over the game. */
  onMenu?: (which: GameMenu) => void;
  /** The player died; `cause` is the game's words for how, when there are some. */
  onDeath?: (cause?: string) => void;
  /** T or the View button: the wait menu, as in Skyrim. */
  onWait?: () => void;
  /** Ria comes to the sleeping player; the game plays her visions and carries on. */
  onDream?: (visions: Vision[]) => void;
  onEscape?: () => void;
  /** The map screen opened (true) or closed. */
  onMap?: (open: boolean) => void;
  /** A level was gained, with `health` more health and bonus points to share out (see Dungeon.applyAttributes); without this, a banner says so. */
  onLevelUp?: (gained: { level: number; health: number; points: number }) => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly autopilot: boolean;
  private readonly controls: ControlSettings;

  /** The renderer is shared and outlives the engine; one engine runs at a time. */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly dungeon: Dungeon,
    private readonly levelScene: LevelScene,
    private readonly options: EngineOptions = {},
  ) {
    this.canvas = renderer.domElement;
    this.autopilot = options.autopilot ?? false;
    this.controls = options.controls ?? { lookSpeed: 1, invertLook: false, vibration: true, volume: 1, music: 1, intro: true };
    const canvas = this.canvas;
    this.scene.background = new THREE.Color(0x000000);
    // Arena's dungeons fade to black a few voxels away.
    this.scene.fog = new THREE.Fog(0x000000, this.controls.graphicsMode === 'original' ? 2 : FOG_NEAR, this.controls.graphicsMode === 'original' ? 9 : FOG_FAR);
    this.scene.add(levelScene.group,this.impacts.group);
    this.scene.add(this.lootDrops.group);
    if (options.creatures) this.scene.add(options.creatures.group);
    if (options.spells) this.scene.add(options.spells.group);
    if (options.arrows) this.scene.add(options.arrows.group);
    this.graphics = new SceneEffects(renderer);
    this.lighting = new SceneLighting(renderer, this.scene, dungeon, levelScene);
    this.resize();

    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('keydown', this.onEscapeDown, true);
    window.addEventListener('keyup', this.onEscapeUp, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    if (!this.autopilot && !this.mapOpen) this.lockPointer();
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.running = false;
    this.padSprinting=false;
    cancelAnimationFrame(this.frameRequest);
    this.keys.clear();
    this.mouseHeld = false;
    this.blockHeld = false;
    this.attackPressed = this.attackReleased = false;
    this.attackHold.reset();
  }

  dispose(): void {
    this.pause();
    this.combatText.clear();this.options.hud?.damageNumbers?.([]);
    this.lootDrops.dispose();
    this.options.hud?.target(undefined);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('keydown', this.onEscapeDown, true);
    window.removeEventListener('keyup', this.onEscapeUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.options.map?.dispose();
    this.options.spells?.dispose();
    this.options.arrows?.dispose();
    this.options.weapon?.dispose();
    this.options.film?.dispose();
    this.impacts.dispose();
    this.graphics.dispose();this.lighting.dispose();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map) textures.add(map);
          const normalMap = (m as THREE.MeshStandardMaterial).normalMap;
          if (normalMap) textures.add(normalMap);
          m.dispose();
        }
      }
    });
    for (const t of textures) t.dispose();
  }

  /** Opens the map screen, if there is one and the player is still in the dungeon. */
  openMap(): void {
    const map = this.options.map;
    if (!map || this.mapOpen || this.dungeon.outcome) return;
    this.mapOpen = true;
    this.keys.clear();
    this.mouseHeld = false;
    this.blockHeld = false;
    this.targetKey = '';
    this.options.hud?.target(undefined);
    if (document.pointerLockElement) document.exitPointerLock();
    void map.open();
    this.onMap?.(true);
  }

  closeMap(): void {
    if (!this.mapOpen) return;
    this.mapOpen = false;
    this.mapDrag = undefined;
    this.keys.clear();
    this.onMap?.(false);
    this.lockPointer();
  }

  get mapShown(): boolean {
    return this.mapOpen;
  }

  private frame = (now: number) => {
    if (!this.running) return;
    // The first frame can be stamped a little before the engine started: never a step back in time.
    const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
    this.last = now;
    this.options.pad?.poll(now);
    this.update(dt);
    if (!this.running) return; // paused from a controller button
    this.levelScene.animate(now / 1000);
    this.render(dt);
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const d = this.dungeon;
    if (this.autopilot) {
      if (this.options.film) this.options.film.update(dt);
      else d.player.yaw += 0.12 * dt;
      return;
    }
    if (this.mapOpen) {
      this.updateMap(dt);
      return;
    }
    const pad = this.options.pad;
    const alive = !d.outcome;
    if (pad?.connected) {
      if (pad.take(GAMEPLAY_BUTTON.pause)) {
        this.onPause?.();
        return;
      }
      if (alive && d.camping) {
        // The wait button again, or B, wakes the player, as Arena's camp button does.
        if (pad.take('Down') || pad.take('B')) d.stopCamping();
      } else if (alive) {
        if (pad.take('Back')) {
          this.onMenu?.('tween');
          return;
        }
        if(pad.take('Down')){this.onWait?.();return;}
        if (pad.take(GAMEPLAY_BUTTON.use)) this.activate(true);
        if (pad.take(GAMEPLAY_BUTTON.jump)) this.startJump();
        if (pad.take(GAMEPLAY_BUTTON.sneak)){this.sneaking = !this.sneaking;this.padSprinting=false;}
        if(pad.take(GAMEPLAY_BUTTON.sprint))this.padSprinting=!this.padSprinting;
        if(pad.take('Up'))d.useQuickslot();
        for(const [slot,button] of ['X','B','LB','RB','Left','Right'].entries())if(pad.take(button as 'X'|'B'|'LB'|'RB'|'Left'|'Right'))d.castAbility(slot);
      }
    }

    const k = this.keys;
    const lookSpeed = this.controls.lookSpeed;
    const keyboard = keyboardMovement(k), holds = gamepadHolds(pad);
    let { forward, strafe, sprint } = keyboard;
    const padHeld = holds.attack;
    const block = alive && (this.blockHeld || holds.block);
    const attack = this.attackHold.sample(this.mouseHeld || padHeld, this.attackPressed && this.attackReleased);
    this.attackPressed = this.attackReleased = false;
    if (alive) {
      d.player.yaw += keyboard.turn * TURN_SPEED * dt;
      if (pad?.connected) {
        forward -= pad.move.y;
        strafe += pad.move.x;
        sprint ||= this.padSprinting;
        // Squared response: fine aim near the centre, quick turns at full tilt.
        const { x, y } = pad.look;
        d.player.yaw += x * Math.abs(x) * STICK_TURN * lookSpeed * dt;
        this.tilt(-y * Math.abs(y) * STICK_PITCH * lookSpeed * dt);
      }
      if(!pad?.connected||!forward&&!strafe||d.stats.stamina<=0)this.padSprinting=false;
      // Sprinting stands you up, as in Skyrim.
      if (sprint && (forward !== 0 || strafe !== 0)) this.sneaking = false;
    }
    const eye = d.outcome === 'dead' ? DEAD_EYE : d.swimming ? SWIM_EYE : this.sneaking ? SNEAK_EYE : EYE;
    this.eye += (eye - this.eye) * Math.min(1, dt * (d.outcome ? 3 : 10));
    d.viewEyeOffset=Math.min(this.eye+this.stepLag+this.walkingCamera.value.lift,
      ceilingHeight(d.level.cells[cellIndex(d.level,d.player.x,d.player.y)],d.level)-.03-(d.player.z??0));
    d.viewSideOffset=this.walkingCamera.value.side;
    d.update(dt, { forward, strafe, sprint, sneaking: this.sneaking, block, guardOnly:true, attack });
    this.options.testArea?.update(dt);
    this.playEvents();
    this.impacts.update(dt);
    // The feet go up a step at once; the view follows them up smoothly.
    const feet = d.player.z ?? 0;
    if (feet - this.lastFeet > STEP_RISE && !(d.player.vz ?? 0)) this.stepLag -= feet - this.lastFeet;
    this.stepLag *= Math.exp(-STEP_CATCH_UP * dt);
    this.lastFeet = feet;
    this.walkingCamera.update(dt,d.walked,{grounded:!d.outcome&&!d.swimming&&!d.climb&&!airborne(d.level,d.player),sprinting:d.running,sneaking:d.sneaking,aiming:d.blocking||!!(d.stats.weapon.bow&&d.swing)});

    for (const [index, door] of d.doors) {
      const mesh = this.levelScene.doors.get(index);
      if (mesh) poseDoor(mesh, door.open, d.level.height, { x: d.player.x, z: d.player.y });
    }
    for (const item of d.items) {
      const sprite = this.levelScene.items[item.id];
      if (sprite) sprite.visible = !item.taken;
    }

    const hud = this.options.hud;
    if (hud) {
      const s = d.stats;
      this.showEnemy();
      hud.level?.(s.level);
      const floor=experienceFor(s.level,d.hero.experience),next=experienceFor(s.level+1,d.hero.experience);
      hud.experience?.(Math.max(0,s.experience-floor),Math.max(1,next-floor));
      hud.vitals({ health: s.health, maxHealth: s.maxHealth, stamina: s.stamina, maxStamina: s.maxStamina, magicka: s.magicka, maxMagicka: s.maxMagicka });
      const quick=d.hotbarEntry(0);
      hud.abilities?.(Array.from({length:6},(_,i)=>{
        const entry=d.hotbarEntry(i+1),spell=entry?.spell,itemSpell=d.spellRecord(entry?.item?.spell);
        return {key:entry?.key,name:entry?.name,icon:spell?abilityIcon(spell):itemSpell?abilityIcon(itemSpell):entry?.item?.kind==='potion'?'regeneration':undefined,cost:spell&&d.spellCost(spell),cooldown:spell?d.spellCooldown:0,duration:d.spellCooldownDuration,available:spell?d.canCast(spell):!!entry&&!d.outcome};
      }),quick&&{key:quick.key,name:quick.name,icon:quick.spell?abilityIcon(quick.spell):d.spellRecord(quick.item?.spell)?abilityIcon(d.spellRecord(quick.item?.spell)!):quick.item?.kind==='potion'?'regeneration':undefined});
      const spell = d.readied;
      const readiedKey = spell ? `${spell.index}:${d.spellCost(spell)}` : '';
      if (readiedKey !== this.readiedKey) {
        this.readiedKey = readiedKey;
        hud.readied(spell && { name: spell.name, cost: d.spellCost(spell), colour: spellColour(spell) });
      }
      const effects = d.statusEffects();
      const effectsKey = statusEffectsKey(effects);
      if (effectsKey !== this.effectsKey) {
        this.effectsKey = effectsKey;
        hud.effects(effects);
      }
      hud.detection(d.sneaking ? d.detection() : undefined);
      if (d.camping) hud.resting(d.campingText);
      this.showTarget();
    }
    if (this.diedAt !== undefined && !this.deathFaded && d.time - this.diedAt > DEATH_SCREEN - DEATH_FADE) {
      this.deathFaded = true;
      hud?.fade(0.85, DEATH_FADE);
    }
    if (d.outcome === 'dead' && !this.deathShown && this.diedAt !== undefined && d.time - this.diedAt > DEATH_SCREEN) {
      this.deathShown = true;
      this.onDeath?.(this.deathCause);
    }
    if (this.escapedAt !== undefined && d.time - this.escapedAt > ESCAPE_SCREEN) {
      this.escapedAt = undefined;
      this.onEscape?.();
    }
  }

  /** Plays out what happened in the dungeon this frame: sounds, messages, hits. */
  private playEvents(): void {
    const d = this.dungeon;
    const p = d.player;
    const listener = { x: p.x, y: p.y, yaw: p.yaw };
    const hud = this.options.hud;
    for (const e of d.events.splice(0)) {
      switch (e.type) {
        case 'terrainChanged':
          void this.levelScene.refreshTerrain?.();
          break;
        case 'loot':
          this.onLoot?.();
          break;
        case 'sound': {
          // Sounds from behind walls are muffled.
          const heard = e.at && !lineOfSight(d.level, p.x, p.y, e.at.x, e.at.y, d.openDoors) ? 0.45 : 1;
          this.options.sounds?.play(e.name, { volume: e.volume, from: e.at, listener, heard });
          break;
        }
        case 'message':
          hud?.message(e.text);
          break;
        case 'notify':
          hud?.notify(e.text);
          break;
        case 'hurt':
          hud?.hurt();
          this.rumble(220, 0.7, 0.7);
          break;
        case 'blocked':
          this.rumble(90, 0.35, 0.2);
          break;
        case 'surfaceImpact':
          this.impacts.burst(e.material,e.point,e.normal);
          break;
        case 'weaponImpact':
          this.options.weapon?.impact(e.material, e.bash);
          this.rumble(70, 0.25, 0.15);
          break;
        case 'hit':
          {
            const c=e.creature,cell=d.level.cells[cellIndex(d.level,c.x,c.y)];
            const height=Math.max(0,floorHeight(cell,d.level))+(c.collisionHeight??.6)+c.info.lift*ARENA_HEIGHT;
            this.combatText.add(e.appliedDamage??e.damage,[c.x,height,c.y],d.time,e.damageKind,e.critical,e.periodic);
          }
          this.enemy = e.creature;
          this.enemyHitUntil = d.time + .35;
          this.updateEnemyBar(true);
          // Blood splashes on the view only for a blow struck close by.
          if (!e.far) {
            this.options.weapon?.splash();
            this.rumble(80, 0.1, 0.3);
          }
          break;
        case 'bashed':
          this.enemy = e.creature;
          this.enemyHitUntil = d.time + .35;
          this.updateEnemyBar(true);
          this.rumble(110, 0.4, 0.2);
          break;
        case 'cast':
          hud?.cast(spellColour(e.spell));
          this.rumble(70, 0.15, 0.35);
          break;
        case 'burst':
          this.options.spells?.burst(e.spell, e.at.x, e.at.y, (d.player.z ?? 0) + this.eye * 0.85, e.radius);
          break;
        case 'noMagicka':
          hud?.noMagicka();
          break;
        case 'levelUp':
          if (this.onLevelUp) this.onLevelUp(e);
          else hud?.banner(`Level ${e.level}`, 'Level up', `Health +${e.health}`);
          break;
        case 'questStarted':
          hud?.banner(e.name, 'Quest started');
          break;
        case 'objective':
          hud?.objective(e.text,e.done,d.quest?.name);
          break;
        case 'cleared':
          hud?.banner(d.level.name, undefined, 'Cleared');
          break;
        case 'camping':
          hud?.resting(d.campingText);
          break;
        case 'camped':
          hud?.resting(undefined);
          if (e.text) hud?.message(e.text);
          break;
        case 'despawned':
          this.options.creatures?.remove(e.creature);
          break;
        case 'spawned':
          void this.options.creatures?.add(e.creature);
          break;
        case 'dream':
          this.onDream?.(e.visions);
          break;
        case 'died':
          this.diedAt = d.time;
          this.deathCause = e.cause;
          this.sneaking = false;
          break;
        case 'escaped':
          this.escapedAt = d.time;
          this.sneaking = false;
          hud?.fade(1, ESCAPE_SCREEN * 0.85);
          break;
        default:
          break;
      }
    }
  }

  private updateMap(dt: number): void {
    const map = this.options.map!;
    const pad = this.options.pad;
    if (pad?.connected) {
      if (pad.take('B') || pad.take('Back') || pad.take(GAMEPLAY_BUTTON.pause)) {
        this.closeMap();
        return;
      }
      map.move(pad.move.x * dt * 4, -pad.move.y * dt * 4);
      map.turn(pad.look.x * Math.abs(pad.look.x) * dt * 2.2, pad.look.y * Math.abs(pad.look.y) * dt * 1.6);
      const zoom = pad.triggers.left - pad.triggers.right;
      if (zoom) map.zoom(Math.exp(zoom * dt * 1.8));
    }
    const k = this.keys;
    const axis = (plus: string[], minus: string[]) => (plus.some((c) => k.has(c)) ? 1 : 0) - (minus.some((c) => k.has(c)) ? 1 : 0);
    map.move(axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) * dt * 4, axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) * dt * 4);
    map.turn(axis(['KeyE'], ['KeyQ']) * dt * 1.8, axis(['KeyR'], ['KeyF']) * dt * 1.2);
    const zoom = axis(['Minus', 'NumpadSubtract'], ['Equal', 'NumpadAdd']);
    if (zoom) map.zoom(Math.exp(zoom * dt * 1.8));
  }

  private render(dt = 0): void {
    if (this.mapOpen && this.options.map) {
      this.options.map.render(this.renderer, dt);
      return;
    }
    this.graphics.begin(this.controls);
    if (this.options.film) {
      let active: THREE.Camera | undefined;
      this.options.film.render(this.renderer, this.scene, camera => {
        active = camera; this.face(camera, FILM_NEAREST); this.lighting.update(camera, this.controls, dt);
      });
      if (active instanceof THREE.PerspectiveCamera) this.graphics.applyWorld(active, this.controls);
      this.graphics.present(this.controls, dt, false);
      return;
    }
    const d = this.dungeon;
    const p = d.player;
    const h = ceilingHeight(d.level.cells[cellIndex(d.level,p.x,p.y)],d.level);
    // The eye rides on the feet: up on platforms and in jumps, down in water and pits.
    const bob=this.walkingCamera.value;
    const eye = Math.min((p.z ?? 0) + this.stepLag + this.eye + bob.lift, h - 0.03);
    // Sprinting widens the view a little, as in Skyrim.
    const fov = FOV + (d.running ? SPRINT_FOV : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
    const viewX=p.x-Math.sin(p.yaw)*bob.side,viewZ=p.y+Math.cos(p.yaw)*bob.side;
    this.camera.position.set(viewX, eye, viewZ);
    const cp = Math.cos(p.pitch);
    this.camera.lookAt(viewX + Math.cos(p.yaw) * cp, eye + Math.sin(p.pitch), viewZ + Math.sin(p.yaw) * cp);
    this.camera.rotateZ(bob.roll);
    this.camera.updateMatrixWorld(true);
    this.options.hud?.damageNumbers?.(this.combatText.frame(d.time,point=>{
      const projected=new THREE.Vector3(...point).project(this.camera);
      return {x:(projected.x+1)*.5*this.canvas.clientWidth,y:(1-projected.y)*.5*this.canvas.clientHeight,
        visible:projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<1.05&&Math.abs(projected.y)<1.1&&lineOfSight(d.level,p.x,p.y,point[0],point[2],d.openDoors)};
    }));
    this.face(this.camera);
    this.options.spells?.update(d.bolts, eye * 0.85, dt);
    this.options.arrows?.update(d.arrows, eye * 0.85, dt);
    this.lootDrops.update(d.lootDrops(),d.time);
    // A Light spell lets the player see further into the dark.
    const fog = this.scene.fog as THREE.Fog;
    const reach = d.lightReach;
    const original = this.controls.graphicsMode === 'original';
    fog.near += ((original ? 2 : FOG_NEAR) * reach - fog.near) * Math.min(1, dt * 2);
    fog.far += ((original ? 9 : FOG_FAR) * reach - fog.far) * Math.min(1, dt * 2);
    const lowered = this.diedAt === undefined ? 0 : Math.min(1, (d.time - this.diedAt) / 0.8);
    this.options.weapon?.setEnvironment({
      toWorld: (point) => point.clone().multiplyScalar(METRES_TO_WORLD).applyMatrix4(this.camera.matrixWorld).toArray(),
      toView: (point) => new THREE.Vector3(...point).applyMatrix4(this.camera.matrixWorld.clone().invert()).divideScalar(METRES_TO_WORLD),
      sweep: (from, to) => sweepTerrain(d.level, d.openDoors, from, to, d.surfaceMaterials),
      sphere: (point, radius) => terrainSphere(d.level, d.openDoors, point, radius),
      contact: (hit, swing) => d.meleeTerrainContact(hit, swing),
    });
    this.options.weapon?.draw(d.stats.weapon, { swing: d.swing, charging: d.attackCharging, walked: d.walked, lowered, guard: d.blocking, dt, look: { yaw: p.yaw, pitch: p.pitch }, sneaking: d.sneaking,
      arrowReady:
        !d.stats.weapon.bow || d.stats.weapon.material !== 1 || d.inventory.steelArrowCount() > 0 || (!!d.swing && !d.swing.struck),
    });
    this.options.minimap?.draw();
    this.options.hud?.heading(p.yaw, this.compassMarkers());
    this.lighting.update(this.camera, this.controls, dt);
    this.renderer.render(this.scene, this.camera);
    this.graphics.applyWorld(this.camera, this.controls);
    this.options.weapon?.render(this.renderer, this.controls.bumpMaps !== false);
    this.graphics.present(this.controls, dt, !this.autopilot);
  }

  async refreshGraphics(): Promise<void> {
    await this.levelScene.setGraphicsMode?.(this.controls.graphicsMode ?? 'remake');
    const fog=this.scene.fog as THREE.Fog, original=this.controls.graphicsMode==='original';
    fog.near=(original?2:FOG_NEAR)*this.dungeon.lightReach;fog.far=(original?9:FOG_FAR)*this.dungeon.lightReach;
    this.render();
  }

  /** Turns the flat sprites and the creatures towards `camera`, leaving out creatures nearer it than `nearest`. */
  private face(camera: THREE.Camera, nearest = 0): void {
    for (const b of this.levelScene.billboards) {
      b.rotation.y = Math.atan2(camera.position.x - b.position.x, camera.position.z - b.position.z);
    }
    this.options.creatures?.update(camera.position, nearest);
  }

  /** Creatures hunting the player, and the current objective, for the compass. */
  private compassMarkers(): CompassMarker[] {
    const d = this.dungeon;
    const p = d.player;
    const markers: CompassMarker[] = [];
    const bearing = (x: number, y: number) => ((Math.atan2(y - p.y, x - p.x) * 180) / Math.PI + 90 + 360) % 360;
    if (d.outcome) return markers;
    for (const c of d.creatures) {
      if (!isAlive(c) || (c.state !== 'chase' && c.state !== 'attack')) continue;
      const dist = Math.hypot(c.x - p.x, c.y - p.y);
      if (dist > COMPASS_RANGE) continue;
      markers.push({ kind: 'enemy', bearing: bearing(c.x, c.y), near: 1 - dist / COMPASS_RANGE });
    }
    const goal = d.objective?.marker;
    if (goal) markers.push({ kind: 'quest', bearing: bearing(goal.x, goal.y), near: 1 });
    return markers;
  }

  /** Moves the player; used by the dev console and browser tests. */
  teleport(x: number, y: number, yaw = this.dungeon.player.yaw): void {
    Object.assign(this.dungeon.player, { x, y, yaw, pitch: 0 });
  }

  /** Follow the actual creature under the crosshair, retaining the last hit briefly when looking away. */
  private showEnemy(): void {
    const d = this.dungeon, p = d.player;
    const height = Math.min((p.z ?? 0) + (d.viewEyeOffset ?? this.eye),
      ceilingHeight(d.level.cells[cellIndex(d.level,p.x,p.y)],d.level) - .03);
    const from: [number,number,number] = [p.x,height,p.y], cp = Math.cos(p.pitch);
    const to: [number,number,number] = [p.x+Math.cos(p.yaw)*cp*COMPASS_RANGE,
      height+Math.sin(p.pitch)*COMPASS_RANGE,p.y+Math.sin(p.yaw)*cp*COMPASS_RANGE];
    const hit = sweepCreatures(d.level,d.creatures,from,to);
    const terrain = hit && sweepTerrain(d.level,d.openDoors,from,hit.point,d.surfaceMaterials);
    const aimed = hit && !terrain ? d.creatures.find(c=>c.id===hit.creature&&isAlive(c)) : undefined;
    // A wide melee arc can hit a different creature than the reticle. Show that hit before following aim again.
    const followAim = !!aimed && (aimed === this.enemy || d.time >= this.enemyHitUntil);
    if (followAim) this.enemy = aimed;
    if (this.enemy && !d.creatures.includes(this.enemy)) this.enemy = undefined;
    this.updateEnemyBar(followAim);
  }

  private updateEnemyBar(aimed = false): void {
    const c = this.enemy;
    if (!c) return;
    const key = `${c.id}:${c.health}:${c.maxHealth}`;
    if (!aimed && key === this.enemyKey) return;
    this.enemyKey = key;
    this.options.hud?.enemy(creatureName(c),c.health,c.maxHealth,c.id,eliteDescription(c),c.elite?.tier);
  }

  /** Tells the HUD what the player can use, when it changes. */
  private showTarget(): void {
    const t = this.dungeon.target();
    const key = t ? `${t.kind}:${t.id}:${t.verb}:${t.note ?? ''}` : '';
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.options.hud?.target(t);
  }

  private activate(fromPad = false): void {
    if (!this.dungeon.target()) return;
    this.dungeon.activate();
    if (fromPad) this.rumble();
  }

  private rumble(ms?: number, strong?: number, weak?: number): void {
    if (this.controls.vibration && this.options.pad?.connected) this.options.pad.rumble(ms, strong, weak);
  }

  private startJump(): void {
    if (this.dungeon.jump()) this.sneaking = false;
  }

  private tilt(amount: number): void {
    const p = this.dungeon.player;
    p.pitch = clamp(p.pitch + (this.controls.invertLook ? -amount : amount), -GAMEPLAY_LOOK.limit, GAMEPLAY_LOOK.limit);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Resizing clears the canvas, so redraw the paused view behind the menu.
    if (!this.running) this.render();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // A key the menu already handled, such as the Esc that closed it, isn't for the game.
    if (!this.running || this.autopilot || e.defaultPrevented) return;
    const testing=this.options.testArea;
    if(testing?.mode==='effects' && ['F6','F7','F8','F9','F10'].includes(e.code)){
      e.preventDefault();if(e.repeat)return;
      if(e.code==='F6')testing.addBuff();else if(e.code==='F7')testing.addDebuff();else if(e.code==='F8')testing.clearEffects();else if(e.code==='F9')testing.toggleAutoBuffs();else testing.toggleAutoDebuffs();
      return;
    }
    if (this.mapOpen) {
      if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyM') {
        e.preventDefault();
        this.closeMap();
        return;
      }
      this.keys.add(e.code);
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      this.onPause?.();
      return;
    }
    const menu = MENU_KEYS.get(e.code);
    if (menu) {
      // Tab would otherwise move the focus about the page.
      e.preventDefault();
      if (!this.dungeon.outcome) this.onMenu?.(menu);
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'Space') e.preventDefault(); // don't scroll or press a focused button
    if (e.repeat || this.dungeon.outcome) return;
    const hotbar=/^(?:Digit|Numpad)([1-7])$/.exec(e.code);
    if(hotbar){
      e.preventDefault();const slot=HOTBAR_ORDER[Number(hotbar[1])-1];
      if(slot===0)this.dungeon.useQuickslot();else this.dungeon.castAbility(slot-1);
    }
    else if (e.code === 'KeyE') this.activate();
    else if (e.code === 'Space') this.startJump();
    else if (e.code === 'KeyC') this.sneaking = !this.sneaking;
    else if (e.code === 'KeyM') this.openMap();
    else if (e.code === 'KeyT') {
      if (this.dungeon.camping) this.dungeon.stopCamping();
      else this.onWait?.();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private onEscapeDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') this.escapeHeld = true;
  };

  private onEscapeUp = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    this.escapeHeld = false;
    if (!this.lockOnEscapeUp) return;
    this.lockOnEscapeUp = false;
    if (this.running && !this.autopilot && !this.mapOpen && !this.dungeon.outcome) this.lockPointer();
  };

  /** Keys held while the window loses focus never send keyup, so forget them. */
  private onBlur = () => {
    this.keys.clear();
    this.padSprinting=false;
    this.escapeHeld = this.lockOnEscapeUp = false;
    if (this.mouseHeld) this.attackReleased = true;
    this.mouseHeld = false;
    this.blockHeld = false;
  };

  private get pointerLockFailed(): boolean {
    return this.pointerLockFailures >= 2;
  }

  private lockPointer(): void {
    if(this.options.testArea?.mode==='effects')return;
    if (this.pointerLockFailed) return;
    if (this.escapeHeld) {
      this.lockOnEscapeUp = true;
      return;
    }
    // Capturing the mouse needs a click or key press; a controller button doesn't count, so don't ask.
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return;
    try {
      const result = this.canvas.requestPointerLock?.() as unknown;
      // A refusal also fires 'pointerlockerror', which does the counting.
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      this.onPointerLockError();
    }
  }

  private look(dx: number, dy: number): void {
    // Arena doesn't let the player move or turn while camping.
    if (this.dungeon.camping) return;
    const speed = MOUSE_SENSITIVITY * this.controls.lookSpeed;
    this.dungeon.player.yaw += dx * speed;
    this.tilt(-dy * speed);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.running) return;
    if (this.mapOpen) {
      if (this.mapDrag === undefined) return;
      // Left drag turns and tilts the map; right drag (or Shift) moves it.
      if (this.mapDrag === 2 || e.shiftKey) this.options.map?.move(-e.movementX * 0.02, e.movementY * 0.02);
      else this.options.map?.turn(e.movementX * 0.006, e.movementY * 0.005);
      return;
    }
    if (this.dungeon.outcome) return;
    if (document.pointerLockElement === this.canvas) this.look(e.movementX, e.movementY);
    else if (this.dragging) {
      // Drag-to-look when the mouse can't be captured.
      this.look(e.movementX, e.movementY);
      this.dragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.running || this.autopilot) return;
    if (this.mapOpen) {
      this.mapDrag = e.button;
      return;
    }
    // The right button blocks.
    if (e.button === 2) {
      this.blockHeld = true;
      return;
    }
    if (e.button !== 0) return;
    if (document.pointerLockElement === this.canvas) {
      this.mouseHeld = true;
      this.attackPressed = true;
      return;
    }
    this.dragging = true;
    this.dragDistance = 0;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (this.mapOpen) {
      this.mapDrag = undefined;
      return;
    }
    if (e.button === 2) this.blockHeld = false;
    if (e.button !== 0) return;
    if (this.mouseHeld) {
      this.mouseHeld = false;
      this.attackReleased = true;
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.running || this.dragDistance > 4) return;
    // A plain click: capture the mouse if we can, otherwise treat it as an attack.
    if (this.pointerLockFailed || this.options.testArea?.mode==='effects') this.attackPressed = this.attackReleased = true;
    else this.lockPointer();
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.mapOpen) return;
    e.preventDefault();
    this.options.map?.zoom(Math.exp(Math.sign(e.deltaY) * 0.15));
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerLockError = () => {
    this.pointerLockFailures++;
  };

  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.canvas) this.pointerLockFailures = 0;
    // Losing pointer lock (Esc) opens the menu, like pausing; the map lets the mouse go on purpose.
    else if (this.running && !this.autopilot && !this.mapOpen && !this.dungeon.outcome) this.onPause?.();
  };
}

/** Keys that open the menus over the game, as in Skyrim. */
const MENU_KEYS = new Map<string, GameMenu>([
  ['Tab', 'tween'],
  ['KeyI', 'items'],
  ['KeyP', 'magic'],
]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
