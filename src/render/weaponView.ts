/**
 * The weapon in the player's hand, drawn over the 3D view as Arena draws it:
 * pictures from the weapon's CIF placed on the 320x147 game view, scaled up
 * with square-cornered pixels. Arena's swing sets have 33 frames:
 *   0-4     chop down from overhead
 *   5-9     cut down from the upper right
 *   10-14   slash from right to left
 *   15-19   slash from left to right
 *   20-24   cut down from the upper left
 *   25-29   thrust
 *   30-32   raise from below; 32 is the weapon at rest
 * Blood from Arena's BLOODEXP.CFA splashes on the view when a blow lands.
 */
import type { Swing, SwingKind } from '../game/dungeon';
import type { ScreenImage } from './textures';

export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 147;

const REST = 32;
const SWINGS: Record<SwingKind, [number, number]> = {
  chop: [0, 4],
  downRight: [5, 9],
  right: [10, 14],
  left: [15, 19],
  downLeft: [20, 24],
  thrust: [25, 29],
};
/** Frames that bring the weapon back up after a swing, and when it is first drawn. */
const RAISE = [30, 31];
const RAISE_TIME = 0.16;
const SPLASH_FRAME_TIME = 0.06;
/**
 * The guard: the weapon held up across the body. Arena has no block, so this
 * is the top of the cut from the upper left, moved in toward the middle with
 * its end kept at the bottom of the view.
 */
const GUARD = 20;
const GUARD_RIGHT = 196;

/** The frame of the swing set to show for a swing in progress, or the resting frame. */
export function swingFrame(swing: Swing | undefined): number {
  if (!swing) return REST;
  const [first, last] = SWINGS[swing.kind];
  const n = last - first + 1;
  return first + Math.min(n - 1, Math.floor((swing.time / swing.duration) * n));
}

export interface WeaponPose {
  swing?: Swing;
  /** How far the player has walked, for the sway of each step. */
  walked: number;
  /** 0 to 1: sinks the weapon out of view. */
  lowered: number;
  /** Blocking: the weapon is held up to guard. */
  guard: boolean;
  /** Seconds since the last draw. */
  dt: number;
}

export class WeaponView {
  private readonly ctx: CanvasRenderingContext2D;
  private frames: ScreenImage[] = [];
  private blood: ScreenImage[] = [];
  private file = '';
  private drawn = '';
  /** Seconds into raising the weapon to rest; Infinity once at rest. */
  private raising = 0;
  private splashing = Infinity;
  private swinging = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly load: (file: string) => Promise<ScreenImage[]>,
  ) {
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  }

  /** Switches to another weapon's swing set; resolves once it is loaded. */
  async use(file: string): Promise<void> {
    if (file === this.file) return;
    this.file = file;
    const frames = await this.load(file);
    if (this.file === file) {
      this.frames = frames;
      this.drawn = '';
      this.raising = 0;
    }
  }

  /** The frames of the blood splash shown when a blow lands. */
  useBlood(frames: ScreenImage[]): void {
    this.blood = frames;
  }

  /** Splashes blood on the view, as a blow lands. */
  splash(): void {
    if (this.blood.length) this.splashing = 0;
  }

  /** Draws `file`'s frame for the pose: a swing, the guard, or at rest, swaying with the player's steps. */
  draw(file: string, pose: WeaponPose): void {
    if (file !== this.file) void this.use(file);
    const { swing, guard, dt } = pose;
    if (swing) this.swinging = true;
    else if (this.swinging) {
      // The swing is over: bring the weapon back up.
      this.swinging = false;
      this.raising = 0;
    }
    let index = swingFrame(swing);
    if (!swing) {
      this.raising += dt;
      if (this.raising < RAISE_TIME) index = RAISE[Math.floor((this.raising / RAISE_TIME) * RAISE.length)];
      else this.raising = Infinity;
    }
    let dx = 0;
    let dy = 0;
    if (guard && !swing) {
      index = GUARD;
      this.raising = Infinity;
      const raised = this.frames[GUARD];
      if (raised) {
        dx = Math.max(0, GUARD_RIGHT - (raised.x + raised.image.width));
        dy = VIEW_HEIGHT - (raised.y + raised.image.height);
      }
    } else if (!swing) {
      const sway = pose.walked * Math.PI * 0.9;
      dx = Math.round(Math.sin(sway) * 5);
      dy = Math.round((1 - Math.abs(Math.cos(sway))) * 4);
    }
    dy += Math.round(pose.lowered * VIEW_HEIGHT);
    let splash = -1;
    if (this.splashing !== Infinity) {
      this.splashing += dt;
      splash = Math.floor(this.splashing / SPLASH_FRAME_TIME);
      if (splash >= this.blood.length) {
        splash = -1;
        this.splashing = Infinity;
      }
    }
    const key = `${this.file}:${index}:${dx}:${dy}:${splash}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    const blood = this.blood[splash];
    if (blood) this.ctx.drawImage(blood.image, blood.x, blood.y);
    const frame = this.frames[index];
    if (frame) this.ctx.drawImage(frame.image, frame.x + dx, frame.y + dy);
  }
}
