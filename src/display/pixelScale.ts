export interface PixelScale {
  /** Píxeis do dispositivo por píxel de jogo. Inteiro ≥ 1, exceto em ecrãs menores do que o jogo. */
  deviceZoom: number;
  /** Tamanho do canvas em píxeis CSS (pode ser fracionário quando devicePixelRatio ≠ 1). */
  cssWidth: number;
  cssHeight: number;
  /**
   * Posição do canvas (centrado) em píxeis CSS, arredondada a píxeis inteiros do
   * dispositivo — um centro fracionário faria o browser reamostrar a imagem.
   */
  offsetX: number;
  offsetY: number;
}

// Tolerância para erros de vírgula flutuante (ex.: 1536 × 1.25 = 1920 deve dar zoom 4).
const EPSILON = 1e-6;

/**
 * Maior escala inteira, em píxeis REAIS do dispositivo, com que o jogo cabe no ecrã.
 * Contar em píxeis do dispositivo (e não em píxeis CSS) garante que cada píxel de
 * jogo ocupa exatamente N×N píxeis físicos também com devicePixelRatio 1.25, 2.625, etc.
 * Se o ecrã for menor do que o jogo, reduz (fracionário) para caber.
 */
export function computePixelScale(
  viewportCssWidth: number,
  viewportCssHeight: number,
  devicePixelRatio: number,
  gameWidth: number,
  gameHeight: number,
): PixelScale {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const fit = Math.min((viewportCssWidth * dpr) / gameWidth, (viewportCssHeight * dpr) / gameHeight);

  let deviceZoom: number;
  if (!Number.isFinite(fit) || fit <= 0) deviceZoom = 1;
  else if (fit + EPSILON >= 1) deviceZoom = Math.floor(fit + EPSILON);
  else deviceZoom = fit;

  const deviceWidth = gameWidth * deviceZoom;
  const deviceHeight = gameHeight * deviceZoom;
  const margin = (viewportCss: number, contentDevice: number): number =>
    Math.max(0, Math.floor((viewportCss * dpr - contentDevice) / 2 + EPSILON)) / dpr;

  return {
    deviceZoom,
    cssWidth: deviceWidth / dpr,
    cssHeight: deviceHeight / dpr,
    offsetX: margin(viewportCssWidth, deviceWidth),
    offsetY: margin(viewportCssHeight, deviceHeight),
  };
}
