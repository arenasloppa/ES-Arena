import { SPELL_SIZE } from '../../src/formats/spells';

/** One made-up 85-byte spell record; none of these numbers come from the game. */
export function record(o: { name: string; target?: number; element?: number; effects?: number[]; subs?: number[]; params?: number[][]; cost?: number }): Uint8Array {
  const b = new Uint8Array(SPELL_SIZE);
  const v = new DataView(b.buffer);
  const effects = o.effects ?? [4];
  // params[row][effect]
  (o.params ?? [[1, 10, 1, 2, 1, 0]]).forEach((p, e) => p.forEach((n, row) => v.setUint16((row * 3 + e) * 2, n, true)));
  b[36] = o.target ?? 2;
  b[38] = o.element ?? 0;
  for (let e = 0; e < 3; e++) {
    b[41 + e] = effects[e] ?? 0xff;
    b[44 + e] = o.subs?.[e] ?? 0;
  }
  v.setUint16(50, o.cost ?? 100, true);
  [...o.name].forEach((c, i) => (b[52 + i] = c.charCodeAt(0)));
  return b;
}

export function file(...records: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(records.length * SPELL_SIZE);
  records.forEach((r, i) => out.set(r, i * SPELL_SIZE));
  return out;
}
