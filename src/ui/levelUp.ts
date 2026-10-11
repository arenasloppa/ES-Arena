/**
 * Arena's level up: the character sheet again, with the bonus points the
 * levels gained to share out among the attributes. As in Arena, every point
 * has to be placed before the game goes on. What each attribute gives shows
 * beside it, and the health, stamina and spell points they make beside the
 * sheet, with Endurance's health counting for every level.
 */
import {
  ATTRIBUTE_COUNT,
  ATTRIBUTE_MAX,
  attributeRoom,
  derivedAttributes,
  INTELLIGENCE,
  maxFatigue,
  type Character,
  type CreationData,
} from '../game/character';
import { maxHealthFor, raiseTo, type PlayerStats } from '../game/combat';
import { startingMagicka } from '../game/magic';
import type { StepEvent } from './menu';
import { attributeNotes, el, settingRow } from './sheet';

export interface LevelUpSheet {
  character: Character;
  data: CreationData;
  /** The player as they are, at their new level. */
  stats: PlayerStats;
  /** Points to share out. */
  points: number;
  /** What the game says when a level is gained. */
  text: string;
  /** Every point is placed: the attributes as they now are. */
  done(attributes: number[]): void;
}

export class LevelUp {
  private sheet: LevelUpSheet | undefined;
  private points = 0;
  private added: number[] = [];
  private rows: HTMLButtonElement[] = [];
  private notes: HTMLElement[] = [];
  private readonly left = el('p', 'create-bonus');
  private readonly status = el('dl', 'create-status');

  constructor(private readonly root: HTMLElement) {}

  /** Puts up the sheet; returns its first row. */
  open(sheet: LevelUpSheet): HTMLElement {
    const { character: c, data, stats: s } = sheet;
    this.sheet = sheet;
    this.points = Math.min(sheet.points, attributeRoom(c.attributes));
    this.added = new Array(ATTRIBUTE_COUNT).fill(0);
    const head = el('header', 'create-head');
    head.append(el('p', 'create-kicker', c.name), el('h2', '', `Level ${s.level}`), el('div', 'rule'));
    const body = el('div', 'create-columns create-sheet');
    const column = el('div', 'create-attributes');
    const nav = el('nav', 'options settings');
    this.notes = [];
    this.rows = data.attributes.slice(0, ATTRIBUTE_COUNT).map((name, i) => {
      const row = settingRow(name, '');
      const note = el('span', 'create-sub');
      row.querySelector('.row-label')!.append(note);
      this.notes.push(note);
      row.addEventListener('step', (e) => this.add(i, (e as StepEvent).detail.delta));
      row.addEventListener('click', () => this.add(i, 1));
      nav.append(row);
      return row;
    });
    const done = el('button', 'option', 'Done');
    done.addEventListener('click', () => this.finish());
    nav.append(done);
    column.append(this.left, nav);
    body.append(column, this.status);
    this.root.replaceChildren(head, el('p', 'create-text', sheet.text), body);
    this.show();
    return this.rows[0];
  }

  /** Esc, B or Start: the game goes on only once every point is placed, as in Arena. */
  back(): void {
    if (this.pointsLeft > 0) this.warn();
    else this.finish();
  }

  private get pointsLeft(): number {
    return this.points - this.added.reduce((a, b) => a + b, 0);
  }

  private attributes(): number[] {
    return this.sheet!.character.attributes.map((v, i) => v + (this.added[i] ?? 0));
  }

  private add(i: number, delta: number): void {
    const was = this.sheet!.character.attributes[i];
    if (delta > 0 && (this.pointsLeft <= 0 || was + this.added[i] >= ATTRIBUTE_MAX)) return;
    if (delta < 0 && this.added[i] <= 0) return;
    this.added[i] += Math.sign(delta);
    this.show();
  }

  private finish(): void {
    if (this.pointsLeft > 0) this.warn();
    else this.sheet?.done(this.attributes());
  }

  private warn(): void {
    this.left.textContent = this.sheet!.data.sheet.distributeAll;
    this.left.classList.add('warn');
  }

  private show(): void {
    const { character: c, data, stats: s } = this.sheet!;
    const a = this.attributes();
    this.rows.forEach((row, i) => {
      const value = row.querySelector('.value')!;
      value.textContent = String(a[i]);
      value.classList.toggle('raised', this.added[i] > 0);
    });
    // What the player will have once the points are placed, as Dungeon.applyAttributes works it out.
    const cls = data.classes[c.cls];
    const health = maxHealthFor(s, derivedAttributes(a).health);
    const stamina = maxFatigue(a);
    const magicka = cls ? startingMagicka(cls, a[INTELLIGENCE]) : 0;
    // Health rounds up, as the HUD shows it.
    const now = (value: number, max: number, to: number, round = Math.floor) => `${round(raiseTo(value, max, to))}/${to}`;
    const notes = attributeNotes(a, now(s.magicka, s.maxMagicka, magicka));
    this.notes.forEach((note, i) => (note.textContent = notes[i]));
    const lines: Array<[string, string]> = [
      ['Health', now(s.health, s.maxHealth, health, Math.ceil)],
      ['Fatigue', now(s.stamina, s.maxStamina, stamina)],
      ['Gold', String(s.gold)],
      ['Experience', String(s.experience)],
      ['Level', String(s.level)],
    ];
    this.status.replaceChildren(...lines.flatMap(([k, x]) => [el('dt', '', k), el('dd', '', x)]));
    const n = this.pointsLeft;
    this.left.textContent = `Bonus points: ${n}`;
    this.left.classList.toggle('done', n === 0);
    this.left.classList.remove('warn');
  }
}
