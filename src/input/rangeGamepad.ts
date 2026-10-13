import { GamepadInput } from './gamepad';
import type { ControlSettings } from '../game/engine';
import { DEFAULT_SETTINGS } from '../ui/settings';
import { GAMEPLAY_BUTTON, gamepadHolds, gamepadLook } from './gameplayControls';
/** Same gameplay buttons, trigger thresholds and saved look settings as Engine. */
export function rangeGamepad(pad: GamepadInput, now: number, dt: number, settings: Pick<ControlSettings, 'lookSpeed' | 'invertLook'> = DEFAULT_SETTINGS) {
  pad.poll(now);
  return {
    forward: -pad.move.y, strafe: pad.move.x,
    ...gamepadLook(pad.look.x, pad.look.y, dt, settings),
    ...gamepadHolds(pad),
    use: pad.take(GAMEPLAY_BUTTON.use), jump: pad.take(GAMEPLAY_BUTTON.jump),
    sneak: pad.take(GAMEPLAY_BUTTON.sneak), pause: pad.take(GAMEPLAY_BUTTON.pause),
    hotkey: pad.take('Left') ? 0 : pad.take('Right') ? 1 : undefined,
  };
}
/** Combine mouse and controller holds before finding edges, so one can't release the other. */
export class AttackHold {
  private held = false;
  sample(held: boolean, tap = false) {
    tap &&= !held;
    const previous = this.held;
    this.held = held;
    return { held, pressed: tap || (held && !previous), released: tap || (!held && previous) };
  }
  reset() { this.held = false; }
}
