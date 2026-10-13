import {cString} from './cstrings';

export interface MonsterRegeneration {
  health: number;
  everyRounds: number;
  revives: boolean;
}

/** CD initialization 2194:8e05/8eb8 and death decision 3aa1:06b8.
 * Validate the instruction layout before reading its immediate values.
 * Regeneration is indefinite; CX=1/2/3 is not its recovery interval.
 */
export function readMonsterRegeneration(image:Uint8Array):Array<MonsterRegeneration|undefined>|undefined {
  if(cString(image,0x3f508)!=='exp_ab.cfa')return undefined;
  const matches=(at:number,pattern:Array<number|null>)=>pattern.every((byte,i)=>at+i<image.length&&(byte===null||image[at+i]===byte));
  const init=0x1a745,effect=0x1a7f8,death=0x2b0c8;
  if(!matches(init,[0xb8,null,null,0xb9,1,0,0x26,0x80,0x7d,4,22,0x74,0x11,0x41,0x26,0x80,0x7d,4,14,0x74,9,0x41,0x40,0x26,0x80,0x7d,4,23,0x75,3,0xe8,0x83,0])||
     !matches(effect,[0xb8,0x80,0,0xbb,null,null,0xba,1,0,0xbd,0xfb,0xff])||
     !matches(death,[0xf7,0x84,0x0d,4,0x80,0,0x74,0x15,0x80,0x7c,4,23,0x74,0x0f,0x83,0x7c,0x5b,0,0x7f,0x1e]))return undefined;
  const health=image[init+1]+image[init+2]*256,everyRounds=image[effect+4]+image[effect+5]*256;
  if(health<1||health>100||everyRounds<1||everyRounds>100)return undefined;
  const result=Array<MonsterRegeneration|undefined>(24).fill(undefined);
  result[13]={health,everyRounds,revives:true};
  result[21]={health,everyRounds,revives:true};
  result[22]={health:health+1,everyRounds,revives:false};
  return result;
}
