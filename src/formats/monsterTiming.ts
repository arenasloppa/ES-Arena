import {cString} from './cstrings';

export interface MonsterTiming {
  timerTicks:number;
  meleeMask:number;
  castDivisor:number;
  reach:number;
  attackFirst:number;
  attackEnd:number;
  strikeFrame:number;
  deathEnd:number;
  speedMultiplier:number;
  speedBase:number;
}

/** Validated CD AI/frame routines. The normal loop waits two BIOS ticks;
 * the original fast-mode option skips its second wait.
 */
export function readMonsterTiming(image:Uint8Array):MonsterTiming|undefined {
  const matches=(at:number,hex:string)=>hex.match(/../g)!.every((b,i)=>image[at+i]===parseInt(b,16));
  if(cString(image,0x3f508)!=='exp_ab.cfa'||
    !matches(0xa428,'a151013b0660ba74f7f7069ac30004750dff0660baa151013b0660ba74f7ff06bccc')||
    !matches(0x1d89,'640fb6472db91400f7e1c1e808051400894408')||
    !matches(0x1e3a,'c1e80203c33daa000f878e00')||
    !matches(0x1eab,'2507000f85ef00')||!matches(0x1f77,'33d2b91600f7f123d2751f')||
    !matches(0x1da5,'807c0d087220807c0d0a0f85ee01')||
    !matches(0x19b8,'807c0d087204c6440d00')||
    !matches(0x2117,'f74402ffff7508a1cecc653907730d')||
    !matches(0x221b,'c6440cc0fe440d807c0d0c7204c6440d00c3')||
    !matches(0x21a7,'fe440d807c0d037301'))return undefined;
  return {timerTicks:2,meleeMask:image[0x1eac],castDivisor:image[0x1f7a],reach:image[0x1e40],
    attackFirst:image[0x1da8],attackEnd:image[0x2225],strikeFrame:image[0x1dae],deathEnd:image[0x21ad],
    speedMultiplier:image[0x1d8f],speedBase:image[0x1d97]};
}
