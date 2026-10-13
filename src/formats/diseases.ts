import {cString, stringsAt} from './cstrings';

export interface DiseaseInfo {
  id: number;
  name: string;
  damage: [number, number];
  /** STR..LUC 0..7, health 8, spell points 10, fatigue 12. Original order retained. */
  attributes: number[];
  temporary: boolean;
}
export interface DiseaseTables {
  diseases: DiseaseInfo[];
  carriers: Array<{creature: number; diseases: number[]}>;
}

/** Validated CD executable tables, checked against the original effect routines.
 * Unknown layouts are left unread rather than inventing disease statistics.
 */
export function readDiseaseTables(image: Uint8Array): DiseaseTables | undefined {
  if (cString(image, 0x3f508) !== 'exp_ab.cfa' || cString(image, 0x36fd8) !== 'Witch Pox' || image.length <= 0x445eb) return undefined;
  const names = stringsAt(image, 0x36fd8, 17), temporary = image.subarray(0x445e8, 0x445eb);
  let at = 0x3a032;
  const list = (allowed: (n: number) => boolean): number[] | undefined => {
    const out: number[] = [];
    for (let i = 0; i < 24; i++) {
      const n = image[at++];
      if (n === 255) return out.length ? out : undefined;
      if (!allowed(n)) return undefined;
      out.push(n);
    }
    return undefined;
  };
  const diseases: DiseaseInfo[] = [];
  for (let i = 0; i < 17; i++) {
    const low = image[0x445bc + i * 2], high = image[0x445bd + i * 2];
    const attributes = list(n => n < 8 || [8,10,12].includes(n));
    if (!names[i] || low < 1 || high < low || high > 30 || !attributes) return undefined;
    diseases.push({id:i+10, name:names[i], damage:[low,high], attributes, temporary:temporary.includes(i+10)});
  }
  const carriers: DiseaseTables['carriers'] = [];
  at = 0x43cc7;
  for (let i = 0; i < 4; i++) {
    const creature = image[0x43cbb+i];
    const ids = list(n => n >= 10 && n <= 26);
    if (![1,10,13,22].includes(creature) || !ids) return undefined;
    carriers.push({creature,diseases:ids});
  }
  return {diseases, carriers};
}
