import {cString} from './cstrings';

export interface MonsterSpells {
  spells: number[];
  /** Native casting level, separate from the creature's combat level. */
  spellLevel: number;
}

/**
 * CD monster initialization, 2194:8cee–8f08. Three early creatures have
 * immediate assignments in code; the last ten use four parallel tables.
 * Tharn's six spell IDs are contiguous at the end of the spell-ID table.
 * Offsets below are relative to the adjacent rat@.cfa animation list.
 * Other executable layouts remain unverified and are not guessed.
 */
export function readMonsterSpells(image: Uint8Array, animations: number): MonsterSpells[] | undefined {
  if(cString(image,0x3f508)!=='exp_ab.cfa' || animations<0x45 || animations>image.length) return undefined;
  const counts=image.subarray(animations-0x45,animations-0x3b);
  const ids=image.subarray(animations-0x3b,animations-0x2c);
  const levels=image.subarray(animations-0x2c,animations-0x22);
  if(counts.length!==10 || ids.length!==15 || levels.length!==10 ||
    counts.subarray(0,9).some(count=>count>1) || counts[9]!==6 ||
    levels.some(level=>level>30) ||
    counts.some((count,i)=>count>0&&(levels[i]===0||ids[i]>127)) ||
    ids.subarray(9).some(id=>id>127)) return undefined;
  const result=Array.from({length:24},():MonsterSpells=>({spells:[],spellLevel:0}));
  result[4]={spells:[12],spellLevel:6}; // Snow Wolf: Ice Bolt
  result[10]={spells:[16],spellLevel:6}; // Hell Hound: Fireball
  result[11]={spells:[63],spellLevel:5}; // Ghost: Spell Drain
  for(let i=0;i<10;i++) result[i+14]={
    spells:counts[i]===0?[]:Array.from(ids.subarray(i,i+counts[i])),
    spellLevel:levels[i],
  };
  return result;
}
