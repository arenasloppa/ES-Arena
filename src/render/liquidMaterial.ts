import * as THREE from 'three';

/** Keep world depth/fog, but sample the complete RCI frame in screen space. A wall layer masks the liquid. */
export function makeLiquidMaterial(frame: THREE.DataTexture, layer?: THREE.DataTexture): {
  material: THREE.MeshBasicMaterial;
  frame: { value: THREE.DataTexture };
} {
  const viewport = new THREE.Vector4(0, 0, 1, 1);
  const frameUniform = { value: frame };
  const material = new THREE.MeshBasicMaterial({ map: layer ?? frame, side: THREE.DoubleSide });
  material.userData.keepAnimatedMaterial = true;
  material.userData.liquid = true;
  material.onBeforeRender = renderer => { renderer.getCurrentViewport(viewport); };
  material.onBeforeCompile = shader => {
    shader.uniforms.arenaLiquidViewport = { value: viewport };
    shader.uniforms.arenaLiquidFrame = frameUniform;
    shader.fragmentShader = `uniform vec4 arenaLiquidViewport;\nuniform sampler2D arenaLiquidFrame;\n${shader.fragmentShader}`;
    const sample = `
      vec2 arenaScreenUv = (gl_FragCoord.xy - arenaLiquidViewport.xy) / arenaLiquidViewport.zw;
      arenaScreenUv.y = fract(arenaScreenUv.y * 2.0);
      vec4 sampledDiffuseColor = ${layer ? 'texture2D(map, vMapUv)' : 'texture2D(arenaLiquidFrame, arenaScreenUv)'};
      ${layer ? 'if (sampledDiffuseColor.a < 0.5) sampledDiffuseColor = texture2D(arenaLiquidFrame, arenaScreenUv);' : ''}
      diffuseColor *= sampledDiffuseColor;
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', sample);
  };
  material.customProgramCacheKey = () => layer ? 'arena-liquid-layer-v1' : 'arena-liquid-screen-v1';
  return { material, frame: frameUniform };
}
