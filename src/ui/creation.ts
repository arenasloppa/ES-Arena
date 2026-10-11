/**
 * Character creation, in Skyrim's order with Arena's pieces: gender, race and
 * face together, as Skyrim's race menu has them, with the race's province
 * marked on Arena's map of Tamriel and the game's words on that race; then a
 * name, in the race's style; then a class, chosen from the list or by
 * answering ten questions, with what the class needs beside it; then bonus
 * points shared out among the rolled attributes on a sheet like Arena's; and
 * last Arena's farewell. The paper doll shows the character as made so far
 * beside every step, in the gear of the class picked or being looked at.
 * Each step shows the game's own words, read from the player's copy, and is
 * worked like the rest of the menu with the keyboard, the mouse or a
 * controller.
 */
import type { ClassInfo } from '../formats/classes';
import type { Question } from '../formats/creation';
import type { WeaponInfo } from '../formats/exe';
import type { Random } from '../game/combat';
import {
  ATTRIBUTE_COUNT,
  ATTRIBUTE_MAX,
  classFromAnswers,
  INTELLIGENCE,
  derivedAttributes,
  FACES,
  fillText,
  maxFatigue,
  pickQuestions,
  rollAttributes,
  startingHealth,
  type Character,
  type CreationData,
  type Gender,
} from '../game/character';
import { Inventory, SHIELDS, startingGear } from '../game/items';
import { randomName } from '../game/names';
import { startingMagicka } from '../game/magic';
import { DOLL_HEIGHT, DOLL_WIDTH, PIXEL_ASPECT, type Portraits } from '../render/portrait';
import type { StepEvent } from './menu';
import { attributeNotes, el, settingRow } from './sheet';

/** How many questions choose a class, as in Arena. */
const QUESTIONS = 10;
const NAME_LENGTH = 24;
/** Where each race's province is named on the map of Tamriel (TAMRIEL.MNU), in the races' order. */
const PROVINCE_AT: Array<[number, number]> = [
  [74, 56],
  [97, 80],
  [158, 49],
  [247, 89],
  [60, 154],
  [130, 151],
  [166, 132],
  [243, 149],
];
/** The Imperial Province, in the middle, is no race's home. */
const IMPERIAL_AT: [number, number] = [174, 110];
const MAP_WIDTH = 320;
const MAP_HEIGHT = 200;
const ARMOUR_ALLOWED = ['Any', 'Chain, leather', 'Leather', 'None'];

type Step = 'look' | 'name' | 'method' | 'question' | 'result' | 'classes' | 'attributes' | 'farewell';

export interface CreationHost {
  data: CreationData;
  /** The game's weapon list, for the weapons each class may use; empty without it. */
  weapons: WeaponInfo[];
  portraits?: Portraits;
  random?: Random;
  /** What the last step's button says, such as "Enter the dungeon". */
  finish: string;
  /** The character is made. */
  done(character: Character): void;
  /** Gone back from the first step. */
  cancel(): void;
}

interface Draft {
  cls?: number;
  gender: Gender;
  name: string;
  race: number;
  /** The attributes as rolled, and the bonus points added to each. */
  rolled?: number[];
  added: number[];
  bonus: number;
  /** The hit die's roll for health, and the gold, rolled with the attributes. */
  healthRoll: number;
  gold: number;
  /** The race, gender and class the attributes were rolled for. */
  rolledFor?: string;
  face: number;
  /** The style of name Random name makes: 0 for any race, then each race's men and women in turn; it follows the race and gender chosen. */
  nameStyle: number;
  questions: Question[];
  /** The path each answer so far counts toward. */
  answers: number[];
}

export class CharacterCreation {
  private host: CreationHost | undefined;
  private step: Step = 'look';
  private history: Step[] = [];
  private draft: Draft = newDraft();
  private readonly doll = document.createElement('canvas');
  /** The step's own part of the screen, and the doll's beside it. */
  private body: HTMLElement;
  private side: HTMLElement;
  /** Shows the step's values again once one has changed, on steps that show them. */
  private changed: (() => void) | undefined;

  constructor(private readonly root: HTMLElement) {
    this.body = root;
    this.side = root;
    this.doll.className = 'create-doll';
    this.doll.addEventListener('click', () => this.step === 'look' && this.changeFace(1));
    // Arena's keys for the answers.
    window.addEventListener('keydown', (e) => {
      if (this.step !== 'question' || this.root.hidden || e.defaultPrevented || e.repeat) return;
      const answer = ['KeyA', 'KeyB', 'KeyC'].indexOf(e.code);
      if (answer < 0 || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.answer(answer);
    });
  }

  /** Begins a new character, at the first step. */
  start(host: CreationHost): void {
    this.host = host;
    this.draft = newDraft();
    this.history = [];
    this.go('look', false);
  }

  /** Esc or B: one step back, or out of character creation from the first. */
  back(): void {
    if (this.step === 'question' && this.draft.answers.length) {
      this.draft.answers.pop();
      this.render();
      return;
    }
    const previous = this.history.pop();
    if (previous) {
      this.step = previous;
      this.render();
    } else this.host?.cancel();
  }

  private get data(): CreationData {
    return this.host!.data;
  }

  private random(): number {
    return (this.host?.random ?? Math.random)();
  }

  private go(step: Step, remember = true): void {
    if (remember) this.history.push(this.step);
    this.step = step;
    this.render();
  }

  private get cls(): ClassInfo | undefined {
    return this.draft.cls === undefined ? undefined : this.data.classes[this.draft.cls];
  }

  // ---- Steps ----

  private render(): void {
    const t = this.data.texts;
    const d = this.draft;
    const clsName = this.cls?.name ?? '';
    const race = this.data.races[d.race];
    let focus: HTMLElement | undefined;
    switch (this.step) {
      case 'look': {
        // Only the first words: the last tell how Arena's own screen ends.
        this.frame('New character', 'Appearance', sentences(t.appearance, 2));
        focus = this.renderLook();
        break;
      }
      case 'name': {
        // Arena asks it of the class, chosen before the name there; here the race is what is known.
        this.frame(race?.name ?? '', 'Name', fillText(t.name, [race?.name ?? ''], d.gender));
        const nav = el('nav', 'options create-choices');
        const box = el('input', 'option create-name');
        box.type = 'text';
        box.maxLength = NAME_LENGTH;
        box.value = d.name;
        box.placeholder = 'Your name';
        box.spellcheck = false;
        box.autocomplete = 'off';
        box.setAttribute('aria-label', 'Name');
        const next = el('button', 'option', 'Continue');
        const update = () => {
          d.name = box.value.replace(/\s+/g, ' ').trimStart();
          next.disabled = !d.name.trim();
        };
        box.addEventListener('input', update);
        box.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (!next.disabled) next.click();
        });
        // The style of name follows the race and gender chosen, and can be changed: another race's men or women, or any.
        const style = settingRow('Name style', '');
        const styles = this.data.races.length * 2 + 1;
        const showStyle = () => {
          const n = d.nameStyle;
          const race = this.data.races[(n - 1) >> 1]?.name;
          style.querySelector('.value')!.textContent = n && race ? `${race} ${n % 2 ? 'man' : 'woman'}` : 'Any';
        };
        const changeStyle = (delta: number) => {
          d.nameStyle = (d.nameStyle + Math.sign(delta) + styles) % styles;
          showStyle();
        };
        style.addEventListener('step', (e) => changeStyle((e as StepEvent).detail.delta));
        style.addEventListener('click', () => changeStyle(1));
        showStyle();
        const random = el('button', 'option', 'Random name');
        random.addEventListener('click', () => {
          const n = d.nameStyle;
          const race = n ? (n - 1) >> 1 : Math.floor(this.random() * this.data.races.length);
          const gender = n ? (n % 2 ? 'male' : 'female') : this.random() < 0.5 ? 'male' : 'female';
          box.value = randomName(race, gender, () => this.random(), this.data.names).slice(0, NAME_LENGTH);
          update();
        });
        next.addEventListener('click', () => {
          d.name = d.name.trim();
          if (d.name) this.go(this.data.questions.length ? 'method' : 'classes');
        });
        update();
        nav.append(box, style, random, next);
        this.body.append(nav);
        focus = box;
        break;
      }
      case 'method': {
        this.frame(d.name, 'Class', t.method);
        this.options(
          [
            ['Answer ten questions', () => this.beginQuestions()],
            ['Choose from the list', () => this.go('classes')],
          ],
          'create-choices',
        );
        break;
      }
      case 'question': {
        const n = d.answers.length;
        const q = d.questions[n];
        // Only the first words: the rest tell how Arena's own screen works.
        const intro = n === 0 ? firstSentence(t.questions) : undefined;
        this.frame(`Question ${n + 1} of ${d.questions.length}`, 'Class', intro);
        const question = el('p', 'create-question', q.text);
        const list = this.options(
          q.answers.map((a, i) => [a.text, () => this.answer(i)] as [string, () => void]),
          'create-answers',
        );
        list.querySelectorAll('.option').forEach((b, i) => b.prepend(el('span', 'letter', 'ABC'[i])));
        list.before(question);
        this.body.append(el('p', 'create-hint', 'A, B or C answers'));
        break;
      }
      case 'result': {
        this.frame('Your answers', clsName, fillText(t.classResult, [clsName]));
        this.body.append(this.classDetails(this.cls!));
        this.options(
          [
            ['Accept', () => this.go('attributes')],
            ['Choose another', () => this.go('classes')],
          ],
          'create-choices',
        );
        break;
      }
      case 'classes': {
        this.frame(d.name, 'Class');
        const body = el('div', 'create-columns');
        const list = el('nav', 'options create-list');
        const details = el('div', 'create-details-slot');
        this.data.classes.forEach((c, i) => {
          const b = el('button', 'option', c.name);
          b.addEventListener('click', () => {
            d.cls = i;
            this.go('attributes');
          });
          // The doll tries on the class's clothes and gear as it is looked at.
          b.addEventListener('focus', () => {
            details.replaceChildren(this.classDetails(c));
            this.drawDoll(c);
          });
          list.append(b);
          if (i === (d.cls ?? 0)) focus = b;
        });
        details.append(this.classDetails(this.data.classes[d.cls ?? 0]));
        body.append(list, details);
        this.body.append(body);
        showMore(list);
        break;
      }
      case 'attributes': {
        const key = `${d.race}:${d.gender}:${d.cls}`;
        if (d.rolled === undefined || d.rolledFor !== key) this.reroll();
        this.frame(d.name, 'Attributes', t.distribute);
        focus = this.renderAttributes();
        break;
      }
      case 'farewell': {
        // Who the character is, and Arena's farewell, together; what the class needs was beside the class list.
        this.frame(`${race?.name ?? ''} ${clsName}`, d.name, fillText(t.knownAs, [clsName, d.name, race?.province ?? '', race?.plural ?? ''], d.gender));
        this.body.append(el('p', 'create-text', t.farewell));
        this.options([[this.host!.finish, () => this.finish()]], 'create-choices');
        break;
      }
    }
    // From the top for each step, then down as far as the option picked first needs.
    this.root.closest('#menu')?.scrollTo({ top: 0 });
    (focus ?? this.root.querySelector<HTMLElement>('.option:not(:disabled)'))?.focus();
  }

  /**
   * Clears the screen and puts up the step's heading, the game's words for
   * it, and the doll beside the step's own part of the screen.
   */
  private frame(kicker: string, title: string, text?: string): void {
    const head = el('header', 'create-head');
    head.append(el('p', 'create-kicker', kicker), el('h2', '', title), el('div', 'rule'));
    const stage = el('div', 'create-stage');
    this.body = el('div', 'create-body');
    this.side = el('aside', 'create-side');
    stage.append(this.body, this.side);
    this.root.replaceChildren(head, stage);
    this.root.dataset.step = this.step;
    this.changed = undefined;
    if (text) this.body.append(el('p', 'create-text', text));
    this.side.append(this.dollFrame());
  }

  private options(choices: Array<[string, () => void]>, className: string): HTMLElement {
    const nav = el('nav', `options ${className}`);
    for (const [label, act] of choices) {
      const b = el('button', 'option', label);
      b.addEventListener('click', act);
      nav.append(b);
    }
    this.body.append(nav);
    return nav;
  }

  /**
   * Gender, race and face together, as in Skyrim's race menu: each a row
   * stepped with left and right, with the doll changing beside them, the
   * game's words on the race under them, and Arena's map of Tamriel with the
   * race's province marked, which picks the race whose province is clicked.
   * Returns the first row.
   */
  private renderLook(): HTMLElement {
    const d = this.draft;
    const races = this.data.races;
    const columns = el('div', 'create-columns create-look');
    const left = el('div', 'create-sheet create-look-rows');
    const nav = el('nav', 'options settings');
    const gender = settingRow('Gender', '');
    const race = settingRow('Race', '');
    const face = settingRow('Face', '');
    const next = el('button', 'option', 'Continue');
    const lore = el('p', 'create-text create-lore');
    const home = el('p', 'create-text create-home');
    const map = this.renderMap((i) => {
      d.race = i;
      show();
    });
    const value = (row: HTMLElement) => row.querySelector('.value')!;
    const show = () => {
      const r = races[d.race];
      value(gender).textContent = d.gender === 'female' ? 'Female' : 'Male';
      value(race).textContent = r.name;
      value(face).textContent = `${d.face + 1} of ${FACES}`;
      map.mark(d.race);
      // Only the first words: the last ask whether to keep the race, which Continue does here.
      home.textContent = firstSentence(fillText(this.data.texts.home, [r.province, r.plural], d.gender));
      const words = this.data.raceLore?.[d.race]?.replace(/\s*\n\s*/g, ' ').trim();
      lore.textContent = words ? `${this.data.sheet.knowYe} ${words}` : '';
      lore.hidden = !words;
      this.drawDoll();
    };
    this.changed = show;
    const toggle = () => {
      d.gender = d.gender === 'female' ? 'male' : 'female';
      show();
    };
    gender.addEventListener('step', toggle);
    gender.addEventListener('click', toggle);
    const stepRace = (delta: number) => {
      d.race = (d.race + Math.sign(delta) + races.length) % races.length;
      show();
    };
    race.addEventListener('step', (e) => stepRace((e as StepEvent).detail.delta));
    race.addEventListener('click', () => stepRace(1));
    face.addEventListener('step', (e) => this.changeFace((e as StepEvent).detail.delta));
    face.addEventListener('click', () => this.changeFace(1));
    next.addEventListener('click', () => {
      // The style of names to offer follows the race and gender, as the name comes next.
      d.nameStyle = 1 + d.race * 2 + (d.gender === 'female' ? 1 : 0);
      this.go('name');
    });
    nav.append(gender, race, face, next);
    left.append(nav, lore);
    const right = el('div', 'create-look-map');
    right.append(map.box, home);
    columns.append(left, right);
    this.body.append(columns);
    show();
    return gender;
  }

  /** What a class is like, from the game's tables. */
  private classDetails(c: ClassInfo): HTMLElement {
    const box = el('aside', 'create-details');
    box.append(el('h3', '', c.name));
    if (c.needs) box.append(el('p', 'create-needs', fillText(this.data.texts.needs, [c.needs, c.name], this.draft.gender)));
    const rows: Array<[string, string]> = [
      ['Health each level', `1 to ${c.healthDie}`],
      ['Experience for level 2', String(c.experience)],
      ['Armour', ARMOUR_ALLOWED[c.armour] ?? 'Any'],
      ['Shields', c.shields.length === SHIELDS.length ? 'Any' : c.shields.length ? c.shields.map((s) => SHIELDS[s]).join(', ') : 'None'],
    ];
    const names = this.host?.weapons.map((w) => w.name) ?? [];
    if (!c.weapons) rows.push(['Weapons', 'Any']);
    else if (names.length) rows.push(['Weapons', c.weapons.map((w) => names[w]).filter(Boolean).join(', ')]);
    const traits = [c.spellcaster && 'Casts spells', c.critical && 'Critical strikes', c.thief && 'Picks locks'].filter(Boolean) as string[];
    if (traits.length) rows.push(['Gifts', traits.join(', ')]);
    const dl = el('dl', 'create-stats');
    for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
    box.append(dl);
    return box;
  }

  private beginQuestions(): void {
    this.draft.questions = pickQuestions(this.data.questions, QUESTIONS, () => this.random());
    this.draft.answers = [];
    this.go('question');
  }

  private answer(i: number): void {
    const d = this.draft;
    const q = d.questions[d.answers.length];
    if (!q?.answers[i]) return;
    d.answers.push(q.answers[i].path);
    if (d.answers.length < d.questions.length) {
      this.render();
      return;
    }
    d.cls = classFromAnswers(d.answers, this.data);
    // Going back from the result asks the last question again.
    d.answers.pop();
    this.go('result');
  }

  // ---- The map ----

  /**
   * The map of Tamriel, with a diamond on the province of the race `mark`
   * is given; a click picks the race whose province is nearest.
   */
  private renderMap(pick: (race: number) => void): { box: HTMLElement; mark: (race: number) => void } {
    const box = el('div', 'create-map');
    const canvas = el('canvas');
    const marker = el('span', 'create-marker');
    marker.hidden = true;
    box.append(canvas, marker);
    // Its room is kept while the map loads, so nothing jumps when it appears.
    box.style.visibility = 'hidden';
    const races = this.data.races.length;
    const near = (e: MouseEvent): number | undefined => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
      const y = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT;
      const spots = [...PROVINCE_AT, IMPERIAL_AT];
      let best = -1;
      let bestDist = Infinity;
      spots.forEach(([sx, sy], i) => {
        const dist = Math.hypot(x - sx, (y - sy) * PIXEL_ASPECT);
        if (dist < bestDist) [best, bestDist] = [i, dist];
      });
      return best >= 0 && best < races ? best : undefined;
    };
    canvas.addEventListener('mousemove', (e) => (canvas.style.cursor = near(e) === undefined ? 'default' : 'pointer'));
    canvas.addEventListener('click', (e) => {
      const i = near(e);
      if (i !== undefined) pick(i);
    });
    const portraits = this.host?.portraits;
    if (!portraits) box.hidden = true;
    void Promise.all([portraits?.map(), portraits?.noExit()]).then(([image, noExit]) => {
      if (!canvas.isConnected) return;
      if (!image) {
        box.hidden = true;
        return;
      }
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      // Arena hides the map's Exit while a character is being made, under its own piece of map.
      if (noExit) ctx.drawImage(noExit.image, noExit.x, noExit.y);
      box.style.visibility = '';
    });
    const mark = (race: number) => {
      const at = PROVINCE_AT[race];
      marker.hidden = !at;
      if (at) marker.style.cssText = `left:${(at[0] / MAP_WIDTH) * 100}%;top:${(at[1] / MAP_HEIGHT) * 100}%`;
    };
    return { box, mark };
  }

  // ---- Attributes and face ----

  /** Rolls the attributes, bonus points, health and gold again, as Arena's "Reroll stats" does. */
  private reroll(): void {
    const d = this.draft;
    const roll = rollAttributes(d.race, d.gender, this.cls!, () => this.random(), this.data.raceAttributes);
    d.rolled = roll.attributes;
    d.added = new Array(ATTRIBUTE_COUNT).fill(0);
    d.bonus = roll.bonus;
    d.healthRoll = roll.healthRoll;
    d.gold = roll.gold;
    d.rolledFor = `${d.race}:${d.gender}:${d.cls}`;
  }

  private get bonusLeft(): number {
    return this.draft.bonus - this.draft.added.reduce((a, b) => a + b, 0);
  }

  /**
   * The sheet, laid out like Arena's (CHARSTAT.IMG): each attribute with what
   * it gives beside it, then health, fatigue, gold, experience and level, and
   * the bonus points left. "Done" asks, as Arena does, whether to keep the
   * attributes or roll them again; keeping them wants every point shared out.
   * Returns the first row.
   */
  private renderAttributes(): HTMLElement {
    const d = this.draft;
    const sheet = this.data.sheet;
    const column = el('div', 'create-sheet create-attributes');
    const nav = el('nav', 'options settings');
    const left = el('p', 'create-bonus');
    const status = el('dl', 'create-status');
    const done = el('button', 'option', 'Done');
    const choice = el('div', 'create-choice');
    const choiceNav = el('nav', 'options create-choices');
    const save = el('button', 'option', sheet.save);
    const again = el('button', 'option', sheet.reroll);
    choiceNav.append(save, again);
    choice.append(el('p', 'create-text', sheet.choose), choiceNav);
    choice.hidden = true;
    const subs: HTMLElement[] = [];
    const rows = this.data.attributes.slice(0, ATTRIBUTE_COUNT).map((name, i) => {
      const row = settingRow(name, '');
      const sub = el('span', 'create-sub');
      row.querySelector('.row-label')!.append(sub);
      subs.push(sub);
      row.addEventListener('step', (e) => this.addPoint(i, (e as StepEvent).detail.delta, show));
      row.addEventListener('click', () => this.addPoint(i, 1, show));
      nav.append(row);
      return row;
    });
    const choosing = (on: boolean) => {
      choice.hidden = !on;
      done.hidden = on;
      rows.forEach((r) => (r.disabled = on));
      (on ? save : done).focus();
    };
    // As in Arena, Done always asks; it is saving that wants every point shared out first.
    done.addEventListener('click', () => choosing(true));
    save.addEventListener('click', () => {
      if (this.bonusLeft === 0) {
        this.go('farewell');
        return;
      }
      choosing(false);
      left.textContent = sheet.distributeAll;
      left.classList.add('warn');
    });
    again.addEventListener('click', () => {
      this.reroll();
      show();
      choosing(false);
      rows[0].focus();
    });
    nav.append(done);
    const show = () => {
      const c = this.character();
      const a = c.attributes;
      rows.forEach((row, i) => {
        const value = row.querySelector('.value')!;
        value.textContent = String(a[i]);
        value.classList.toggle('raised', d.added[i] > 0);
      });
      const spellPoints = startingMagicka(this.cls!, a[INTELLIGENCE]);
      const notes = attributeNotes(a, `${spellPoints}/${spellPoints}`);
      subs.forEach((sub, i) => (sub.textContent = notes[i]));
      const fatigue = maxFatigue(a);
      const lines: Array<[string, string]> = [
        ['Health', `${c.health}/${c.health}`],
        ['Fatigue', `${fatigue}/${fatigue}`],
        ['Gold', String(d.gold)],
        ['Experience', '0'],
        ['Level', '1'],
      ];
      status.replaceChildren(...lines.flatMap(([k, x]) => [el('dt', '', k), el('dd', '', x)]));
      const n = this.bonusLeft;
      left.textContent = `Bonus points: ${n}`;
      left.classList.toggle('done', n === 0);
      left.classList.remove('warn');
    };
    show();
    column.append(left, nav, choice);
    this.body.append(column);
    this.side.append(status);
    return rows[0];
  }

  private addPoint(i: number, delta: number, show: () => void): void {
    const d = this.draft;
    if (delta > 0 && (this.bonusLeft <= 0 || d.rolled![i] + d.added[i] >= ATTRIBUTE_MAX)) return;
    if (delta < 0 && d.added[i] <= 0) return;
    d.added[i] += Math.sign(delta);
    show();
  }

  private changeFace(delta: number): void {
    this.draft.face = (this.draft.face + Math.sign(delta) + FACES) % FACES;
    this.changed?.();
  }

  /** The doll, as the character will look so far. */
  private dollFrame(): HTMLElement {
    const frame = el('div', 'create-doll-frame');
    frame.style.setProperty('--doll-aspect', `${DOLL_WIDTH} / ${DOLL_HEIGHT * PIXEL_ASPECT}`);
    frame.append(this.doll);
    frame.hidden = !this.host?.portraits;
    this.doll.title = this.step === 'look' ? 'Click to change the face' : '';
    this.drawDoll();
    return frame;
  }

  /** Draws the doll in the clothes and starting gear of `cls`; in a shirt and trousers before there is a class. */
  private drawDoll(cls = this.cls): void {
    const portraits = this.host?.portraits;
    if (!portraits) return;
    const d = this.draft;
    let equipment: number[] = [];
    if (cls) {
      const inventory = new Inventory(cls);
      for (const gear of startingGear(this.host!.weapons, cls)) inventory.equip(inventory.add(gear));
      equipment = inventory.pictureFrames();
    }
    void portraits.drawDoll(this.doll, { race: d.race, gender: d.gender, face: d.face, robe: !!cls?.spellcaster, equipment }).then((drawn) => {
      if (drawn !== undefined && this.doll.parentElement) this.doll.parentElement.hidden = !drawn;
    });
  }

  private character(): Character {
    const d = this.draft;
    const attributes = (d.rolled ?? new Array(ATTRIBUTE_COUNT).fill(50)).map((v, i) => v + (d.added[i] ?? 0));
    return {
      name: d.name.trim(),
      gender: d.gender,
      race: d.race,
      cls: d.cls ?? 0,
      attributes,
      face: d.face,
      // Worked out with Endurance as it ends up, as Arena does once the points are shared out.
      health: d.rolled ? startingHealth(d.healthRoll, derivedAttributes(attributes).health) : undefined,
      gold: d.rolled ? d.gold : undefined,
    };
  }

  private finish(): void {
    this.host?.done(this.character());
  }
}

function newDraft(): Draft {
  return {
    gender: 'male',
    name: '',
    race: 0,
    added: new Array(ATTRIBUTE_COUNT).fill(0),
    bonus: 0,
    healthRoll: 0,
    gold: 0,
    face: 0,
    nameStyle: 0,
    questions: [],
    answers: [],
  };
}

/** Marks a list that scrolls with whether there is more of it above and below, for its fades. */
function showMore(list: HTMLElement): void {
  const update = () => {
    list.classList.toggle('more-above', list.scrollTop > 1);
    list.classList.toggle('more-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };
  list.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(list);
}

/** The first sentence of a text. */
function firstSentence(text: string): string {
  return sentences(text, 1);
}

/** The first `n` sentences of a text. */
function sentences(text: string, n: number): string {
  const m = new RegExp(`^(?:.*?[.!?](?=\\s|$)){1,${n}}`).exec(text);
  return m ? m[0] : text;
}
