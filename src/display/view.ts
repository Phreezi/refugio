import type Phaser from 'phaser';

// A "vista": quanto do mundo se vê (em píxeis de jogo) e com que zoom inteiro (píxeis do
// dispositivo por píxel de jogo). O canvas tem a resolução do dispositivo e cada câmara amplia
// por `zoom`: a pixel art fica exata e o texto é desenhado à resolução real (nítido).
//
// Regra (CLAUDE.md §3.1/§5.6): com zoom na câmara o Phaser NÃO arredonda posições; tudo o que
// se desenha tem de estar em coordenadas inteiras de jogo (as cenas arredondam).

export interface View {
  /** Tamanho visível, em píxeis de jogo (pares). */
  width: number;
  height: number;
  /** Píxeis do dispositivo por píxel de jogo (inteiro, exceto em ecrãs minúsculos). */
  zoom: number;
}

let current: View = { width: 480, height: 270, zoom: 1 };

export function getView(): View {
  return current;
}

/** Chamado por installPixelScaling antes de redimensionar o canvas. */
export function setView(view: View): void {
  current = view;
}

/** Resolução para objetos de texto: um píxel de textura por píxel do dispositivo. */
export function textResolution(): number {
  return Math.max(1, Math.round(current.zoom));
}

/**
 * Câmara fixa (menus, HUD): mostra o retângulo (0, 0)–(width, height) da vista.
 * Chamar em create() e sempre que a vista mudar (evento RESIZE).
 */
export function setupFixedCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
  camera.setZoom(current.zoom);
  camera.centerOn(current.width / 2, current.height / 2);
}
