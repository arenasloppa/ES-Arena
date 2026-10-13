import * as THREE from 'three';

export function environmentAtlas(model: THREE.Group): THREE.Texture | undefined {
  let texture: THREE.Texture | undefined;
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || texture) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    texture = (material as THREE.MeshBasicMaterial).map ?? undefined;
  });
  return texture;
}

/** Keeps openings defined by the player's original tile, while using the finished replacement art. */
export function maskEnvironmentPanel(model: THREE.Group, mask: THREE.DataTexture): THREE.Group {
  const source = environmentAtlas(model);
  const original = mask.image as { width: number; height: number; data: Uint8Array };
  if (!source || !original.data.some((_, i) => i % 4 === 3 && original.data[i] === 0)) return model;
  const image = source.image as HTMLImageElement;
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  applyTileMask(pixels, canvas.width, canvas.height, original.data, original.width, original.height);
  const texture = new THREE.DataTexture(new Uint8Array(pixels), canvas.width, canvas.height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const result = model.clone(true);
  result.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const prepare = (source: THREE.Material) => {
      const material = source.clone() as THREE.MeshBasicMaterial;
      material.map = object.name === 'Solid_Back_And_Edges' ? material.map : texture; material.alphaTest = object.name === 'Solid_Back_And_Edges' ? material.alphaTest : 0.5; material.side = THREE.DoubleSide;
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material);
  });
  return result;
}

export function applyTileMask(pixels: Uint8ClampedArray, width: number, height: number,
  original: Uint8Array, originalWidth: number, originalHeight: number): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor(x * originalWidth / width), sy = Math.floor(y * originalHeight / height);
    if (original[(sy * originalWidth + sx) * 4 + 3] === 0) pixels[(y * width + x) * 4 + 3] = 0;
  }
}
