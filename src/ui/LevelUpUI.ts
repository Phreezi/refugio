import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { eventBus } from '../core/EventBus';
import { getView } from '../display/view';
import { itemName, t, tKey } from '../i18n';
import { content } from '../world/content';
import { Button } from './Button';
import { Label } from './text';

const DEPTH = 85;
/** Fecha-se sozinho ao fim deste tempo (não interrompe o jogo). */
const AUTO_CLOSE_MS = 8000;

interface LevelUp {
  level: number;
  lines: string[];
}

/**
 * "Subiste de nível!" (CLAUDE.md §11, Fase 8): painel no topo do ecrã com o que ficou
 * desbloqueado (receitas, peças de construção, zonas). Não pausa o jogo; fecha com
 * "Continuar" ou sozinho. Várias subidas seguidas mostram-se uma de cada vez.
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
    const w = Math.min(220, width - 16);
    const x = Math.round((width - w) / 2);
    const y = 34;
    const body =
      next.lines.length > 0 ? `${t('level.unlocked')}\n${next.lines.join(', ')}` : t('level.nothing');
    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };
    const text = add(
      new Label(
        scene,
        x + w / 2,
        y + 30,
        body,
        { size: 8, color: 'cream', align: 'center', wrap: w - 16 },
        [0.5, 0],
      ),
    ).setDepth(DEPTH + 1);
    const h = Math.round(30 + text.text.height + 26);
    add(scene.add.rectangle(x, y, w, h, paletteNumber('gold')).setOrigin(0).setDepth(DEPTH));
    add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'), 0.95)
        .setOrigin(0)
        .setDepth(DEPTH),
    );
    add(
      new Label(scene, x + w / 2, y + 5, t('level.title'), { size: 10, bold: true, color: 'gold' }, [0.5, 0]),
    ).setDepth(DEPTH + 1);
    add(
      new Label(
        scene,
        x + w / 2,
        y + 18,
        t('level.level', { level: next.level }),
        { size: 8, bold: true, color: 'wheat' },
        [0.5, 0],
      ),
    ).setDepth(DEPTH + 1);
    add(
      new Button(scene, x + w / 2, y + h - 11, t('level.ok'), { width: 64, height: 14, fontSize: 8 }, () => {
        scene.time.delayedCall(0, () => {
          this.showNext();
        });
      }),
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
