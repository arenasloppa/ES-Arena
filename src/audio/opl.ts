/**
 * An AdLib's FM chip, the Yamaha YM3812 (OPL2): nine channels of two
 * operators each, driven by writing its registers as a sound driver does.
 * Pure arithmetic, so it renders the same in the browser, a worker or a
 * test. The remake's own emulation, in floating point, of the chip as it is
 * documented (Yamaha's YM3812 manual) and as the Nuked OPL3 emulator models
 * it:
 *
 * - Each operator is a sine (or one of three cut-down sines) whose phase
 *   runs at the channel's frequency times the operator's multiple, shaped by
 *   an envelope: attack, decay to the sustain level, sustain while the key
 *   is held (or keep decaying, for percussive sounds), release.
 * - Loudness is attenuation in decibels: the envelope, the total level
 *   (0.75 dB steps), key scaling (high notes quieter) and tremolo.
 * - The first operator can feed back on itself, and either modulates the
 *   second's phase (FM: a full output moves it by up to four cycles) or is
 *   heard beside it (additive).
 * - Envelope times come from the manual's tables: at rate 1 an attack takes
 *   2826 ms and a decay to silence 39281 ms, each rate step halving them.
 *
 * Rhythm mode and the timers are left out: the Miles drivers don't use them.
 */

/** The chip's own sample rate: a 14.318 MHz clock divided by 288. */
export const OPL_RATE = 49716;

const MULTIPLES = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
/** Key scale level at 6 dB an octave, by the top four bits of the frequency number, in octave 7. */
const KSL_DB = [0, 9, 12, 13.875, 15, 16.125, 16.875, 17.625, 18, 18.75, 19.125, 19.5, 19.875, 20.25, 20.625, 21];
/** How much of KSL_DB each key scale setting applies: none, 3, 1.5 and 6 dB an octave. */
const KSL_SHARE = [0, 0.5, 0.25, 1];
const ATTACK_MS = 2826.24;
const DECAY_MS = 39280.64;
const SILENT_DB = 96;
const TREMOLO_HZ = 3.7;
const VIBRATO_HZ = 6.07;

type Stage = 'off' | 'attack' | 'decay' | 'sustain' | 'release';

// Lookup tables: a sine cycle, and loudness for attenuation in 1/16 dB steps.
const SINE_SIZE = 4096;
const SINE = Float32Array.from({ length: SINE_SIZE }, (_, i) => Math.sin((2 * Math.PI * i) / SINE_SIZE));
const DB_STEPS = 16;
const LOUDNESS = Float32Array.from({ length: SILENT_DB * DB_STEPS + 1 }, (_, i) => 10 ** (-i / DB_STEPS / 20));

class Operator {
  am = false;
  vib = false;
  /** Sustains while the key is held; otherwise percussive. */
  sustained = false;
  ksr = false;
  mult = 1;
  ksl = 0;
  /** Total level, in 0.75 dB steps. */
  tl = 63;
  ar = 0;
  dr = 0;
  /** Sustain level, in 3 dB steps (15 is all the way down). */
  sl = 0;
  rr = 0;
  wave = 0;

  phase = 0;
  /** Attenuation from the envelope, in dB. */
  env = SILENT_DB;
  stage: Stage = 'off';
  out = 0;
  prev = 0;

  keyOn(): void {
    this.phase = 0;
    this.stage = 'attack';
  }

  keyOff(): void {
    if (this.stage !== 'off') this.stage = 'release';
  }
}

class Channel {
  fnum = 0;
  block = 0;
  key = false;
  feedback = 0;
  /** Additive (both operators heard) rather than FM. */
  additive = false;
  readonly ops: [Operator, Operator] = [new Operator(), new Operator()];
}

export class Opl2 {
  private readonly channels = Array.from({ length: 9 }, () => new Channel());
  /** Operators by their place in the register map (0x00-0x15, gaps left out). */
  private readonly slots: Operator[] = [];
  private waveSelect = false;
  private deepTremolo = false;
  private deepVibrato = false;
  private time = 0;

  constructor(readonly sampleRate = OPL_RATE) {
    for (let c = 0; c < 9; c++) {
      const base = Math.floor(c / 3) * 6 + (c % 3);
      this.slots[base] = this.channels[c].ops[0];
      this.slots[base + 3] = this.channels[c].ops[1];
    }
  }

  write(register: number, value: number): void {
    const r = register & 0xff;
    if (r === 0x01) this.waveSelect = (value & 0x20) !== 0;
    else if (r === 0xbd) {
      this.deepTremolo = (value & 0x80) !== 0;
      this.deepVibrato = (value & 0x40) !== 0;
    } else if (r >= 0x20 && r < 0xa0) this.writeOperator(r & 0xe0, r & 0x1f, value);
    else if (r >= 0xe0 && r < 0xf6) this.writeOperator(0xe0, r & 0x1f, value);
    else if (r >= 0xa0 && r < 0xd0) this.writeChannel(r & 0xf0, r & 0x0f, value);
  }

  private writeOperator(group: number, offset: number, value: number): void {
    if ((offset & 7) > 5) return;
    const op = this.slots[(offset >> 3) * 6 + (offset & 7)];
    if (!op) return;
    switch (group) {
      case 0x20:
        op.am = (value & 0x80) !== 0;
        op.vib = (value & 0x40) !== 0;
        op.sustained = (value & 0x20) !== 0;
        op.ksr = (value & 0x10) !== 0;
        op.mult = MULTIPLES[value & 0x0f];
        break;
      case 0x40:
        op.ksl = value >> 6;
        op.tl = value & 0x3f;
        break;
      case 0x60:
        op.ar = value >> 4;
        op.dr = value & 0x0f;
        break;
      case 0x80:
        op.sl = value >> 4;
        op.rr = value & 0x0f;
        break;
      case 0xe0:
        op.wave = this.waveSelect ? value & 3 : 0;
        break;
    }
  }

  private writeChannel(group: number, index: number, value: number): void {
    const ch = this.channels[index];
    if (!ch) return;
    if (group === 0xa0) ch.fnum = (ch.fnum & 0x300) | value;
    else if (group === 0xb0) {
      ch.fnum = (ch.fnum & 0xff) | ((value & 3) << 8);
      ch.block = (value >> 2) & 7;
      const key = (value & 0x20) !== 0;
      if (key && !ch.key) ch.ops.forEach((o) => o.keyOn());
      else if (!key && ch.key) ch.ops.forEach((o) => o.keyOff());
      ch.key = key;
    } else if (group === 0xc0) {
      ch.feedback = (value >> 1) & 7;
      ch.additive = (value & 1) !== 0;
    }
  }

  /** Adds `count` samples of the chip's output to `out` from `start` (mono, about -1 to 1 for one loud channel). */
  render(out: Float32Array, start = 0, count = out.length - start): void {
    const dt = 1 / this.sampleRate;
    for (let i = start; i < start + count; i++) {
      const t = this.time;
      const tremolo = (this.deepTremolo ? 4.8 : 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * TREMOLO_HZ * t));
      const vibrato = 2 ** (((this.deepVibrato ? 14 : 7) * Math.sin(2 * Math.PI * VIBRATO_HZ * t)) / 1200);
      let sample = 0;
      for (const ch of this.channels) {
        const [m, c] = ch.ops;
        if (m.stage === 'off' && c.stage === 'off') continue;
        const hz = (ch.fnum * 2 ** ch.block * OPL_RATE) / 2 ** 20;
        const feedback = ch.feedback ? (m.out + m.prev) * 2 ** (ch.feedback - 7) : 0;
        m.prev = m.out;
        m.out = this.operator(ch, m, hz, feedback, tremolo, vibrato, dt);
        const carrier = this.operator(ch, c, hz, ch.additive ? 0 : m.out * 4, tremolo, vibrato, dt);
        sample += ch.additive ? m.out + carrier : carrier;
      }
      out[i] += sample;
      this.time += dt;
    }
  }

  /** Steps one operator by a sample and returns its output, -1 to 1. */
  private operator(ch: Channel, op: Operator, hz: number, modulation: number, tremolo: number, vibrato: number, dt: number): number {
    this.envelope(ch, op, dt);
    op.phase = (op.phase + hz * op.mult * (op.vib ? vibrato : 1) * dt) % 1;
    if (op.stage === 'off') return 0;
    const attenuation = op.env + op.tl * 0.75 + this.keyScale(ch, op) + (op.am ? tremolo : 0);
    if (attenuation >= SILENT_DB) return 0;
    return wave(op.wave, op.phase + modulation) * LOUDNESS[(attenuation * DB_STEPS) | 0];
  }

  private keyScale(ch: Channel, op: Operator): number {
    if (!op.ksl) return 0;
    return Math.max(0, KSL_DB[ch.fnum >> 6] - 6 * (7 - ch.block)) * KSL_SHARE[op.ksl];
  }

  /** The rate an envelope stage runs at, 0 to 63, raised for high notes when the operator scales its rates by key. */
  private rate(ch: Channel, op: Operator, r: number): number {
    if (r === 0) return 0;
    const keyCode = ch.block * 2 + ((ch.fnum >> 9) & 1);
    return Math.min(63, r * 4 + (op.ksr ? keyCode : keyCode >> 2));
  }

  private envelope(ch: Channel, op: Operator, dt: number): void {
    switch (op.stage) {
      case 'attack': {
        const rate = this.rate(ch, op, op.ar);
        if (rate >= 60) op.env = 0;
        else if (rate >= 4) {
          // The attack falls in decibels in proportion to how far there is to go: quick at first.
          const samples = Math.max(1, (stageMs(ATTACK_MS, rate) / 1000) / dt);
          op.env -= (op.env + 1) * (1 - (1 / (SILENT_DB + 1)) ** (1 / samples));
        }
        if (op.env <= 0) {
          op.env = 0;
          op.stage = 'decay';
        }
        break;
      }
      case 'decay': {
        const level = op.sl === 15 ? 93 : op.sl * 3;
        op.env += step(this.rate(ch, op, op.dr), dt);
        if (op.env >= level) {
          op.env = Math.max(op.env, level);
          op.stage = op.sustained ? 'sustain' : 'release';
        }
        break;
      }
      case 'sustain':
        break;
      case 'release':
        op.env += step(this.rate(ch, op, op.rr), dt);
        if (op.env >= SILENT_DB) {
          op.env = SILENT_DB;
          op.stage = 'off';
        }
        break;
      default:
        break;
    }
  }
}

/** Milliseconds a stage takes at `rate`: its time at rate 4 halved for every four rates more. */
function stageMs(base: number, rate: number): number {
  return (base / 2 ** ((rate >> 2) - 1)) * (4 / (4 + (rate & 3)));
}

/** Decibels a decay or release falls in one sample. */
function step(rate: number, dt: number): number {
  return rate < 4 ? 0 : (SILENT_DB * dt * 1000) / stageMs(DECAY_MS, rate);
}

/** The four OPL2 waves at `phase` cycles: sine, half sine, rectified sine and quarter sine. */
export function wave(kind: number, phase: number): number {
  const p = phase - Math.floor(phase);
  const s = SINE[(p * SINE_SIZE) | 0];
  switch (kind) {
    case 1:
      return s > 0 ? s : 0;
    case 2:
      return Math.abs(s);
    case 3:
      return p % 0.5 < 0.25 ? Math.abs(s) : 0;
    default:
      return s;
  }
}
