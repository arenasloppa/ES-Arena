import {cString} from './cstrings';

export interface SpellAreaCell {x:number;y:number}

/** CD 3cdd:094d matches packed map-cell offsets, rather than a radial distance.
 * Decode the table only when its native loop and data-segment layout match.
 */
export function readSpellAreaCells(image:Uint8Array):SpellAreaCell[]|undefined {
  const routine=0x2d71d,table=0x43e51;
  const pattern=[0xb9,0x15,0,0xbf,0x51,0x84,0x8b,0xd3,3,0x15,0x3b,0xc2,0x74,7,0x83,0xc7,2,0xe2,0xf3,0xf8,0xc3,0xf9,0xc3];
  if(cString(image,0x3f508)!=='exp_ab.cfa'||image.length<table+42||!pattern.every((b,i)=>image[routine+i]===b))return undefined;
  const view=new DataView(image.buffer,image.byteOffset,image.byteLength),cells:SpellAreaCell[]=[];
  for(let i=0;i<21;i++){
    const offset=view.getInt16(table+i*2,true),y=Math.round(offset/256),x=(offset-y*256)/2;
    if(!Number.isInteger(x)||Math.abs(x)>8||Math.abs(y)>8||cells.some(c=>c.x===x&&c.y===y))return undefined;
    cells.push({x,y});
  }
  return cells.some(c=>c.x===0&&c.y===0)?cells:undefined;
}
