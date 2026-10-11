/**
 * XMI: the Miles Sound System's extended MIDI, Arena's music. An IFF file:
 *
 *   FORM XDIR { INFO (u16 sequence count) }
 *   CAT  XMID { FORM XMID { TIMB? RBRN? EVNT } ... }
 *
 * Chunk sizes are big-endian. TIMB lists the (patch, bank) pairs the song
 * uses. EVNT holds the events with these differences from a MIDI file:
 * - Time runs at a fixed 120 ticks a second.
 * - A delay is a run of bytes below 0x80, added together, before an event.
 * - There is no running status.
 * - A note-on carries its own length after the velocity, as a MIDI
 *   variable-length number; there are no note-offs.
 * The format is as the Miles drivers read it (see ScummVM's XMIDI parser,
 * the reference used here). Arena keeps two arrangements of every song:
 * .XMI for MIDI synthesizers and .XFM for FM chips.
 */

export const XMI_TICKS_PER_SECOND = 120;

export type XmiEvent =
  | { tick: number; type: 'noteOn'; channel: number; note: number; velocity: number }
  | { tick: number; type: 'noteOff'; channel: number; note: number }
  | { tick: number; type: 'control'; channel: number; controller: number; value: number }
  | { tick: number; type: 'program'; channel: number; program: number }
  | { tick: number; type: 'pitchBend'; channel: number; value: number };

export interface XmiSong {
  /** Every event, note-offs included, in time order. */
  events: XmiEvent[];
  /** Ticks to the end of the song, the last note's end included. */
  length: number;
  /** The (patch, bank) pairs the song asks for. */
  timbres: Array<{ patch: number; bank: number }>;
}

export class XmiFormatError extends Error {}

/** Reads the first song of an XMI file. */
export function parseXmi(bytes: Uint8Array): XmiSong {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let timbres: XmiSong['timbres'] = [];
  let evnt: Uint8Array | undefined;

  // Walks the chunks from `start` to `end`, going into FORM and CAT chunks.
  const walk = (start: number, end: number) => {
    for (let p = start; p + 8 <= end && !evnt; ) {
      const tag = id(p);
      const size = view.getUint32(p + 4, false);
      const body = p + 8;
      if (body + size > bytes.length + 1) throw new XmiFormatError(`the ${tag} chunk runs past the end of the file`);
      if (tag === 'FORM' || tag === 'CAT ') walk(body + 4, Math.min(body + size, end));
      else if (tag === 'TIMB') {
        const count = view.getUint16(body, true);
        timbres = Array.from({ length: count }, (_, i) => ({ patch: bytes[body + 2 + i * 2], bank: bytes[body + 3 + i * 2] }));
      } else if (tag === 'EVNT') evnt = bytes.subarray(body, Math.min(body + size, bytes.length));
      // Chunks are padded to an even size.
      p = body + size + (size & 1);
    }
  };
  walk(0, bytes.length);
  if (!evnt) throw new XmiFormatError('no EVNT chunk: not an XMI song');
  return { ...readEvents(evnt), timbres };
}

function readEvents(data: Uint8Array): { events: XmiEvent[]; length: number } {
  const events: XmiEvent[] = [];
  let tick = 0;
  let length = 0;
  let p = 0;
  const vlq = () => {
    let value = 0;
    for (;;) {
      const b = data[p++];
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80) || p >= data.length) return value;
    }
  };
  while (p < data.length) {
    // A delay: bytes below 0x80, added together.
    while (p < data.length && data[p] < 0x80) tick += data[p++];
    if (p >= data.length) break;
    const status = data[p++];
    const channel = status & 0x0f;
    switch (status & 0xf0) {
      case 0x90: {
        const note = data[p++];
        const velocity = data[p++];
        const duration = vlq();
        if (velocity > 0) {
          events.push({ tick, type: 'noteOn', channel, note, velocity });
          events.push({ tick: tick + duration, type: 'noteOff', channel, note });
          length = Math.max(length, tick + duration);
        }
        break;
      }
      case 0x80:
        events.push({ tick, type: 'noteOff', channel, note: data[p] });
        p += 2;
        break;
      case 0xa0:
        p += 2;
        break;
      case 0xb0:
        events.push({ tick, type: 'control', channel, controller: data[p], value: data[p + 1] });
        p += 2;
        break;
      case 0xc0:
        events.push({ tick, type: 'program', channel, program: data[p++] });
        break;
      case 0xd0:
        p += 1;
        break;
      case 0xe0:
        events.push({ tick, type: 'pitchBend', channel, value: data[p] | (data[p + 1] << 7) });
        p += 2;
        break;
      default:
        if (status === 0xff) {
          const meta = data[p++];
          const len = vlq();
          p += len;
          if (meta === 0x2f) p = data.length; // end of track
        } else if (status === 0xf0 || status === 0xf7) p += vlq();
        else throw new XmiFormatError(`unexpected byte 0x${status.toString(16)} in the events`);
    }
  }
  length = Math.max(length, tick);
  // Stable sort by time; at the same moment, notes end before new ones start.
  const order = (e: XmiEvent) => (e.type === 'noteOff' ? 0 : 1);
  events.sort((a, b) => a.tick - b.tick || order(a) - order(b));
  return { events, length };
}
