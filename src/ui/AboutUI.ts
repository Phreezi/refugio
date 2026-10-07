import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { getView } from '../display/view';
import { t } from '../i18n';
import { Button } from './Button';
import { Label } from './text';

/** Largura máxima do painel (px de jogo); em ecrãs estreitos encolhe. */
const MAX_W = 280;
const PAD = 10;

type Page = 'credits' | 'privacy';

/**
 * "Sobre / Créditos" (menu inicial e menu de pausa): nome e versão, créditos (e licenças) e uma
 * nota de privacidade curta. Dois separadores, para caber num ecrã baixo (telemóvel ao baixo).
 * Desenha-se a si próprio (fundo escuro + painel) por cima do que estiver na cena.
 */
export class AboutUI {
  private readonly scene: Phaser.Scene;
  private readonly depth: number;
  private readonly onClose: () => void;
  private objects: { destroy(): void }[] = [];
  private page: Page = 'credits';

  constructor(scene: Phaser.Scene, depth: number, onClose: () => void) {
    this.scene = scene;
    this.depth = depth;
    this.onClose = onClose;
    this.build();
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
    this.objects = [];
  }

  private add<T extends { destroy(): void }>(object: T): T {
    this.objects.push(object);
    return object;
  }

  private build(): void {
    this.destroy();
    const view = getView();
    const w = Math.min(MAX_W, view.width - 16) & ~1;
    const x = Math.round((view.width - w) / 2);
    const scene = this.scene;
    const depth = this.depth;
    // Corpo primeiro (fora do ecrã) para medir a altura e centrar o painel.
    const body = this.add(
      new Label(scene, 0, 0, t(this.page === 'credits' ? 'about.credits' : 'about.privacy'), {
        size: 8,
        color: 'cream',
        wrap: w - 2 * PAD,
      }).setDepth(depth + 2),
    );
    const subtitle = this.add(
      new Label(
        scene,
        0,
        0,
        `${t('about.version', { version: __APP_VERSION__, build: __BUILD_ID__ })}\n${t('about.tagline')}`,
        { size: 7, color: 'stone_light', align: 'center', wrap: w - 2 * PAD },
        [0.5, 0],
      ).setDepth(depth + 2),
    );
    // Título, versão e separadores (a altura da versão depende da fonte e do zoom).
    const tabsY = 20 + Math.ceil(subtitle.text.height) + 9;
    const header = tabsY + 13;
    const footer = 30;
    const h = Math.min(view.height - 8, header + body.text.height + footer) & ~1;
    const y = Math.max(4, Math.round((view.height - h) / 2));
    // Fundo: tapa e bloqueia os toques no que está por baixo.
    this.add(
      scene.add
        .rectangle(0, 0, view.width, view.height, paletteNumber('ink'), 0.75)
        .setOrigin(0)
        .setDepth(depth)
        .setInteractive(),
    );
    this.add(
      scene.add
        .rectangle(x, y, w, h, paletteNumber('bark_dark'))
        .setOrigin(0)
        .setDepth(depth + 1),
    );
    this.add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(depth + 1),
    );
    const cx = Math.round(view.width / 2);
    this.add(
      new Label(scene, cx, y + 6, t('about.title'), { size: 10, color: 'wheat' }, [0.5, 0]).setDepth(
        depth + 2,
      ),
    );
    // Separadores.
    const tabW = Math.min(90, Math.floor((w - 2 * PAD - 4) / 2)) & ~1;
    (['credits', 'privacy'] as const).forEach((page, i) => {
      this.add(
        new Button(
          scene,
          cx + (i === 0 ? -1 : 1) * (tabW / 2 + 2),
          y + tabsY,
          t(page === 'credits' ? 'about.tab_credits' : 'about.tab_privacy'),
          { width: tabW, height: 12, fontSize: 8, style: page === this.page ? 'primary' : 'secondary' },
          () => {
            if (page === this.page) return;
            this.page = page;
            // A partir do próprio clique: refazer no frame seguinte.
            scene.time.delayedCall(0, () => {
              this.build();
            });
          },
        ).setDepth(depth + 2),
      );
    });
    subtitle.setPosition(cx, y + 20);
    body.setPosition(x + PAD, y + header);
    this.add(
      new Button(scene, cx, y + h - 14, t('about.close'), { width: 80, height: 16, fontSize: 8 }, () => {
        scene.time.delayedCall(0, () => {
          this.destroy();
          this.onClose();
        });
      }).setDepth(depth + 2),
    );
  }
}
