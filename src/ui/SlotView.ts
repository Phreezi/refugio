import { BALANCE } from '../data/balance';
import type Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import type { SlotRef } from '../core/PlayerActions';
import type { ItemDefs, Rarity } from '../data/types';
import { preferences } from './preferences';
import type { Slot } from '../systems/inventory/inventory';
import { Label } from './text';

/** Lado de um slot (px de jogo; par). O ícone de 16×16 fica com 3 px de margem. */
export const SLOT_SIZE = 22;
export const SLOT_GAP = 2;

/**
 * Lado de um slot com os ícones ampliados `scale` vezes (inteiro: a pixel art fica exata).
 * ×2 (36 px) usa-se nos ecrãs táteis quando cabe, para os dedos.
 */
export function slotSize(scale: number): number {
  return scale === 1 ? SLOT_SIZE : 16 * scale + 4;
}

/** Cor do contorno por raridade (comum: a madeira de sempre). */
const RARITY_FRAME: Readonly<Record<Rarity, PaletteColor>> = {
  common: 'bark_dark',
  uncommon: 'grass',
  rare: 'sky',
  epic: 'rose',
};
/** Modo daltónico: número de marcas por raridade (além da cor). */
const RARITY_PIPS: Readonly<Record<Rarity, number>> = { common: 0, uncommon: 1, rare: 2, epic: 3 };

/**
 * Um slot desenhado: fundo, ícone, quantidade e barra de durabilidade. Posições inteiras e
 * origem 0 (as Shapes não são arredondadas ao píxel).
 */
export class SlotView {
  readonly ref: SlotRef;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  private readonly iconWidth: number;
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly qty: Label;
  /** "+N" das armas e roupa encantadas. */
  private readonly enchant: Label;
  /** Munição de uma arma à distância (canto superior direito; ver `setAmmo`). */
  private readonly ammo: Label;
  private readonly wearBg: Phaser.GameObjects.Rectangle;
  private readonly wear: Phaser.GameObjects.Rectangle;
  private readonly key: Label | null;
  /** Marcas de raridade no canto (modo daltónico). */
  private readonly pips: Phaser.GameObjects.Rectangle[];

  /**
   * @param keyHint número da tecla (hotbar no PC), ou null.
   * @param scale ampliação inteira do ícone (1 = 16 px, 2 = 32 px).
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    ref: SlotRef,
    keyHint: string | null = null,
    scale = 1,
  ) {
    this.ref = ref;
    this.x = x;
    this.y = y;
    const size = slotSize(scale);
    this.size = size;
    this.iconWidth = 16 * scale;
    const margin = (size - this.iconWidth) / 2;
    const wearY = y + size - 2 - 2 * scale;
    this.frame = scene.add.rectangle(x, y, size, size, paletteNumber('bark_dark')).setOrigin(0);
    this.bg = scene.add.rectangle(x + 1, y + 1, size - 2, size - 2, paletteNumber('shadow')).setOrigin(0);
    this.icon = scene.add
      .image(x + margin, y + margin, '__DEFAULT')
      .setOrigin(0)
      .setScale(scale)
      .setVisible(false);
    this.wearBg = scene.add
      .rectangle(x + margin, wearY, this.iconWidth, 2 * scale, paletteNumber('ink'))
      .setOrigin(0)
      .setVisible(false);
    this.wear = scene.add
      .rectangle(x + margin, wearY, this.iconWidth, 2 * scale, paletteNumber('lime'))
      .setOrigin(0)
      .setVisible(false);
    this.qty = new Label(
      scene,
      x + size - 1,
      y + size,
      '',
      { size: 6 + 3 * (scale - 1), bold: true, stroke: true },
      [1, 1],
    );
    this.pips = [0, 1, 2].map((i) =>
      scene.add
        .rectangle(x + size - 4 - i * 3, y + 2, 2, 2, paletteNumber('cream'))
        .setOrigin(0)
        .setVisible(false),
    );
    this.key = keyHint
      ? new Label(scene, x + 2, y + 1, keyHint, { size: 6, color: 'stone_light', stroke: true })
      : null;
    this.enchant = new Label(
      scene,
      x + 2,
      y + size,
      '',
      { size: 6 + 2 * (scale - 1), bold: true, color: 'gold', stroke: true },
      [0, 1],
    );
    this.ammo = new Label(
      scene,
      x + size - 1,
      y + 1,
      '',
      { size: 6 + 3 * (scale - 1), bold: true, stroke: true },
      [1, 0],
    );
  }

  /** Arma à distância: quantas munições tem (null = não mostra; a vermelho se acabaram). */
  setAmmo(qty: number | null): this {
    this.ammo.setText(qty === null ? '' : String(Math.min(qty, BALANCE.quiverDisplayMax)));
    if (qty !== null) this.ammo.setColor(qty > 0 ? 'cream' : 'red');
    return this;
  }

  /** Fundo de outra cor (o slot da arma ao lado da hotbar). */
  setAccent(color: PaletteColor): this {
    this.bg.setFillStyle(paletteNumber(color));
    return this;
  }

  update(slot: Slot | null, items: ItemDefs, selected: boolean): void {
    const def = slot ? items[slot[0]] : undefined;
    const rarity = def?.rarity ?? 'common';
    this.frame.setFillStyle(paletteNumber(selected ? 'gold' : RARITY_FRAME[rarity]));
    const pips = preferences().colorblind ? RARITY_PIPS[rarity] : 0;
    this.pips.forEach((pip, i) => pip.setVisible(i < pips));
    // Os slots de equipamento dizem o que levam só quando estão vazios.
    if (this.ref.container === 'equipment') this.key?.setVisible(!slot);
    const enchant = slot?.[3] ?? 0;
    this.enchant.setText(enchant > 0 ? `+${String(enchant)}` : '');
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
      this.wear.width = Math.max(1, Math.round(this.iconWidth * fraction));
      this.wear.setFillStyle(paletteNumber(fraction > 0.5 ? 'lime' : fraction > 0.2 ? 'amber' : 'red'));
    }
  }

  contains(px: number, py: number): boolean {
    return px >= this.x && py >= this.y && px < this.x + this.size && py < this.y + this.size;
  }

  setDepth(depth: number): this {
    for (const obj of [this.frame, this.bg, this.icon, this.wearBg, this.wear]) obj.setDepth(depth);
    for (const pip of this.pips) pip.setDepth(depth + 1);
    this.qty.setDepth(depth + 1);
    this.enchant.setDepth(depth + 1);
    this.ammo.setDepth(depth + 2);
    this.key?.setDepth(depth + 1);
    return this;
  }

  destroy(): void {
    for (const obj of [this.frame, this.bg, this.icon, this.wearBg, this.wear, ...this.pips]) obj.destroy();
    this.qty.destroy();
    this.enchant.destroy();
    this.ammo.destroy();
    this.key?.destroy();
  }
}
