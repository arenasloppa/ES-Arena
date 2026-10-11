/**
 * The in-game HUD, after Skyrim's: a compass along the top that marks
 * creatures hunting the player and the current objective, the health of the
 * creature being fought beneath it, a small crosshair with the sneak eye
 * above it, the name of what you can use and the button for it, health and
 * stamina bars along the bottom that fade away when full, notes such as
 * "Key added" and quest objectives in the top corner, titles across the top
 * for places, quests and levels, and the dungeon's messages along the
 * bottom.
 */
import type { CompassMarker, EngineHud, HudTarget, ReadiedSpell, Vitals } from '../game/engine';

const MESSAGE_MS = 7000;
const TIPS_MS = 14000;
const NOTE_MS = 4500;
const OBJECTIVE_MS = 7000;
const MAX_NOTES = 5;
/** How long each title across the top stays up; the next waits its turn. */
const BANNER_MS = 4200;
/** Markers further round than this from where the player faces are off the compass. */
const COMPASS_HALF = 80;
/** Bars fade this long after they were last full and unchanged. */
const BAR_FADE_MS = 2500;
const ENEMY_MS = 4000;
/** Compass scale; the CSS uses the same 3px per degree. */
const MARK_STEP = 15;
const LETTERS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/** Compass bearing in degrees for a yaw: a Level's +x is east and +y south, so yaw 0 faces east. */
export function compassHeading(yaw: number): number {
  const deg = (yaw * 180) / Math.PI + 90;
  return ((deg % 360) + 360) % 360;
}

class Bar {
  private shownUntil = 0;
  private last = -1;

  constructor(private readonly el: HTMLElement) {}

  set(value: number, max: number, now: number): void {
    const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    if (fraction !== this.last) {
      this.last = fraction;
      this.el.style.setProperty('--fill', fraction.toFixed(4));
      if (fraction < 1) this.shownUntil = Infinity;
      else if (this.shownUntil === Infinity) this.shownUntil = now + BAR_FADE_MS;
    }
    this.el.classList.toggle('faded', now > this.shownUntil);
  }

  /** Shows the bar again for a while, full or not. */
  flash(now: number): void {
    if (this.shownUntil !== Infinity) this.shownUntil = now + BAR_FADE_MS;
  }

  reset(): void {
    this.last = -1;
    this.shownUntil = 0;
  }
}

export class Hud implements EngineHud {
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private tipsTimer: ReturnType<typeof setTimeout> | undefined;
  private lastHeading = Number.NaN;
  private readonly strip: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptName: HTMLElement;
  private readonly promptVerb: HTMLElement;
  private readonly promptNote: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly tips: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly hurtEl: HTMLElement;
  private readonly enemyEl: HTMLElement;
  private readonly enemyName: HTMLElement;
  private readonly enemyBar: HTMLElement;
  private readonly health: Bar;
  private readonly stamina: Bar;
  private readonly magickaEl: HTMLElement;
  private readonly magicka: Bar;
  private readonly hand: HTMLElement;
  private readonly spellEl: HTMLElement;
  private readonly effectsEl: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly markerPool: HTMLElement[] = [];
  private readonly bannerEl: HTMLElement;
  private readonly eye: HTMLElement;
  private readonly fader: HTMLElement | null;
  private readonly restingEl: HTMLElement;
  private enemyUntil = 0;
  private enemyKey = '';
  private readonly banners: Array<[string, string | undefined, string | undefined]> = [];
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private eyeOpen = -1;

  constructor(private readonly root: HTMLElement) {
    const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    this.strip = $('compass-strip');
    this.prompt = $('prompt');
    this.promptName = $('prompt-name');
    this.promptVerb = $('prompt-verb');
    this.promptNote = $('prompt-note');
    this.messageEl = $('message');
    this.tips = $('tips');
    this.notes = $('notes');
    this.hurtEl = $('hurt');
    this.enemyEl = $('enemy');
    this.enemyName = $('enemy-name');
    this.enemyBar = $('enemy-bar');
    this.health = new Bar($('health'));
    this.stamina = new Bar($('stamina'));
    this.magickaEl = $('magicka');
    this.magicka = new Bar(this.magickaEl);
    this.hand = $('hand');
    this.spellEl = $('spell-readied');
    this.effectsEl = $('effects');
    this.hand.addEventListener('animationend', () => this.hand.classList.remove('cast'));
    this.magickaEl.addEventListener('animationend', () => this.magickaEl.classList.remove('short'));
    this.marks = $('compass-marks');
    this.bannerEl = $('banner');
    this.eye = $('sneak-eye');
    this.fader = document.getElementById('fade');
    this.restingEl = $('resting');
    // Hiding the HUD (for the map or the menu) and showing it again would play a finished animation over.
    this.hurtEl.addEventListener('animationend', () => this.hurtEl.classList.remove('flash'));
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

  /** While camping: the hours left or passed, in the game's words, over the darkened view; undefined when done. */
  resting(text: string | undefined): void {
    this.restingEl.hidden = text === undefined;
    const line = this.restingEl.firstElementChild!;
    if (text !== undefined && line.textContent !== text) line.textContent = text;
  }

  message(text: string): void {
    this.messageEl.textContent = text;
    this.messageEl.classList.add('shown');
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.messageEl.classList.remove('shown'), MESSAGE_MS);
  }

  target(target: HudTarget | undefined): void {
    this.prompt.hidden = !target;
    if (!target) return;
    this.promptName.textContent = target.name;
    this.promptVerb.textContent = target.verb;
    this.promptNote.textContent = target.note ?? '';
    this.promptNote.hidden = !target.note;
  }

  heading(yaw: number, markers: CompassMarker[] = []): void {
    const deg = compassHeading(yaw);
    if (!(Math.abs(deg - this.lastHeading) < 0.05)) {
      this.lastHeading = deg;
      this.strip.style.setProperty('--heading', deg.toFixed(2));
    }
    // Quest markers last, so they sit on top.
    const shown = markers
      .map((m) => ({ m, delta: ((((m.bearing - deg) % 360) + 540) % 360) - 180 }))
      .filter(({ delta }) => Math.abs(delta) <= COMPASS_HALF)
      .sort((a, b) => (a.m.kind === b.m.kind ? 0 : a.m.kind === 'quest' ? 1 : -1));
    while (this.markerPool.length < shown.length) {
      const el = document.createElement('span');
      this.marks.append(el);
      this.markerPool.push(el);
    }
    this.markerPool.forEach((el, i) => {
      const item = shown[i];
      el.hidden = !item;
      if (!item) return;
      el.className = `marker ${item.m.kind}`;
      el.style.setProperty('--x', `${(item.delta * 3).toFixed(1)}px`);
      el.style.opacity = item.m.kind === 'enemy' ? (0.4 + 0.6 * item.m.near).toFixed(2) : '';
    });
  }

  vitals(v: Vitals): void {
    const now = performance.now();
    this.health.set(v.health, v.maxHealth, now);
    this.stamina.set(v.stamina, v.maxStamina, now);
    this.magickaEl.hidden = v.maxMagicka <= 0;
    this.magicka.set(v.magicka, v.maxMagicka, now);
    this.root.classList.toggle('low-health', v.health > 0 && v.health / v.maxHealth < 0.25);
    this.enemyEl.classList.toggle('faded', now > this.enemyUntil);
  }

  readied(spell: ReadiedSpell | undefined): void {
    this.spellEl.hidden = !spell;
    this.hand.classList.toggle('ready', !!spell);
    if (!spell) return;
    this.spellEl.style.setProperty('--spell', spell.colour);
    this.hand.style.setProperty('--spell', spell.colour);
    this.spellEl.querySelector('#spell-name')!.textContent = spell.name;
    this.spellEl.querySelector('#spell-cost')!.textContent = `${spell.cost} SP`;
  }

  cast(colour: string): void {
    this.hand.style.setProperty('--spell', colour);
    this.hand.classList.remove('cast');
    void this.hand.offsetWidth; // restart the animation
    this.hand.classList.add('cast');
    this.magicka.flash(performance.now());
  }

  noMagicka(): void {
    this.magickaEl.classList.remove('short');
    void this.magickaEl.offsetWidth;
    this.magickaEl.classList.add('short');
    this.magicka.flash(performance.now());
  }

  effects(names: string[]): void {
    this.effectsEl.hidden = !names.length;
    this.effectsEl.replaceChildren(
      ...names.map((n) => {
        const li = document.createElement('li');
        li.textContent = n;
        return li;
      }),
    );
  }

  /** A short note in the corner, such as "Key added". */
  notify(text: string): void {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = text;
    note.addEventListener('animationend', () => note.classList.add('settled'), { once: true });
    this.notes.append(note);
    while (this.notes.children.length > MAX_NOTES) this.notes.firstElementChild?.remove();
    setTimeout(() => note.classList.add('gone'), NOTE_MS);
    setTimeout(() => note.remove(), NOTE_MS + 800);
  }

  /** Flashes the screen's edges red. */
  hurt(): void {
    this.hurtEl.classList.remove('flash');
    void this.hurtEl.offsetWidth; // restart the animation
    this.hurtEl.classList.add('flash');
    this.health.flash(performance.now());
  }

  /** Shows the health of the creature being fought, under the compass. */
  enemy(name: string, health: number, maxHealth: number): void {
    const key = `${name}:${health}:${maxHealth}`;
    this.enemyUntil = performance.now() + (health > 0 ? ENEMY_MS : 1200);
    if (key === this.enemyKey) return;
    this.enemyKey = key;
    this.enemyName.textContent = name;
    this.enemyBar.style.setProperty('--fill', String(Math.max(0, health / maxHealth)));
    this.enemyEl.hidden = false;
    this.enemyEl.classList.remove('faded');
  }

  banner(title: string, kicker?: string, sub?: string): void {
    this.banners.push([title, kicker, sub]);
    if (this.bannerTimer === undefined) this.nextBanner();
  }

  private nextBanner(): void {
    const next = this.banners.shift();
    if (!next) {
      this.bannerTimer = undefined;
      // Done: or it would show again each time the HUD comes back from behind the map or the menu.
      this.bannerEl.classList.remove('shown');
      return;
    }
    const [title, kicker, sub] = next;
    const el = this.bannerEl;
    el.querySelector('.banner-title')!.textContent = title;
    const k = el.querySelector<HTMLElement>('.banner-kicker')!;
    k.textContent = kicker ?? '';
    k.hidden = !kicker;
    const s = el.querySelector<HTMLElement>('.banner-sub')!;
    s.textContent = sub ?? '';
    s.hidden = !sub;
    el.classList.remove('shown');
    void el.offsetWidth; // restart the animation
    el.classList.add('shown');
    this.bannerTimer = setTimeout(() => this.nextBanner(), BANNER_MS);
  }

  objective(text: string, done: boolean): void {
    const note = document.createElement('p');
    note.className = done ? 'note objective done' : 'note objective';
    note.addEventListener('animationend', () => note.classList.add('settled'), { once: true });
    const box = document.createElement('span');
    box.className = 'box';
    box.setAttribute('aria-hidden', 'true');
    note.append(box, text);
    if (done) note.setAttribute('aria-label', `${text}: done`);
    this.notes.append(note);
    while (this.notes.children.length > MAX_NOTES) this.notes.firstElementChild?.remove();
    setTimeout(() => note.classList.add('gone'), OBJECTIVE_MS);
    setTimeout(() => note.remove(), OBJECTIVE_MS + 800);
  }

  detection(level: number | undefined): void {
    const open = level === undefined ? -1 : Math.round(level * 20) / 20;
    if (open === this.eyeOpen) return;
    this.eyeOpen = open;
    this.eye.hidden = open < 0;
    if (open < 0) return;
    // Shut, both lids curve down like lashes; open, they part into an almond round the iris.
    const up = 6 - 22 * open;
    const down = 6 + 10 * open;
    const lids = `M-22 0Q0 ${up.toFixed(1)} 22 0Q0 ${down.toFixed(1)}-22 0z`;
    for (const path of this.eye.querySelectorAll('path')) path.setAttribute('d', lids);
    const iris = this.eye.querySelector('ellipse')!;
    iris.setAttribute('cy', ((up + down) / 4).toFixed(2));
    iris.setAttribute('ry', Math.max(0, Math.min(5.4, (down - up) / 4 - 0.6)).toFixed(2));
    this.eye.classList.toggle('seen', open >= 1);
  }

  fade(opacity: number, seconds: number): void {
    const f = this.fader;
    if (!f) return;
    f.style.transition = seconds > 0 ? `opacity ${seconds}s ease-in-out` : 'none';
    if (seconds <= 0) void f.offsetWidth;
    f.style.opacity = String(opacity);
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
    clearTimeout(this.bannerTimer);
    this.bannerTimer = undefined;
    this.banners.length = 0;
    this.bannerEl.classList.remove('shown');
    for (const el of this.markerPool) el.hidden = true;
    this.detection(undefined);
    this.messageEl.classList.remove('shown');
    this.tips.hidden = true;
    this.notes.replaceChildren();
    this.enemyEl.hidden = true;
    this.enemyKey = '';
    this.enemyUntil = 0;
    this.health.reset();
    this.stamina.reset();
    this.magicka.reset();
    this.readied(undefined);
    this.effects([]);
    this.root.classList.remove('low-health');
    this.hurtEl.classList.remove('flash');
    this.target(undefined);
  }
}
