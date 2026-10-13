import * as THREE from 'three';

// Soft glow for the rendered scene.
// Off bypasses all passes; the blur runs at a quarter of the scene resolution.
export function createSoftLighting(renderer: THREE.WebGLRenderer){
 const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
 const make=(fragmentShader: string,uniforms: Record<string, THREE.IUniform>)=>new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending});
 const source=`uniform vec4 region;uniform vec2 sourceTexel;vec4 sampleSource(vec2 p){return texture2D(image,region.xy+clamp(p,sourceTexel*.5,vec2(1.)-sourceTexel*.5)*region.zw);}`;
 const sourceUniforms=()=>({region:{value:new THREE.Vector4(0,0,1,1)},sourceTexel:{value:new THREE.Vector2()}});
 const extract=make(`uniform sampler2D image;uniform vec2 texel;uniform float threshold;varying vec2 vUv;${source}
 void main(){vec3 c=vec3(0.);for(int i=0;i<4;i++){vec2 off=vec2(mod(float(i),2.)-.5,floor(float(i)/2.)-.5)*texel*2.;vec4 s=sampleSource(vUv+off);c+=s.rgb*s.a;}c*=.25;
 float bright=max(c.r,max(c.g,c.b));float knee=smoothstep(threshold*.5,threshold*1.5,bright);gl_FragColor=vec4(c*knee*max(0.,bright-threshold)/max(bright,.001),1.);}`,{...sourceUniforms(),image:{value:null},texel:{value:new THREE.Vector2()},threshold:{value:.1}});
 const blur=make(`uniform sampler2D image;uniform vec2 direction;varying vec2 vUv;
 void main(){vec3 c=texture2D(image,vUv).rgb*.227027;c+=(texture2D(image,vUv+direction*1.384615).rgb+texture2D(image,vUv-direction*1.384615).rgb)*.316216;c+=(texture2D(image,vUv+direction*3.230769).rgb+texture2D(image,vUv-direction*3.230769).rgb)*.070270;gl_FragColor=vec4(c,1.);}`,{image:{value:null},direction:{value:new THREE.Vector2()}});
 const combine=make(`uniform sampler2D image,bloom;uniform vec2 texel;uniform float strength,preserveAlpha;varying vec2 vUv;${source}
 void main(){vec4 originalSample=sampleSource(vUv);vec3 original=originalSample.rgb;
 vec3 c=original+texture2D(bloom,vUv).rgb*strength;
 // Keep the dungeon's dark colours intact; only bright highlights bloom.
 c/=1.+max(c-vec3(.85),vec3(0.))*.15;
 gl_FragColor=vec4(c,mix(1.,originalSample.a,preserveAlpha));}`,{...sourceUniforms(),preserveAlpha:{value:0},image:{value:null},bloom:{value:null},texel:{value:new THREE.Vector2()},strength:{value:0}});
 const copy=make('uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}',{image:{value:null}});
 const scene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),extract),cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);scene.add(quad);
 let a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, width=0,height=0;
 const target=(w: number,h: number)=>new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false});
 function resize(w: number,h: number){if(w===width&&h===height)return;for(const t of[a,b,out])t?.dispose();width=w;height=h;a=target(Math.max(1,Math.ceil(w/4)),Math.max(1,Math.ceil(h/4)));b=target(a.width,a.height);out=target(w,h);}
 function draw(mat: THREE.ShaderMaterial,t: THREE.WebGLRenderTarget | null){quad.material=mat;renderer.setRenderTarget(t);renderer.render(scene,cam);}
 function render(texture: THREE.Texture,mode: boolean,{region=null,preserveAlpha=false}: {region?: [number,number,number,number] | null; preserveAlpha?: boolean}={}){
  if(!mode)return texture;
  const image=texture.image as {width:number;height:number};
  const [x,y,w,h]=region||[0,0,image.width,image.height];resize(w,h);
  const prior=renderer.getRenderTarget();
  for(const mat of[extract,combine]){mat.uniforms.region.value.set(x/image.width,y/image.height,w/image.width,h/image.height);mat.uniforms.sourceTexel.value.set(1/w,1/h);}
  extract.uniforms.image.value=texture;extract.uniforms.texel.value.set(1/width,1/height);extract.uniforms.threshold.value=.075;draw(extract,a);
  const radius=2.2;blur.uniforms.image.value=a.texture;blur.uniforms.direction.value.set(radius/a.width,0);draw(blur,b);
  blur.uniforms.image.value=b.texture;blur.uniforms.direction.value.set(0,radius/a.height);draw(blur,a);
  combine.uniforms.image.value=texture;combine.uniforms.bloom.value=a.texture;combine.uniforms.texel.value.set(1/width,1/height);combine.uniforms.strength.value=.72;combine.uniforms.preserveAlpha.value=preserveAlpha?1:0;draw(combine,out);
  renderer.setRenderTarget(prior);return out.texture;
 }
 return {render,
  // Process each preview independently. Atlas samples clamp to its cell, so light cannot leak from another portrait.
  apply(t: THREE.WebGLRenderTarget,mode: boolean,options={}){if(!mode)return;copy.uniforms.image.value=render(t.texture,mode,options);const prior=renderer.getRenderTarget();draw(copy,t);renderer.setRenderTarget(prior);},
  present(texture: THREE.Texture,mode: boolean){copy.uniforms.image.value=render(texture,mode);draw(copy,null);},
  get target(){return out;},
  dispose(){for(const t of[a,b,out])t?.dispose();for(const m of[extract,blur,combine,copy])m.dispose();quad.geometry.dispose();},
  stats(){return {scene:[width,height],bloom:a?[a.width,a.height]:null,passes:4};}
 };
}
