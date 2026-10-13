/**
 * Moving through the menu with a controller or the keyboard, Skyrim style:
 * up and down pick an option, left and right change the picked setting,
 * A or Enter chooses it, and B or Esc goes back.
 */
import { Repeater, type Direction, type GamepadInput } from '../input/gamepad';
import type { InputModeWatcher } from './controls';

export interface MenuActions {
  /** B or Esc. */
  back(): void;
  /** Start: back to the game, if one is running. */
  resume(): void;
  switchTab?(delta: number): boolean;
}

/** Asks a setting to step through its values; `wrap` goes round from the last value to the first. */
export type StepEvent = CustomEvent<{ delta: number; wrap: boolean }>;

/**
 * Options are elements with the class "option". A <select> option changes with left and
 * right and fires a "choose" event when chosen; an option with data-setting gets "step"
 * events for left and right. An element with the class "arrow" inside an
 * "option-row" steps that row's option when clicked.
 */
export class MenuNav {
  private readonly repeater = new Repeater();
  private justOpened = true;

  constructor(
    private readonly menu: HTMLElement,
    private readonly pad: GamepadInput,
    private readonly input: InputModeWatcher,
    private readonly actions: MenuActions,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    // With the mouse, pointing at an option picks it, so there is only ever one picked. Only real moves
    // count: browsers also report one when the menu opens under a resting pointer, which would steal
    // the pick from Resume.
    menu.addEventListener('mousemove', (e) => {
      if (this.input.mode !== 'keyboard' || (e.movementX === 0 && e.movementY === 0)) return;
      const target = this.optionAt(e.target as Element);
      if (target && target !== document.activeElement) target.focus({ preventScroll: true });
    });
    // Capturing, so a click on an arrow inside a setting's button doesn't also choose the setting.
    menu.addEventListener(
      'click',
      (e) => {
        const arrow = (e.target as Element).closest<HTMLElement>('.arrow');
        const option = arrow && this.optionAt(arrow);
        if (!option) return;
        e.preventDefault();
        e.stopPropagation();
        option.focus({ preventScroll: true });
        this.adjust(option, Number(arrow.dataset.step));
      },
      true,
    );
  }

  /** The options on the screen showing, top to bottom. */
  options(): HTMLElement[] {
    return [...this.menu.querySelectorAll<HTMLElement>('.option')].filter(
      (el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled,
    );
  }

  focusFirst(): void {
    this.options()[0]?.focus({ preventScroll: true });
  }

  /** Call when the menu opens: a stick still held from walking shouldn't move through it. */
  opened(): void {
    this.justOpened = true;
  }

  /** Acts on the controller; call every frame while the menu is open, after the controller was read. */
  frame(now: number): void {
    const pad = this.pad;
    if (!pad.connected) return;
    if (this.justOpened) {
      this.justOpened = false;
      this.repeater.hold(pad.direction());
    }
    if (pad.take('A')) this.choose();
    if (pad.take('B')) this.actions.back();
    if (pad.take('Start')) this.actions.resume();
    if (pad.take('LB') && !this.actions.switchTab?.(-1)) this.change(-10);
    if (pad.take('RB') && !this.actions.switchTab?.(1)) this.change(10);
    const direction = this.repeater.update(pad.direction(), now);
    if (direction) this.go(direction);
  }

  private optionAt(el: Element): HTMLElement | undefined {
    const row = el.closest<HTMLElement>('.option-row');
    return (row ? (row.matches('.option') ? row : row.querySelector<HTMLElement>('.option')) : el.closest<HTMLElement>('.option')) ?? undefined;
  }

  private current(): HTMLElement | undefined {
    const a = document.activeElement;
    return a instanceof HTMLElement && a.classList.contains('option') && this.menu.contains(a) ? a : undefined;
  }

  private go(direction: Direction): void {
    if (direction === 'left' || direction === 'right') {
      this.change(direction === 'left' ? -1 : 1);
      return;
    }
    const list = this.options();
    if (!list.length) return;
    const i = list.indexOf(this.current()!);
    const next = i < 0 ? 0 : (i + (direction === 'down' ? 1 : -1) + list.length) % list.length;
    list[next].focus();
  }

  private choose(): void {
    const el = this.current();
    if (!el) this.focusFirst();
    else if (el instanceof HTMLSelectElement) el.dispatchEvent(new Event('choose'));
    else el.click();
  }

  /** Changes the picked list or setting, if one is picked. */
  private change(delta: number): void {
    const el = this.current();
    if (el) this.adjust(el, delta);
  }

  private adjust(el: HTMLElement, delta: number): void {
    if (el instanceof HTMLSelectElement) {
      const n = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + delta));
      if (n === el.selectedIndex) return;
      el.selectedIndex = n;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.dataset.settingsTab !== undefined || el.dataset.guideTab!==undefined) { this.actions.switchTab?.(delta);
    } else if (el.dataset.setting !== undefined && delta) {
      el.dispatchEvent(new CustomEvent('step', { detail: { delta: Math.sign(delta), wrap: false } }));
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.menu.hidden || e.defaultPrevented) return;
    const el = this.current();
    const changes = el instanceof HTMLSelectElement || el?.dataset.setting !== undefined || el?.dataset.settingsTab !== undefined || el?.dataset.guideTab!==undefined;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.go(e.key === 'ArrowUp' ? 'up' : 'down');
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && changes) {
      e.preventDefault();
      this.change(e.key === 'ArrowLeft' ? -1 : 1);
    } else if ((e.key === 'PageUp' || e.key === 'PageDown') && el instanceof HTMLSelectElement) {
      e.preventDefault();
      this.change(e.key === 'PageUp' ? -10 : 10);
    } else if (e.key === 'Enter' && el && !(el instanceof HTMLButtonElement)) {
      // Buttons choose themselves on Enter; the map list starts the map, and the folder label opens the picker.
      e.preventDefault();
      this.choose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.actions.back();
    }
  };
}
