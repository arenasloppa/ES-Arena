/**
 * The player's control settings, kept between visits in the browser's storage
 * (the desktop app has its own), and the setting rows on the Controls screen.
 */
import type { ControlSettings } from '../game/engine';
import type { StepEvent } from './menu';

const KEY = 'es-arena.controls';
/** Look speed is set in steps of a fifth, from 0.2 to 2 times the normal speed. */
const LOOK_STEPS = 10;

export const DEFAULT_SETTINGS: ControlSettings = { lookSpeed: 1, invertLook: false, vibration: true };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try {
    return window.localStorage; // private windows and some embedded pages refuse storage
  } catch {
    return undefined;
  }
}

export function loadSettings(storage = browserStorage()): ControlSettings {
  let saved: Partial<Record<keyof ControlSettings, unknown>> = {};
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {};
  } catch {
    // unreadable: use the defaults
  }
  const speed = Number(saved.lookSpeed);
  return {
    lookSpeed: Number.isFinite(speed) ? lookSpeed(Math.round(speed * 5)) : DEFAULT_SETTINGS.lookSpeed,
    invertLook: saved.invertLook === true,
    vibration: saved.vibration !== false,
  };
}

export function saveSettings(settings: ControlSettings, storage = browserStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // full or refused: the settings still apply until the game is closed
  }
}

function lookSpeed(step: number): number {
  return Math.min(LOOK_STEPS, Math.max(1, step)) / 5;
}

/** The next value of a setting, one step left (-1) or right (+1); `wrap` goes round from the end to the start. */
export function stepSetting<K extends keyof ControlSettings>(
  settings: ControlSettings,
  key: K,
  delta: number,
  wrap: boolean,
): ControlSettings[K] {
  const value = settings[key];
  if (typeof value === 'boolean') return !value as ControlSettings[K];
  let step = Math.round((value as number) * 5) + delta;
  if (wrap && step > LOOK_STEPS) step = 1;
  return lookSpeed(step) as ControlSettings[K];
}

/**
 * Wires the setting rows: buttons with data-setting naming a setting. Choosing one
 * moves it on a step, and the menu's left and right step it back and forth.
 */
export function bindSettingRows(root: ParentNode, settings: ControlSettings): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-setting]')) {
    const key = el.dataset.setting as keyof ControlSettings;
    const valueEl = el.querySelector<HTMLElement>('.value')!;
    const show = () => {
      const value = settings[key];
      if (typeof value === 'boolean') valueEl.textContent = value ? 'On' : 'Off';
      else {
        const step = Math.round(value * 5);
        valueEl.textContent = String(step);
        el.style.setProperty('--fill', String(step / LOOK_STEPS));
      }
      el.setAttribute('aria-valuetext', valueEl.textContent ?? '');
    };
    const apply = (delta: number, wrap: boolean) => {
      (settings as unknown as Record<string, unknown>)[key] = stepSetting(settings, key, delta, wrap);
      saveSettings(settings);
      show();
    };
    el.addEventListener('click', () => apply(1, true));
    el.addEventListener('step', (e) => apply((e as StepEvent).detail.delta, (e as StepEvent).detail.wrap));
    show();
  }
}
