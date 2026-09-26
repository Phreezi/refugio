import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { Label } from './text';
import { sfx } from '../audio/sfx';

export type ButtonStyle = 'primary' | 'secondary' | 'danger';

const COLORS: Readonly<Record<ButtonStyle, { fill: PaletteColor; hover: PaletteColor; text: PaletteColor }>> =
  {
    primary: { fill: 'wood', hover: 'wood_light', text: 'cream' },
    secondary: { fill: 'shadow', hover: 'stone_dark', text: 'parchment' },
    danger: { fill: 'blood', hover: 'red', text: 'cream' },
  };

/**
 * Texto especial: desenha uma cruz com píxeis (fechar/cancelar) em vez do carácter "×", que na
 * fonte fica fora do centro.
 */
export const CLOSE_ICON = '×';

export interface ButtonOptions {
  width: number;
  height: number;
  fontSize?: number;
  style?: ButtonStyle;
}

/**
 * Botão de UI: contorno + fundo + texto. Tamanhos pares e centro inteiro, porque as Shapes
 * não são arredondadas ao píxel pelo Phaser 4. Só conta como clique se o toque começar
 * E acabar no botão.
 */
export class Button {
  private readonly border: Phaser.GameObjects.Rectangle;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Label;
  /** Píxeis da cruz (botões CLOSE_ICON). */
  private readonly cross: Phaser.GameObjects.Rectangle[] = [];
  private style: ButtonStyle;
  private hovered = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    options: ButtonOptions,
    onClick: () => void,
  ) {
    const width = options.width + (options.width % 2);
    const height = options.height + (options.height % 2);
    this.style = options.style ?? 'primary';
    const colors = COLORS[this.style];
    this.border = scene.add.rectangle(x, y, width + 2, height + 2, paletteNumber('bark_dark'));
    this.fill = scene.add.rectangle(x, y, width, height, paletteNumber(colors.fill));
    const isClose = text === CLOSE_ICON;
    this.label = new Label(
      scene,
      x,
      y,
      isClose ? '' : text,
      { size: options.fontSize ?? 11, color: colors.text, bold: true, fit: width - 2 },
      [0.5, 0.5],
    );
    if (isClose) {
      // Cruz de 6×6 px centrada: diagonais de quadrados de 1 px em posições inteiras.
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let i = 0; i < 6; i++) {
        for (const px of [cx - 3 + i, cx + 2 - i]) {
          this.cross.push(scene.add.rectangle(px, cy - 3 + i, 1, 1, paletteNumber(colors.text)).setOrigin(0));
        }
      }
    }

    let pressed = false;
    this.fill
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
        this.hovered = true;
        this.paint();
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
        pressed = false;
        this.hovered = false;
        this.paint();
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        pressed = true;
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        if (pressed) {
          sfx.play('click');
          onClick();
        }
        pressed = false;
      });
  }

  /**
   * Premir e largar (para botões que se seguram, como "Correr"): `down` ao tocar, `up` ao
   * largar ou ao sair do botão.
   */
  /** Centro e tamanho do botão (px de jogo). */
  get x(): number {
    return this.fill.x;
  }

  get y(): number {
    return this.fill.y;
  }

  get height(): number {
    return this.fill.height;
  }

  onPress(down: () => void, up: () => void): this {
    let held = false;
    this.fill
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        held = true;
        down();
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        if (held) up();
        held = false;
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
        if (held) up();
        held = false;
      });
    return this;
  }

  setDepth(depth: number): this {
    this.border.setDepth(depth);
    this.fill.setDepth(depth);
    this.label.setDepth(depth);
    for (const px of this.cross) px.setDepth(depth);
    return this;
  }

  setVisible(visible: boolean): this {
    this.border.setVisible(visible);
    this.fill.setVisible(visible);
    this.label.setVisible(visible);
    for (const px of this.cross) px.setVisible(visible);
    return this;
  }

  destroy(): void {
    this.border.destroy();
    this.fill.destroy();
    this.label.destroy();
    for (const px of this.cross) px.destroy();
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setStyle(style: ButtonStyle): this {
    this.style = style;
    this.paint();
    return this;
  }

  private paint(): void {
    const colors = COLORS[this.style];
    this.fill.setFillStyle(paletteNumber(this.hovered ? colors.hover : colors.fill));
    this.label.setColor(colors.text);
    for (const px of this.cross) px.setFillStyle(paletteNumber(colors.text));
  }
}
