import type { ControlSettings } from '../game/engine';
import { BINDINGS } from '../ui/controls';
import type { ButtonName, GamepadInput } from './gamepad';
/** Use the app's control catalog for both gameplay and the proving ground. */
function button(action: 'attack' | 'block' | 'activate' | 'jump' | 'sprint' | 'sneak' | 'menu'): ButtonName {
  const name = BINDINGS[action].pad[0];
  return name === 'LStickPress' ? 'LS' : name === 'RStickPress' ? 'RS' : name as ButtonName;
}
export const GAMEPLAY_BUTTON = {
  attack: button('attack'), block: button('block'), use: button('activate'),
  jump: button('jump'), sprint: button('sprint'), sneak: button('sneak'), pause: button('menu'),
};
export const GAMEPLAY_LOOK = { mouse: .0022, yaw: 3.2, pitch: 2, keyboardTurn: 2.4, limit: 1.2 };
export function keyboardMovement(keys: ReadonlySet<string>) {
  return {
    forward: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
    strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    turn: Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')),
  };
}
export function gamepadHolds(pad?: GamepadInput) {
  return {
    attack: !!pad?.connected && pad.held(GAMEPLAY_BUTTON.attack),
    block: !!pad?.connected && pad.triggers.left > .35,
    sprint: !!pad?.connected && pad.held(GAMEPLAY_BUTTON.sprint),
  };
}
export function gamepadLook(x: number, y: number, dt: number, settings: Pick<ControlSettings, 'lookSpeed' | 'invertLook'>) {
  return {
    yaw: x * Math.abs(x) * GAMEPLAY_LOOK.yaw * settings.lookSpeed * dt,
    pitch: -y * Math.abs(y) * GAMEPLAY_LOOK.pitch * settings.lookSpeed * dt * (settings.invertLook ? -1 : 1),
  };
}
