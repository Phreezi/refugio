import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { eventBus } from '../core/EventBus';
import { getView } from '../display/view';
import { itemName, t, tKey } from '../i18n';
import { content } from '../world/content';
import { Label } from './text';
import { tInput } from './touch';

const DEPTH = 85;
/** Fecha-se sozinho ao fim deste tempo (não interrompe o jogo). */
const AUTO_CLOSE_MS = 6000;
/** Desbloqueios mostrados (o resto conta-se em "+N"). */
const MAX_LINES = 5;

interface LevelUp {
  level: number;
  lines: string[];
}

/**
 * "Subiste de nível!" (CLAUDE.md §11, Fase 8): painel no topo do ecrã com o que ficou
 * desbloqueado (receitas, peças de construção, zonas), numa faixa compacta. Não pausa o jogo;
 * fecha com um toque ou sozinho. Várias subidas seguidas mostram-se uma de cada vez.
 */
export class LevelUpUI {
  private readonly scene: Phaser.Scene;
  private readonly queue: LevelUp[] = [];
  private objects: { destroy(): void }[] = [];
  private timer: Phaser.Time.TimerEvent | null = null;
  private readonly unsubscribe: (() => void)[];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.unsubscribe = [
      eventBus.on('player:levelUp', ({ level, unlocked }) => {
        const lines = [
          ...unlocked.recipes.map((id) => itemName(content.recipes.find((r) => r.id === id)?.output ?? id)),
          ...unlocked.structures.map((id) => tKey(`structure.${id}`)),
          ...unlocked.zones.map((id) => tKey(content.zones[id]?.name ?? id)),
        ];
        this.queue.push({ level, lines });
        if (this.objects.length === 0) this.showNext();
      }),
    ];
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    this.clear();
  }

  private showNext(): void {
    this.clear();
    const next = this.queue.shift();
    if (!next) return;
    const scene = this.scene;
    const { width } = getView();
    // Faixa compacta no topo (não tapa o boneco nem as barras): título numa linha, o que ficou
    // desbloqueado em poucas palavras; tocar fecha.
    const w = Math.min(240, width - 16);
    const x = Math.round((width - w) / 2);
    const y = 30;
    const shown = next.lines.slice(0, MAX_LINES);
    const more = next.lines.length - shown.length;
    const list = more > 0 ? `${shown.join(', ')} ${t('level.more', { n: more })}` : shown.join(', ');
    const body = `${next.lines.length > 0 ? `${t('level.unlocked')} ${list}` : t('level.nothing')}\n${tInput('level.points.touch', 'level.points')}`;
    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };
    const text = add(
      new Label(
        scene,
        x + w / 2,
        y + 16,
        body,
        { size: 7, color: 'cream', align: 'center', wrap: w - 12 },
        [0.5, 0],
      ),
    ).setDepth(DEPTH + 1);
    const h = Math.round(16 + text.text.height + 5);
    add(
      scene.add
        .rectangle(x, y, w, h, paletteNumber('gold'))
        .setOrigin(0)
        .setDepth(DEPTH)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          scene.time.delayedCall(0, () => {
            this.showNext();
          });
        }),
    );
    add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'), 0.95)
        .setOrigin(0)
        .setDepth(DEPTH),
    );
    add(
      new Label(
        scene,
        x + w / 2,
        y + 4,
        `${t('level.title')} ${t('level.level', { level: next.level })}`,
        { size: 9, bold: true, color: 'gold' },
        [0.5, 0],
      ),
    ).setDepth(DEPTH + 1);
    this.timer = scene.time.delayedCall(AUTO_CLOSE_MS, () => {
      this.showNext();
    });
  }

  private clear(): void {
    this.timer?.remove();
    this.timer = null;
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }
}
