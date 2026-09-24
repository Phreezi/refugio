import type Phaser from 'phaser';
import { PALETTE, type PaletteColor } from '../assets/palette';
import { textResolution } from '../display/view';

/** Fonte da interface (até haver uma fonte pixel própria, Fase 12). */
export const UI_FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export interface LabelStyle {
  /** Tamanho em píxeis de jogo (é desenhado à resolução do dispositivo). */
  size: number;
  color?: PaletteColor;
  bold?: boolean;
  /** Largura máxima (px de jogo) antes de mudar de linha. */
  wrap?: number;
  align?: 'left' | 'center' | 'right';
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
    this.text = scene.add
      .text(0, 0, content, {
        fontFamily: UI_FONT,
        fontSize: `${String(style.size)}px`,
        fontStyle: style.bold ? 'bold' : '',
        color: PALETTE[this.color],
        align: style.align ?? 'left',
        resolution: textResolution(),
        ...(style.wrap === undefined ? {} : { wordWrap: { width: style.wrap } }),
      })
      .setOrigin(0, 0);
    this.align();
  }

  /** Só redesenha se o texto mudar (o HUD chama isto em todos os frames). */
  setText(content: string): this {
    if (this.text.text === content) return this;
    this.text.setText(content);
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

  private align(): void {
    this.text.setPosition(
      Math.round(this.anchor.x - this.originX * this.text.width),
      Math.round(this.anchor.y - this.originY * this.text.height),
    );
  }
}
