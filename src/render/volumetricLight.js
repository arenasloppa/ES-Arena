// Volumetric light in the arenas: the air itself lit, as it is in mist, rain and dust. The moon in the churchyard's mist, cut into beams
// by the trees and railings; a torch's glow hanging about it in the courtyard; the chandeliers' light in the mansion's dust; the yacht's
// lamps in the rain; a flash lighting the air for a moment. Worked out at a quarter of the screen (Low: an eighth): along each pixel's
// ray, from the eye to what it meets, a few dozen steps through the air, each lit by the moon and the lights with shadow maps as their
// maps say (so the beams are cut by what stands in the way), and by the dynamic lights (unshadowed); the steps jittered pixel by pixel (a
// fine dither, the PS1's own), then laid over the screen, added
import * as THREE from 'three';
import { SH, SH_GLSL, DL, SH_TILE } from './shadowShared.js';

// each level's air: how thick (per cm), thinning upward from floor (by fall cm); halo: how much more a lamp's light shows in it close
// to the flame (the air about a light glows most where it's brightest); and a faint glow of its own everywhere in it
const AIR = { dungeon: {k:.00004,halo:22,floor:0,fall:1400,glow:[.0015,.001,.001]} };
const MARCH = /* glsl */`
uniform sampler2D depth; uniform mat4 invProj, camWorld; uniform vec3 camPos, uGlowAir; uniform float uK, uHalo, uFloor, uFall, uSteps, uMaxD, uFrame;
${SH_GLSL}
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }   // (a dither that moves each frame)
float phase(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }   // (Henyey-Greenstein by 4 pi: 1 on average; more toward the light)
// one look in a light's map (the level's, and the fighters' if any are in that face): is the air at L from it lit
float lit(int k, vec3 L) {
  float f, T = ${SH_TILE}.0; vec2 p = clamp(shFace(L, f) * T, vec2(1.0), vec2(T - 1.0)); float d = (length(L) - 4.0) / uShPos[k].w;
  vec2 st = (vec2(f, float(k) * 2.0) * T + p) * uShTex, dy = vec2(f, float(k) * 2.0 + 1.0) * T;
  float a = step(d, texture2D(uShAtlas, st).r);
  if (mod(floor(uShExt[k].y / exp2(f)), 2.0) > 0.5) a *= step(d, texture2D(uShAtlas, (dy + p) * uShTex).r);
  return a;
}
float moonLit(vec3 p) {
  vec3 s = (uMoonMat * vec4(p, 1.0)).xyz * 0.5 + 0.5; if (s.x <= 0.002 || s.x >= 0.998 || s.y <= 0.002 || s.y >= 0.998 || s.z >= 1.0) return 1.0;
  float a = step(s.z - uMoonPar.y, texture2D(uMoonMap, vec2(s.x * 0.5, s.y)).r);
  if (uMoonPar.w > 0.5 && s.x > uMoonDyn.x && s.y > uMoonDyn.y && s.x < uMoonDyn.z && s.y < uMoonDyn.w) a *= step(s.z - uMoonPar.y, texture2D(uMoonMap, vec2(0.5 + s.x * 0.5, s.y)).r);
  return a;
}
void main() {
  float d = texture2D(depth, vUv).r; vec4 v = invProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 to = (camWorld * vec4(v.xyz / v.w, 1.0)).xyz - camPos; float L = length(to); vec3 rd = to / max(L, 1.0);
  L = d >= 0.999999 ? uMaxD : min(L, uMaxD);
  // (as many steps as the ray is long, a step to each 60 cm, up to uSteps; each mapped light looked at only where the ray's within its reach)
  float n = clamp(ceil(L / 60.0), 6.0, uSteps), dt = L / n, j = ign(gl_FragCoord.xy + vec2(uFrame * 5.588238)); vec3 acc = vec3(0.0);
  bool maps = uShOn > 0.5; vec2 span[SHN];
  for (int k = 0; k < SHN; k++) { span[k] = vec2(1e9, -1e9); if (!maps || uShPar[k].z < 0.0 || uShPar[k].w <= 0.0) continue;
    vec3 oc = camPos - uShPos[k].xyz; float b = dot(oc, rd), c = dot(oc, oc) - uShPos[k].w * uShPos[k].w, h = b * b - c;
    if (h > 0.0) { h = sqrt(h); span[k] = vec2(-b - h, -b + h); } }
  vec3 moon = uMoonOn > 0.5 ? uMoonCol * (phase(dot(rd, uMoonDir), 0.55) * uMoonPar.z) : vec3(0.0); float mv = 1.0;   // (mist throws the moon's light on forward: beams when you look toward it; the same all along a ray)
  for (int i = 0; i < 48; i++) { if (float(i) >= n) break;
    float t = (float(i) + j) * dt; vec3 p = camPos + rd * t;
    float sig = uK * exp(-max(p.y - uFloor, 0.0) / uFall); if (sig < 1e-7) continue;
    vec3 li = uGlowAir, lamps = vec3(0.0);
    if (uMoonOn > 0.5) { if (i - (i / 2) * 2 == 0) mv = moonLit(p); li += moon * mv; }   // (its map looked at every other step: the dither and the blur hide it)
    if (maps) for (int k = 0; k < SHN; k++) { if (t < span[k].x || t > span[k].y) continue; vec4 P = uShPos[k], Q = uShPar[k];
      vec3 Lv = p - P.xyz; float dl = length(Lv); if (dl > P.w) continue; float r = abs(Q.x) * 0.4;   // (its halo tighter than its light on the walls: brightest by the flame)
      lamps += uShCol[k].rgb * (uShCol[k].w / (1.0 + dl * dl / (r * r)) * (1.0 - smoothstep(P.w * 0.5, P.w, dl)) * phase(dot(rd, -Lv / max(dl, 1.0)), 0.5) * lit(k, Lv) * Q.w); }
    for (int k = 0; k < DLN; k++) { if (k >= uDynN) break; vec3 Lv = uDynP[k].xyz - p; float dl = length(Lv), R = uDynP[k].w; if (dl > R) continue; float q = dl / (uDynC[k].w * 0.5);
      lamps += uDynC[k].rgb * ((1.0 - smoothstep(R * 0.4, R, dl)) / (1.0 + q * q) * phase(dot(rd, Lv / max(dl, 1.0)), 0.4)); }
    acc += (li + lamps * uHalo) * (sig * dt);
  }
  gl_FragColor = vec4(acc, 1.0);
}`;
export function createVolumetric(renderer) {
  const vs = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const march = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, blending: THREE.NoBlending, vertexShader: vs, fragmentShader: MARCH,
    uniforms: { depth: { value: null }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() }, uGlowAir: { value: new THREE.Vector3() },
      uK: { value: 0 }, uHalo: { value: 10 }, uFloor: { value: 0 }, uFall: { value: 1000 }, uSteps: { value: 32 }, uMaxD: { value: 3200 }, uFrame: { value: 0 }, ...SH, ...DL } });
  const add = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, vertexShader: vs,
    uniforms: { image: { value: null }, texel: { value: new THREE.Vector2() } },
    // (laid over the screen: the dither softened by a few looks round each pixel)
    fragmentShader: 'uniform sampler2D image;uniform vec2 texel;varying vec2 vUv;void main(){vec3 c=texture2D(image,vUv).rgb*.4+(texture2D(image,vUv+vec2(texel.x,0.)).rgb+texture2D(image,vUv-vec2(texel.x,0.)).rgb+texture2D(image,vUv+vec2(0.,texel.y)).rgb+texture2D(image,vUv-vec2(0.,texel.y)).rgb)*.15;gl_FragColor=vec4(c,1.);}' });
  const scene = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), march), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); scene.add(quad);
  const half = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  let low = null;
  return {
    // the air lit, over target (its colour and depth: the frame as drawn), seen by camera; quality 0 off, 1 low, 2 high; level: whose air
    apply(target, camera, quality, level) {
      const air = AIR[level?.name] || AIR.dungeon; if (!quality || !air || !target.depthTexture) return;
      const div = quality > 1 ? 4 : 8, w = Math.max(1, Math.floor(target.width / div)), h = Math.max(1, Math.floor(target.height / div));
      if (!low || low.width !== w || low.height !== h) { low?.dispose(); low = new THREE.WebGLRenderTarget(w, h, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false }); }
      const u = march.uniforms; u.depth.value = target.depthTexture; u.invProj.value.copy(camera.projectionMatrixInverse); u.camWorld.value.copy(camera.matrixWorld); camera.getWorldPosition(u.camPos.value);
      u.uK.value = air.k; u.uHalo.value = air.halo; u.uFloor.value = air.floor; u.uFall.value = air.fall; u.uGlowAir.value.set(...air.glow); u.uSteps.value = quality > 1 ? 32 : 16; u.uFrame.value = 0;
      const old = { target: renderer.getRenderTarget(), auto: renderer.autoClear, frame: renderer.info.render.frame };
      try {
        renderer.autoClear = false; quad.material = march; renderer.setRenderTarget(low); renderer.render(scene, cam);
        add.uniforms.image.value = low.texture; add.uniforms.texel.value.set(1 / w, 1 / h); quad.material = add; renderer.setRenderTarget(target); renderer.render(scene, cam);
      } finally { renderer.info.render.frame = old.frame; renderer.setRenderTarget(old.target); renderer.autoClear = old.auto; }
    },
    dispose(){low?.dispose();march.dispose();add.dispose();quad.geometry.dispose();},
  };
}
