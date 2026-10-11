/**
 * GLOBAL.BSA reader.
 *
 * Layout: a u16 entry count, then every entry's bytes back to back, then an
 * index at the very end of the file with one 18-byte record per entry:
 * a 12-byte NUL-padded name, a u16 (unused) and a u32 size.
 */
export interface BsaEntry {
  name: string;
  offset: number;
  size: number;
}

const RECORD_SIZE = 18;
const NAME_SIZE = 12;

export class BsaArchive {
  readonly entries: BsaEntry[];
  private readonly byName = new Map<string, BsaEntry>();

  constructor(private readonly data: Uint8Array) {
    if (data.length < 2) throw new Error('BSA: file is too small');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = view.getUint16(0, true);
    const indexStart = data.length - count * RECORD_SIZE;
    if (indexStart < 2) throw new Error(`BSA: index for ${count} entries does not fit`);

    this.entries = [];
    let offset = 2;
    for (let i = 0; i < count; i++) {
      const rec = indexStart + i * RECORD_SIZE;
      const name = readFixedString(data, rec, NAME_SIZE);
      const size = view.getUint32(rec + 14, true);
      if (offset + size > indexStart) throw new Error(`BSA: entry ${name} runs past the index`);
      const entry = { name, offset, size };
      this.entries.push(entry);
      this.byName.set(name.toUpperCase(), entry);
      offset += size;
    }
  }

  has(name: string): boolean {
    return this.byName.has(name.toUpperCase());
  }

  /** Returns the entry's bytes (a view, not a copy), or undefined. */
  get(name: string): Uint8Array | undefined {
    const e = this.byName.get(name.toUpperCase());
    return e ? this.data.subarray(e.offset, e.offset + e.size) : undefined;
  }
}

export function readFixedString(data: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    const c = data[start + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}
