// Resolução interna adaptável + escala inteira em píxeis do DISPOSITIVO (CLAUDE.md §3.1).
// Lógica pura (sem Phaser nem DOM), testável em Vitest.

export interface PixelScaleOptions {
  /**
   * Altura desejada do jogo, em píxeis de jogo. Escolhe-se o zoom inteiro que mais se aproxima
   * dela; a largura acompanha o formato do ecrã. Mais alto = mais tiles no ecrã, tudo mais pequeno.
   */
  targetHeight: number;
  /** Abaixo disto o zoom passa a fracionário (ecrãs minúsculos), para a UI caber sempre. */
  minHeight: number;
  /** Proporção largura/altura permitida; fora dela ficam barras (ex.: janelas estreitas, ultrawide). */
  minAspect: number;
  maxAspect: number;
}

export interface PixelScale {
  /** Tamanho do jogo (o que se vê), em píxeis de jogo. Sempre pares: o centro cai num píxel inteiro. */
  gameWidth: number;
  gameHeight: number;
  /** Tamanho do canvas em píxeis do dispositivo (= jogo × deviceZoom): o render é feito a esta resolução. */
  canvasWidth: number;
  canvasHeight: number;
  /** Píxeis do dispositivo por píxel de jogo. Inteiro ≥ 1, exceto em ecrãs muito pequenos. */
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

// Tolerância para erros de vírgula flutuante (ex.: 1536 × 1.25 = 1920).
const EPSILON = 1e-6;

/**
 * Escolhe o zoom inteiro (em píxeis REAIS do dispositivo) cuja altura de jogo fica mais perto de
 * `targetHeight`, e dá ao jogo o tamanho que enche o ecrã com esse zoom. Contar em píxeis do
 * dispositivo (e não CSS) garante que cada píxel de jogo ocupa exatamente N×N píxeis físicos,
 * também com devicePixelRatio 1,25 ou 2,625.
 */
export function computePixelScale(
  viewportCssWidth: number,
  viewportCssHeight: number,
  devicePixelRatio: number,
  options: PixelScaleOptions,
): PixelScale {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const valid = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  const deviceWidth = Math.floor(valid(viewportCssWidth) * dpr + EPSILON);
  const deviceHeight = Math.floor(valid(viewportCssHeight) * dpr + EPSILON);
  const { targetHeight, minHeight, minAspect, maxAspect } = options;

  let deviceZoom = Math.max(1, Math.round(deviceHeight / targetHeight));
  let gameHeight = Math.floor(deviceHeight / deviceZoom);
  let gameWidth = Math.floor(deviceWidth / deviceZoom);

  // Janela mais estreita do que minAspect: o jogo fica mais baixo (barras em cima e em baixo).
  if (gameWidth < gameHeight * minAspect) gameHeight = Math.floor(gameWidth / minAspect);
  gameWidth = Math.min(gameWidth, Math.floor(gameHeight * maxAspect));
  gameWidth -= gameWidth % 2;
  gameHeight -= gameHeight % 2;

  // Ecrã minúsculo (ou inválido): tamanho mínimo, reduzido com zoom fracionário.
  if (gameHeight < minHeight) {
    gameHeight = minHeight;
    gameWidth = Math.max(
      Math.round(minHeight * minAspect),
      Math.min(gameWidth, Math.floor(minHeight * maxAspect)),
    );
    const fit = Math.min(deviceWidth / gameWidth, deviceHeight / gameHeight);
    deviceZoom = fit > 0 ? Math.min(1, fit) : 1;
  }

  const contentWidth = Math.round(gameWidth * deviceZoom);
  const contentHeight = Math.round(gameHeight * deviceZoom);
  const margin = (device: number, content: number): number =>
    Math.max(0, Math.floor((device - content) / 2 + EPSILON)) / dpr;

  return {
    gameWidth,
    gameHeight,
    canvasWidth: contentWidth,
    canvasHeight: contentHeight,
    deviceZoom,
    cssWidth: contentWidth / dpr,
    cssHeight: contentHeight / dpr,
    offsetX: margin(deviceWidth, contentWidth),
    offsetY: margin(deviceHeight, contentHeight),
  };
}
