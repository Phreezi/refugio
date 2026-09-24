// Resolução interna adaptável + escala inteira em píxeis do DISPOSITIVO (CLAUDE.md §3.1).
// Lógica pura (sem Phaser nem DOM), testável em Vitest.

export interface PixelScaleOptions {
  /**
   * Altura desejada do jogo, em píxeis de jogo. Escolhe-se o zoom inteiro que mais se aproxima
   * dela; a largura acompanha o formato do ecrã. Mais alto = mais tiles no ecrã, tudo mais pequeno.
   */
  targetHeight: number;
  /** Lado curto mínimo: abaixo disto o zoom passa a fracionário (ecrãs minúsculos), para a UI caber. */
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

  // O alvo aplica-se ao lado MAIS CURTO: ao alto (telemóvel na vertical) as coisas ficam do
  // mesmo tamanho e vê-se uma área mais alta do que larga.
  const shortSide = Math.min(deviceWidth, deviceHeight);
  let deviceZoom = Math.max(1, Math.round(shortSide / targetHeight));
  let gameHeight = Math.floor(deviceHeight / deviceZoom);
  let gameWidth = Math.floor(deviceWidth / deviceZoom);

  // Proporções extremas (janelas muito estreitas/largas): barras em vez de esticar a vista.
  gameHeight = Math.min(gameHeight, Math.floor(gameWidth / minAspect));
  gameWidth = Math.min(gameWidth, Math.floor(gameHeight * maxAspect));
  gameWidth -= gameWidth % 2;
  gameHeight -= gameHeight % 2;

  // Ecrã minúsculo (ou inválido): o lado curto fica com o mínimo, com zoom fracionário.
  if (Math.min(gameWidth, gameHeight) < minHeight) {
    const portrait = deviceHeight > deviceWidth;
    const ratio = deviceWidth > 0 && deviceHeight > 0 ? deviceWidth / deviceHeight : 16 / 9;
    const aspect = Math.max(minAspect, Math.min(maxAspect, ratio));
    // Arredondar para baixo (e para par): o lado longo nunca obriga a reduzir mais o zoom.
    if (portrait) {
      gameWidth = minHeight;
      gameHeight = Math.floor(minHeight / aspect);
    } else {
      gameHeight = minHeight;
      gameWidth = Math.floor(minHeight * aspect);
    }
    gameWidth -= gameWidth % 2;
    gameHeight -= gameHeight % 2;
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
