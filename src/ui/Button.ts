import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { Label } from './text';

export type ButtonStyle = 'primary' | 'secondary' | 'danger';

const COLORS: Readonly<Record<ButtonStyle, { fill: PaletteColor; hover: PaletteColor; text: PaletteColor }>> =
  {
    primary: { fill: 'wood', hover: 'wood_light', text: 'cream' },
    secondary: { fill: 'shadow', hover: 'stone_dark', text: 'parchment' },
    danger: { fill: 'blood', hover: 'red', text: 'cream' },
  };

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
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Label;
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
    scene.add.rectangle(x, y, width + 2, height + 2, paletteNumber('bark_dark'));
    this.fill = scene.add.rectangle(x, y, width, height, paletteNumber(colors.fill));
    this.label = new Label(
      scene,
      x,
      y,
      text,
      { size: options.fontSize ?? 11, color: colors.text, bold: true },
      [0.5, 0.5],
    );

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
        if (pressed) onClick();
        pressed = false;
      });
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
  }
}
