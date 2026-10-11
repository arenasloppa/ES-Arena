/**
 * SAMPLE.AD (and SAMPLE.OPL): the Miles Sound System's global timbre
 * library, the instruments Arena's music plays on an AdLib or Sound Blaster.
 *
 * A list of entries, each [patch u8][bank u8][offset u32], ending with patch
 * and bank both 0xFF. At each offset an instrument: a u16 size (14 for a
 * two-operator instrument), then a transposition (i8, or for the drums of
 * bank 127 the note they sound at), then the OPL register values: 0x20,
 * 0x40, 0x60, 0x80, 0xE0 for the first operator, 0xC0 for the channel, and
 * 0x20, 0x40, 0x60, 0x80, 0xE0 for the second. As ScummVM's Miles AdLib
 * driver reads it.
 */

export interface Timbre {
  patch: number;
  bank: number;
  transposition: number;
  /** Registers 0x20, 0x40, 0x60, 0x80, 0xE0 of the modulator and the carrier. */
  op1: OperatorRegisters;
  op2: OperatorRegisters;
  /** Feedback and connection (register 0xC0). */
  c0: number;
}

export interface OperatorRegisters {
  r20: number;
  r40: number;
  r60: number;
  r80: number;
  rE0: number;
}

/** The bank whose patches are the drums of MIDI channel 10, by note. */
export const PERCUSSION_BANK = 127;

export class TimbreFormatError extends Error {}

export function parseTimbres(bytes: Uint8Array): Timbre[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const timbres: Timbre[] = [];
  for (let p = 0; ; p += 6) {
    if (p + 2 > bytes.length) throw new TimbreFormatError('the timbre list has no end');
    const patch = bytes[p];
    const bank = bytes[p + 1];
    if (patch === 0xff && bank === 0xff) break;
    if (p + 6 > bytes.length) throw new TimbreFormatError('the timbre list has no end');
    const at = view.getUint32(p + 2, true);
    if (at + 14 > bytes.length) throw new TimbreFormatError(`timbre ${bank}:${patch} is past the end of the file`);
    const size = view.getUint16(at, true);
    // Only two-operator instruments are known; leave out anything else.
    if (size !== 14) continue;
    const r = (i: number) => bytes[at + 2 + i];
    timbres.push({
      patch,
      bank,
      transposition: view.getInt8(at + 2),
      op1: { r20: r(1), r40: r(2), r60: r(3), r80: r(4), rE0: r(5) },
      c0: r(6),
      op2: { r20: r(7), r40: r(8), r60: r(9), r80: r(10), rE0: r(11) },
    });
  }
  return timbres;
}

/** Finds an instrument by bank and patch. */
export function findTimbre(timbres: Timbre[], bank: number, patch: number): Timbre | undefined {
  return timbres.find((t) => t.bank === bank && t.patch === patch);
}
