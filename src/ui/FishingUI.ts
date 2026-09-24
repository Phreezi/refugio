import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { eventBus } from '../core/EventBus';
import type { Simulation } from '../core/Simulation';
import { getView } from '../display/view';
import { t } from '../i18n';
import { Button } from './Button';
import { Label } from './text';

const BAR_W = 140;
const BAR_H = 10;
const DEPTH = 65;

/**
 * Mini-jogo da pesca (1 botão): uma barra com a zona verde e o marcador que vai e volta.
 * O "puxar" é o botão de ação normal (Espaço, clique no mundo, botão Ação); "Parar" desiste.
 */
export class FishingUI {
  private readonly scene: Phaser.Scene;
  private readonly simulation: Simulation;
  private objects: { destroy(): void }[] = [];
  private zone: Phaser.GameObjects.Rectangle | null = null;
  private marker: Phaser.GameObjects.Rectangle | null = null;
  private barX = 0;
  private readonly unsubscribe: (() => void)[];

  constructor(scene: Phaser.Scene, simulation: Simulation) {
    this.scene = scene;
    this.simulation = simulation;
    this.unsubscribe = [
      eventBus.on('fishing:started', () => {
        this.build();
      }),
      eventBus.on('fishing:result', ({ caught }) => {
        this.clear();
        scene.events.emit('ui:message', t(caught ? 'fish.caught' : 'fish.missed'));
      }),
      eventBus.on('fishing:filled', () => {
        scene.events.emit('ui:message', t('fish.filled'));
      }),
    ];
    if (simulation.fishing.active) this.build();
  }

  update(): void {
    const session = this.simulation.fishing.session;
    if (!session || !this.marker || !this.zone) return;
    this.marker.setX(this.barX + Math.round(this.simulation.fishing.marker * (BAR_W - 2)));
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    this.clear();
  }

  private build(): void {
    this.clear();
    const session = this.simulation.fishing.session;
    if (!session) return;
    const scene = this.scene;
    const { width, height } = getView();
    const cx = Math.round(width / 2);
    const top = Math.round(height * 0.22);
    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };
    const panelW = BAR_W + 24;
    const panelH = 64;
    const px = cx - panelW / 2;
    add(
      scene.add.rectangle(px, top, panelW, panelH, paletteNumber('bark_dark')).setOrigin(0).setDepth(DEPTH),
    );
    add(
      scene.add
        .rectangle(px + 1, top + 1, panelW - 2, panelH - 2, paletteNumber('night'), 0.92)
        .setOrigin(0)
        .setDepth(DEPTH),
    );
    add(
      new Label(scene, cx, top + 5, t('fish.title'), { size: 8, bold: true, color: 'wheat' }, [0.5, 0]),
    ).setDepth(DEPTH);
    this.barX = cx - BAR_W / 2;
    const barY = top + 20;
    add(
      scene.add.rectangle(this.barX - 1, barY - 1, BAR_W + 2, BAR_H + 2, paletteNumber('ink')).setOrigin(0),
    );
    add(scene.add.rectangle(this.barX, barY, BAR_W, BAR_H, paletteNumber('deep_water')).setOrigin(0));
    const zoneW = Math.round(session.width * BAR_W) & ~1;
    this.zone = add(
      scene.add
        .rectangle(
          this.barX + Math.round(session.zone * BAR_W - zoneW / 2),
          barY,
          zoneW,
          BAR_H,
          paletteNumber('leaf'),
        )
        .setOrigin(0),
    );
    this.marker = add(
      scene.add.rectangle(this.barX, barY - 2, 2, BAR_H + 4, paletteNumber('cream')).setOrigin(0),
    );
    for (const obj of this.objects) (obj as unknown as { setDepth(d: number): void }).setDepth(DEPTH);
    add(
      new Label(
        scene,
        cx,
        barY + BAR_H + 4,
        t('fish.hint'),
        { size: 7, color: 'parchment', wrap: panelW - 8, align: 'center' },
        [0.5, 0],
      ),
    ).setDepth(DEPTH);
    add(
      new Button(
        scene,
        px + panelW - 20,
        top + 9,
        t('fish.cancel'),
        { width: 32, height: 12, fontSize: 7, style: 'secondary' },
        () => {
          this.simulation.fishing.cancel();
        },
      ),
    ).setDepth(DEPTH + 1);
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.zone = null;
    this.marker = null;
  }
}
