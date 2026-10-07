import type Phaser from 'phaser';

// Culling (CLAUDE.md §3.1, Fase 11): o Phaser desenha TUDO o que está na lista da cena, mesmo
// fora da câmara. Com o mundo contínuo há ~1500 imagens (recursos, obstáculos, vedações) e
// dezenas de camadas de tiles das zonas vizinhas, mas só umas dezenas se veem: o resto fica
// de fora pelo `cameraFilter` (não mexe no `visible`, que é estado do jogo — recursos apanhados…).

/** Retângulo em píxeis de jogo (x0, y0 = canto superior esquerdo; x1, y1 = inferior direito). */
export interface CullRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A vista da câmara alargada por `margin` px (o que está nesta área desenha-se). */
export function cullRect(
  view: { x: number; y: number; width: number; height: number },
  margin: number,
): CullRect {
  return {
    x0: view.x - margin,
    y0: view.y - margin,
    x1: view.x + view.width + margin,
    y1: view.y + view.height + margin,
  };
}

/** O ponto (x, y) está fora da área? */
export function pointOutside(area: CullRect, x: number, y: number): boolean {
  return x < area.x0 || x > area.x1 || y < area.y0 || y > area.y1;
}

/** O retângulo (x, y, w, h) não toca na área? */
export function boxOutside(area: CullRect, x: number, y: number, w: number, h: number): boolean {
  return x > area.x1 || y > area.y1 || x + w < area.x0 || y + h < area.y0;
}

/** Tira (ou repõe) um objeto da câmara; só escreve quando muda. */
export function setCulled(
  object: Phaser.GameObjects.GameObject,
  camera: Phaser.Cameras.Scene2D.Camera,
  culled: boolean,
): void {
  const filter = culled ? camera.id : 0;
  if (object.cameraFilter !== filter) object.cameraFilter = filter;
}
