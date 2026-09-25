import type Phaser from 'phaser';

/**
 * Cópia a cinzento de uma textura (com as mesmas frames), criada uma vez e reaproveitada: os
 * inimigos derrotados ficam assim no chão, para se ver logo que "morreram". Pixel a pixel,
 * sem filtros (a pixel art fica exata a qualquer zoom).
 */
export function grayTexture(scene: Phaser.Scene, key: string): string {
  const grayKey = `${key}__gray`;
  if (scene.textures.exists(grayKey)) return grayKey;
  const source = scene.textures.get(key);
  const image = source.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = scene.textures.createCanvas(grayKey, image.width, image.height);
  if (!canvas) return key;
  const ctx = canvas.getContext();
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.3 * (px[i] ?? 0) + 0.59 * (px[i + 1] ?? 0) + 0.11 * (px[i + 2] ?? 0);
    // Cinzento um pouco mais claro e sem contraste forte (lê-se como "apagado").
    const value = Math.round(40 + lum * 0.7);
    px[i] = value;
    px[i + 1] = value;
    px[i + 2] = value;
  }
  ctx.putImageData(data, 0, 0);
  for (const name of source.getFrameNames()) {
    const frame = source.get(name);
    canvas.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
  }
  canvas.refresh();
  return grayKey;
}
