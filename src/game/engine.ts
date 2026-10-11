import * as THREE from 'three';
import type { Level } from './level';
import { cellIndex, doorInFront, step, type PlayerState } from './player';
import type { LevelScene } from '../render/levelScene';

const EYE = 0.55; // eye height as a fraction of room height
const MOUSE_SENSITIVITY = 0.0022;
const TURN_SPEED = 2.4; // radians per second for arrow keys
const DOOR_SPEED = 1.6; // fraction per second

export interface EngineOptions {
  /** Slowly turns the camera with no input; used for the backdrop behind the menu. */
  autopilot?: boolean;
}

/** Runs one level: input, movement, doors, triggers and rendering. */
export class Engine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.02, 100);
  private readonly keys = new Set<string>();
  private readonly openDoors = new Set<number>();
  private readonly seenTriggers = new Set<number>();
  private player: PlayerState;
  private running = false;
  private last = 0;
  private messageTimer = 0;
  /** Set when the page may not capture the mouse (e.g. some embedded frames); we fall back to drag-to-look. */
  private pointerLockFailed = !('requestPointerLock' in HTMLElement.prototype);
  private dragging = false;
  private dragDistance = 0;
  onPause?: () => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly autopilot: boolean;

  /** The renderer is shared and outlives the engine; one engine runs at a time. */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly level: Level,
    private readonly levelScene: LevelScene,
    private readonly messageEl: HTMLElement,
    options: EngineOptions = {},
  ) {
    this.canvas = renderer.domElement;
    this.autopilot = options.autopilot ?? false;
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
    requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.running = false;
    this.keys.clear();
  }

  dispose(): void {
    this.pause();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
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
    this.update(dt);
    this.levelScene.animate(now / 1000);
    this.render();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    if (this.autopilot) {
      this.player.yaw += 0.12 * dt;
      return;
    }
    const k = this.keys;
    if (k.has('ArrowLeft')) this.player.yaw -= TURN_SPEED * dt;
    if (k.has('ArrowRight')) this.player.yaw += TURN_SPEED * dt;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    step(this.level, this.player, { forward, strafe, run: k.has('ShiftLeft') || k.has('ShiftRight') }, dt, this.openDoors);

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
        this.showMessage(trig.text);
      }
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.messageEl.hidden = true;
    }
  }

  private render(): void {
    const p = this.player;
    const cell = this.level.cells[cellIndex(this.level, p.x, p.y)];
    let eye = EYE * this.level.height;
    if (cell?.chasm === 'wet' || cell?.chasm === 'lava') eye -= 0.15 * this.level.height; // wading
    this.camera.position.set(p.x, eye, p.y);
    const cp = Math.cos(p.pitch);
    this.camera.lookAt(p.x + Math.cos(p.yaw) * cp, eye + Math.sin(p.pitch), p.y + Math.sin(p.yaw) * cp);
    for (const b of this.levelScene.billboards) {
      b.rotation.y = Math.atan2(this.camera.position.x - b.position.x, this.camera.position.z - b.position.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Moves the player; used by the dev console and browser tests. */
  teleport(x: number, y: number, yaw = this.player.yaw): void {
    Object.assign(this.player, { x, y, yaw, pitch: 0 });
  }

  showMessage(text: string, seconds = 7): void {
    this.messageEl.textContent = text;
    this.messageEl.hidden = false;
    this.messageTimer = seconds;
  }

  private useDoor(): void {
    const i = doorInFront(this.level, this.player);
    if (i === undefined) return;
    const door = this.levelScene.doors.get(i);
    if (!door) return;
    // Don't close a door on the player.
    if (door.target === 1 && cellIndex(this.level, this.player.x, this.player.y) === i) return;
    door.target = door.target === 1 ? 0 : 1;
    if (door.target === 0) this.openDoors.delete(i);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.running || this.autopilot) return;
    this.keys.add(e.code);
    if (e.code === 'KeyE' || e.code === 'Space') this.useDoor();
    if (e.code === 'Escape') this.onPause?.();
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private lockPointer(): void {
    if (this.pointerLockFailed) return;
    try {
      const result = this.canvas.requestPointerLock?.() as unknown;
      if (result instanceof Promise) result.catch(this.onPointerLockError);
    } catch {
      this.onPointerLockError();
    }
  }

  private look(dx: number, dy: number): void {
    this.player.yaw += dx * MOUSE_SENSITIVITY;
    this.player.pitch = Math.max(-1.2, Math.min(1.2, this.player.pitch - dy * MOUSE_SENSITIVITY));
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
    this.pointerLockFailed = true;
  };

  private onPointerLockChange = () => {
    // Losing pointer lock (Esc) opens the menu, like pausing.
    if (this.running && !this.autopilot && document.pointerLockElement !== this.canvas) this.onPause?.();
  };
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
