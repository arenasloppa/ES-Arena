import * as THREE from 'three';
import type { Level } from './level';
import { cellIndex, doorInFront, startJump, step, stepJump, type Jump, type PlayerState } from './player';
import type { LevelScene } from '../render/levelScene';
import type { GamepadInput } from '../input/gamepad';

const EYE = 0.55; // eye height as a fraction of room height
const SNEAK_EYE = 0.36;
const MOUSE_SENSITIVITY = 0.0022;
const TURN_SPEED = 2.4; // radians per second for arrow keys
const STICK_TURN = 3.2; // radians per second at full right-stick tilt
const STICK_PITCH = 2;
const DOOR_SPEED = 1.6; // fraction per second
const SNEAK_SPEED = 0.5;
const JUMP_APEX = 0.22; // fraction of room height
const JUMP_TIME = 0.55; // seconds from take-off to landing

/** Something under the crosshair that the player can use. */
export interface Target {
  name: string;
  verb: string;
}

/** What the engine tells the on-screen HUD. */
export interface EngineHud {
  message(text: string): void;
  target(target: Target | undefined): void;
  heading(yaw: number): void;
}

/** The player's settings; shared with the menu, which changes them while the game runs. */
export interface ControlSettings {
  /** Multiplies mouse and stick look speed. */
  lookSpeed: number;
  invertLook: boolean;
  /** Controller rumble. */
  vibration: boolean;
}

export interface EngineOptions {
  /** Slowly turns the camera with no input; used for the backdrop behind the menu. */
  autopilot?: boolean;
  pad?: GamepadInput;
  hud?: EngineHud;
  controls?: ControlSettings;
}

/**
 * Runs one level: input, movement, doors, triggers and rendering. The controls follow
 * Skyrim's where the game has the action: on a controller, left stick moves, right
 * stick looks, A activates, Y jumps, LB sprints, clicking the left stick sneaks and
 * B or Start opens the menu; on a keyboard, E activates, Space jumps, Shift sprints,
 * C sneaks and Esc or Tab opens the menu.
 */
export class Engine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.02, 100);
  private readonly keys = new Set<string>();
  private readonly openDoors = new Set<number>();
  private readonly seenTriggers = new Set<number>();
  private readonly jump: Jump = { height: 0, speed: 0 };
  private player: PlayerState;
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
  onPause?: () => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly autopilot: boolean;
  private readonly pad?: GamepadInput;
  private readonly hud?: EngineHud;
  private readonly controls: ControlSettings;

  /** The renderer is shared and outlives the engine; one engine runs at a time. */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly level: Level,
    private readonly levelScene: LevelScene,
    options: EngineOptions = {},
  ) {
    this.canvas = renderer.domElement;
    this.autopilot = options.autopilot ?? false;
    this.pad = options.pad;
    this.hud = options.hud;
    this.controls = options.controls ?? { lookSpeed: 1, invertLook: false, vibration: true };
    const canvas = this.canvas;
    this.scene.background = new THREE.Color(0x000000);
    // Arena's dungeons fade to black a few voxels away.
    this.scene.fog = new THREE.Fog(0x000000, 1.5, 9);
    this.scene.add(levelScene.group);
    this.player = { x: level.start.x, y: level.start.y, yaw: initialYaw(level), pitch: 0 };
    this.resize();

    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    if (!this.autopilot) this.lockPointer();
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.keys.clear();
  }

  dispose(): void {
    this.pause();
    this.hud?.target(undefined);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.pad?.poll(now);
    this.update(dt);
    if (!this.running) return; // paused from a controller button
    this.levelScene.animate(now / 1000);
    this.render();
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    if (this.autopilot) {
      this.player.yaw += 0.12 * dt;
      return;
    }
    const pad = this.pad;
    if (pad?.connected) {
      const back = pad.take('B');
      const start = pad.take('Start');
      if (back || start) {
        this.onPause?.();
        return;
      }
      if (pad.take('A')) this.useDoor(true);
      if (pad.take('Y')) this.startJump();
      if (pad.take('LS')) this.sneaking = !this.sneaking;
    }

    const k = this.keys;
    const lookSpeed = this.controls.lookSpeed;
    this.player.yaw += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * TURN_SPEED * dt;
    let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (pad?.connected) {
      forward -= pad.move.y;
      strafe += pad.move.x;
      sprint ||= pad.held('LB');
      // Squared response: fine aim near the centre, quick turns at full tilt.
      const { x, y } = pad.look;
      this.player.yaw += x * Math.abs(x) * STICK_TURN * lookSpeed * dt;
      this.tilt(-y * Math.abs(y) * STICK_PITCH * lookSpeed * dt);
    }
    // Sprinting stands you up, as in Skyrim.
    if (sprint && (forward !== 0 || strafe !== 0)) this.sneaking = false;
    const pace = this.sneaking ? SNEAK_SPEED : 1;
    step(
      this.level,
      this.player,
      { forward: clamp(forward, -1, 1) * pace, strafe: clamp(strafe, -1, 1) * pace, run: sprint },
      dt,
      this.openDoors,
    );
    stepJump(this.jump, JUMP_APEX * this.level.height, JUMP_TIME, dt);
    this.eye += ((this.sneaking ? SNEAK_EYE : EYE) - this.eye) * Math.min(1, dt * 10);

    for (const [index, door] of this.levelScene.doors) {
      if (door.openAmount !== door.target) {
        const dir = Math.sign(door.target - door.openAmount);
        door.openAmount = Math.min(1, Math.max(0, door.openAmount + dir * DOOR_SPEED * dt));
        door.mesh.position.y = door.openAmount * this.level.height * 0.95;
        if (door.openAmount === 1) this.openDoors.add(index);
      }
    }

    const here = cellIndex(this.level, this.player.x, this.player.y);
    for (let t = 0; t < this.level.triggers.length; t++) {
      const trig = this.level.triggers[t];
      if (!trig.text || this.seenTriggers.has(t)) continue;
      if (trig.y * this.level.width + trig.x === here) {
        this.seenTriggers.add(t);
        this.hud?.message(trig.text);
      }
    }

    this.showTarget();
  }

  private render(): void {
    const p = this.player;
    const h = this.level.height;
    const cell = this.level.cells[cellIndex(this.level, p.x, p.y)];
    let eye = this.eye * h + this.jump.height;
    if (cell?.chasm === 'wet' || cell?.chasm === 'lava') eye -= 0.15 * h; // wading
    eye = Math.min(eye, h - 0.05);
    this.camera.position.set(p.x, eye, p.y);
    const cp = Math.cos(p.pitch);
    this.camera.lookAt(p.x + Math.cos(p.yaw) * cp, eye + Math.sin(p.pitch), p.y + Math.sin(p.yaw) * cp);
    for (const b of this.levelScene.billboards) {
      b.rotation.y = Math.atan2(this.camera.position.x - b.position.x, this.camera.position.z - b.position.z);
    }
    this.hud?.heading(p.yaw);
    this.renderer.render(this.scene, this.camera);
  }

  /** Moves the player; used by the dev console and browser tests. */
  teleport(x: number, y: number, yaw = this.player.yaw): void {
    Object.assign(this.player, { x, y, yaw, pitch: 0 });
  }

  /** Tells the HUD what the player is looking at, when it changes. */
  private showTarget(): void {
    const i = doorInFront(this.level, this.player);
    const door = i === undefined ? undefined : this.levelScene.doors.get(i);
    const target = door ? { name: 'Door', verb: door.target === 1 ? 'Close' : 'Open' } : undefined;
    const key = target ? `${i}:${target.verb}` : '';
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.hud?.target(target);
  }

  private useDoor(fromPad = false): void {
    const i = doorInFront(this.level, this.player);
    if (i === undefined) return;
    const door = this.levelScene.doors.get(i);
    if (!door) return;
    // Don't close a door on the player.
    if (door.target === 1 && cellIndex(this.level, this.player.x, this.player.y) === i) return;
    door.target = door.target === 1 ? 0 : 1;
    if (door.target === 0) this.openDoors.delete(i);
    if (fromPad && this.controls.vibration) this.pad?.rumble();
  }

  private startJump(): void {
    if (startJump(this.jump, JUMP_APEX * this.level.height, JUMP_TIME)) this.sneaking = false;
  }

  private tilt(amount: number): void {
    const p = this.player;
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
    if (e.code === 'Escape' || e.code === 'Tab') {
      e.preventDefault();
      this.onPause?.();
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'Space') e.preventDefault(); // don't scroll or press a focused button
    if (e.repeat) return;
    if (e.code === 'KeyE') this.useDoor();
    else if (e.code === 'Space') this.startJump();
    else if (e.code === 'KeyC') this.sneaking = !this.sneaking;
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  /** Keys held while the window loses focus never send keyup, so forget them. */
  private onBlur = () => this.keys.clear();

  private get pointerLockFailed(): boolean {
    return this.pointerLockFailures >= 2;
  }

  private lockPointer(): void {
    if (this.pointerLockFailed) return;
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
    const speed = MOUSE_SENSITIVITY * this.controls.lookSpeed;
    this.player.yaw += dx * speed;
    this.tilt(-dy * speed);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.running) return;
    if (document.pointerLockElement === this.canvas) this.look(e.movementX, e.movementY);
    else if (this.dragging) {
      // Drag-to-look when the mouse can't be captured.
      this.look(e.movementX, e.movementY);
      this.dragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
    }
  };

  private onMouseDown = () => {
    if (!this.running || this.autopilot) return;
    if (document.pointerLockElement === this.canvas) {
      this.useDoor();
      return;
    }
    this.dragging = true;
    this.dragDistance = 0;
  };

  private onMouseUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.running || this.dragDistance > 4) return;
    // A plain click: capture the mouse if we can, otherwise treat it as "use".
    if (this.pointerLockFailed) this.useDoor();
    else this.lockPointer();
  };

  private onPointerLockError = () => {
    this.pointerLockFailures++;
  };

  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.canvas) this.pointerLockFailures = 0;
    // Losing pointer lock (Esc) opens the menu, like pausing.
    else if (this.running && !this.autopilot) this.onPause?.();
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Faces the most open direction from the start cell. */
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
