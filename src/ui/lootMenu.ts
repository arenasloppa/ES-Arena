import type {Dungeon} from '../game/dungeon';
import {Repeater, type GamepadInput} from '../input/gamepad';
import {type InputModeWatcher} from './controls';

/** Pauses while choosing drops, using the same use/close controls as inventory. */
export class LootMenu {
  private dungeon?: Dungeon;
  private row = 0;
  private readonly repeat = new Repeater();
  private readonly root = document.createElement('section');
  constructor(private readonly pad: GamepadInput, private readonly input: InputModeWatcher, private readonly resume: () => void) {
    this.root.id = 'loot-menu';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Items');
    document.body.append(this.root);
    window.addEventListener('keydown', this.key, true);
    input.onChange(() => {if(this.isOpen)this.input.render(this.root);});
  }
  get isOpen(): boolean { return !!this.dungeon; }
  open(dungeon: Dungeon): void {
    if (!dungeon.lootView) return;
    this.dungeon = dungeon;
    this.row = 0;
    this.repeat.hold(this.pad.direction());
    this.root.hidden = false;
    this.render();
  }
  close(resume = true): void {
    if (!this.dungeon) return;
    this.dungeon.closeLoot();
    this.dungeon = undefined;
    this.root.hidden = true;
    this.pad.resync();
    if (resume) this.resume();
  }
  frame(now: number): void {
    if (!this.dungeon) return;
    if (this.pad.take('B') || this.pad.take('Start')) return this.close();
    if (this.pad.take('Y')) return this.take();
    const direction = this.repeat.update(this.pad.direction(), now);
    if (direction === 'up' || direction === 'down') this.move(direction === 'up' ? -1 : 1);
    if (this.pad.take('A')) this.take(this.dungeon.lootView?.entries[this.row]?.key);
  }
  private move(by: number): void {
    const count = this.dungeon?.lootView?.entries.length ?? 0;
    this.row = Math.max(0, Math.min(count - 1, this.row + by));
    this.render();
  }
  private take(key?: string): void {
    const dungeon = this.dungeon;
    if (!dungeon) return;
    dungeon.takeLoot(key);
    if (!dungeon.lootView) this.close();
    else { this.row = Math.min(this.row, dungeon.lootView.entries.length - 1); this.render(); }
  }
  private key = (event: KeyboardEvent): void => {
    if (!this.dungeon) return;
    const code = event.code;
    if (!['Escape', 'Tab', 'KeyE', 'Enter', 'KeyR', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat && !['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(code)) return;
    if (code === 'Escape' || code === 'Tab') this.close();
    else if (code === 'KeyR') this.take();
    else if (code === 'Enter' || code === 'KeyE') this.take(this.dungeon.lootView?.entries[this.row]?.key);
    else this.move(code === 'ArrowUp' || code === 'KeyW' ? -1 : 1);
  };
  private render(): void {
    const view = this.dungeon?.lootView;
    if (!view) return;
    const title = document.createElement('h2'); title.textContent = view.name==='Loot'?'Items':view.name;
    const list = document.createElement('ul'); list.className = 'loot-drops';
    view.entries.forEach((entry, i) => {
      const li = document.createElement('li'), button = document.createElement('button');
      button.textContent = entry.name + (entry.count > 1 ? ` (${entry.count})` : '');
      if(entry.colour)button.style.color=entry.colour;
      button.classList.toggle('selected', i === this.row);
      button.addEventListener('mousemove', (event) => { if(this.input.mode!=='keyboard'||(!event.movementX&&!event.movementY))return;this.row = i; list.querySelectorAll('button').forEach((b, n) => b.classList.toggle('selected', n === i)); });
      button.addEventListener('click', () => this.take(entry.key)); li.append(button); list.append(li);
    });
    const actions = document.createElement('footer');
    for (const [label, action, run] of [
      ['Take', 'use', () => this.take(view.entries[this.row]?.key)],
      ['Take All', 'lootTakeAll', () => this.take()],
      ['Close', 'close', () => this.close()],
    ] as const) {
      const button = document.createElement('button');
      const glyph=document.createElement('span');glyph.dataset.glyph=action;button.append(glyph);
      button.append(` ${label}`); button.addEventListener('click', run); actions.append(button);
    }
    this.root.replaceChildren(title, list, actions);this.input.render(actions);
    list.children[this.row]?.scrollIntoView({block: 'nearest'});
  }
}
