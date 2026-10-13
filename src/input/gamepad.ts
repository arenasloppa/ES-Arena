/**
 * Game controllers, read through the browser's Gamepad API once per frame.
 * Buttons follow the "standard" layout that Xbox, PlayStation, Switch Pro and
 * most other controllers are mapped to, and are named after the Xbox buttons.
 */

export const BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  LS: 10,
  RS: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
} as const;

export type ButtonName = keyof typeof BUTTON;

/** Whose button labels to show. */
export type PadStyle = 'xbox' | 'playstation' | 'nintendo';

export interface Stick {
  x: number;
  y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Picks button labels from the id the browser reports, which carries the USB vendor id. */
export function padStyle(id: string): PadStyle {
  if (/054c|playstation|dualshock|dualsense/i.test(id)) return 'playstation';
  if (/057e|nintendo|switch|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/** Radial dead zone: ignores drift around the centre and rescales the rest of the throw to 0..1. */
export function deadzone(x: number, y: number, inner = 0.18, outer = 0.92): Stick {
  const m = Math.hypot(x, y);
  if (m <= inner) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - inner) / (outer - inner));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}

type PadSource = () => ArrayLike<Gamepad | null>;

function browserPads(): ArrayLike<Gamepad | null> {
  try {
    return navigator.getGamepads?.() ?? [];
  } catch {
    return []; // pages embedded without gamepad permission throw here
  }
}

export class GamepadInput {
  move: Stick = { x: 0, y: 0 };
  look: Stick = { x: 0, y: 0 };
  /** How far the triggers are pulled, 0 to 1. */
  triggers = { left: 0, right: 0 };
  style: PadStyle = 'xbox';
  connected = false;
  /** True when a button was held or a stick pushed at the last read. */
  active = false;
  private down = new Set<number>();
  private pressed = new Set<number>();
  private lastPoll = Number.NaN;
  private pad: Gamepad | undefined;

  constructor(private readonly source: PadSource = browserPads) {}

  /**
   * Reads the controller. Calls with the same frame time read it only once, so the
   * game and the menu, which both read it each frame, see the same presses.
   */
  poll(now: number): void {
    if (now === this.lastPoll) return;
    this.lastPoll = now;
    // With several controllers connected, follow the one used last.
    let pad: Gamepad | undefined;
    for (const p of Array.from(this.source())) if (p?.connected && (!pad || p.timestamp > pad.timestamp)) pad = p;
    this.pad = pad;
    this.connected = pad !== undefined;
    const down = new Set<number>();
    pad?.buttons.forEach((b, i) => {
      if (b.pressed || b.value > 0.5) down.add(i);
    });
    this.pressed = new Set([...down].filter((b) => !this.down.has(b)));
    this.down = down;
    const axes = pad?.axes ?? [];
    this.move = deadzone(axes[0] ?? 0, axes[1] ?? 0);
    this.look = deadzone(axes[2] ?? 0, axes[3] ?? 0);
    const pull = (i: number) => {
      const v = pad?.buttons[i]?.value ?? 0;
      return v < 0.08 ? 0 : v;
    };
    this.triggers = { left: pull(BUTTON.LT), right: pull(BUTTON.RT) };
    if (pad) this.style = padStyle(pad.id);
    // A stick needs a real push, so one that drifts past the dead zone doesn't keep taking over the prompts.
    this.active = down.size > 0 || Math.hypot(this.move.x, this.move.y) > 0.4 || Math.hypot(this.look.x, this.look.y) > 0.4;
  }

  held(button: ButtonName): boolean {
    return this.down.has(BUTTON[button]);
  }

  /** Resume with current holds, without replaying menu/focus-change button presses. */
  resync(now = performance.now()): void {
    this.lastPoll=Number.NaN;
    this.poll(now);
    this.pressed.clear();
  }

  /** True once per press: whoever reads the press first handles it. */
  take(button: ButtonName): boolean {
    return this.pressed.delete(BUTTON[button]);
  }

  /** The way the D-pad or left stick points, for moving through menus. */
  direction(): Direction | undefined {
    if (this.held('Up')) return 'up';
    if (this.held('Down')) return 'down';
    if (this.held('Left')) return 'left';
    if (this.held('Right')) return 'right';
    const { x, y } = this.move;
    if (Math.max(Math.abs(x), Math.abs(y)) < 0.5) return undefined;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
  }

  /** A short buzz, on controllers and browsers that can. */
  rumble(ms = 120, strong = 0.2, weak = 0.45): void {
    const actuator = (this.pad as (Gamepad & { vibrationActuator?: GamepadHapticActuator | null }) | undefined)?.vibrationActuator;
    actuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}

/** Turns a held direction into steps, like a held key: one at once, then more after a pause. */
export class Repeater {
  private current: Direction | undefined;
  private next = 0;
  private steps = 0;

  constructor(
    private readonly delay = 380,
    private readonly interval = 120,
  ) {}

  /** Ignores a direction already held, such as a stick still pushed from walking, until it is let go. */
  hold(direction: Direction | undefined): void {
    this.current = direction;
    this.next = Number.POSITIVE_INFINITY;
  }

  update(direction: Direction | undefined, now: number): Direction | undefined {
    if (direction !== this.current) {
      this.current = direction;
      this.steps = 0;
      this.next = now + this.delay;
      return direction;
    }
    if (!direction || now < this.next) return undefined;
    // Speeds up the longer it is held, for long lists such as the map list.
    this.steps++;
    this.next = now + Math.max(35, this.interval - this.steps * 8);
    return direction;
  }
}
