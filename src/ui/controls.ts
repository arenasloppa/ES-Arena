/**
 * Which keys and controller buttons do what, and the key caps and button
 * icons drawn for them. Like Skyrim, the prompts follow the device used last:
 * keyboard keys, or the connected controller's own button labels.
 */
import type { GamepadInput, PadStyle } from '../input/gamepad';

export type InputMode = 'keyboard' | 'gamepad';

/** Controller inputs, named by their place on an Xbox controller. */
type PadInput = 'A' | 'B' | 'Y' | 'LB' | 'Start' | 'LStick' | 'RStick' | 'LStickPress' | 'DPad';

export type Action = 'move' | 'look' | 'activate' | 'jump' | 'sprint' | 'sneak' | 'menu' | 'select' | 'back' | 'change';

interface Binding {
  label: string;
  keys: string[];
  pad: PadInput[];
}

export const BINDINGS: Record<Action, Binding> = {
  move: { label: 'Move', keys: ['W', 'A', 'S', 'D'], pad: ['LStick'] },
  look: { label: 'Look', keys: ['Mouse'], pad: ['RStick'] },
  activate: { label: 'Open doors', keys: ['E'], pad: ['A'] },
  jump: { label: 'Jump', keys: ['Space'], pad: ['Y'] },
  sprint: { label: 'Sprint', keys: ['Shift'], pad: ['LB'] },
  sneak: { label: 'Sneak', keys: ['C'], pad: ['LStickPress'] },
  menu: { label: 'Menu', keys: ['Esc', 'Tab'], pad: ['B', 'Start'] },
  select: { label: 'Select', keys: ['Enter'], pad: ['A'] },
  back: { label: 'Back', keys: ['Esc'], pad: ['B'] },
  change: { label: 'Change', keys: ['←', '→'], pad: ['DPad'] },
};

/** The in-game actions, in the order the controls screen and the first-time tips list them. */
export const GAME_ACTIONS: Action[] = ['move', 'look', 'activate', 'jump', 'sprint', 'sneak', 'menu'];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small line drawings for symbols that fonts draw differently on every system. */
const ICONS: Record<string, string> = {
  cross: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  circle: '<circle cx="8" cy="8" r="4.2"/>',
  triangle: '<path d="M8 3.6l4.6 8H3.4z"/>',
  menu: '<path d="M4 5h8M4 8h8M4 11h8"/>',
  dpad: '<path d="M6.2 2.5h3.6v3.7h3.7v3.6H9.8v3.7H6.2V9.8H2.5V6.2h3.7z"/>',
  '←': '<path d="M12.5 8h-9M7 4.5L3.5 8 7 11.5"/>',
  '→': '<path d="M3.5 8h9M9 4.5l3.5 3.5L9 11.5"/>',
};

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

type Face = { text: string } | { icon: string };

const FACE: Record<PadStyle, Record<'A' | 'B' | 'Y', Face>> = {
  xbox: { A: { text: 'A' }, B: { text: 'B' }, Y: { text: 'Y' } },
  playstation: { A: { icon: 'cross' }, B: { icon: 'circle' }, Y: { icon: 'triangle' } },
  // Nintendo's letters sit elsewhere: its B is where Xbox has A.
  nintendo: { A: { text: 'B' }, B: { text: 'A' }, Y: { text: 'X' } },
};

const OTHER: Record<PadStyle, Record<'LB' | 'Start' | 'LStickPress', Face>> = {
  xbox: { LB: { text: 'LB' }, Start: { icon: 'menu' }, LStickPress: { text: 'LS' } },
  playstation: { LB: { text: 'L1' }, Start: { text: 'OPTIONS' }, LStickPress: { text: 'L3' } },
  nintendo: { LB: { text: 'L' }, Start: { text: '+' }, LStickPress: { text: 'LS' } },
};

function fill(el: HTMLElement, face: Face): HTMLElement {
  if ('icon' in face) el.append(icon(face.icon));
  else el.textContent = face.text;
  return el;
}

function keyCap(key: string): HTMLElement {
  const k = document.createElement('kbd');
  k.className = key.length > 1 && !(key in ICONS) ? 'glyph key wide' : 'glyph key';
  return fill(k, key in ICONS ? { icon: key } : { text: key });
}

function padGlyph(input: PadInput, style: PadStyle): HTMLElement {
  const g = document.createElement('span');
  g.className = 'glyph pad';
  if (input === 'A' || input === 'B' || input === 'Y') {
    g.classList.add('face', `face-${input.toLowerCase()}`);
    return fill(g, FACE[style][input]);
  }
  if (input === 'LStick' || input === 'RStick') {
    g.classList.add('stick');
    g.textContent = input[0];
    return g;
  }
  if (input === 'DPad') {
    g.classList.add('dpad');
    return fill(g, { icon: 'dpad' });
  }
  g.classList.add(input === 'LStickPress' ? 'stick' : 'shoulder');
  return fill(g, OTHER[style][input]);
}

export function glyphs(action: Action, mode: InputMode, style: PadStyle): HTMLElement[] {
  const b = BINDINGS[action];
  return mode === 'keyboard' ? b.keys.map(keyCap) : b.pad.map((p) => padGlyph(p, style));
}

/**
 * Tracks whether the player last used the keyboard and mouse or a controller,
 * and redraws every [data-glyph] prompt to match. A prompt with
 * data-glyph-mode always shows that device's buttons.
 */
export class InputModeWatcher {
  mode: InputMode = 'keyboard';
  style: PadStyle = 'xbox';
  private readonly listeners: Array<() => void> = [];

  constructor() {
    const keyboard = () => this.set('keyboard', this.style);
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('mousedown', keyboard, true);
    // Jitters, and the moves browsers report when the page changes under a still mouse, don't count.
    window.addEventListener(
      'mousemove',
      (e) => {
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) keyboard();
      },
      true,
    );
    this.apply();
  }

  /** Switches to controller prompts once the controller is used. */
  update(pad: GamepadInput): void {
    if (pad.active) this.set('gamepad', pad.style);
    else if (pad.connected && pad.style !== this.style) this.set(this.mode, pad.style);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  render(root: ParentNode = document): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-glyph]')) {
      const mode = (el.dataset.glyphMode as InputMode | undefined) ?? this.mode;
      el.replaceChildren(...glyphs(el.dataset.glyph as Action, mode, this.style));
    }
  }

  private set(mode: InputMode, style: PadStyle): void {
    if (mode === this.mode && style === this.style) return;
    this.mode = mode;
    this.style = style;
    this.apply();
  }

  private apply(): void {
    document.body.dataset.input = this.mode;
    document.body.dataset.pad = this.style;
    this.render();
    for (const l of this.listeners) l();
  }
}
