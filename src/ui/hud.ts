/**
 * The in-game HUD, after Skyrim's: a compass along the top, a small
 * crosshair, the name of what you can use and the button for it, and
 * the dungeon's messages along the bottom.
 */
import type { EngineHud, Target } from '../game/engine';

const MESSAGE_MS = 7000;
const TIPS_MS = 12000;
/** Compass scale; the CSS uses the same 3px per degree. */
const MARK_STEP = 15;
const LETTERS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/** Compass bearing in degrees for a yaw: a Level's +x is east and +y south, so yaw 0 faces east. */
export function compassHeading(yaw: number): number {
  const deg = (yaw * 180) / Math.PI + 90;
  return ((deg % 360) + 360) % 360;
}

export class Hud implements EngineHud {
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private tipsTimer: ReturnType<typeof setTimeout> | undefined;
  private lastHeading = Number.NaN;
  private readonly strip: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptName: HTMLElement;
  private readonly promptVerb: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly tips: HTMLElement;

  constructor(root: HTMLElement) {
    const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    this.strip = $('compass-strip');
    this.prompt = $('prompt');
    this.promptName = $('prompt-name');
    this.promptVerb = $('prompt-verb');
    this.messageEl = $('message');
    this.tips = $('tips');
    // Marks for three turns, so the strip never runs out whichever way the player faces.
    for (let deg = -360; deg < 720; deg += MARK_STEP) {
      const mark = document.createElement('span');
      const letter = LETTERS[(deg + 360) % 360];
      mark.className = letter ? 'mark letter' : deg % 45 === 0 ? 'mark major' : 'mark';
      if (letter) mark.textContent = letter;
      mark.style.setProperty('--at', String(deg + 360));
      this.strip.append(mark);
    }
  }

  message(text: string): void {
    this.messageEl.textContent = text;
    this.messageEl.classList.add('shown');
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.messageEl.classList.remove('shown'), MESSAGE_MS);
  }

  target(target: Target | undefined): void {
    this.prompt.hidden = !target;
    if (!target) return;
    this.promptName.textContent = target.name;
    this.promptVerb.textContent = target.verb;
  }

  heading(yaw: number): void {
    const deg = compassHeading(yaw);
    if (Math.abs(deg - this.lastHeading) < 0.05) return;
    this.lastHeading = deg;
    this.strip.style.setProperty('--heading', deg.toFixed(2));
  }

  /** Lists the controls for a while, as Skyrim's tutorial notes do. */
  showTips(): void {
    this.tips.hidden = false;
    clearTimeout(this.tipsTimer);
    this.tipsTimer = setTimeout(() => (this.tips.hidden = true), TIPS_MS);
  }

  /** Clears everything from the last map. */
  reset(): void {
    clearTimeout(this.messageTimer);
    clearTimeout(this.tipsTimer);
    this.messageEl.classList.remove('shown');
    this.tips.hidden = true;
    this.target(undefined);
  }
}
