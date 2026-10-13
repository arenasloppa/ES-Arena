import * as THREE from 'three';

// Reuse each scene's existing depth buffer, including cropped preview windows.
// No second geometry pass, CPU readback, or temporal noise is needed.
export function withDepth(target){
 target.depthTexture=new THREE.DepthTexture(target.width,target.height,THREE.UnsignedIntType);
 target.depthTexture.minFilter=target.depthTexture.magFilter=THREE.NearestFilter;
 return target;
}
export function createAmbientOcclusion(renderer){
 const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
 const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,blending:THREE.NoBlending,
  uniforms:{color:{value:null},depth:{value:null},region:{value:new THREE.Vector4()},size:{value:new THREE.Vector2()},inverseProjection:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4()},radius:{value:28}},vertexShader,
  fragmentShader:`uniform sampler2D color,depth;uniform vec4 region;uniform vec2 size;uniform mat4 inverseProjection,projection;uniform float radius;varying vec2 vUv;
   vec2 sourceUV(vec2 p){return region.xy+clamp(p,.5/size,1.-.5/size)*region.zw;}
   float depthAt(vec2 p){return texture2D(depth,sourceUV(p)).r;}
   vec3 positionAt(vec2 p,float d){vec4 v=inverseProjection*vec4(p*2.-1.,d*2.-1.,1.);return v.xyz/v.w;}
   void main(){
    vec4 original=texture2D(color,sourceUV(vUv));float d=depthAt(vUv);
    if(d>=.999999||original.a<.01){gl_FragColor=original;return;}
    vec3 p=positionAt(vUv,d);vec2 dx=vec2(1./size.x,0.),dy=vec2(0.,1./size.y);
    vec3 left=positionAt(vUv-dx,depthAt(vUv-dx)),right=positionAt(vUv+dx,depthAt(vUv+dx));
    vec3 bottom=positionAt(vUv-dy,depthAt(vUv-dy)),top=positionAt(vUv+dy,depthAt(vUv+dy));
    vec3 vx=abs(left.z-p.z)<abs(right.z-p.z)?p-left:right-p;
    vec3 vy=abs(bottom.z-p.z)<abs(top.z-p.z)?p-bottom:top-p;
    vec3 normal=normalize(cross(vx,vy));if(normal.z<0.)normal=-normal;
    float perspective=abs(projection[2][3]);
    float screenRadius=clamp(radius*abs(projection[0][0])*size.x*.5/mix(1.,max(.01,-p.z),perspective),1.5,64.);
    float sum=0.;
    for(int k=0;k<16;k++){
     float f=(float(k)+.5)/16.,angle=float(k)*2.39996323;
     vec2 uv=vUv+vec2(cos(angle),sin(angle))*sqrt(f)*screenRadius/size;
     if(any(lessThan(uv,.5/size))||any(greaterThan(uv,1.-.5/size)))continue;
     float sd=depthAt(uv);if(sd>=.999999)continue;
     vec3 delta=positionAt(uv,sd)-p;float dist=length(delta);
     float range=max(0.,1.-dist*dist/(radius*radius));
     sum+=max(0.,dot(normal,delta)-radius*.025)/max(dist,.001)*range*range;
    }
    float occlusion=min(.38,sum*(2.4/16.));
    // Retain bright flames, lights and emissive effects. Preserve source alpha.
    float highlight=1.-smoothstep(.65,1.,max(original.r,max(original.g,original.b)));
    gl_FragColor=vec4(original.rgb*(1.-occlusion*highlight),original.a);
   }`});
 const copy=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,blending:THREE.NoBlending,vertexShader,
  uniforms:{image:{value:null}},fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}'});
 const scene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);scene.add(quad);
 const targets=new Map();let calls=0;
 return {
  apply(target,viewCamera,on,{region=null,radius=28}={}){
   if(!on||!target.depthTexture)return;
   const [x,y,w,h]=region||[0,0,target.width,target.height],key=w+'x'+h;
   let out=targets.get(key);if(!out){out=new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false,type:target.texture.type});targets.set(key,out);}
   const old={target:renderer.getRenderTarget(),viewport:target.viewport.clone(),scissor:target.scissor.clone(),test:target.scissorTest,auto:renderer.autoClear};
   material.uniforms.color.value=target.texture;material.uniforms.depth.value=target.depthTexture;
   material.uniforms.region.value.set(x/target.width,y/target.height,w/target.width,h/target.height);material.uniforms.size.value.set(w,h);
   material.uniforms.inverseProjection.value.copy(viewCamera.projectionMatrixInverse);material.uniforms.projection.value.copy(viewCamera.projectionMatrix);material.uniforms.radius.value=radius;
   try{
    renderer.autoClear=false;quad.material=material;renderer.setRenderTarget(out);renderer.render(scene,camera);
    // Copy only this window back; neither pass writes or clears the depth buffer.
    copy.uniforms.image.value=out.texture;quad.material=copy;target.viewport.set(x,y,w,h);target.scissor.copy(target.viewport);target.scissorTest=true;
    renderer.setRenderTarget(target);renderer.render(scene,camera);calls++;
   }finally{target.viewport.copy(old.viewport);target.scissor.copy(old.scissor);target.scissorTest=old.test;renderer.autoClear=old.auto;renderer.setRenderTarget(old.target);}
  },
  stats(){return {calls,targets:[...targets.keys()],samples:16};},
  dispose(){for(const target of targets.values())target.dispose();targets.clear();material.dispose();copy.dispose();quad.geometry.dispose();}
 };
}
