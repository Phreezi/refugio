import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView, setupFixedCamera } from '../display/view';
import { t, tKey } from '../i18n';
import { autosave } from '../save';
import { canTravel } from '../systems/travel/travel';
import { Button } from '../ui/Button';
import { Label } from '../ui/text';
import { uiState } from '../ui/uiState';
import { content } from '../world/content';
import { SceneKey } from './keys';
import type { ZoneSceneData } from './ZoneScene';

export interface WorldMapData {
  /** Zona de onde se saiu (onde o jogador continua, até viajar). */
  from: string;
  /** Saída por onde se saiu (para voltar pelo mesmo sítio). */
  exit: { x: number; y: number };
}

/** Cor de cada nível de perigo (CLAUDE.md §8.1): base, T1 verde, T2 amarelo, T3 laranja, T4 vermelho. */
const DANGER_COLORS: readonly PaletteColor[] = ['wood_light', 'leaf', 'gold', 'orange', 'red'];
const NODE_R = 9;
const FADE_MS = 250;

/**
 * Mapa-mundo (CLAUDE.md §8.1): a base ao centro e as zonas à volta, com o perigo, o custo da
 * viagem e se lá ficou a mochila. O tempo de jogo não corre aqui (a cena de jogo está parada).
 */
export class WorldMapScene extends Phaser.Scene {
  private from = BASE_ZONE_ID;
  private exit = { x: 0, y: 0 };
  private selected: string | null = null;
  private panel: { destroy(): void }[] = [];
  private busy = false;

  constructor() {
    super(SceneKey.WorldMap);
  }

  create(data: WorldMapData): void {
    this.from = data.from;
    this.exit = data.exit;
    this.selected = null;
    this.panel = [];
    this.busy = false;
    const camera = this.cameras.main;
    setupFixedCamera(camera);
    camera.setBackgroundColor(paletteNumber('night'));
    this.drawMap();
    this.showPanel();
    camera.fadeIn(FADE_MS);

    const onResize = (): void => {
      this.scene.restart({ from: this.from, exit: this.exit } satisfies WorldMapData);
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    const onEsc = (): void => {
      this.back();
    };
    this.input.keyboard?.on('keydown-ESC', onEsc);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
  }

  /** Posição de uma zona no ecrã (worldMapPos 0–100 dentro da área do mapa). */
  private screenPos(zoneId: string): { x: number; y: number } {
    const { width, height } = getView();
    const pos = content.zones[zoneId]?.worldMapPos ?? { x: 50, y: 50 };
    const left = 24;
    const top = 26;
    const w = width - 48;
    const h = height - 26 - 92; // o painel ocupa o fundo
    return { x: Math.round(left + (pos.x / 100) * w), y: Math.round(top + (pos.y / 100) * h) };
  }

  private drawMap(): void {
    const { width, height } = getView();
    const g = this.add.graphics();
    // "Papel" do mapa.
    g.fillStyle(paletteNumber('bark_dark'));
    g.fillRect(8, 20, width - 16, height - 112);
    g.fillStyle(paletteNumber('parchment'));
    g.fillRect(10, 22, width - 20, height - 116);
    new Label(
      this,
      Math.round(width / 2),
      5,
      t('map.title'),
      { size: 10, bold: true, color: 'wheat' },
      [0.5, 0],
    );
    new Button(
      this,
      30,
      11,
      t('map.back'),
      { width: 44, height: 14, fontSize: 8, style: 'secondary' },
      () => {
        this.back();
      },
    );

    // Caminhos da base a cada zona (tracejado).
    const base = this.screenPos(BASE_ZONE_ID);
    g.fillStyle(paletteNumber('stone'));
    for (const zoneId of Object.keys(content.zones)) {
      if (zoneId === BASE_ZONE_ID) continue;
      const to = this.screenPos(zoneId);
      const steps = Math.round(Math.hypot(to.x - base.x, to.y - base.y) / 6);
      for (let i = 1; i < steps; i += 1) {
        const x = Math.round(base.x + ((to.x - base.x) * i) / steps);
        const y = Math.round(base.y + ((to.y - base.y) * i) / steps);
        g.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    const data = gameState.data;
    for (const [zoneId, zone] of Object.entries(content.zones)) {
      const { x, y } = this.screenPos(zoneId);
      const here = zoneId === this.from;
      if (here) this.add.circle(x, y, NODE_R + 3, paletteNumber('gold'));
      this.add.circle(x, y, NODE_R + 1, paletteNumber('ink'));
      const node = this.add.circle(x, y, NODE_R, paletteNumber(DANGER_COLORS[zone.danger] ?? 'red'));
      node.setInteractive({ useHandCursor: true }).on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.selected = zoneId;
        this.showPanel();
      });
      new Label(
        this,
        x,
        y,
        zone.danger === 0 ? 'C' : `T${String(zone.danger)}`,
        {
          size: 7,
          bold: true,
          color: 'ink',
        },
        [0.5, 0.5],
      );
      new Label(
        this,
        x,
        y + NODE_R + 3,
        tKey(zone.name),
        { size: 7, bold: true, color: 'bark_dark' },
        [0.5, 0],
      );
      // Mochila deixada ao morrer (§8.1: ícone de estado).
      if (data.zones[zoneId]?.bags.some((bag) => bag.death)) {
        this.add.image(x + NODE_R + 4, y - NODE_R, 'bag_dropped').setOrigin(0.5);
      }
    }
  }

  /** Painel de baixo: a zona escolhida, o custo e o botão de viajar (ou só a dica). */
  private showPanel(): void {
    for (const obj of this.panel) obj.destroy();
    this.panel = [];
    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.panel.push(obj);
      return obj;
    };
    const { width, height } = getView();
    const top = height - 86;
    const cx = Math.round(width / 2);
    const zoneId = this.selected;
    const zone = zoneId ? content.zones[zoneId] : undefined;
    if (!zoneId || !zone) {
      add(new Label(this, cx, top + 20, t('map.hint'), { size: 9, color: 'parchment' }, [0.5, 0]));
      return;
    }
    const lines: string[] = [
      zone.danger === 0 ? t('map.safe') : t('map.danger', { tier: `T${String(zone.danger)}` }),
    ];
    const here = zoneId === this.from;
    const cost = here ? { hunger: 0, thirst: 0 } : zone.travelCost;
    if (here) lines.push(t('map.here'));
    else if (cost.hunger + cost.thirst === 0) lines.push(t('map.free'));
    else lines.push(t('map.cost', { hunger: cost.hunger, thirst: cost.thirst }));
    if (gameState.data.zones[zoneId]?.bags.some((bag) => bag.death)) lines.push(t('map.bag'));
    if (zone.unlockLevel > 1) lines.push(t('map.unlock_later', { level: zone.unlockLevel }));
    add(new Label(this, cx, top, tKey(zone.name), { size: 10, bold: true, color: 'wheat' }, [0.5, 0]));
    add(
      new Label(
        this,
        cx,
        top + 15,
        lines.join('\n'),
        {
          size: 7,
          color: 'parchment',
          align: 'center',
          wrap: width - 24,
        },
        [0.5, 0],
      ),
    );
    add(
      new Button(
        this,
        cx,
        height - 12,
        here ? t('map.back') : t('map.travel'),
        { width: 80, height: 16, fontSize: 9 },
        () => {
          if (here) this.back();
          else this.travel(zoneId);
        },
      ),
    );
  }

  /** Volta à zona de onde se saiu, pela mesma saída (grátis). */
  private back(): void {
    if (this.busy) return;
    this.busy = true;
    simulation.enterZone(this.from, content.zoneMap(this.from), this.exit);
    this.go(this.from);
  }

  private travel(zoneId: string): void {
    const zone = content.zones[zoneId];
    if (this.busy || !zone) return;
    const player = gameState.data.player;
    if (!canTravel(player, zone.travelCost)) {
      this.flash(t('map.too_tired', { hunger: zone.travelCost.hunger, thirst: zone.travelCost.thirst }));
      return;
    }
    this.busy = true;
    simulation.travel(zoneId, content.zoneMap(zoneId), zone.travelCost);
    uiState.pendingNotice = tKey(zone.name);
    this.go(zoneId);
  }

  private go(zoneId: string): void {
    void autosave.flush(); // CLAUDE.md §10.2: gravar ao mudar de zona
    const camera = this.cameras.main;
    camera.fadeOut(FADE_MS, 0, 0, 0);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SceneKey.Zone, { zoneId } satisfies ZoneSceneData);
    });
  }

  private flash(text: string): void {
    const { width, height } = getView();
    const label = new Label(
      this,
      Math.round(width / 2),
      height - 36,
      text,
      {
        size: 8,
        bold: true,
        color: 'red',
        stroke: true,
        align: 'center',
        wrap: width - 24,
      },
      [0.5, 1],
    );
    this.time.delayedCall(2500, () => {
      label.destroy();
    });
  }
}
