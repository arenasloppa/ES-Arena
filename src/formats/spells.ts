/**
 * SPELLSG.65: Arena's standard spells, the ones the Mages Guild sells. 128
 * records of 85 bytes; unused records are blank. Layout, from
 * OpenTESArena's ArenaTypes::SpellData:
 *
 *    0  u16[6][3]  parameters: six numbers for each of the three effects,
 *                  row by row (params[row][effect])
 *   36  u8         target: 0 caster, 1 touch, 2 target, 3 area around the
 *                  caster, 4 area at the target, 0xff walls (Passwall)
 *   37  u8         unknown
 *   38  u8         element: 0 fire, 1 cold, 2 poison, 3 shock, 4 magic,
 *                  5 none (heals and other spells on oneself)
 *   39  u16        flags
 *   41  u8[3]      effects, 0xff for none (see EFFECT_NAMES)
 *   44  u8[3]      sub-effects (Heal: 0 stamina, 1 health; ...)
 *   47  u8[3]      affected attributes
 *   50  u16        cost
 *   52  char[33]   name
 *
 * The meaning of the target and element numbers was worked out from the
 * spells themselves (Fireball hits an area at the target with fire, Shock
 * is a touch of shock). The effect numbers are in the order of Arena's
 * spellmaker list.
 */

export const SPELL_SIZE = 85;
export const SPELL_RECORDS = 128;

export type SpellTarget = 'caster' | 'touch' | 'target' | 'areaCaster' | 'areaTarget' | 'walls';
const TARGETS: Record<number, SpellTarget> = { 0: 'caster', 1: 'touch', 2: 'target', 3: 'areaCaster', 4: 'areaTarget', 255: 'walls' };

export const ELEMENTS = ['Fire', 'Cold', 'Poison', 'Shock', 'Magic'];

/** Arena's spell effects, by number. */
export const EFFECT_NAMES = [
  'Cause',
  'Continuous Damage',
  'Create',
  'Cure',
  'Damage',
  'Designate Non-Target',
  'Destroy',
  'Detect',
  'Disintegrate',
  'Drain',
  'Elemental Resistance',
  'Fortify',
  'Heal',
  'Transfer',
  'Hold',
  'Invisibility',
  'Levitate',
  'Light',
  'Lock',
  'Open',
  'Regenerate',
  'Silence',
  'Spell Absorption',
  'Spell Reflection',
  'Spell Resistance',
];

export interface SpellEffect {
  /** Index into EFFECT_NAMES. */
  effect: number;
  sub: number;
  attribute: number;
  /** The effect's six numbers, in the file's order. */
  params: [number, number, number, number, number, number];
}

export interface SpellRecord {
  /** The record's place in the file. */
  index: number;
  name: string;
  target: SpellTarget;
  /** Index into ELEMENTS; 5 or more for none. */
  element: number;
  flags: number;
  /** One to three effects. */
  effects: SpellEffect[];
  cost: number;
}

export class SpellFormatError extends Error {}

/** Reads the named spells; blank records are left out. */
export function parseSpells(bytes: Uint8Array): SpellRecord[] {
  if (bytes.length < SPELL_SIZE || bytes.length % SPELL_SIZE !== 0) {
    throw new SpellFormatError(`a spell list is a whole number of ${SPELL_SIZE}-byte records, not ${bytes.length} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const spells: SpellRecord[] = [];
  for (let index = 0; index < bytes.length / SPELL_SIZE; index++) {
    const at = index * SPELL_SIZE;
    const name = latin1(bytes.subarray(at + 52, at + SPELL_SIZE)).trim();
    if (!name) continue;
    const target = TARGETS[bytes[at + 36]];
    if (!target) continue;
    const effects: SpellEffect[] = [];
    for (let e = 0; e < 3; e++) {
      const effect = bytes[at + 41 + e];
      if (effect === 0xff || effect >= EFFECT_NAMES.length) continue;
      const params = Array.from({ length: 6 }, (_, row) => view.getUint16(at + (row * 3 + e) * 2, true)) as SpellEffect['params'];
      effects.push({ effect, sub: bytes[at + 44 + e], attribute: bytes[at + 47 + e], params });
    }
    if (!effects.length) continue;
    spells.push({
      index,
      name,
      target,
      element: bytes[at + 38],
      flags: view.getUint16(at + 39, true),
      effects,
      cost: view.getUint16(at + 50, true),
    });
  }
  return spells;
}

function latin1(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...(end >= 0 ? bytes.subarray(0, end) : bytes));
}
