import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import type { SlotRef } from '../core/PlayerActions';
import type { ItemDefs } from '../data/types';
import type { Slot } from '../systems/inventory/inventory';
import { Label } from './text';

/** Lado de um slot (px de jogo; par). O ícone de 16×16 fica com 3 px de margem. */
export const SLOT_SIZE = 22;
export const SLOT_GAP = 2;

/**
 * Um slot desenhado: fundo, ícone, quantidade e barra de durabilidade. Posições inteiras e
 * origem 0 (as Shapes não são arredondadas ao píxel).
 */
export class SlotView {
  readonly ref: SlotRef;
  readonly x: number;
  readonly y: number;
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly qty: Label;
  private readonly wearBg: Phaser.GameObjects.Rectangle;
  private readonly wear: Phaser.GameObjects.Rectangle;
  private readonly key: Label | null;

  /** @param keyHint número da tecla (hotbar no PC), ou null. */
  constructor(scene: Phaser.Scene, x: number, y: number, ref: SlotRef, keyHint: string | null = null) {
    this.ref = ref;
    this.x = x;
    this.y = y;
    this.frame = scene.add.rectangle(x, y, SLOT_SIZE, SLOT_SIZE, paletteNumber('bark_dark')).setOrigin(0);
    this.bg = scene.add
      .rectangle(x + 1, y + 1, SLOT_SIZE - 2, SLOT_SIZE - 2, paletteNumber('shadow'))
      .setOrigin(0);
    this.icon = scene.add
      .image(x + 3, y + 3, '__DEFAULT')
      .setOrigin(0)
      .setVisible(false);
    this.wearBg = scene.add
      .rectangle(x + 3, y + SLOT_SIZE - 4, 16, 2, paletteNumber('ink'))
      .setOrigin(0)
      .setVisible(false);
    this.wear = scene.add
      .rectangle(x + 3, y + SLOT_SIZE - 4, 16, 2, paletteNumber('lime'))
      .setOrigin(0)
      .setVisible(false);
    this.qty = new Label(
      scene,
      x + SLOT_SIZE - 1,
      y + SLOT_SIZE,
      '',
      { size: 7, bold: true, stroke: true },
      [1, 1],
    );
    this.key = keyHint
      ? new Label(scene, x + 2, y + 1, keyHint, { size: 6, color: 'stone_light', stroke: true })
      : null;
  }

  update(slot: Slot | null, items: ItemDefs, selected: boolean): void {
    this.frame.setFillStyle(paletteNumber(selected ? 'gold' : 'bark_dark'));
    const def = slot ? items[slot[0]] : undefined;
    if (!slot || !def) {
      this.icon.setVisible(false);
      this.qty.setText('');
      this.wear.setVisible(false);
      this.wearBg.setVisible(false);
      return;
    }
    this.icon.setTexture(def.icon).setVisible(true);
    this.qty.setText(slot[1] > 1 ? String(slot[1]) : '');
    const max = def.durability;
    const left = slot[2];
    const showWear = max !== undefined && left !== undefined && left < max;
    this.wearBg.setVisible(showWear);
    this.wear.setVisible(showWear);
    if (showWear) {
      const fraction = left / max;
      this.wear.width = Math.max(1, Math.round(16 * fraction));
      this.wear.setFillStyle(paletteNumber(fraction > 0.5 ? 'lime' : fraction > 0.2 ? 'amber' : 'red'));
    }
  }

  contains(px: number, py: number): boolean {
    return px >= this.x && py >= this.y && px < this.x + SLOT_SIZE && py < this.y + SLOT_SIZE;
  }

  setDepth(depth: number): this {
    for (const obj of [this.frame, this.bg, this.icon, this.wearBg, this.wear]) obj.setDepth(depth);
    this.qty.setDepth(depth + 1);
    this.key?.setDepth(depth + 1);
    return this;
  }

  destroy(): void {
    for (const obj of [this.frame, this.bg, this.icon, this.wearBg, this.wear]) obj.destroy();
    this.qty.destroy();
    this.key?.destroy();
  }
}
