/** Arena Weapon Motion v1 reader. Values retain double precision. */
export function readWeaponMotion<T>(bytes:Uint8Array):T {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=new TextDecoder();let cursor=4;
  if(bytes.length<4||text.decode(bytes.subarray(0,4))!=='AWM1')throw Error('Unsupported weapon motion format');
  function need(length:number){if(!Number.isSafeInteger(length)||length<0||cursor+length>bytes.length)throw Error('Truncated weapon motion data');}
  function uint(){need(4);const n=view.getUint32(cursor,true);cursor+=4;return n;}
  function number(){need(8);const n=view.getFloat64(cursor,true);cursor+=8;if(!Number.isFinite(n))throw Error('Invalid weapon motion number');return n;}
  function string(){const length=uint();need(length);const s=text.decode(bytes.subarray(cursor,cursor+length));cursor+=length;return s;}
  function value(depth=0):unknown {
    if(depth>128)throw Error('Weapon motion nesting exceeds limit');need(1);const tag=bytes[cursor++];
    if(tag===0)return null;if(tag===1)return false;if(tag===2)return true;
    if(tag===3)return number();if(tag===4)return string();
    if(tag===5||tag===7){const length=uint();need(length*(tag===7?8:1));return Array.from({length},()=>tag===7?number():value(depth+1));}
    if(tag===6){const length=uint();need(length*5);const result:Record<string,unknown>=Object.create(null);for(let i=0;i<length;i++){const key=string();if(Object.hasOwn(result,key))throw Error('Duplicate weapon motion field');result[key]=value(depth+1);}return result;}
    throw Error('Unknown weapon motion value type');
  }
  const result=value();if(cursor!==bytes.length)throw Error('Trailing weapon motion data');return result as T;
}
