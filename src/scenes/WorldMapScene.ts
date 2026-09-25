import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView, setupFixedCamera } from '../display/view';
import { itemName, t, tKey } from '../i18n';
import { autosave } from '../save';
import { canTravel } from '../systems/travel/travel';
import { Button } from '../ui/Button';
import { Label } from '../ui/text';
import { uiState } from '../ui/uiState';
import { content } from '../world/content';
import { SceneKey } from './keys';
import { coop } from '../net/coop';
import type { MainMenuData } from './MainMenuScene';
import type { ZoneSceneData } from './ZoneScene';

export interface WorldMapData {
  /** Zona de onde se saiu (onde o jogador continua, até viajar). */
  from: string;
  /** Saída por onde se saiu (para voltar pelo mesmo sítio). */
  exit: { x: number; y: number };
  /**
   * Aberto num poste de teletransporte (Etapa E): só os postes ativados (e a base) são
   * destinos, sem custo; "Voltar" deixa o jogador onde estava.
   */
  teleport?: boolean;
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
  private teleport = false;
  private panel: { destroy(): void }[] = [];
  private busy = false;

  constructor() {
    super(SceneKey.WorldMap);
  }

  create(data: WorldMapData): void {
    this.from = data.from;
    this.exit = data.exit;
    this.teleport = data.teleport === true;
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
      this.scene.restart({
        from: this.from,
        exit: this.exit,
        teleport: this.teleport,
      } satisfies WorldMapData);
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    const onEsc = (): void => {
      this.back();
    };
    this.input.keyboard?.on('keydown-ESC', onEsc);
    // Co-op: no mapa-mundo os inimigos ignoram este jogador (o tempo não pára para o outro).
    coop.setAway(true);
    if (coop.isGuest) {
      coop.onLost = () => {
        gameState.clear();
        this.scene.start(SceneKey.MainMenu, { message: 'coop.lost' } satisfies MainMenuData);
      };
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      coop.onLost = null;
    });
  }

  /** Co-op (anfitrião): o mundo continua a andar para o convidado enquanto se escolhe a zona. */
  override update(): void {
    if (coop.isHost && uiState.coop) simulation.update(this.game.loop.rawDelta);
    coop.update(performance.now());
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
      t(this.teleport ? 'map.teleport_title' : 'map.title'),
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
    for (const [zoneId, zone] of Object.entries(content.zones)) {
      if (zoneId === BASE_ZONE_ID || zone.hidden || !simulation.progression.isZoneAvailable(zoneId)) continue;
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
      // Pisos de baixo das masmorras e eventos que não estão a decorrer.
      if (zone.hidden || !simulation.progression.isZoneAvailable(zoneId)) continue;
      const { x, y } = this.screenPos(zoneId);
      const here = zoneId === this.surface();
      if (here) this.add.circle(x, y, NODE_R + 3, paletteNumber('gold'));
      this.add.circle(x, y, NODE_R + 1, paletteNumber('ink'));
      const locked =
        !here && (this.teleport ? !this.hasPost(zoneId) : !simulation.progression.isZoneUnlocked(zoneId));
      const node = this.add.circle(
        x,
        y,
        NODE_R,
        paletteNumber(locked ? 'stone' : (DANGER_COLORS[zone.danger] ?? 'red')),
      );
      node.setInteractive({ useHandCursor: true }).on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.selected = zoneId;
        this.showPanel();
      });
      new Label(
        this,
        x,
        y,
        locked && !this.teleport
          ? String(zone.unlockLevel)
          : zone.danger === 0
            ? 'C'
            : `T${String(zone.danger)}`,
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
      const hint = t(this.teleport ? 'map.teleport_hint' : 'map.hint');
      add(
        new Label(
          this,
          cx,
          top + 20,
          hint,
          { size: 9, color: 'parchment', wrap: width - 24, align: 'center' },
          [0.5, 0],
        ),
      );
      return;
    }
    if (this.teleport) {
      this.showTeleportPanel(zoneId, top, cx);
      return;
    }
    const lines: string[] = [
      zone.danger === 0 ? t('map.safe') : t('map.danger', { tier: `T${String(zone.danger)}` }),
    ];
    const here = zoneId === this.surface();
    const cost = here ? { hunger: 0, thirst: 0 } : simulation.progression.travelCost(zoneId);
    if (zone.event) lines.push(t('map.event', { hours: simulation.progression.eventHoursLeft(zoneId) }));
    if (here) lines.push(t('map.here'));
    else if (cost.hunger + cost.thirst === 0) lines.push(t('map.free'));
    else lines.push(t('map.cost', { hunger: cost.hunger, thirst: cost.thirst }));
    if (gameState.data.zones[zoneId]?.bags.some((bag) => bag.death)) lines.push(t('map.bag'));
    const levelLocked = !here && !simulation.progression.isZoneUnlocked(zoneId);
    const missing = here ? null : simulation.progression.missingItem(zoneId);
    const locked = levelLocked || missing !== null;
    const lockText = levelLocked
      ? t('map.locked', { level: zone.unlockLevel })
      : missing
        ? t('map.needs_item', { item: itemName(missing) })
        : '';
    if (locked) lines.push(lockText);
    if (missing && zone.hint) lines.push(tKey(zone.hint));
    // Masmorra: diz em que piso se vai entrar (checkpoint).
    const entry = simulation.progression.dungeonEntry(zoneId);
    const floor = content.zones[entry]?.dungeon?.floor ?? 1;
    if (!here && floor > 1) lines.push(t('map.checkpoint', { floor }));
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
        { width: 80, height: 16, fontSize: 9, style: locked ? 'secondary' : 'primary' },
        () => {
          if (here) this.back();
          else if (locked) this.flash(lockText);
          else this.travel(zoneId);
        },
      ),
    );
  }

  /** Volta à zona de onde se saiu, pela mesma saída (grátis); do poste, fica onde estava. */
  private back(): void {
    if (this.busy) return;
    this.busy = true;
    if (!this.teleport) simulation.enterZone(this.from, content.zoneMap(this.from), this.exit);
    this.go(this.from);
  }

  /** A zona tem o poste de teletransporte ativado? (a base está sempre) */
  private hasPost(zoneId: string): boolean {
    return zoneId === BASE_ZONE_ID || gameState.data.waystones.includes(zoneId);
  }

  /** Painel do teletransporte: grátis para os postes ativados. */
  private showTeleportPanel(zoneId: string, top: number, cx: number): void {
    const { width, height } = getView();
    const zone = content.zones[zoneId];
    if (!zone) return;
    const here = zoneId === this.from;
    const ok = !here && this.hasPost(zoneId);
    const line = here ? t('map.here') : ok ? t('map.teleport_free') : t('map.teleport_off');
    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.panel.push(obj);
      return obj;
    };
    add(new Label(this, cx, top, tKey(zone.name), { size: 10, bold: true, color: 'wheat' }, [0.5, 0]));
    add(
      new Label(
        this,
        cx,
        top + 15,
        line,
        { size: 7, color: 'parchment', align: 'center', wrap: width - 24 },
        [0.5, 0],
      ),
    );
    add(
      new Button(
        this,
        cx,
        height - 12,
        here ? t('map.back') : t('map.teleport_go'),
        { width: 80, height: 16, fontSize: 9, style: ok ? 'primary' : 'secondary' },
        () => {
          if (here) this.back();
          else if (!ok) this.flash(line);
          else if (!this.busy && simulation.teleport(zoneId, content.zoneMap(zoneId))) {
            this.busy = true;
            uiState.pendingNotice = tKey(zone.name);
            this.go(zoneId);
          }
        },
      ),
    );
  }

  /** A zona do mapa-mundo onde se está (nos pisos de baixo de uma masmorra, a entrada). */
  private surface(): string {
    const dungeon = content.zones[this.from]?.dungeon;
    if (!dungeon) return this.from;
    const entry = Object.entries(content.zones).find(
      ([, z]) => z.dungeon?.id === dungeon.id && z.dungeon.floor === 1,
    );
    return entry?.[0] ?? this.from;
  }

  private travel(zoneId: string): void {
    const zone = content.zones[zoneId];
    if (this.busy || !zone) return;
    // Numa masmorra, vai-se direto ao checkpoint (piso mais fundo já alcançado).
    const target = simulation.progression.dungeonEntry(zoneId);
    const player = gameState.data.player;
    const cost = simulation.progression.travelCost(zoneId);
    if (!canTravel(player, cost)) {
      this.flash(t('map.too_tired', { hunger: cost.hunger, thirst: cost.thirst }));
      return;
    }
    this.busy = true;
    simulation.travel(target, content.zoneMap(target), cost, target !== zoneId);
    uiState.pendingNotice = tKey(content.zones[target]?.name ?? zone.name);
    this.go(target);
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
