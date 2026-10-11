/**
 * The player's settings, kept between visits in the browser's storage
 * (the desktop app has its own), and the setting rows on the Controls screen.
 */
import type { ControlSettings } from '../game/engine';
import type { StepEvent } from './menu';

const KEY = 'es-arena.controls';

type NumberSetting = 'lookSpeed' | 'volume' | 'music';

/**
 * Number settings go in steps: look speed in fifths from 0.2 to 2 times the
 * normal speed, sound and music volume in tenths from off to full.
 */
const STEPS: Record<NumberSetting, { min: number; max: number; per: number }> = {
  lookSpeed: { min: 1, max: 10, per: 5 },
  volume: { min: 0, max: 10, per: 10 },
  music: { min: 0, max: 10, per: 10 },
};

export const DEFAULT_SETTINGS: ControlSettings = { lookSpeed: 1, invertLook: false, vibration: true, volume: 0.8, music: 0.6, intro: true };

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
  const number = (key: NumberSetting) => {
    const value = Number(saved[key] ?? Number.NaN);
    return Number.isFinite(value) ? fromStep(key, Math.round(value * STEPS[key].per)) : DEFAULT_SETTINGS[key];
  };
  return {
    lookSpeed: number('lookSpeed'),
    invertLook: saved.invertLook === true,
    vibration: saved.vibration !== false,
    volume: number('volume'),
    music: number('music'),
    intro: saved.intro !== false,
  };
}

export function saveSettings(settings: ControlSettings, storage = browserStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // full or refused: the settings still apply until the game is closed
  }
}

function fromStep(key: NumberSetting, step: number): number {
  const { min, max, per } = STEPS[key];
  return Math.min(max, Math.max(min, step)) / per;
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
  const { min, max, per } = STEPS[key as NumberSetting];
  let step = Math.round((value as number) * per) + delta;
  if (wrap && step > max) step = min;
  return fromStep(key as NumberSetting, step) as ControlSettings[K];
}

/**
 * Wires the setting rows: buttons with data-setting naming a setting. Choosing one
 * moves it on a step, and the menu's left and right step it back and forth.
 */
export function bindSettingRows(root: ParentNode, settings: ControlSettings, onChange?: (key: keyof ControlSettings) => void): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-setting]')) {
    const key = el.dataset.setting as keyof ControlSettings;
    const valueEl = el.querySelector<HTMLElement>('.value')!;
    const show = () => {
      const value = settings[key];
      if (typeof value === 'boolean') valueEl.textContent = value ? 'On' : 'Off';
      else {
        const { max, per } = STEPS[key as NumberSetting];
        const step = Math.round(value * per);
        valueEl.textContent = String(step);
        el.style.setProperty('--fill', String(step / max));
      }
      el.setAttribute('aria-valuetext', valueEl.textContent ?? '');
    };
    const apply = (delta: number, wrap: boolean) => {
      (settings as unknown as Record<string, unknown>)[key] = stepSetting(settings, key, delta, wrap);
      saveSettings(settings);
      show();
      onChange?.(key);
    };
    el.addEventListener('click', () => apply(1, true));
    el.addEventListener('step', (e) => apply((e as StepEvent).detail.delta, (e as StepEvent).detail.wrap));
    show();
  }
}
