import * as THREE from 'three';
import type { SoundBank } from '../audio/sound';
import type { GamepadInput } from '../input/gamepad';
import type { CreatureView } from '../render/creatureView';
import { poseDoor, type LevelScene } from '../render/levelScene';
import type { MapView } from '../render/mapView';
import { spellColour, type SpellView } from '../render/spellView';
import type { WeaponView } from '../render/weaponView';
import type { Minimap } from '../ui/minimap';
import { isAlive } from './creatures';
import type { Dungeon, Vision } from './dungeon';
import { lineOfSight } from './grid';
import { ARENA_HEIGHT } from './level';

/** Eye height above the feet: Arena's 60 units (OpenTESArena); lower when sneaking, as Skyrim crouches, and on the floor when dead. */
const EYE = 60 * ARENA_HEIGHT;
const SNEAK_EYE = 40 * ARENA_HEIGHT;
const DEAD_EYE = 10 * ARENA_HEIGHT;
const MOUSE_SENSITIVITY = 0.0022;
const TURN_SPEED = 2.4; // radians per second for arrow keys
const STICK_TURN = 3.2; // radians per second at full right-stick tilt
const STICK_PITCH = 2;
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
const FOG_NEAR = 1.5;
const FOG_FAR = 9;

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
  notify(text: string): void;
  hurt(): void;
  enemy(name: string, health: number, maxHealth: number): void;
  /** A title across the top: a place, a quest started, a level gained. */
  banner(title: string, kicker?: string, sub?: string): void;
  /** A quest objective given, or done. */
  objective(text: string, done: boolean): void;
  /** Skyrim's sneak eye: how aware the creatures are (0 to 1), or undefined when not sneaking. */
  detection(level: number | undefined): void;
  /** Darkens the screen to `opacity` over `seconds`. */
  fade(opacity: number, seconds: number): void;
  /** The spell in hand, or none. */
  readied(spell: ReadiedSpell | undefined): void;
  /** A spell cast: the hand glows. */
  cast(colour: string): void;
  /** Too few spell points: the magicka bar flashes. */
  noMagicka(): void;
  /** The spells working on the player, such as "Shield (12)". */
  effects(names: string[]): void;
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
}

export interface EngineOptions {
  /** Slowly turns the camera with no input; used for the backdrop behind the menu. */
  autopilot?: boolean;
  pad?: GamepadInput;
  hud?: EngineHud;
  controls?: ControlSettings;
  creatures?: CreatureView;
  weapon?: WeaponView;
  sounds?: SoundBank;
  map?: MapView;
  minimap?: Minimap;
  spells?: SpellView;
}

/**
 * Runs one dungeon: reads the keyboard, mouse and controller, steps the game,
 * plays its sounds and draws it. The controls follow Skyrim's: on a
 * controller, the left stick moves, the right stick looks, RT attacks (hold
 * for a power attack), LT blocks, A uses things, Y jumps, LB sprints,
 * clicking the left stick sneaks, up or down on the D-pad opens the
 * favourites and left or right uses the two favourites put there, B opens
 * the menu of menus, View the map and Start the pause menu; on a keyboard,
 * the left mouse button attacks and the right one blocks, E uses things,
 * Space jumps, Shift sprints, C sneaks, Q opens the favourites and 1 to 8 use
 * the favourites put on them, Tab opens the menu of menus, I the items, P the
 * magic, M the map and Esc the pause menu.
 */
export class Engine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 100);
  private readonly keys = new Set<string>();
  private running = false;
  private frameRequest = 0;
  private last = 0;
  private sneaking = false;
  private eye = EYE;
  private targetKey = '';
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
  private padAttackHeld = false;
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
  private effectsKey = '';
  onPause?: () => void;
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
    this.scene.fog = new THREE.Fog(0x000000, FOG_NEAR, FOG_FAR);
    this.scene.add(levelScene.group);
    if (options.creatures) this.scene.add(options.creatures.group);
    if (options.spells) this.scene.add(options.spells.group);
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
    cancelAnimationFrame(this.frameRequest);
    this.keys.clear();
    this.mouseHeld = false;
    this.blockHeld = false;
  }

  dispose(): void {
    this.pause();
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
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map) textures.add(map);
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
    const dt = Math.min((now - this.last) / 1000, 0.1);
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
      d.player.yaw += 0.12 * dt;
      return;
    }
    if (this.mapOpen) {
      this.updateMap(dt);
      return;
    }
    const pad = this.options.pad;
    const alive = !d.outcome;
    if (pad?.connected) {
      if (pad.take('Start')) {
        this.onPause?.();
        return;
      }
      if (alive && d.camping) {
        // The wait button again, or B, wakes the player, as Arena's camp button does.
        if (pad.take('Back') || pad.take('B')) d.stopCamping();
      } else if (alive) {
        if (pad.take('Back')) {
          this.onWait?.();
          return;
        }
        const menu = pad.take('B') ? 'tween' : pad.take('Up') || pad.take('Down') ? 'favourites' : undefined;
        if (menu) {
          this.onMenu?.(menu);
          return;
        }
        if (pad.take('A')) this.activate(true);
        if (pad.take('Y')) this.startJump();
        if (pad.take('LS')) this.sneaking = !this.sneaking;
        if (pad.take('Left')) d.hotkey(0);
        if (pad.take('Right')) d.hotkey(1);
      }
    }

    const k = this.keys;
    const lookSpeed = this.controls.lookSpeed;
    let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const padHeld = !!pad?.connected && pad.held('RT');
    const block = alive && (this.blockHeld || (!!pad?.connected && pad.triggers.left > 0.35));
    const attack = {
      held: this.mouseHeld || padHeld,
      pressed: this.attackPressed || (padHeld && !this.padAttackHeld),
      released: this.attackReleased || (!padHeld && this.padAttackHeld),
    };
    this.padAttackHeld = padHeld;
    this.attackPressed = this.attackReleased = false;
    if (alive) {
      d.player.yaw += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * TURN_SPEED * dt;
      if (pad?.connected) {
        forward -= pad.move.y;
        strafe += pad.move.x;
        sprint ||= pad.held('LB');
        // Squared response: fine aim near the centre, quick turns at full tilt.
        const { x, y } = pad.look;
        d.player.yaw += x * Math.abs(x) * STICK_TURN * lookSpeed * dt;
        this.tilt(-y * Math.abs(y) * STICK_PITCH * lookSpeed * dt);
      }
      // Sprinting stands you up, as in Skyrim.
      if (sprint && (forward !== 0 || strafe !== 0)) this.sneaking = false;
    }
    d.update(dt, { forward, strafe, sprint, sneaking: this.sneaking, block, attack });
    this.playEvents();
    const eye = d.outcome === 'dead' ? DEAD_EYE : this.sneaking ? SNEAK_EYE : EYE;
    this.eye += (eye - this.eye) * Math.min(1, dt * (d.outcome ? 3 : 10));

    for (const [index, door] of d.doors) {
      const mesh = this.levelScene.doors.get(index);
      if (mesh) poseDoor(mesh, door.open, d.level.height);
    }
    for (const item of d.items) {
      const sprite = this.levelScene.items[item.id];
      if (sprite) sprite.visible = !item.taken;
    }

    const hud = this.options.hud;
    if (hud) {
      const s = d.stats;
      hud.vitals({ health: s.health, maxHealth: s.maxHealth, stamina: s.stamina, maxStamina: s.maxStamina, magicka: s.magicka, maxMagicka: s.maxMagicka });
      const spell = d.readied;
      const readiedKey = spell ? `${spell.index}:${d.spellCost(spell)}` : '';
      if (readiedKey !== this.readiedKey) {
        this.readiedKey = readiedKey;
        hud.readied(spell && { name: spell.name, cost: d.spellCost(spell), colour: spellColour(spell) });
      }
      const effects = d.activeEffects();
      if (effects.join('|') !== this.effectsKey) {
        this.effectsKey = effects.join('|');
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
        case 'hit':
          hud?.enemy(e.creature.info.name, e.creature.health, e.creature.maxHealth);
          this.options.weapon?.splash();
          this.rumble(80, 0.1, 0.3);
          break;
        case 'bashed':
          hud?.enemy(e.creature.info.name, e.creature.health, e.creature.maxHealth);
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
          hud?.banner(`Level ${e.level}`, 'Level up', `Health +${e.health} · Stamina +${e.stamina}`);
          break;
        case 'questStarted':
          hud?.banner(e.name, 'Quest started');
          break;
        case 'objective':
          hud?.objective(e.text, e.done);
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
      if (pad.take('B') || pad.take('Back') || pad.take('Start')) {
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
    const d = this.dungeon;
    const p = d.player;
    const h = d.level.height;
    // The eye rides on the feet: up on platforms and in jumps, down in water and pits.
    const eye = Math.min((p.z ?? 0) + this.eye, h - 0.03);
    // Sprinting widens the view a little, as in Skyrim.
    const fov = FOV + (d.running ? SPRINT_FOV : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(p.x, eye, p.y);
    const cp = Math.cos(p.pitch);
    this.camera.lookAt(p.x + Math.cos(p.yaw) * cp, eye + Math.sin(p.pitch), p.y + Math.sin(p.yaw) * cp);
    for (const b of this.levelScene.billboards) {
      b.rotation.y = Math.atan2(this.camera.position.x - b.position.x, this.camera.position.z - b.position.z);
    }
    this.options.creatures?.update(this.camera.position);
    this.options.spells?.update(d.bolts, eye * 0.85, dt);
    // A Light spell lets the player see further into the dark.
    const fog = this.scene.fog as THREE.Fog;
    const reach = d.lightReach;
    fog.near += (FOG_NEAR * reach - fog.near) * Math.min(1, dt * 2);
    fog.far += (FOG_FAR * reach - fog.far) * Math.min(1, dt * 2);
    const lowered = this.diedAt === undefined ? 0 : Math.min(1, (d.time - this.diedAt) / 0.8);
    this.options.weapon?.draw(d.stats.weapon.cif, { swing: d.swing, walked: d.walked, lowered, guard: d.blocking, dt });
    this.options.minimap?.draw();
    this.options.hud?.heading(p.yaw, this.compassMarkers());
    this.renderer.render(this.scene, this.camera);
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
    p.pitch = clamp(p.pitch + (this.controls.invertLook ? -amount : amount), -1.2, 1.2);
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
    const hotkey = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (hotkey) this.dungeon.hotkey(Number(hotkey[1]) - 1);
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
    this.escapeHeld = this.lockOnEscapeUp = false;
    if (this.mouseHeld) this.attackReleased = true;
    this.mouseHeld = false;
    this.blockHeld = false;
  };

  private get pointerLockFailed(): boolean {
    return this.pointerLockFailures >= 2;
  }

  private lockPointer(): void {
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
    // The right button blocks, as in Skyrim.
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
    if (this.pointerLockFailed) this.attackPressed = this.attackReleased = true;
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
  ['KeyQ', 'favourites'],
]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
