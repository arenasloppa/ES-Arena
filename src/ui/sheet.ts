/**
 * Pieces of Arena's character sheet that character creation and the level-up
 * screen share: the attribute rows, stepped with left and right, and what
 * each attribute gives, which Arena's sheet shows beside it.
 */
import { derivedAttributes, LUCK } from '../game/character';

/** A number with its sign, as the sheet shows what attributes add and take away. */
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** What each attribute gives, in the attributes' order; `spellPoints` is what Intelligence's says. */
export function attributeNotes(a: number[], spellPoints: string): string[] {
  const v = derivedAttributes(a);
  const beside: Array<Array<[string, string]>> = [
    [
      ['Damage', signed(v.damage)],
      ['Max Kilos', String(v.maxKilos)],
    ],
    [['Spell Pts', spellPoints]],
    [['Magic Def', signed(v.magicDefence)]],
    [
      ['To Hit', signed(v.toHit)],
      ['To Defend', signed(v.toDefend)],
    ],
    [],
    [
      ['Health', signed(v.health)],
      ['Heal Mod', signed(v.healMod)],
    ],
    [['Charisma', signed(v.charisma)]],
    [],
  ];
  const notes = beside.map((pairs) => pairs.map(([k, x]) => `${k} ${x}`).join('  ·  '));
  // Arena shows nothing for Luck; the remake says what Oblivion's description does.
  notes[LUCK] = 'Has an effect on everything you do';
  return notes;
}

/** A row like the settings': a name, and a value stepped with left and right. */
export function settingRow(label: string, value: string): HTMLButtonElement {
  const row = el('button', 'option option-row');
  row.dataset.setting = 'creation';
  const valueBox = el('span', 'row-value');
  const less = el('span', 'arrow', '‹');
  less.dataset.step = '-1';
  less.setAttribute('aria-hidden', 'true');
  const more = el('span', 'arrow', '›');
  more.dataset.step = '1';
  more.setAttribute('aria-hidden', 'true');
  valueBox.append(less, el('span', 'value', value), more);
  row.append(el('span', 'row-label', label), valueBox);
  return row;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
