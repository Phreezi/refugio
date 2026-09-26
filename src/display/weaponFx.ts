import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import type { ItemDef } from '../data/types';
import { weaponPose, type Facing, type SwingKind } from './weaponPose';

// Desenho das animações das armas (ver weaponPose.ts): a arma equipada (o ícone dela) ou o
// punho por cima do boneco durante o golpe, o rasto do golpe, a corda do arco com a flecha e o
// clarão das armas de fogo.

/** Duração de cada animação (ms). */
const DURATION: Record<SwingKind, number> = { melee: 260, punch: 200, ranged: 320 };
/** Os ícones das armas estão desenhados na diagonal (pega em baixo à esquerda, ponta em cima à direita). */
const ICON_DIAGONAL = Math.PI / 4;

/**
 * Rotação a somar para o ícone apontar na direção 0 (direita): na diagonal (a maioria), na
 * vertical (picaretas, fisga) ou já à direita (arcos, pistola).
 */
function iconTurn(def: ItemDef | undefined, ranged: boolean): number {
  if (def?.toolKind === 'pickaxe' || def?.ranged?.ammo === 'pebble') return Math.PI / 2;
  return ranged ? 0 : ICON_DIAGONAL;
}
const TRAIL_RADIUS = 13;

interface Swing {
  kind: SwingKind;
  start: number;
  aim: number | null;
  hand: number;
  weapon: ItemDef | undefined;
  ammo: ItemDef | undefined;
}

export class WeaponFx {
  private readonly weapon: Phaser.GameObjects.Image;
  private readonly arrow: Phaser.GameObjects.Image;
  private readonly fx: Phaser.GameObjects.Graphics;
  private swing: Swing | null = null;
  private punches = 0;

  constructor(scene: Phaser.Scene) {
    this.weapon = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.arrow = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.fx = scene.add.graphics().setVisible(false);
  }

  /**
   * Começa uma animação: com arma à distância e `aim` (disparo), puxa a corda; com arma (ou
   * ferramenta) de corpo a corpo, golpe em arco; sem arma, soco (alterna as mãos).
   */
  start(now: number, weapon: ItemDef | undefined, aim: number | null, ammo?: ItemDef): void {
    const kind: SwingKind =
      weapon?.ranged && aim !== null ? 'ranged' : weapon && !weapon.ranged ? 'melee' : 'punch';
    if (kind === 'punch') this.punches += 1;
    this.swing = { kind, start: now, aim, hand: this.punches % 2, weapon, ammo };
  }

  /** Desenha a animação em curso para o jogador com os pés em (x, y). */
  render(now: number, x: number, y: number, facing: Facing, depth: number): void {
    const swing = this.swing;
    const t = swing ? (now - swing.start) / DURATION[swing.kind] : 1;
    if (!swing || t >= 1) {
      this.swing = null;
      this.weapon.setVisible(false);
      this.arrow.setVisible(false);
      this.fx.setVisible(false);
      return;
    }
    const pose = weaponPose(swing.kind, facing, t, swing.aim, swing.hand);
    const px = Math.round(x + pose.dx);
    const py = Math.round(y + pose.dy);
    const d = depth + (pose.behind ? -0.5 : 0.5);
    const fx = this.fx.clear().setPosition(0, 0).setVisible(true).setDepth(d);

    if (swing.kind === 'punch') {
      // Punho: 3×3 px de pele com contorno, e duas riscas de impacto no fim do soco.
      this.weapon.setVisible(false);
      this.arrow.setVisible(false);
      fx.fillStyle(paletteNumber('ink'), 1).fillRect(px - 2, py - 2, 5, 5);
      fx.fillStyle(paletteNumber('peach'), 1).fillRect(px - 1, py - 1, 3, 3);
      if (t > 0.3 && t < 0.6) {
        const cx = Math.round(px + Math.cos(pose.angle) * 4);
        const cy = Math.round(py + Math.sin(pose.angle) * 4);
        fx.fillStyle(paletteNumber('cream'), 0.8);
        fx.fillRect(cx - 1, cy - 3, 2, 2)
          .fillRect(cx - 1, cy + 1, 2, 2)
          .fillRect(cx + 1, cy - 1, 2, 2);
      }
      return;
    }

    const icon = swing.weapon?.icon;
    if (!icon) return;
    this.weapon.setTexture(icon).setVisible(true).setDepth(d);

    if (swing.kind === 'ranged') {
      // Arco/pistola apontados ao alvo; o arco com a corda puxada e a flecha nela.
      const bow = swing.weapon?.ranged?.ammo !== 'pistol_ammo';
      const left = Math.cos(pose.angle) < 0;
      this.weapon
        .setOrigin(0.5, 0.5)
        .setPosition(px, py)
        .setRotation(pose.angle + iconTurn(swing.weapon, true))
        .setFlipY(!bow && left);
      if (bow && pose.draw > 0) {
        // Corda: das pontas do arco até ao ponto puxado para trás.
        const back = 1 + Math.round(4 * pose.draw);
        const nx = -Math.sin(pose.angle);
        const ny = Math.cos(pose.angle);
        const tipA = { x: px + nx * 6 - Math.cos(pose.angle) * 2, y: py + ny * 6 - Math.sin(pose.angle) * 2 };
        const tipB = { x: px - nx * 6 - Math.cos(pose.angle) * 2, y: py - ny * 6 - Math.sin(pose.angle) * 2 };
        const pull = { x: px - Math.cos(pose.angle) * (2 + back), y: py - Math.sin(pose.angle) * (2 + back) };
        fx.lineStyle(1, paletteNumber('cream'), 0.9);
        fx.lineBetween(tipA.x, tipA.y, pull.x, pull.y).lineBetween(tipB.x, tipB.y, pull.x, pull.y);
        if (swing.ammo) {
          this.arrow
            .setTexture(swing.ammo.icon)
            .setVisible(true)
            .setDepth(d + 0.01)
            .setOrigin(0.5, 0.5)
            .setPosition(
              Math.round(pull.x + Math.cos(pose.angle) * 6),
              Math.round(pull.y + Math.sin(pose.angle) * 6),
            )
            .setRotation(pose.angle + ICON_DIAGONAL);
        } else this.arrow.setVisible(false);
      } else this.arrow.setVisible(false);
      if (pose.flash) {
        // Clarão na boca do cano (armas de fogo) ou "sopro" da corda (arcos).
        const mx = Math.round(px + Math.cos(pose.angle) * 9);
        const my = Math.round(py + Math.sin(pose.angle) * 9);
        if (!bow) {
          fx.fillStyle(paletteNumber('gold'), 1).fillRect(mx - 2, my - 2, 4, 4);
          fx.fillStyle(paletteNumber('cream'), 1).fillRect(mx - 1, my - 1, 2, 2);
        }
      }
      return;
    }

    // Golpe em arco: a arma roda à volta da pega (na mão), com um rasto claro na descida.
    this.arrow.setVisible(false);
    this.weapon
      .setOrigin(0.2, 0.8)
      .setFlipY(false)
      .setPosition(px, py)
      .setRotation(pose.angle + iconTurn(swing.weapon, false));
    if (t > 0.3) {
      const from = weaponPose('melee', facing, 0.3).angle;
      const steps = 6;
      fx.fillStyle(paletteNumber('cream'), 0.55);
      for (let i = 0; i <= steps; i++) {
        const a = from + ((pose.angle - from) * i) / steps;
        fx.fillRect(
          Math.round(px + Math.cos(a) * TRAIL_RADIUS) - 1,
          Math.round(py + Math.sin(a) * TRAIL_RADIUS) - 1,
          2,
          2,
        );
      }
    }
  }

  destroy(): void {
    this.weapon.destroy();
    this.arrow.destroy();
    this.fx.destroy();
  }
}
