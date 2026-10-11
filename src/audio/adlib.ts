/**
 * Arena's music on an AdLib: plays an XMI song through the FM chip (opl.ts)
 * with the instruments of the game's own SAMPLE.AD, the way the Miles Sound
 * System's AdLib driver, which Arena used, does it (as documented by
 * ScummVM's reimplementation of it):
 *
 * - Nine voices, one per FM channel; a note with no voice free takes the
 *   one that has sounded longest.
 * - A channel's instrument is its program in the bank chosen by Miles
 *   controller 114; channel 10's drums are bank 127, by note, each sounding
 *   at the pitch its instrument gives.
 * - Loudness is channel volume times expression times velocity (scaled
 *   through Miles's sensitivity table), applied to the carrier's total
 *   level, and the modulator's too in additive instruments.
 * - Notes are turned into frequency numbers with Miles's own table, with
 *   pitch bends over 12 semitones (Miles 2, whose .ADV drivers Arena has).
 * - Holding the modulation wheel past halfway adds vibrato; the sustain
 *   pedal holds notes.
 */
import { findTimbre, PERCUSSION_BANK, type Timbre } from '../formats/timbres';
import { XMI_TICKS_PER_SECOND, type XmiEvent, type XmiSong } from '../formats/xmi';
import { Opl2 } from './opl';

const VOICES = 9;
const PITCH_RANGE = 12;
const SENSITIVITY = [82, 85, 88, 91, 94, 97, 100, 103, 106, 109, 112, 115, 118, 121, 124, 127];
// Miles's note-to-frequency table: 12 semitones of 16 steps each.
const FREQUENCIES = [
  0x02b2, 0x02b4, 0x02b7, 0x02b9, 0x02bc, 0x02be, 0x02c1, 0x02c3, 0x02c6, 0x02c9, 0x02cb, 0x02ce, 0x02d0, 0x02d3, 0x02d6, 0x02d8,
  0x02db, 0x02dd, 0x02e0, 0x02e3, 0x02e5, 0x02e8, 0x02eb, 0x02ed, 0x02f0, 0x02f3, 0x02f6, 0x02f8, 0x02fb, 0x02fe, 0x0301, 0x0303,
  0x0306, 0x0309, 0x030c, 0x030f, 0x0311, 0x0314, 0x0317, 0x031a, 0x031d, 0x0320, 0x0323, 0x0326, 0x0329, 0x032b, 0x032e, 0x0331,
  0x0334, 0x0337, 0x033a, 0x033d, 0x0340, 0x0343, 0x0346, 0x0349, 0x034c, 0x034f, 0x0352, 0x0356, 0x0359, 0x035c, 0x035f, 0x0362,
  0x0365, 0x0368, 0x036b, 0x036f, 0x0372, 0x0375, 0x0378, 0x037b, 0x037f, 0x0382, 0x0385, 0x0388, 0x038c, 0x038f, 0x0392, 0x0395,
  0x0399, 0x039c, 0x039f, 0x03a3, 0x03a6, 0x03a9, 0x03ad, 0x03b0, 0x03b4, 0x03b7, 0x03bb, 0x03be, 0x03c1, 0x03c5, 0x03c8, 0x03cc,
  0x03cf, 0x03d3, 0x03d7, 0x03da, 0x03de, 0x03e1, 0x03e5, 0x03e8, 0x03ec, 0x03f0, 0x03f3, 0x03f7, 0x03fb, 0x03fe, 0xfe01, 0xfe03,
  0xfe05, 0xfe07, 0xfe08, 0xfe0a, 0xfe0c, 0xfe0e, 0xfe10, 0xfe12, 0xfe14, 0xfe16, 0xfe18, 0xfe1a, 0xfe1c, 0xfe1e, 0xfe20, 0xfe21,
  0xfe23, 0xfe25, 0xfe27, 0xfe29, 0xfe2b, 0xfe2d, 0xfe2f, 0xfe31, 0xfe34, 0xfe36, 0xfe38, 0xfe3a, 0xfe3c, 0xfe3e, 0xfe40, 0xfe42,
  0xfe44, 0xfe46, 0xfe48, 0xfe4a, 0xfe4c, 0xfe4f, 0xfe51, 0xfe53, 0xfe55, 0xfe57, 0xfe59, 0xfe5c, 0xfe5e, 0xfe60, 0xfe62, 0xfe64,
  0xfe67, 0xfe69, 0xfe6b, 0xfe6d, 0xfe6f, 0xfe72, 0xfe74, 0xfe76, 0xfe79, 0xfe7b, 0xfe7d, 0xfe7f, 0xfe82, 0xfe84, 0xfe86, 0xfe89,
  0xfe8b, 0xfe8d, 0xfe90, 0xfe92, 0xfe95, 0xfe97, 0xfe99, 0xfe9c, 0xfe9e, 0xfea1, 0xfea3, 0xfea5, 0xfea8, 0xfeaa, 0xfead, 0xfeaf,
];
/** Miles's own controllers. */
const PATCH_BANK = 114;
const MODULATION = 1;
const VOLUME = 7;
const EXPRESSION = 11;
const SUSTAIN = 64;
const RESET_CONTROLLERS = 121;
const ALL_NOTES_OFF = 123;

interface MidiChannel {
  bank: number;
  timbre?: Timbre;
  volume: number;
  expression: number;
  modulation: number;
  sustain: boolean;
  /** 0 to 0x3fff, centred on 0x2000. */
  bend: number;
}

interface Voice {
  channel: number;
  /** The note as played, to find it again for its note-off. */
  note: number;
  /** The note it sounds at: the drum's own pitch for drums. */
  sounding: number;
  transposition: number;
  timbre: Timbre;
  velocity: number;
  held: boolean;
  started: number;
}

export class AdlibDriver {
  private readonly channels: MidiChannel[] = [];
  private readonly voices: Array<Voice | undefined> = new Array(VOICES).fill(undefined);
  private notes = 0;

  constructor(
    readonly opl: Opl2,
    private readonly timbres: Timbre[],
  ) {
    this.reset();
  }

  reset(): void {
    this.channels.length = 0;
    for (let i = 0; i < 16; i++) this.channels.push({ bank: 0, volume: 127, expression: 127, modulation: 0, sustain: false, bend: 0x2000 });
    this.voices.fill(undefined);
    const w = (r: number, v: number) => this.opl.write(r, v);
    w(0x01, 0x20); // waveform select on
    w(0x08, 0);
    w(0xbd, 0xc0); // deep tremolo and vibrato, no rhythm mode
    for (let v = 0; v < VOICES; v++) {
      const [a, b] = operatorOffsets(v);
      for (const o of [a, b]) {
        w(0x20 + o, 1);
        w(0x40 + o, 0x3f);
        w(0x60 + o, 0xff);
        w(0x80 + o, 0x0f);
        w(0xe0 + o, 0);
      }
      w(0xa0 + v, 0);
      w(0xb0 + v, 0);
      w(0xc0 + v, 0);
    }
  }

  event(e: XmiEvent): void {
    const ch = this.channels[e.channel];
    switch (e.type) {
      case 'noteOn':
        this.noteOn(e.channel, e.note, e.velocity);
        break;
      case 'noteOff':
        this.noteOff(e.channel, e.note);
        break;
      case 'program':
        ch.timbre = findTimbre(this.timbres, ch.bank, e.program) ?? findTimbre(this.timbres, 0, e.program) ?? ch.timbre;
        break;
      case 'pitchBend':
        ch.bend = e.value;
        this.update(e.channel, false, true);
        break;
      case 'control':
        this.control(e.channel, e.controller, e.value);
        break;
    }
  }

  private control(channel: number, controller: number, value: number): void {
    const ch = this.channels[channel];
    switch (controller) {
      case PATCH_BANK:
        ch.bank = value;
        break;
      case MODULATION:
        ch.modulation = value;
        this.update(channel, true, false);
        break;
      case VOLUME:
        ch.volume = value;
        this.update(channel, true, false);
        break;
      case EXPRESSION:
        ch.expression = value;
        this.update(channel, true, false);
        break;
      case SUSTAIN:
        ch.sustain = value >= 64;
        if (!ch.sustain) this.voices.forEach((v, i) => v?.channel === channel && v.held && this.release(i));
        break;
      case RESET_CONTROLLERS:
        Object.assign(ch, { sustain: false, modulation: 0, expression: 127, bend: 0x2000 });
        this.voices.forEach((v, i) => v?.channel === channel && v.held && this.release(i));
        this.update(channel, true, true);
        break;
      case ALL_NOTES_OFF:
        this.voices.forEach((v, i) => v?.channel === channel && this.release(i));
        break;
    }
  }

  private noteOn(channel: number, note: number, velocity: number): void {
    const drum = channel === 9;
    const timbre = drum ? findTimbre(this.timbres, PERCUSSION_BANK, note) : this.channels[channel].timbre;
    if (!timbre) return;
    let slot = this.voices.findIndex((v) => !v);
    if (slot < 0) {
      // Every voice is busy: take the one that has sounded longest.
      slot = 0;
      for (let i = 1; i < VOICES; i++) if (this.voices[i]!.started < this.voices[slot]!.started) slot = i;
      this.keyOff(slot);
    }
    this.voices[slot] = {
      channel,
      note,
      sounding: drum ? timbre.transposition : note,
      transposition: drum ? 0 : timbre.transposition,
      timbre,
      velocity: SENSITIVITY[(velocity & 0x7f) >> 3],
      held: false,
      started: this.notes++,
    };
    this.program(slot);
    this.frequency(slot, true);
  }

  private noteOff(channel: number, note: number): void {
    this.voices.forEach((v, i) => {
      if (!v || v.channel !== channel || v.note !== note) return;
      if (this.channels[channel].sustain) v.held = true;
      else this.release(i);
    });
  }

  private release(slot: number): void {
    this.keyOff(slot);
    this.voices[slot] = undefined;
  }

  private keyOff(slot: number): void {
    const v = this.voices[slot];
    if (v) this.frequency(slot, false);
  }

  /** Re-sends what changed on a channel to the voices playing it. */
  private update(channel: number, levels: boolean, pitch: boolean): void {
    this.voices.forEach((v, i) => {
      if (v?.channel !== channel) return;
      if (levels) this.program(i, true);
      if (pitch) this.frequency(i, true);
    });
  }

  /** Writes the voice's instrument, with its loudness, to its FM channel. */
  private program(slot: number, levelsOnly = false): void {
    const v = this.voices[slot]!;
    const ch = this.channels[v.channel];
    const t = v.timbre;
    const [o1, o2] = operatorOffsets(slot);
    const w = (r: number, value: number) => this.opl.write(r, value);
    let volume = (ch.volume * ch.expression * 2) >> 8;
    if (volume) volume++;
    volume = (volume * v.velocity * 2) >> 8;
    if (volume) volume++;
    volume = Math.min(volume, 0x7f);
    const level = (r40: number, scaled: boolean) => {
      let loud = ~r40 & 0x3f;
      if (scaled) loud = Math.floor((loud * volume) / 127);
      return (r40 & 0xc0) | (~loud & 0x3f);
    };
    const vibrato = ch.modulation >= 64 ? 0x40 : 0;
    w(0x20 + o1, t.op1.r20 | vibrato);
    w(0x20 + o2, t.op2.r20 | vibrato);
    w(0x40 + o1, level(t.op1.r40, (t.c0 & 1) === 1));
    w(0x40 + o2, level(t.op2.r40, true));
    if (levelsOnly) return;
    w(0x60 + o1, t.op1.r60);
    w(0x60 + o2, t.op2.r60);
    w(0x80 + o1, t.op1.r80);
    w(0x80 + o2, t.op2.r80);
    w(0xe0 + o1, t.op1.rE0);
    w(0xe0 + o2, t.op2.rE0);
    w(0xc0 + slot, t.c0);
  }

  /** Writes the voice's pitch, with the key on or off. */
  private frequency(slot: number, keyOn: boolean): void {
    const v = this.voices[slot]!;
    const ch = this.channels[v.channel];
    // As Miles works it out, in its 16 steps a semitone.
    const bend = ((ch.bend - 0x2000) >> 5) * PITCH_RANGE;
    // Miles's own steps, kept as they are: they leave notes an octave down, and fold those out of range back in.
    let note = v.sounding + v.transposition - 24;
    do note += 12;
    while (note < 0);
    note += 12;
    do note -= 12;
    while (note > 95);
    let fine = (((note << 8) + bend + 8) >> 4) - 192;
    do fine += 192;
    while (fine < 0);
    fine += 192;
    do fine -= 192;
    while (fine > 96 * 16 - 1);
    const physical = fine >> 4;
    let f = FREQUENCIES[((physical % 12) << 4) + (fine & 0x0f)];
    let octave = Math.floor(physical / 12) - 1;
    if (f & 0x8000) octave++;
    if (octave < 0) {
      octave++;
      f >>= 1;
    }
    const b0 = ((f >> 8) & 3) | ((octave & 7) << 2) | (keyOn ? 0x20 : 0);
    this.opl.write(0xa0 + slot, f & 0xff);
    this.opl.write(0xb0 + slot, b0);
  }
}

/** The register offsets of an FM channel's two operators. */
function operatorOffsets(channel: number): [number, number] {
  const base = Math.floor(channel / 3) * 8 + (channel % 3);
  return [base, base + 3];
}

export interface RenderedSong {
  /** Mono samples at `sampleRate`. */
  samples: Float32Array;
  sampleRate: number;
}

/** Overall loudness, so a full arrangement stays within -1 to 1. */
const GAIN = 0.22;

/**
 * Plays a whole song through a fresh chip and returns the sound, ready to
 * loop: Arena's songs play over and over. `seconds` caps how much is made.
 */
export function renderSong(song: XmiSong, timbres: Timbre[], sampleRate = 44100, seconds = 600): RenderedSong {
  const opl = new Opl2(sampleRate);
  const driver = new AdlibDriver(opl, timbres);
  const total = Math.min(Math.ceil((song.length / XMI_TICKS_PER_SECOND) * sampleRate), Math.ceil(seconds * sampleRate));
  const samples = new Float32Array(total);
  let at = 0;
  for (const e of song.events) {
    const until = Math.min(total, Math.round((e.tick / XMI_TICKS_PER_SECOND) * sampleRate));
    if (until > at) {
      opl.render(samples, at, until - at);
      at = until;
    }
    if (at >= total) break;
    driver.event(e);
  }
  if (at < total) opl.render(samples, at, total - at);
  for (let i = 0; i < total; i++) samples[i] *= GAIN;
  return { samples, sampleRate };
}
