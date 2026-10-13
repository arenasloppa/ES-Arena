import * as THREE from 'three';
import { relief } from './textureRelief';

const maps = new WeakMap<object, Map<string, THREE.DataTexture>>();
let worker: Worker | undefined;
let nextJob = 0;
const pending = new Map<number, {map:THREE.DataTexture; pixels:Uint8Array; width:number; height:number; flipY:boolean}>();

function finish(map: THREE.DataTexture, pixels: Uint8Array, width:number, height:number, flipY:boolean): void {
  const bytes=relief(pixels,width,height,new Uint8ClampedArray(width*height*4));
  if(!flipY)for(let i=1;i<bytes.length;i+=4)bytes[i]=255-bytes[i];
  (map.image as {data:Uint8Array}).data.set(bytes);map.needsUpdate=true;
}

export function normalMapFor(texture: THREE.Texture): THREE.DataTexture | undefined {
  const image = texture.image as { width: number; height: number; data?: Uint8Array };
  if (!image || image.width < 8 || image.height < 8) return undefined;
  const key = JSON.stringify([texture.flipY,texture.wrapS,texture.wrapT,texture.channel,texture.repeat.toArray(),texture.offset.toArray(),texture.center.toArray(),texture.rotation,texture.matrixAutoUpdate,texture.matrix.toArray()]);
  let variants = maps.get(image); if (!variants) {variants=new Map();maps.set(image,variants);}
  const cached = variants.get(key); if (cached) return cached;
  const scale=Math.min(1,512/Math.max(image.width,image.height));
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
  let pixels = image.data;
  if (!pixels) {
    if (typeof document === 'undefined') return undefined;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(texture.image as CanvasImageSource,0,0,width,height);
    pixels = new Uint8Array(context.getImageData(0,0,width,height).data);
  } else if(scale<1) {
    const small=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const source=(Math.floor(y*image.height/height)*image.width+Math.floor(x*image.width/width))*4;
      small.set(pixels.subarray(source,source+4),(y*width+x)*4);
    }
    pixels=small;
  }
  const data=new Uint8Array(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set([128,128,255,255],i);
  const map = new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  map.wrapS=texture.wrapS;map.wrapT=texture.wrapT;map.flipY=texture.flipY;map.channel=texture.channel;
  map.repeat.copy(texture.repeat);map.offset.copy(texture.offset);map.center.copy(texture.center);map.rotation=texture.rotation;
  map.matrixAutoUpdate=texture.matrixAutoUpdate;map.matrix.copy(texture.matrix);if(map.matrixAutoUpdate)map.updateMatrix();
  map.magFilter = THREE.NearestFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true;
  variants.set(key,map);
  if(width*height>65536&&typeof Worker!=='undefined') {
    try {
      if(!worker){
        worker=new Worker(new URL('./normalMapWorker.ts',import.meta.url),{type:'module'});
        worker.onmessage=event=>{const job=pending.get(event.data.id);if(!job)return;pending.delete(event.data.id);(job.map.image as {data:Uint8Array}).data.set(event.data.bytes);job.map.needsUpdate=true;};
        worker.onerror=()=>{for(const job of pending.values())finish(job.map,job.pixels,job.width,job.height,job.flipY);pending.clear();worker?.terminate();worker=undefined;};
      }
      const id=++nextJob;pending.set(id,{map,pixels,width,height,flipY:texture.flipY});
      worker.postMessage({id,pixels:new Uint8Array(pixels),width,height,flipY:texture.flipY});return map;
    } catch { /* Fall back to the same calculation when workers are unavailable. */ }
  }
  finish(map,pixels,width,height,texture.flipY);return map;
}
