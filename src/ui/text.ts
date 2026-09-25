import type Phaser from 'phaser';
import { PALETTE, type PaletteColor } from '../assets/palette';
import { textResolution } from '../display/view';

/** Fonte da interface: pixel (Jersey 10, OFL; ver display/fonts.ts), com reservas. */
export const UI_FONT = '"Jersey 10", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Grelha da Jersey 10: cada píxel da letra mede 3/56 do tamanho da fonte (maiúsculas: 10). */
const FONT_PIXEL_PER_PX = 3 / 56;

/**
 * Píxeis da letra por píxel do tamanho pedido: a fonte desenha-se ~1,5× maior do que o tamanho
 * "natural" (maiúsculas ≈ 0,8 × tamanho), mais legível; a largura fica parecida com a da antiga.
 */
const FONT_SCALE = 0.08;

/** Um píxel da letra, em píxeis do ecrã (inteiro: senão as letras ficam irregulares). */
function fontPixel(size: number): number {
  return Math.max(1, Math.round(size * textResolution() * FONT_SCALE));
}

/** Tamanho (px de jogo) com que se desenha o texto de tamanho `size`, na grelha da fonte. */
export function pixelFontSize(size: number): number {
  return fontPixel(size) / FONT_PIXEL_PER_PX / textResolution();
}

let measureContext: CanvasRenderingContext2D | null = null;

/**
 * A fonte pixel junta "fi"/"fl" numa ligadura que não encaixa no estilo: um separador
 * invisível (ZWNJ) entre as letras impede-a.
 */
export function noLigatures(content: string): string {
  return content.replace(/f(?=[ilf])/g, 'f\u200C');
}

/**
 * Largura (px de jogo) de uma linha de texto na fonte da interface — medida no browser, porque
 * a mesma fonte tem larguras diferentes em cada sistema (ex.: iPhone vs Windows).
 */
export function measureTextWidth(content: string, size: number): number {
  content = noLigatures(content);
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return content.length * size * 0.6;
  // Medido 4× maior (mais preciso) e reduzido.
  measureContext.font = `${String(pixelFontSize(size) * 4)}px ${UI_FONT}`;
  return measureContext.measureText(content).width / 4;
}

export interface LabelStyle {
  /** Tamanho em píxeis de jogo (é desenhado à resolução do dispositivo). */
  size: number;
  color?: PaletteColor;
  bold?: boolean;
  /** Largura máxima (px de jogo) antes de mudar de linha. */
  wrap?: number;
  align?: 'left' | 'center' | 'right';
  /** Contorno escuro (legível por cima do mundo, ex.: quantidades nos slots). */
  stroke?: boolean;
  /** Largura máxima (px de jogo) numa linha: se o texto não couber, a letra encolhe. */
  fit?: number;
}

/**
 * Texto nítido: textura à resolução do dispositivo (ver display/view.ts) e canto superior
 * esquerdo sempre num píxel inteiro de jogo — com origem 0,5 e largura ímpar ficaria a meio
 * píxel do dispositivo, e o browser esbatia-o. O ponto de ancoragem mantém-se ao mudar o texto.
 */
export class Label {
  readonly text: Phaser.GameObjects.Text;
  private anchor: { x: number; y: number };
  private readonly originX: number;
  private readonly originY: number;
  private color: PaletteColor;
  private readonly size: number;
  private readonly fit: number | undefined;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    content: string,
    style: LabelStyle,
    origin: readonly [number, number] = [0, 0],
  ) {
    this.anchor = { x, y };
    [this.originX, this.originY] = origin;
    this.color = style.color ?? 'cream';
    this.size = style.size;
    this.fit = style.fit;
    this.text = scene.add
      .text(0, 0, noLigatures(content), {
        fontFamily: UI_FONT,
        fontSize: `${String(pixelFontSize(style.size))}px`,
        // A fonte pixel só tem um peso: o "negrito" falso esborrataria os píxeis.
        fontStyle: '',
        color: PALETTE[this.color],
        align: style.align ?? 'left',
        resolution: textResolution(),
        // Legível por cima do mundo: sombra de 1 píxel da letra, em baixo e à direita (um
        // contorno engrossava as letras de 1 píxel e fechava-lhes os buracos).
        ...(style.stroke
          ? {
              shadow: {
                offsetX: fontPixel(style.size),
                offsetY: fontPixel(style.size),
                color: PALETTE.ink,
                blur: 0,
                fill: true,
              },
              padding: { right: 1, bottom: 1 },
            }
          : {}),
        ...(style.wrap === undefined ? {} : { wordWrap: { width: style.wrap } }),
      })
      .setOrigin(0, 0);
    this.shrinkToFit();
    this.align();
  }

  /** Só redesenha se o texto mudar (o HUD chama isto em todos os frames). */
  setText(content: string): this {
    content = noLigatures(content);
    if (this.text.text === content) return this;
    this.text.setText(content);
    this.shrinkToFit();
    this.align();
    return this;
  }

  setColor(color: PaletteColor): this {
    if (this.color === color) return this;
    this.color = color;
    this.text.setColor(PALETTE[color]);
    return this;
  }

  setPosition(x: number, y: number): this {
    this.anchor = { x, y };
    this.align();
    return this;
  }

  setVisible(visible: boolean): this {
    this.text.setVisible(visible);
    return this;
  }

  setDepth(depth: number): this {
    this.text.setDepth(depth);
    return this;
  }

  destroy(): void {
    this.text.destroy();
  }

  /** Com `fit`: letra no tamanho pedido ou, se não couber, píxel a píxel mais pequena. */
  private shrinkToFit(): void {
    if (this.fit === undefined) return;
    const resolution = textResolution();
    let pixel = fontPixel(this.size);
    const apply = (): void => {
      const size = `${String(pixel / FONT_PIXEL_PER_PX / resolution)}px`;
      if (this.text.style.fontSize !== size) this.text.setFontSize(size);
    };
    apply();
    while (this.text.width > this.fit && pixel > 1) {
      pixel--;
      apply();
    }
  }

  private align(): void {
    let y = this.anchor.y - this.originY * this.text.height;
    // Centrado na vertical (botões): pelo meio das maiúsculas, e não da caixa do texto, que tem
    // espaço para acentos e descendentes (e muda de fonte para fonte: no Windows é outra).
    if (this.originY === 0.5 && !this.text.text.includes('\n')) {
      const cap = capHeight(this.text.style.fontStyle, this.text.style.fontSize);
      if (cap > 0) y = this.anchor.y - (this.text.getTextMetrics().ascent - cap / 2);
    }
    this.text.setPosition(Math.round(this.anchor.x - this.originX * this.text.width), Math.round(y));
  }
}

const capHeights = new Map<string, number>();

/** Altura das maiúsculas (px) da fonte da interface neste tamanho (medida uma vez no browser). */
function capHeight(fontStyle: string, fontSize: string | number): number {
  const size = typeof fontSize === 'number' ? `${String(fontSize)}px` : fontSize;
  const key = `${fontStyle} ${size}`;
  const cached = capHeights.get(key);
  if (cached !== undefined) return cached;
  let cap = 0;
  try {
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = `${fontStyle} ${size} ${UI_FONT}`;
      cap = context.measureText('H').actualBoundingBoxAscent;
    }
  } catch {
    cap = 0;
  }
  capHeights.set(key, cap);
  return cap;
}
