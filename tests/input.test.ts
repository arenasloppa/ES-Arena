import { describe, expect, it } from 'vitest';
import { BUTTON, GamepadInput, Repeater, deadzone, padStyle, type ButtonName } from '../src/input/gamepad';
import { BINDINGS, GAME_ACTIONS, type Action } from '../src/ui/controls';
import {HOTBAR_ORDER} from '../src/input/hotbar';
import { compassHeading } from '../src/ui/hud';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, stepSetting } from '../src/ui/settings';

/** A stand-in for the browser's Gamepad object. */
function fakePad(id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)') {
  const pad = {
    id,
    connected: true,
    timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
    press(name: ButtonName, down = true) {
      pad.buttons[BUTTON[name]] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    },
  };
  return pad;
}

function inputFor(...pads: ReturnType<typeof fakePad>[]) {
  return new GamepadInput(() => pads as unknown as Gamepad[]);
}

describe('controller', () => {
  it('ignores stick drift and rescales the rest of the throw', () => {
    expect(deadzone(0.1, -0.1)).toEqual({ x: 0, y: 0 });
    expect(deadzone(1, 0)).toEqual({ x: 1, y: 0 });
    const half = deadzone(0, 0.55);
    expect(half.x).toBe(0);
    expect(half.y).toBeCloseTo((0.55 - 0.18) / (0.92 - 0.18));
  });

  it('shows the button labels of the controller in use', () => {
    expect(padStyle('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padStyle('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padStyle('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(padStyle('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(padStyle('Unknown Gamepad')).toBe('xbox');
  });

  it('reports each press once, to whoever takes it first', () => {
    const pad = fakePad();
    const input = inputFor(pad);
    input.poll(1);
    expect(input.connected).toBe(true);
    pad.press('A');
    input.poll(2);
    expect(input.held('A')).toBe(true);
    expect(input.take('A')).toBe(true);
    expect(input.take('A')).toBe(false);
    // Still held next frame: not a new press.
    input.poll(3);
    expect(input.take('A')).toBe(false);
    expect(input.held('A')).toBe(true);
    pad.press('A', false);
    input.poll(4);
    pad.press('A');
    input.poll(5);
    expect(input.take('A')).toBe(true);
  });

  it('reads the controller once per frame, so the game and the menu see the same presses', () => {
    const pad = fakePad();
    const input = inputFor(pad);
    input.poll(1);
    pad.press('B');
    input.poll(2);
    input.poll(2); // a second reader in the same frame
    expect(input.take('B')).toBe(true);
  });

  it('follows the controller used last', () => {
    const xbox = fakePad();
    const ps = fakePad('DualShock 4 (Vendor: 054c)');
    const input = inputFor(xbox, ps);
    ps.press('Y');
    input.poll(1);
    expect(input.style).toBe('playstation');
    expect(input.take('Y')).toBe(true);
  });

  it('counts as in use only when pushed past drift', () => {
    const pad = fakePad();
    const input = inputFor(pad);
    pad.axes = [0.25, 0, 0, 0];
    input.poll(1);
    expect(input.active).toBe(false);
    pad.axes = [0.9, 0, 0, 0];
    input.poll(2);
    expect(input.active).toBe(true);
    expect(input.direction()).toBe('right');
  });

  it('reads the D-pad and the left stick as menu directions', () => {
    const pad = fakePad();
    const input = inputFor(pad);
    pad.press('Down');
    input.poll(1);
    expect(input.direction()).toBe('down');
    pad.press('Down', false);
    pad.axes = [0, -1, 0, 0];
    input.poll(2);
    expect(input.direction()).toBe('up');
  });

  it('is disconnected when no controller is there', () => {
    const input = new GamepadInput(() => [null]);
    input.poll(1);
    expect(input.connected).toBe(false);
    expect(input.take('A')).toBe(false);
    expect(input.direction()).toBeUndefined();
  });
});

describe('menu repeat', () => {
  it('steps once, then repeats after a pause, faster the longer it is held', () => {
    const r = new Repeater(300, 100);
    expect(r.update('down', 0)).toBe('down');
    expect(r.update('down', 200)).toBeUndefined();
    expect(r.update('down', 300)).toBe('down');
    expect(r.update('down', 350)).toBeUndefined();
    expect(r.update('down', 392)).toBe('down'); // 100 - 8 ms later
    expect(r.update(undefined, 400)).toBeUndefined();
    expect(r.update('up', 410)).toBe('up');
  });

  it('ignores a direction held from before until it is let go', () => {
    const r = new Repeater(300, 100);
    r.hold('up');
    expect(r.update('up', 0)).toBeUndefined();
    expect(r.update('up', 5000)).toBeUndefined();
    expect(r.update(undefined, 5100)).toBeUndefined();
    expect(r.update('up', 5200)).toBe('up');
  });
});

describe('compass', () => {
  it('reads north up the map and east along +x', () => {
    expect(compassHeading(0)).toBeCloseTo(90); // +x
    expect(compassHeading(Math.PI / 2)).toBeCloseTo(180); // +y, south
    expect(compassHeading(Math.PI)).toBeCloseTo(270);
    expect(compassHeading(-Math.PI / 2)).toBeCloseTo(0);
    expect(compassHeading(-Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(0);
  });
});

describe('settings', () => {
  function memoryStorage(initial?: string) {
    const items = new Map<string, string>();
    if (initial !== undefined) items.set('es-arena.controls', initial);
    return {
      items,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    };
  }

  it('starts from the defaults', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStorage('not json'))).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps settings between visits, within range', () => {
    const storage = memoryStorage();
    saveSettings({ lookSpeed: 1.6, invertLook: true, vibration: false, volume: 0.3, music: 0.5, intro: false }, storage);
    expect(loadSettings(storage)).toEqual({ lookSpeed: 1.6, invertLook: true, vibration: false, volume: 0.3, music: 0.5, intro: false });
    expect(loadSettings(memoryStorage('{"volume": 7}')).volume).toBe(1);
    expect(loadSettings(memoryStorage('{"volume": 0}')).volume).toBe(0);
    expect(loadSettings(memoryStorage('{"lookSpeed": 40}')).lookSpeed).toBe(2);
    expect(loadSettings(memoryStorage('{"lookSpeed": "fast"}')).lookSpeed).toBe(1);
  });

  it('steps look speed in fifths and volume in tenths, and flips switches', () => {
    const s = { ...DEFAULT_SETTINGS };
    expect(stepSetting(s, 'lookSpeed', 1, false)).toBeCloseTo(1.2);
    expect(stepSetting(s, 'lookSpeed', -1, false)).toBeCloseTo(0.8);
    expect(stepSetting({ ...s, lookSpeed: 2 }, 'lookSpeed', 1, false)).toBe(2);
    expect(stepSetting({ ...s, lookSpeed: 2 }, 'lookSpeed', 1, true)).toBeCloseTo(0.2);
    expect(stepSetting({ ...s, lookSpeed: 0.2 }, 'lookSpeed', -1, false)).toBeCloseTo(0.2);
    expect(stepSetting(s, 'volume', 1, false)).toBeCloseTo(0.9);
    expect(stepSetting({ ...s, volume: 0 }, 'volume', -1, false)).toBe(0);
    expect(stepSetting({ ...s, volume: 1 }, 'volume', 1, true)).toBe(0);
    expect(stepSetting(s, 'invertLook', 1, false)).toBe(true);
    expect(stepSetting(s, 'vibration', -1, false)).toBe(false);
  });
});

describe('controls', () => {
  const distinct = (actions: Action[]) => {
    const keys = actions.flatMap((a) => BINDINGS[a].keys);
    const buttons = actions.flatMap((a) => BINDINGS[a].pad);
    return [new Set(keys).size === keys.length, new Set(buttons).size === buttons.length];
  };

  it('gives each action in the game its own key and its own button', () => {
    expect(distinct(GAME_ACTIONS)).toEqual([true, true]);
    expect(GAME_ACTIONS.filter((a) => !BINDINGS[a].keys.length)).toEqual([]);
  });

  it('gives each thing to do in the item menus its own key and its own button', () => {
    expect(distinct(['use', 'favourite', 'drop', 'cast', 'setHotkey', 'back'])).toEqual([true, true]);
  });
});

describe('hotbar display order',()=>{
 it('shows Left, Up, Right before the face and shoulder controls, with matching keyboard keys',()=>{
  const actions=['quickslot','ability1','ability2','ability3','ability4','ability5','ability6'] as const;
  expect(HOTBAR_ORDER.map(i=>BINDINGS[actions[i]].pad[0])).toEqual(['DLeft','DUp','DRight','X','B','LB','RB']);
  expect(HOTBAR_ORDER.map(i=>BINDINGS[actions[i]].keys[0])).toEqual(['1','2','3','4','5','6','7']);
  expect(BINDINGS.close.pad).toEqual(['B']);
 });
});
