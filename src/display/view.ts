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

let world: View = { width: 480, height: 270, zoom: 1 };
let current: View = world;

/**
 * Vista da INTERFACE (menus, HUD, painéis). Com o tamanho da interface "Médio"/"Pequeno" tem
 * menos zoom do que a do mundo (mais píxeis de jogo cabem no ecrã, tudo fica mais pequeno).
 */
export function getView(): View {
  return current;
}

/** Vista do MUNDO (ZoneScene): o zoom máximo do mundo e o que se vê com ele. */
export function getWorldView(): View {
  return world;
}

/** Chamado por installPixelScaling antes de redimensionar o canvas. */
export function setView(worldView: View, uiView: View = worldView): void {
  world = worldView;
  current = uiView;
}

/**
 * Zoom inteiro da interface para um zoom do mundo `zoom` e o lado curto do canvas (píxeis do
 * dispositivo): grande = o do mundo; médio = um nível abaixo; pequeno = dois. Nunca abaixo de
 * metade do do mundo, nem com o lado curto da interface acima de `maxShort` px de jogo (letras
 * ilegíveis). Zoom fracionário (ecrã minúsculo) fica igual.
 */
export function uiZoomFor(zoom: number, size: UiSize, shortSide: number, maxShort = 560): number {
  if (!Number.isInteger(zoom) || zoom < 2) return zoom;
  const steps = size === 'small' ? 2 : size === 'medium' ? 1 : 0;
  const floor = Math.max(1, Math.ceil(zoom / 2), Math.ceil(shortSide / maxShort));
  return Math.min(zoom, Math.max(floor, zoom - steps));
}

export type UiSize = 'large' | 'medium' | 'small';

/** Resolução para objetos de texto da interface: um píxel de textura por píxel do dispositivo. */
export function textResolution(): number {
  return Math.max(1, Math.round(current.zoom));
}

/** Resolução para texto desenhado no mundo (nomes, números de dano). */
export function worldTextResolution(): number {
  return Math.max(1, Math.round(world.zoom));
}

/**
 * Câmara fixa (menus, HUD): mostra o retângulo (0, 0)–(width, height) da vista.
 * Chamar em create() e sempre que a vista mudar (evento RESIZE).
 */
export function setupFixedCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
  // Origem no canto: com a interface mais pequena, a vista pode não encher o canvas por uns
  // píxeis do dispositivo (ficam à direita/em baixo) e o canto fica sempre num píxel inteiro.
  camera.setOrigin(0, 0);
  camera.setZoom(current.zoom);
  camera.setScroll(0, 0);
}
