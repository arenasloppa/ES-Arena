/**
 * The menus over the game, after Skyrim's. Tab (B on a controller) opens the
 * menu of menus, Skyrim's separated plus: the character sheet above, magic to
 * the left, the items to the right and the map below. Pushing a way lights
 * that arm and its name, and letting go opens its menu. The item menu lists what the character
 * carries by kind, with the picked piece and its numbers, and anything in
 * it can be equipped, made a favourite or dropped. The piece is Arena's
 * picture of it given depth, to turn and look at closer as in Skyrim. The magic
 * menu lists the spells the character knows, with what each does at their
 * level and costs, and readies one to cast. The
 * favourites (Q, or up or down on the D-pad) list down the left of the game,
 * where each can be put on a number key (on a controller, the D-pad's left
 * or right) to use without opening a menu. The game waits while any of them
 * is open.
 */
import { experienceFor, POTION_HEALS } from '../game/combat';
import type { Character, CreationData } from '../game/character';
import type { Dungeon, MenuEntry } from '../game/dungeon';
import type { GameMenu } from '../game/engine';
import { ARMOUR_TYPES, HOTKEYS, itemFrame, POTION } from '../game/items';
import { describe as describeSpell, elementName, targetWords } from '../game/magic';
import { spellColour } from '../render/spellView';
import { Repeater, type Direction, type GamepadInput } from '../input/gamepad';
import { ItemView, STICK_TURN } from '../render/itemView';
import type { Portraits } from '../render/portrait';
import { padHotkeyGlyph, type Action, type InputModeWatcher } from './controls';

/** The run the menus show: the dungeon being played and its character. */
export interface MenuRun {
  dungeon: Dungeon;
  character: Character;
  data: CreationData;
}

export interface GameMenuHost {
  /** The run being played; undefined when there is none. */
  run(): MenuRun | undefined;
  portraits(): Portraits | undefined;
  /** Closes the menus and goes back to the game. */
  resume(): void;
  /** Closes the menus and opens the map. */
  openMap(): void;
  /** Closes the menus and opens the pause menu. */
  pause(): void;
}

type TweenPick = 'character' | 'items' | 'magic' | 'map';
const TWEEN: Record<Direction, TweenPick> = { up: 'character', left: 'magic', right: 'items', down: 'map' };
/** How far the stick may still lean once let go of: under the half that picks a way, so a wavering aim doesn't open a menu. */
const LET_GO = 0.25;
const TWEEN_LABELS: Record<TweenPick, string> = { character: 'Character', items: 'Items', magic: 'Magic', map: 'Map' };

interface Category {
  name: string;
  holds(e: MenuEntry): boolean;
}

const CATEGORIES: Category[] = [
  { name: 'Favourites', holds: (e) => e.favourite },
  { name: 'All', holds: () => true },
  { name: 'Weapons', holds: (e) => e.category === 'weapons' },
  { name: 'Apparel', holds: (e) => e.category === 'apparel' },
  { name: 'Potions', holds: (e) => e.category === 'potions' },
  { name: 'Misc', holds: (e) => e.category === 'misc' },
];
const ALL = 1;
const MESSAGE_MS = 3500;

/** A button hint along the bottom, which the mouse can also click. */
interface Hint {
  action: Action;
  label: string;
  run(): void;
}

export class GameMenus {
  private which: GameMenu | undefined;
  private tweenPick: TweenPick | undefined;
  /** The plus menu's arm is being aimed at with the stick or D-pad: its menu opens when they are let go. */
  private padAiming = false;
  /** A stick or D-pad held as the plus menu opened, as from walking: it counts once it has been let go. */
  private padHeld = false;
  /** The key aiming at an arm of the plus menu: its menu opens when the key comes up. */
  private aimKey: string | undefined;
  private category = ALL;
  private column: 'categories' | 'list' = 'list';
  private row = 0;
  private spellRow = 0;
  private favouriteRow = 0;
  private readonly repeater = new Repeater();
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  /** The entry whose picture the item card shows. */
  private pictureKey = '';
  /** When the menus last read the controller, for turning the item with the right stick. */
  private lastFrame = 0;

  private readonly panels: Record<GameMenu, HTMLElement>;
  private readonly tweenOptions: Record<TweenPick, HTMLButtonElement>;
  private readonly tweenArms: Record<TweenPick, HTMLElement>;
  private readonly categoryList: HTMLElement;
  private readonly itemList: HTMLElement;
  private readonly card: HTMLElement;
  private readonly picture: HTMLCanvasElement;
  private readonly itemView: ItemView;
  private readonly cardName: HTMLElement;
  private readonly cardStats: HTMLElement;
  private readonly cardNote: HTMLElement;
  private readonly doll: HTMLCanvasElement;
  private readonly sheet: HTMLElement;
  private readonly magicNote: HTMLElement;
  private readonly spellList: HTMLElement;
  private readonly spellCard: HTMLElement;
  private readonly spellName: HTMLElement;
  private readonly spellStats: HTMLElement;
  private readonly spellEffects: HTMLElement;
  private readonly spellNote: HTMLElement;
  private readonly favouriteList: HTMLElement;
  private readonly message: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly hints: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly pad: GamepadInput,
    private readonly input: InputModeWatcher,
    private readonly host: GameMenuHost,
  ) {
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    // The menu of menus: an arm of the plus each way, with its menu at the end.
    const tween = el('section', 'gm-tween');
    this.tweenOptions = {} as Record<TweenPick, HTMLButtonElement>;
    this.tweenArms = {} as Record<TweenPick, HTMLElement>;
    for (const [direction, pick] of Object.entries(TWEEN) as Array<[Direction, TweenPick]>) {
      const arm = el('span', `tween-arm tween-arm-${direction}`);
      const b = el('button', `tween-option tween-${direction}`, TWEEN_LABELS[pick]);
      b.addEventListener('mouseenter', () => this.pickTween(pick));
      b.addEventListener('click', () => this.openTween(pick));
      this.tweenOptions[pick] = b;
      this.tweenArms[pick] = arm;
      tween.append(arm, b);
    }

    // Items: kinds, the list, and a card for the picked one.
    const items = el('section', 'gm-items');
    this.categoryList = el('ul', 'gm-categories');
    this.categoryList.setAttribute('role', 'listbox');
    this.categoryList.setAttribute('aria-label', 'Kinds of item');
    this.itemList = el('ul', 'gm-list');
    this.itemList.setAttribute('role', 'listbox');
    this.itemList.setAttribute('aria-label', 'Items');
    this.card = el('aside', 'gm-card');
    this.picture = el('canvas', 'gm-picture');
    this.itemView = new ItemView(this.picture);
    this.cardName = el('h3', 'gm-card-name');
    this.cardStats = el('dl', 'gm-card-stats');
    this.cardNote = el('p', 'gm-card-note');
    this.card.append(this.cardName, el('div', 'rule'), this.cardStats, this.cardNote);
    const right = el('div', 'gm-right');
    right.append(this.picture, this.card);
    items.append(this.categoryList, this.itemList, right);

    // Magic: the spells known, and a card for the picked one.
    const magic = el('section', 'gm-magic');
    this.magicNote = el('p', 'gm-empty');
    this.spellList = el('ul', 'gm-list active');
    this.spellList.setAttribute('role', 'listbox');
    this.spellList.setAttribute('aria-label', 'Spells');
    this.spellCard = el('aside', 'gm-card gm-spell-card');
    this.spellName = el('h3', 'gm-card-name');
    this.spellStats = el('dl', 'gm-card-stats');
    this.spellEffects = el('ul', 'gm-spell-effects');
    this.spellNote = el('p', 'gm-card-note');
    this.spellCard.append(this.spellName, el('div', 'rule'), this.spellEffects, this.spellStats, this.spellNote);
    const spellRight = el('div', 'gm-right');
    spellRight.append(this.spellCard);
    magic.append(this.magicNote, this.spellList, spellRight);

    // The character sheet: the paper doll beside the numbers.
    const character = el('section', 'gm-character');
    this.doll = el('canvas', 'gm-doll');
    this.sheet = el('div', 'gm-sheet');
    character.append(this.doll, this.sheet);

    // Favourites, down the left of the game.
    const favourites = el('section', 'gm-favourites');
    this.favouriteList = el('ul', 'gm-list');
    this.favouriteList.setAttribute('role', 'listbox');
    this.favouriteList.setAttribute('aria-label', 'Favourites');
    favourites.append(el('h2', '', 'Favourites'), el('div', 'rule'), this.favouriteList);

    this.panels = { tween, items, magic, character, favourites };
    this.message = el('p', 'gm-message');
    this.message.setAttribute('role', 'status');
    this.bar = el('div', 'gm-bar');
    this.hints = el('div', 'hints gm-hints');
    root.append(...Object.values(this.panels), this.message, this.bar, this.hints);

    // Clicking the dark around the favourites list goes back to the game.
    root.addEventListener('mousedown', (e) => {
      if (this.which === 'favourites' && e.target === root) this.host.resume();
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    input.onChange(() => this.which && this.render());
  }

  get isOpen(): boolean {
    return this.which !== undefined;
  }

  get current(): GameMenu | undefined {
    return this.which;
  }

  /** Opens one of the menus; the caller has paused the game. */
  open(which: GameMenu): void {
    if (!this.host.run()) return;
    this.which = which;
    this.root.hidden = false;
    this.root.dataset.panel = which;
    for (const [name, panel] of Object.entries(this.panels)) panel.hidden = name !== which;
    // A stick or D-pad still held from walking, or from picking this menu, shouldn't move through it.
    this.repeater.hold(this.pad.connected ? this.pad.direction() : undefined);
    if (which === 'tween') {
      this.tweenPick = this.aimKey = undefined;
      this.padAiming = false;
      this.padHeld = this.pad.connected && this.pushed();
    }
    if (which === 'items') this.column = this.shown().length ? 'list' : 'categories';
    if (which === 'favourites') this.favouriteRow = 0;
    this.showMessage('');
    this.render();
  }

  close(): void {
    if (!this.which) return;
    this.which = undefined;
    this.root.hidden = true;
    clearTimeout(this.messageTimer);
  }

  /** Acts on the controller; call every frame while a menu is open, after the controller was read. */
  frame(now: number): void {
    const pad = this.pad;
    if (!this.which || !pad.connected) return;
    if (pad.take('Start')) return this.host.pause();
    if (pad.take('B')) return this.back();
    const which = this.which;
    if (which === 'favourites') {
      // The D-pad's left and right are the controller's two hotkeys.
      if (pad.take('Left')) this.setHotkey(0);
      if (pad.take('Right')) this.setHotkey(1);
    }
    if (pad.take('A')) this.choose();
    if (pad.take('Y')) this.toggleFavourite();
    if (pad.take('X') && which === 'items') this.drop();
    if (which === 'items') {
      if (pad.take('LB')) this.moveCategory(-1);
      if (pad.take('RB')) this.moveCategory(1);
      if (pad.take('RS')) this.itemView.toggleZoom();
      // The right stick turns the picked item.
      const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
      const { x, y } = pad.look;
      if (!this.picture.hidden && (x || y)) this.itemView.turn(x * STICK_TURN * dt, y * STICK_TURN * dt);
    }
    this.lastFrame = now;
    if (this.which === 'tween') {
      this.aimWithPad();
      return;
    }
    const direction = this.repeater.update(pad.direction(), now);
    if (direction && !(which === 'favourites' && (direction === 'left' || direction === 'right'))) this.go(direction);
  }

  // ---- Moving about ----

  /**
   * The plus menu with the stick or the D-pad: aiming lights an arm and its
   * name, and letting go opens its menu, as in Skyrim.
   */
  private aimWithPad(): void {
    const direction = this.pad.direction();
    if (this.padHeld) {
      this.padHeld = this.pushed();
      return;
    }
    if (direction) {
      this.padAiming = true;
      if (TWEEN[direction] !== this.tweenPick) this.pickTween(TWEEN[direction]);
    } else if (this.padAiming && !this.pushed()) {
      this.padAiming = false;
      if (this.tweenPick) this.openTween(this.tweenPick);
    }
  }

  /** Whether the D-pad or the stick is still pushed any way. */
  private pushed(): boolean {
    const { x, y } = this.pad.move;
    return this.pad.direction() !== undefined || Math.max(Math.abs(x), Math.abs(y)) >= LET_GO;
  }

  private go(direction: Direction): void {
    switch (this.which) {
      case 'items':
        if (direction === 'left') this.column = 'categories';
        else if (direction === 'right') {
          if (this.shown().length) this.column = 'list';
        } else if (this.column === 'categories') this.moveCategory(direction === 'up' ? -1 : 1);
        else this.row = step(this.row, direction === 'up' ? -1 : 1, this.shown().length);
        this.render();
        break;
      case 'magic':
        if (direction === 'up' || direction === 'down') {
          this.spellRow = step(this.spellRow, direction === 'up' ? -1 : 1, this.spells().length);
          this.render();
        }
        break;
      case 'favourites':
        if (direction === 'up' || direction === 'down') {
          this.favouriteRow = step(this.favouriteRow, direction === 'up' ? -1 : 1, this.favourites().length);
          this.render();
        }
        break;
      default:
        break;
    }
  }

  /** A, Enter or E: open the picked menu, go into the list, or use the picked entry. */
  private choose(): void {
    if (this.which === 'tween') {
      if (this.tweenPick) this.openTween(this.tweenPick);
    } else if (this.which === 'items') {
      if (this.column === 'categories') this.go('right');
      else this.use(this.selected());
    } else if (this.which === 'magic') this.use(this.selectedSpell());
    else if (this.which === 'favourites') this.use(this.favourites()[this.favouriteRow]);
  }

  /** B or Esc: from the item list to its kinds, otherwise back to the game. */
  private back(): void {
    if (this.which === 'items' && this.column === 'list') {
      this.column = 'categories';
      this.render();
    } else this.host.resume();
  }

  private pickTween(pick: TweenPick): void {
    this.tweenPick = pick;
    this.render();
  }

  private openTween(pick: TweenPick): void {
    if (pick === 'map') this.host.openMap();
    else this.open(pick);
  }

  private moveCategory(delta: number): void {
    this.category = (this.category + delta + CATEGORIES.length) % CATEGORIES.length;
    this.row = 0;
    this.render();
  }

  // ---- Acting on entries ----

  private use(entry: MenuEntry | undefined): void {
    const d = this.host.run()?.dungeon;
    if (!d || !entry) return;
    this.showMessage(d.use(entry.key) ?? '');
    this.render();
  }

  private toggleFavourite(): void {
    const d = this.host.run()?.dungeon;
    const entry = this.picked();
    if (!d || !entry || (entry.key !== POTION && !entry.item && !entry.spell)) return;
    const now = d.favourite(entry.key);
    this.showMessage(`${entry.name} ${now ? 'added to' : 'taken off'} the favourites`);
    this.render();
  }

  private drop(): void {
    const d = this.host.run()?.dungeon;
    const entry = this.selected();
    if (!d || !entry?.item || this.column !== 'list') return;
    this.showMessage(d.drop(entry.key) ?? '');
    this.render();
  }

  /** Puts the picked entry on number key n + 1, making it a favourite if it isn't. */
  private setHotkey(n: number): void {
    const d = this.host.run()?.dungeon;
    const entry = this.which === 'items' && this.column !== 'list' ? undefined : this.picked();
    if (!d || !entry || (entry.key !== POTION && !entry.item && !entry.spell)) return;
    d.setHotkey(n, entry.key);
    const where = this.input.mode === 'gamepad' && n < 2 ? `the D-pad's ${n === 0 ? 'left' : 'right'}` : String(n + 1);
    this.showMessage(`${entry.name} put on ${where}`);
    this.render();
  }

  /** The entry picked in the open menu, if it has one. */
  private picked(): MenuEntry | undefined {
    switch (this.which) {
      case 'favourites':
        return this.favourites()[this.favouriteRow];
      case 'items':
        return this.selected();
      case 'magic':
        return this.selectedSpell();
      default:
        return undefined;
    }
  }

  private showMessage(text: string): void {
    this.message.textContent = text;
    this.message.classList.toggle('shown', !!text);
    clearTimeout(this.messageTimer);
    if (text) this.messageTimer = setTimeout(() => this.message.classList.remove('shown'), MESSAGE_MS);
  }

  // ---- What there is to show ----

  private entries(): MenuEntry[] {
    const d = this.host.run()?.dungeon;
    return d ? d.entries().sort((a, b) => a.name.localeCompare(b.name)) : [];
  }

  /** The entries of the kind picked in the item menu. */
  private shown(): MenuEntry[] {
    return this.entries().filter(CATEGORIES[this.category].holds);
  }

  private selected(): MenuEntry | undefined {
    const shown = this.shown();
    this.row = Math.min(this.row, Math.max(0, shown.length - 1));
    return shown[this.row];
  }

  /** The spells the character knows, cheapest first. */
  private spells(): MenuEntry[] {
    return this.host.run()?.dungeon.spellEntries() ?? [];
  }

  private selectedSpell(): MenuEntry | undefined {
    const spells = this.spells();
    this.spellRow = Math.min(this.spellRow, Math.max(0, spells.length - 1));
    return spells[this.spellRow];
  }

  /** The favourites the character still has, in the order they were chosen. */
  private favourites(): MenuEntry[] {
    const d = this.host.run()?.dungeon;
    if (!d) return [];
    const byKey = new Map([...d.entries(), ...d.spellEntries()].map((e) => [e.key, e]));
    return d.inventory.favourites.flatMap((key) => byKey.get(key) ?? []);
  }

  // ---- Drawing ----

  private render(): void {
    const run = this.host.run();
    if (!run || !this.which) return;
    switch (this.which) {
      case 'tween':
        for (const [pick, b] of Object.entries(this.tweenOptions)) b.classList.toggle('picked', pick === this.tweenPick);
        for (const [pick, arm] of Object.entries(this.tweenArms)) arm.classList.toggle('picked', pick === this.tweenPick);
        this.renderBar(run, true);
        this.setHints([
          { action: 'use', label: 'Open', run: () => this.choose() },
          { action: 'close', label: 'Close', run: () => this.host.resume() },
        ]);
        break;
      case 'items':
        this.renderItems(run);
        break;
      case 'magic':
        this.renderMagic(run);
        break;
      case 'character':
        this.renderCharacter(run);
        this.renderBar(run, true);
        this.setHints([{ action: 'back', label: 'Back', run: () => this.back() }]);
        break;
      case 'favourites':
        this.renderFavourites();
        this.bar.hidden = true;
        break;
    }
  }

  private renderItems(run: MenuRun): void {
    const all = this.entries();
    this.categoryList.replaceChildren(
      ...CATEGORIES.map((c, i) => {
        const li = el('li', 'gm-category', c.name);
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === this.category));
        li.classList.toggle('picked', i === this.category);
        li.classList.toggle('active', i === this.category && this.column === 'categories');
        li.classList.toggle('empty', !all.some(c.holds));
        li.addEventListener('click', () => {
          this.category = i;
          this.row = 0;
          this.column = this.shown().length ? 'list' : 'categories';
          this.render();
        });
        return li;
      }),
    );
    const shown = this.shown();
    const picked = this.selected();
    this.itemList.classList.toggle('active', this.column === 'list');
    this.itemList.replaceChildren(
      ...(shown.length
        ? shown.map((entry, i) => {
            const li = this.entryRow(entry, i === this.row && this.column === 'list');
            li.addEventListener('mouseenter', () => {
              if (this.row === i && this.column === 'list') return;
              this.row = i;
              this.column = 'list';
              this.render();
            });
            li.addEventListener('click', () => this.use(entry));
            return li;
          })
        : [el('li', 'gm-nothing', 'Nothing')]),
    );
    this.itemList.querySelector('.picked')?.scrollIntoView({ block: 'nearest' });
    this.renderCard(run, this.column === 'list' ? picked : undefined);
    this.renderBar(run, false);
    const hints: Hint[] = [];
    if (picked && this.column === 'list') {
      const verb = picked.key === POTION ? 'Drink' : picked.item ? (picked.equipped ? 'Unequip' : 'Equip') : undefined;
      if (verb) hints.push({ action: 'use', label: verb, run: () => this.use(picked) });
      if (picked.key === POTION || picked.item) {
        hints.push({ action: 'favourite', label: picked.favourite ? 'Unfavourite' : 'Favourite', run: () => this.toggleFavourite() });
      }
      if (picked.item) hints.push({ action: 'drop', label: 'Drop', run: () => this.drop() });
      // The item's picture is there to turn, where the screen is wide enough to show it.
      if (picked.item && !matchMedia('(max-width: 720px)').matches) {
        hints.push({ action: 'turnItem', label: 'Turn', run: () => this.itemView.spin() }, { action: 'zoomItem', label: 'Zoom', run: () => this.itemView.toggleZoom() });
      }
    } else if (this.column === 'categories' && shown.length) hints.push({ action: 'use', label: 'Select', run: () => this.choose() });
    hints.push({ action: 'back', label: this.column === 'list' ? 'Back' : 'Close', run: () => this.back() });
    this.setHints(hints);
  }

  private entryRow(entry: MenuEntry, picked: boolean): HTMLLIElement {
    const li = el('li', 'gm-row');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(picked));
    li.classList.toggle('picked', picked);
    li.classList.toggle('equipped', entry.equipped);
    const mark = el('span', 'gm-mark');
    mark.setAttribute('aria-hidden', 'true');
    const name = el('span', 'gm-name', entry.name);
    li.append(mark, name);
    if (entry.count > 1) li.append(el('span', 'gm-count', `(${entry.count})`));
    if (entry.favourite) li.append(el('span', 'gm-star', '★'));
    if (entry.hotkey !== undefined) li.append(this.hotkeyBadge(entry.hotkey));
    const d = this.host.run()?.dungeon;
    if (entry.item && d?.inventory.forbidden(entry.item)) li.classList.add('forbidden');
    if (entry.equipped) li.setAttribute('aria-label', `${entry.name}, equipped`);
    return li;
  }

  /** The number key an entry is on; with a controller, the D-pad's arm for the first two. */
  private hotkeyBadge(n: number): HTMLElement {
    const badge = el('span', 'gm-hotkey');
    if (this.input.mode === 'gamepad' && n < 2) badge.append(padHotkeyGlyph(n));
    else badge.textContent = String(n + 1);
    if (this.input.mode === 'gamepad' && n >= 2) badge.classList.add('dim');
    return badge;
  }

  private renderCard(run: MenuRun, entry: MenuEntry | undefined): void {
    this.card.hidden = !entry;
    if (entry?.key !== this.pictureKey || !entry?.item) {
      this.picture.hidden = true;
      this.pictureKey = '';
    }
    if (!entry) return;
    this.cardName.textContent = entry.name;
    const rows: Array<[string, string]> = [];
    const item = entry.item;
    let note = '';
    if (item) {
      if (item.kind === 'weapon' && item.damage) rows.push(['Damage', `${item.damage[0]}–${item.damage[1]}`]);
      else rows.push(['Armour', String(item.rating ?? 0)]);
      rows.push(['Weight', weight(item.weight)], ['Value', String(item.value)]);
      const kind = item.kind === 'armour' ? `${ARMOUR_TYPES[item.armour ?? 0]} armour` : item.kind === 'shield' ? 'Shield' : item.twoHanded ? 'Two-handed' : 'One-handed';
      note = run.dungeon.inventory.forbidden(item) ?? (entry.equipped ? `${kind}, equipped` : kind);
      this.card.classList.toggle('forbidden', !!run.dungeon.inventory.forbidden(item));
      if (this.pictureKey !== entry.key) void this.showPicture(itemFrame(item), run.character.gender, entry.key);
    } else if (entry.key === POTION) {
      rows.push(['Heals', String(POTION_HEALS)], ['Count', String(entry.count)]);
      note = 'Restores health';
      this.card.classList.remove('forbidden');
    } else {
      rows.push(['Count', String(entry.count)]);
      note = 'Opens a locked door in this dungeon';
      this.card.classList.remove('forbidden');
    }
    this.cardStats.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = el('dt', '', k);
        const dd = el('dd', '', v);
        return [dt, dd];
      }),
    );
    this.cardNote.textContent = note;
  }

  /** Shows the item's picture from the game as a model to turn, if it is still the one picked when it loads. */
  private async showPicture(frame: number, gender: Character['gender'], key: string): Promise<void> {
    this.pictureKey = key;
    const image = await this.host.portraits()?.item(frame, gender);
    if (!image || this.which !== 'items' || this.pictureKey !== key) return;
    // Shown first, so the view has a size to draw at.
    this.picture.hidden = false;
    if (!this.itemView.show(image)) this.picture.hidden = true;
  }

  private renderMagic(run: MenuRun): void {
    const d = run.dungeon;
    const spells = this.spells();
    const picked = this.selectedSpell();
    const caster = d.stats.maxMagicka > 0;
    this.magicNote.hidden = spells.length > 0;
    this.magicNote.textContent = !caster
      ? `${run.data.classes[run.character.cls]?.name ?? 'Your class'}s cannot cast spells.`
      : 'You know no spells: the game’s spell list (SPELLSG.65) could not be read.';
    this.spellList.hidden = !spells.length;
    this.spellList.replaceChildren(
      ...spells.map((entry, i) => {
        const li = this.entryRow(entry, i === this.spellRow);
        const cost = d.spellCost(entry.spell!);
        li.append(el('span', 'gm-count', `${cost}`));
        if (cost > d.stats.magicka) li.classList.add('forbidden');
        li.addEventListener('mouseenter', () => {
          if (this.spellRow === i) return;
          this.spellRow = i;
          this.render();
        });
        li.addEventListener('click', () => this.use(entry));
        return li;
      }),
    );
    this.spellList.querySelector('.picked')?.scrollIntoView({ block: 'nearest' });
    this.spellCard.hidden = !picked;
    if (picked?.spell) {
      const spell = picked.spell;
      this.spellCard.style.setProperty('--spell', spellColour(spell));
      this.spellName.textContent = spell.name;
      this.spellEffects.replaceChildren(...describeSpell(spell, d.stats.level).map((line) => el('li', '', line)));
      const rows: Array<[string, string]> = [
        ['Cost', `${d.spellCost(spell)} spell points`],
        ['Target', targetWords(spell)],
      ];
      const element = elementName(spell);
      if (element) rows.push(['Element', element]);
      this.spellStats.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', '', k), el('dd', '', v)]));
      this.spellNote.textContent = picked.equipped ? 'Readied: cast it with the block button' : 'Costs less at each level';
    }
    this.renderMagicBar(run);
    const hints: Hint[] = [];
    if (picked) {
      hints.push({ action: 'use', label: picked.equipped ? 'Put away' : 'Ready', run: () => this.use(picked) });
      hints.push({ action: 'favourite', label: picked.favourite ? 'Unfavourite' : 'Favourite', run: () => this.toggleFavourite() });
    }
    hints.push({ action: 'back', label: 'Close', run: () => this.back() });
    this.setHints(hints);
  }

  /** The magic menu's bottom bar: spell points and the spells working on the character. */
  private renderMagicBar(run: MenuRun): void {
    const d = run.dungeon;
    const s = d.stats;
    this.bar.hidden = false;
    this.bar.replaceChildren(stat('Spell points', `${Math.floor(s.magicka)}/${s.maxMagicka}`), stat('Level', String(s.level)));
    const effects = d.activeEffects();
    if (effects.length) this.bar.append(stat('Active', effects.join(', ')));
  }

  private renderCharacter(run: MenuRun): void {
    const { dungeon: d, character: c, data } = run;
    const cls = data.classes[c.cls];
    const race = data.races[c.race];
    const s = d.stats;
    const hero = d.hero;
    const portraits = this.host.portraits();
    this.doll.hidden = !portraits;
    void portraits
      ?.drawDoll(this.doll, { race: c.race, gender: c.gender, face: c.face, robe: !!cls?.spellcaster, equipment: d.inventory.pictureFrames() })
      .then((drawn) => drawn !== undefined && (this.doll.hidden = !drawn));
    const title = el('h2', 'gm-title', c.name);
    const sub = el('p', 'gm-sub', `Level ${s.level} ${race?.name ?? ''} ${cls?.name ?? ''}`.replace(/\s+/g, ' '));
    const attributes = el('dl', 'gm-attributes');
    data.attributes.forEach((name, i) => attributes.append(el('dt', '', name), el('dd', '', String(c.attributes[i] ?? 0))));
    const next = experienceFor(s.level + 1, hero.experience);
    const [low, high] = s.weapon.damage;
    const bonus = hero.damageBonus ? ` ${hero.damageBonus > 0 ? '+' : '−'}${Math.abs(hero.damageBonus)}` : '';
    const rows: Array<[string, string]> = [
      ['Health', `${Math.ceil(s.health)} / ${s.maxHealth}`],
      ['Stamina', `${Math.floor(s.stamina)} / ${s.maxStamina}`],
      ...(s.maxMagicka > 0 ? [['Spell points', `${Math.floor(s.magicka)} / ${s.maxMagicka}`] as [string, string]] : []),
      ['Armour', String(d.inventory.armourRating())],
      ['Damage', `${low}–${high}${bonus}`],
      ['Experience', `${s.experience} / ${next}`],
      ['Gold', String(s.gold)],
      ['Carrying', `${weight(d.inventory.weight(s.potions))} / ${hero.carry}`],
    ];
    if (hero.critical > 0) rows.push(['Critical strikes', `${Math.round(hero.critical * 100)}%`]);
    if (hero.lockpicking > 0) rows.push(['Lock picking', `${Math.round(Math.min(0.95, hero.lockpicking + 0.05 * (s.level - 1)) * 100)}%`]);
    const derived = el('dl', 'gm-derived');
    for (const [k, v] of rows) derived.append(el('dt', '', k), el('dd', '', v));
    this.sheet.replaceChildren(title, sub, el('div', 'rule'), attributes, derived);
  }

  private renderFavourites(): void {
    const list = this.favourites();
    this.favouriteRow = Math.min(this.favouriteRow, Math.max(0, list.length - 1));
    this.favouriteList.replaceChildren(
      ...(list.length
        ? list.map((entry, i) => {
            const li = this.entryRow(entry, i === this.favouriteRow);
            li.querySelector('.gm-star')?.remove();
            li.addEventListener('mouseenter', () => {
              if (this.favouriteRow === i) return;
              this.favouriteRow = i;
              this.render();
            });
            li.addEventListener('click', () => this.use(entry));
            return li;
          })
        : [el('li', 'gm-nothing', 'No favourites yet: press F in the item menu to add one')]),
    );
    this.favouriteList.querySelector('.picked')?.scrollIntoView({ block: 'nearest' });
    const hints: Hint[] = [];
    if (list.length) {
      hints.push({ action: 'use', label: 'Use', run: () => this.choose() });
      hints.push({ action: 'setHotkey', label: 'Hotkey', run: () => this.showMessage(this.hotkeyHelp()) });
      hints.push({ action: 'favourite', label: 'Remove', run: () => this.toggleFavourite() });
    }
    hints.push({ action: 'back', label: 'Close', run: () => this.back() });
    this.setHints(hints);
  }

  private hotkeyHelp(): string {
    return this.input.mode === 'gamepad'
      ? "Press left or right on the D-pad to put the picked favourite there; in the game, the same press uses it"
      : `Press a number from 1 to ${HOTKEYS} to put the picked favourite on it; in the game, the same key uses it`;
  }

  /** The bottom bar: the character's level and progress, or what they carry. */
  private renderBar(run: MenuRun, level: boolean): void {
    const { dungeon: d, character: c } = run;
    const s = d.stats;
    this.bar.hidden = false;
    this.bar.replaceChildren();
    if (level) {
      const before = experienceFor(s.level, d.hero.experience);
      const after = experienceFor(s.level + 1, d.hero.experience);
      const progress = Math.max(0, Math.min(1, (s.experience - before) / Math.max(1, after - before)));
      const xp = el('div', 'bar gm-xp');
      xp.append(el('div', 'bar-fill'));
      xp.style.setProperty('--fill', progress.toFixed(3));
      xp.setAttribute('aria-label', `${Math.round(progress * 100)}% of the way to level ${s.level + 1}`);
      this.bar.append(
        stat('Health', `${Math.ceil(s.health)}/${s.maxHealth}`),
        el('span', 'gm-who', `${c.name}`),
        stat('Level', String(s.level)),
        xp,
        stat('Stamina', `${Math.floor(s.stamina)}/${s.maxStamina}`),
      );
    } else {
      const carried = d.inventory.weight(s.potions);
      const load = stat('Weight', `${weight(carried)}/${d.hero.carry}`);
      load.classList.toggle('over', carried > d.hero.carry);
      this.bar.append(stat('Armour', String(d.inventory.armourRating())), load, stat('Gold', String(s.gold)));
    }
  }

  private setHints(hints: Hint[]): void {
    this.hints.replaceChildren(
      ...hints.map((h) => {
        const b = el('button', 'hint');
        b.type = 'button';
        const glyph = el('span');
        glyph.dataset.glyph = h.action;
        b.append(glyph, h.label);
        b.addEventListener('click', h.run);
        return b;
      }),
    );
    this.input.render(this.hints);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.which || e.defaultPrevented) return;
    // Typing in a box is not for the menus (there is none in them, but be safe).
    if (e.target instanceof HTMLInputElement) return;
    const which = this.which;
    const code = e.code;
    const handled = () => e.preventDefault();
    if (code === 'Tab' || (code === 'KeyI' && which === 'items') || (code === 'KeyP' && which === 'magic') || (code === 'KeyQ' && which === 'favourites')) {
      handled();
      this.host.resume();
      return;
    }
    if (code === 'Escape' || code === 'Backspace') {
      handled();
      this.back();
      return;
    }
    if (code === 'KeyI' || code === 'KeyP') {
      handled();
      this.open(code === 'KeyI' ? 'items' : 'magic');
      return;
    }
    if (code === 'KeyM' && which === 'tween') {
      handled();
      this.host.openMap();
      return;
    }
    const direction = KEY_DIRECTIONS.get(code);
    if (direction) {
      handled();
      if (which === 'favourites' && (direction === 'left' || direction === 'right')) return;
      if (which === 'tween') {
        // The key lights its arm, and opens it when it comes up (onKeyUp). A key held from walking does neither.
        if (!e.repeat) {
          this.aimKey = code;
          this.pickTween(TWEEN[direction]);
        }
        return;
      }
      this.go(direction);
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE' || code === 'Space') {
      handled();
      if (!e.repeat) this.choose();
      return;
    }
    if (code === 'KeyF') {
      handled();
      this.toggleFavourite();
      return;
    }
    if (code === 'KeyR' && which === 'items') {
      handled();
      this.drop();
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-8])$/.exec(code);
    if (digit && (which === 'favourites' || which === 'items' || which === 'magic')) {
      handled();
      this.setHotkey(Number(digit[1]) - 1);
    }
  };

  /** The key that lit an arm of the plus menu comes up: its menu opens. */
  private onKeyUp = (e: KeyboardEvent) => {
    if (this.which !== 'tween' || e.code !== this.aimKey) return;
    e.preventDefault();
    this.aimKey = undefined;
    if (this.tweenPick) this.openTween(this.tweenPick);
  };
}

const KEY_DIRECTIONS = new Map<string, Direction>([
  ['ArrowUp', 'up'],
  ['KeyW', 'up'],
  ['ArrowDown', 'down'],
  ['KeyS', 'down'],
  ['ArrowLeft', 'left'],
  ['KeyA', 'left'],
  ['ArrowRight', 'right'],
  ['KeyD', 'right'],
]);

/** Moves through a list of `length`, stopping at the ends. */
function step(index: number, delta: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index + delta));
}

/** Kilograms, with a decimal only when there is one. */
function weight(kg: number): string {
  return String(Math.round(kg * 10) / 10);
}

function stat(label: string, value: string): HTMLElement {
  const span = el('span', 'gm-stat');
  span.append(el('span', 'gm-stat-label', label), el('b', '', value));
  return span;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
