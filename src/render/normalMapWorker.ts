import { relief } from './textureRelief';
self.onmessage = (event: MessageEvent<{id:number; pixels:Uint8Array; width:number; height:number; flipY:boolean}>) => {
  const {id,pixels,width,height,flipY}=event.data;
  const bytes=relief(pixels,width,height,new Uint8ClampedArray(width*height*4));
  if(!flipY)for(let i=1;i<bytes.length;i+=4)bytes[i]=255-bytes[i];
  self.postMessage({id,bytes}, {transfer:[bytes.buffer]});
};
