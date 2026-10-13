// The shadow engine's shared half: the uniforms every shadowed material reads, and the GLSL that reads them. Kept apart from
// arena_shadows.js (which draws the maps) so engine.js's character material can use it without importing the arena.
//
// The maps: SH_SLOTS point lights at a time, each with a cube map of how far the world is from it (distance / the light's reach) in
// two layers, the level's own (static) and the fighters' (dynamic), all packed in one atlas of SH_TILE squares: a row of six faces per
// layer, two rows per light. The moon (outdoors) has two square maps side by side, the level's own and the fighters', over the ground
// about the camera. A point is lit by a light when it is no further from it than the nearest thing the map saw that way.
import * as THREE from 'three';

export const SH_SLOTS = 4, SH_TILE = 256, MOON_N = 1024, DLN = 8, CLN = 4, ENV_TILE = 64, ENVN = 48, ENVK = 4;
// the cube faces as the maps are drawn: [the way the face looks, its up]; the GLSL below picks the same face and the same corner
export const SH_FACES = [[[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]], [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]], [[0, 0, 1], [0, -1, 0]], [[0, 0, -1], [0, -1, 0]]];
// per light slot k: uShPos (x, y, z, reach), uShCol (r, g, b, intensity), uShPar (radius (negative: a downlight, lighting nothing above
// it), flicker, channel (-1: the slot is empty), fade 0-1); the moon: its matrix, the way to it, its colour (x its level's strength),
// uMoonPar (texel, depth bias, fade, anyone in its fighters' map)
export const SH = {
  uShOn: { value: 0 }, uShAtlas: { value: null }, uShTex: { value: new THREE.Vector2(1 / (6 * SH_TILE), 1 / (2 * SH_SLOTS * SH_TILE)) },
  uShPos: { value: Array.from({ length: SH_SLOTS }, () => new THREE.Vector4(0, -1e6, 0, 1)) },
  uShCol: { value: Array.from({ length: SH_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uShPar: { value: Array.from({ length: SH_SLOTS }, () => new THREE.Vector4(1, 0, -1, 0)) },
  uShExt: { value: Array.from({ length: SH_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },   // (x: how far its candles spread (the light's size, for soft shadows); y: which faces of the fighters' map have anyone in them (bits))
  uMoonOn: { value: 0 }, uMoonMap: { value: null }, uMoonMat: { value: new THREE.Matrix4() }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonCol: { value: new THREE.Vector3() }, uMoonPar: { value: new THREE.Vector4(1 / MOON_N, 0.0003, 0, 0) },
  uMoonDyn: { value: new THREE.Vector4(1, 1, 0, 0) },   // (where in the moon's map the fighters are: x0, y0, x1, y1 (0-1); nothing to look for outside it)
};

// the dynamic lights (arena_dlights.js): muzzle flashes, fire, explosions, rockets; up to DLN at a time, the ones that matter most to the
// camera. uDynP: where (x, y, z) and its reach; uDynC: its colour by its strength now, its radius. Unshadowed, as the old games' were
export const DL = { uDynN: { value: 0 }, uDynP: { value: Array.from({ length: DLN }, () => new THREE.Vector4(0, -1e6, 0, 1)) }, uDynC: { value: Array.from({ length: DLN }, () => new THREE.Vector4(0, 0, 0, 1)) } };
// a fighter's own lights (arena_actor.js): the level's nearest lights to her, as they are now. uCLP: where, its reach; uCLC: its colour by
// its strength now, its radius (negative: a downlight); uCLV: how much of it gets to her (the level's probe), its shadow map (-1: none)
export const charLights = () => ({ uCLN: { value: 0 }, uCLP: { value: Array.from({ length: CLN }, () => new THREE.Vector4(0, -1e6, 0, 1)) }, uCLC: { value: Array.from({ length: CLN }, () => new THREE.Vector4(0, 0, 0, 1)) },
  uCLV: { value: Array.from({ length: CLN }, () => new THREE.Vector4(1, -1, 0, 0)) } });
// reflection probes (arena_probes.js): small cube pictures of the level, up to ENVN of them in its atlas (a row of six ENV_TILE faces each);
// ENVK of them, those nearest the camera, handed to the shader each frame. uEnvC: where it was taken (x, y, z), its row (-1: none);
// uEnvMin, uEnvMax: the box of the room about it
export const ENV = { uEnvOn: { value: 0 }, uEnvMap: { value: null }, uEnvRows: { value: 1 }, uEnvC: { value: Array.from({ length: ENVK }, () => new THREE.Vector4(0, 0, 0, -1)) },
  uEnvMin: { value: Array.from({ length: ENVK }, () => new THREE.Vector3()) }, uEnvMax: { value: Array.from({ length: ENVK }, () => new THREE.Vector3()) } };
export const ENV_GLSL = /* glsl */`
uniform float uEnvOn; uniform sampler2D uEnvMap; uniform float uEnvRows; uniform vec4 uEnvC[${ENVK}]; uniform vec3 uEnvMin[${ENVK}]; uniform vec3 uEnvMax[${ENVK}];
// what something shiny at p, facing n, shows of the room to an eye the way V from it: the probe whose room p is in (failing that the
// nearest), its picture looked up the way a mirror sends the eye, met with the room's walls (so a floor shows the far wall where it
// is, not as seen from where the picture was taken); lod, how blurred: 0 sharp (polished stone, glass) to 4 (worn wood, leather)
vec3 envLook(vec3 p, vec3 n, vec3 V, float lod) {
  vec3 R = reflect(-V, n); int k = -1; float best = 1e9;
  for (int j = 0; j < ${ENVK}; j++) { if (uEnvC[j].w < -0.5) continue;
    bool inside = all(greaterThan(p, uEnvMin[j] - 30.0)) && all(lessThan(p, uEnvMax[j] + 30.0)); float d = length(p - uEnvC[j].xyz) + (inside ? 0.0 : 1e6);
    if (d < best) { best = d; k = j; } }
  if (k < 0) return vec3(0.0);
  vec3 D = R;
  if (best < 1e5) { vec3 t1 = (uEnvMax[k] - p) / R, t2 = (uEnvMin[k] - p) / R, tf = max(t1, t2); D = p + R * max(min(min(tf.x, tf.y), tf.z), 0.0) - uEnvC[k].xyz; }
  vec3 a = abs(D); float f; vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { f = D.x > 0.0 ? 0.0 : 1.0; uv = vec2(D.x > 0.0 ? -D.z : D.z, -D.y) / a.x; }
  else if (a.y >= a.z) { f = D.y > 0.0 ? 2.0 : 3.0; uv = vec2(D.x, D.y > 0.0 ? D.z : -D.z) / a.y; }
  else { f = D.z > 0.0 ? 4.0 : 5.0; uv = vec2(D.z > 0.0 ? D.x : -D.x, -D.y) / a.z; }
  float T = ${ENV_TILE}.0; vec2 px = clamp((uv * 0.5 + 0.5) * T, vec2(1.0), vec2(T - 1.0));
  return textureLod(uEnvMap, (vec2(f, uEnvC[k].w) * T + px) / vec2(6.0 * T, uEnvRows * T), lod).rgb;
}
`;
// the sampling, for vertex or fragment shaders
export const SH_GLSL = /* glsl */`
#define SHN ${SH_SLOTS}
uniform float uShOn; uniform sampler2D uShAtlas; uniform vec2 uShTex; uniform vec4 uShPos[SHN]; uniform vec4 uShCol[SHN]; uniform vec4 uShPar[SHN]; uniform vec4 uShExt[SHN];
uniform float uMoonOn; uniform sampler2D uMoonMap; uniform mat4 uMoonMat; uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform vec4 uMoonPar; uniform vec4 uMoonDyn;
// which face of a cube map a direction from its centre falls on, and where on it (0-1)
vec2 shFace(vec3 L, out float f) {
  vec3 a = abs(L); vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { f = L.x > 0.0 ? 0.0 : 1.0; uv = vec2(L.x > 0.0 ? -L.z : L.z, -L.y) / a.x; }
  else if (a.y >= a.z) { f = L.y > 0.0 ? 2.0 : 3.0; uv = vec2(L.x, L.y > 0.0 ? L.z : -L.z) / a.y; }
  else { f = L.z > 0.0 ? 4.0 : 5.0; uv = vec2(L.z > 0.0 ? L.x : -L.x, -L.y) / a.z; }
  return uv * 0.5 + 0.5;
}
// one look in slot k's map: is there anything nearer the light than d, at texel p of the face (kept inside the face)
float shTap(vec2 tile, vec2 p, float d) { float T = ${SH_TILE}.0; return step(d, texture2D(uShAtlas, (tile + clamp(p, vec2(1.0), vec2(T - 1.0))) * uShTex).r); }
// four looks round p, blended by where p falls between their texels (smooth edges, not the map's square pixels)
float shSmooth(vec2 tile, vec2 p, float d) {
  vec2 q = p - 0.5, b = floor(q) + 0.5, f = q - floor(q);
  return mix(mix(shTap(tile, b, d), shTap(tile, b + vec2(1.0, 0.0), d), f.x), mix(shTap(tile, b + vec2(0.0, 1.0), d), shTap(tile, b + vec2(1.0, 1.0), d), f.x), f.y);
}
// how much of slot k's light reaches a point L from it (0-1), in one layer (0: the level's own map, 1: the fighters'). The point is taken
// a little nearer the light by the size of a texel there (so a surface never shadows itself). A small light (a torch's flame): four looks,
// blended. A big one (a chandelier's ring of candles): how far away what's blocking it is, first, then eight looks spread as wide as the
// shadow's soft edge is there (wider the further behind what casts it)
float shCube(int k, float layer, vec3 L) {
  float f, T = ${SH_TILE}.0; vec2 p = shFace(L, f) * T, tile = vec2(f, float(k) * 2.0 + layer) * T;
  if (layer > 0.5 && mod(floor(uShExt[k].y / exp2(f)), 2.0) < 0.5) return 1.0;   // (no fighter in that face)
  float dR = length(L), texel = 2.0 * dR / T, d = (dR - 1.5 - texel * 1.2) / uShPos[k].w, size = uShExt[k].x;
  if (size < 2.0) return shSmooth(tile, p, d);
  float bs = 0.0, bn = 0.0;
  for (int i = 0; i < 5; i++) { vec2 o = i == 0 ? vec2(0.0) : vec2(i == 1 ? -3.0 : i == 2 ? 3.0 : 0.0, i == 3 ? -3.0 : i == 4 ? 3.0 : 0.0);
    float z = texture2D(uShAtlas, (tile + clamp(p + o, vec2(1.0), vec2(T - 1.0))) * uShTex).r; if (z < d) { bs += z; bn += 1.0; } }
  if (bn < 0.5) return 1.0;
  float dB = max(bs / bn * uShPos[k].w, 1.0), w = clamp(size * T * (dR - dB) / (2.0 * dB * dR), 0.6, 6.0), v = 0.0;
  v += shTap(tile, p + vec2(-0.94, -0.34) * w, d); v += shTap(tile, p + vec2(0.34, -0.94) * w, d); v += shTap(tile, p + vec2(0.94, 0.34) * w, d); v += shTap(tile, p + vec2(-0.34, 0.94) * w, d);
  v += shTap(tile, p + vec2(-0.45, 0.15) * w, d); v += shTap(tile, p + vec2(0.15, 0.45) * w, d); v += shTap(tile, p + vec2(0.45, -0.15) * w, d); v += shTap(tile, p + vec2(-0.15, -0.45) * w, d);
  return v * 0.125;
}
// how much of the moon reaches a point (0-1), in one layer; outside the maps: all of it. Four looks blended, as for the lights
float shMoonTap(float x0, vec2 c, float d) { return step(d, texture2D(uMoonMap, vec2(x0 + clamp(c.x, 0.0005, 0.9995) * 0.5, clamp(c.y, 0.001, 0.999))).r); }
float shMoon(vec3 p, float layer) {
  if (layer > 0.5 && uMoonPar.w < 0.5) return 1.0;   // (no fighter in the moon's map)
  vec3 s = (uMoonMat * vec4(p, 1.0)).xyz * 0.5 + 0.5;
  if (s.x <= 0.002 || s.x >= 0.998 || s.y <= 0.002 || s.y >= 0.998 || s.z >= 1.0) return 1.0;
  if (layer > 0.5 && (s.x < uMoonDyn.x || s.y < uMoonDyn.y || s.x > uMoonDyn.z || s.y > uMoonDyn.w)) return 1.0;   // (no fighter's shadow there)
  float N = 1.0 / uMoonPar.x, d = s.z - uMoonPar.y, x0 = layer * 0.5; vec2 q = s.xy * N - 0.5, b = floor(q) + 0.5, f = q - floor(q);
  return mix(mix(shMoonTap(x0, b / N, d), shMoonTap(x0, (b + vec2(1.0, 0.0)) / N, d), f.x), mix(shMoonTap(x0, (b + vec2(0.0, 1.0)) / N, d), shMoonTap(x0, (b + vec2(1.0, 1.0)) / N, d), f.x), f.y);
}
// slot k's light at a point, as the bake reckons it (reach x facing): its strength (multiply by uShCol[k].rgb); 0 out of its reach
float shReach(int k, vec3 p, vec3 n) {
  vec4 P = uShPos[k], Q = uShPar[k]; vec3 Ld = P.xyz - p; float dist = length(Ld);
  if (Q.z < 0.0 || Q.w <= 0.0 || dist > P.w || (Q.x < 0.0 && p.y > P.y + 2.0)) return 0.0;
  float ndl = dot(n, Ld) / max(dist, 1.0); if (ndl < -0.15) return 0.0;
  float r = abs(Q.x); return uShCol[k].w / (1.0 + (dist / r) * (dist / r)) * (1.0 - smoothstep(P.w * 0.6, P.w, dist)) * min(1.0, ndl + 0.15);
}
#define DLN ${DLN}
#define CLN ${CLN}
uniform int uDynN; uniform vec4 uDynP[DLN]; uniform vec4 uDynC[DLN];
uniform int uCLN; uniform vec4 uCLP[CLN]; uniform vec4 uCLC[CLN]; uniform vec4 uCLV[CLN];
// the dynamic lights at a point: each one's reach and facing
vec3 dynLights(vec3 p, vec3 n) {
  vec3 s = vec3(0.0);
  for (int j = 0; j < DLN; j++) { if (j >= uDynN) break;
    vec3 Ld = uDynP[j].xyz - p; float d = length(Ld), R = uDynP[j].w; if (d > R) continue;
    float q = d / uDynC[j].w; s += uDynC[j].rgb * ((1.0 - smoothstep(R * 0.5, R, d)) * clamp(dot(n, Ld) / max(d, 1.0) + 0.15, 0.0, 1.0) / (1.0 + q * q)); }
  return s;
}
// how much of slot k's light reaches a fighter's vertex: the level's own map only (a fighter's shadow on herself is speckle at a vertex's
// size), four looks blended, enough for a vertex
float shVertex(int k, vec3 L) {
  float f, T = ${SH_TILE}.0; vec2 p = shFace(L, f) * T, tile = vec2(f, float(k) * 2.0) * T;
  float dR = length(L); return shSmooth(tile, p, (dR - 1.5 - 2.4 * dR / T) / uShPos[k].w);
}
// a fighter lit by her own lights (per vertex), the front and back of her faces at once: each light's reach and facing, how much of it
// gets to her (where it has a shadow map, the map's say at this vertex), no one light brighter on her than the old key light could be;
// then the dynamic lights
void shLights(vec3 p, vec3 n, out vec3 front, out vec3 back) {
  front = vec3(0.0); back = vec3(0.0);
  for (int j = 0; j < CLN; j++) { if (j >= uCLN) break;
    vec4 P = uCLP[j], C = uCLC[j], V = uCLV[j]; vec3 Ld = P.xyz - p; float d = length(Ld);
    if (d > P.w || (C.w < 0.0 && p.y > P.y + 2.0)) continue;
    float q = d / abs(C.w), a = (1.0 - smoothstep(P.w * 0.6, P.w, d)) / (1.0 + q * q), ndl = dot(n, Ld) / max(d, 1.0), vis = V.x;
    if (a < 0.003) continue;
    if (uShOn > 0.5 && V.y > -0.5) { int k = int(V.y + 0.5); vis = mix(vis, shVertex(k, p + n * (ndl > 0.0 ? 6.0 : -6.0) - uShPos[k].xyz), uShPar[k].w); }
    vec3 e = C.rgb * (a * vis); front += min(e * max(ndl, 0.0), vec3(1.3)); back += min(e * max(-ndl, 0.0), vec3(1.3)); }
  front += dynLights(p, n); back += dynLights(p, -n);
}
`;
