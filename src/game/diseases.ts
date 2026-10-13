import type {CreatureInfo} from '../formats/exe';
import type {DiseaseInfo, DiseaseTables} from '../formats/diseases';
import {roll, type Random} from './combat';

export const DISEASE_DAY = 86400;
export const DISEASE_ICONS = ['witch-pox','plague','yellow-fever','stomach-rot','consumption','brain-fever','swamp-rot','calirons-curse','cholera','leprosy','wound-rot','red-death','blood-rot','typhoid-fever','dementia','chrondiasis','wizard-fever'];
export interface DiseaseState {
  info: DiseaseInfo;
  started:number;
  /** Arena rolls each affected slot once when infected; repeated slots overwrite. */
  losses: number[];
  next: number;
  until?: number;
}

/** Original landed-blow gate: roll <= special, then roll < poison save.
 * Vampire uses a hardcoded 5 instead of its negative aura entry. Barbarians are immune.
 */
export function diseaseFrom(info: CreatureInfo, tables: DiseaseTables | undefined, poisonSave: number, cls: number | undefined, random: Random): DiseaseInfo | undefined {
  if (!tables || cls === 15) return undefined;
  const carrier = tables.carriers.find(c => c.creature === info.id);
  if (!carrier) return undefined;
  const chance = info.id === 22 ? 5 : info.special;
  if (chance <= 0 || Math.floor(random()*100) > chance || Math.floor(random()*100) >= poisonSave) return undefined;
  const id = carrier.diseases[Math.floor(random()*carrier.diseases.length)];
  return tables.diseases.find(d=>d.id===id);
}

export function infectDisease(info: DiseaseInfo, now: number, random: Random): DiseaseState {
  // Effect counters start at one minute, then repeat every 1440 game minutes.
  const until = info.temporary ? now + roll(random,3,18)*DISEASE_DAY : undefined;
  const losses = Array<number>(13).fill(0);
  for (const slot of info.attributes) losses[slot] = roll(random,...info.damage);
  return {info, started:now, losses, next:now+60, until};
}

/** Readable consequences use the actual affected slots, not a generic disease label. */
export function diseaseDescription(info:DiseaseInfo):string {
 const slots:Record<number,string>={0:'Strength',1:'Intelligence',2:'Willpower',3:'Agility',4:'Speed',5:'Endurance',6:'Personality',7:'Luck',8:'health',10:'spell points',12:'stamina'};
 const names=[...new Set(info.attributes)].map(slot=>slots[slot]).filter(Boolean);
 const list=names.length>1?names.slice(0,-1).join(', ')+' and '+names.at(-1):names[0];
 return `Reduces ${list} over time`;
}
