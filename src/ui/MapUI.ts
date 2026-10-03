import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { simulation, WAYSTONE_PROP } from '../core/Simulation';
import { getView } from '../display/view';
import { t, tKey } from '../i18n';
import { content } from '../world/content';
import type { ZoneRect } from '../world/worldLayout';
import { TILE_PX, villageNpcIds } from '../world/wilds';
import { Button, CLOSE_ICON } from './Button';
import { Label, measureTextWidth } from './text';
import { uiState } from './uiState';

// Por cima dos botões do HUD (a pausa "II" está a 86).
const DEPTH = { dim: 88, panel: 89, content: 90 } as const;
const PAD = 6;
/** Níveis de zoom: tiles do mundo que cabem no lado curto do desenho. */
const ZOOM_TILES = [120, 240, 480, 960, 1920] as const;
/** Cor das zonas selvagens por bioma (aldeias à parte). */
const BIOME_COLOR: Readonly<Record<string, PaletteColor>> = {
  meadow: 'grass',
  forest: 'forest',
  hills: 'sand',
  marsh: 'teal',
};

interface Destroyable {
  destroy(): void;
}

/** Cor de uma zona no mapa: a casa, os caminhos e o perigo (T1 verde … T4 vermelho). */
function zoneColor(zoneId: string, locked: boolean): PaletteColor {
  if (locked) return 'stone_dark';
  if (zoneId === BASE_ZONE_ID) return 'wheat';
  const wild = content.wild(zoneId);
  if (wild) return wild.village ? 'amber' : (BIOME_COLOR[wild.biome] ?? 'grass');
  const zone = content.zones[zoneId];
  if (zone?.hidden) return 'wood';
  return (['grass', 'grass', 'amber', 'orange', 'red'] as const)[zone?.danger ?? 1] ?? 'grass';
}

/**
 * Mapa do mundo contínuo (tecla M ou botão "Mapa"): as zonas à volta, a cor do perigo, as que
 * ainda estão fechadas (nível) e onde o jogador está. Arrasta-se (ou roda do rato) para ver o resto.
 */
export class MapUI {
  private readonly scene: Phaser.Scene;
  private objects: Destroyable[] = [];
  private opened = false;
  /** Ponto do mundo (tiles) ao centro do desenho. */
  private centerX = 0;
  private centerY = 0;
  /** Índice em ZOOM_TILES. */
  private zoom = 1;
  /** Px do ecrã por tile do mundo (do último desenho). */
  private scale = 1;
  /** A arrastar: o último ponto do ponteiro (o painel refaz-se a cada passo). */
  private drag: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  open(): void {
    if (!gameState.hasGame) return;
    const player = gameState.data.player;
    const here = content.world.rect(player.zoneId);
    this.centerX = here ? here.x + player.x / TILE_PX : 0;
    this.centerY = here ? here.y + player.y / TILE_PX : 0;
    this.opened = true;
    uiState.modalOpen = true;
    this.build();
  }

  close(): void {
    this.clear();
    if (this.opened) uiState.modalOpen = false;
    this.opened = false;
  }

  destroy(): void {
    this.close();
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }

  private add<T extends Destroyable>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private build(): void {
    this.clear();
    const scene = this.scene;
    const { width, height } = getView();
    const px = 8;
    const py = 8;
    const pw = width - 16;
    const ph = height - 16;
    // Fundo: tocar fora do painel fecha.
    this.add(
      scene.add
        .rectangle(0, 0, width, height, paletteNumber('ink'), 0.6)
        .setOrigin(0)
        .setDepth(DEPTH.dim)
        .setInteractive()
        .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          const p = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
          if (p.x < px || p.y < py || p.x > px + pw || p.y > py + ph) this.close();
        }),
    );
    const panel = this.add(
      scene.add.rectangle(px, py, pw, ph, paletteNumber('night')).setOrigin(0).setDepth(DEPTH.panel),
    );
    this.dragToScroll(panel);
    const player = gameState.data.player;
    const title = content.zones[player.zoneId]?.name;
    this.add(
      new Label(scene, px + PAD, py + 4, `${t('map.title')}: ${title ? tKey(title) : ''}`, {
        size: 9,
        color: 'wheat',
      }).setDepth(DEPTH.content),
    );
    this.add(
      new Button(
        scene,
        px + pw - 10,
        py + 10,
        CLOSE_ICON,
        { width: 14, height: 14, style: 'secondary' },
        () => {
          this.close();
        },
      ).setDepth(DEPTH.content),
    );
    // Zoom: − afasta, + aproxima.
    for (const [i, [text, step]] of (
      [
        ['+', -1],
        ['-', 1],
      ] as const
    ).entries()) {
      this.add(
        new Button(
          scene,
          px + pw - 30 - i * 18,
          py + 10,
          text,
          { width: 14, height: 14, style: 'secondary' },
          () => {
            this.zoom = Phaser.Math.Clamp(this.zoom + step, 0, ZOOM_TILES.length - 1);
            this.rebuildSoon();
          },
        ).setDepth(DEPTH.content),
      );
    }
    this.add(
      new Label(
        scene,
        px + pw / 2,
        py + ph - 3,
        t('map.drag'),
        { size: 6, color: 'stone_light' },
        [0.5, 1],
      ).setDepth(DEPTH.content),
    );
    // Área do desenho.
    const ix = px + PAD;
    const iy = py + 30;
    const iw = pw - PAD * 2;
    const ih = ph - 42;
    this.drawLegend(ix, py + 21);
    const tiles = ZOOM_TILES[this.zoom] ?? 240;
    const scale = Math.min(iw, ih) / tiles;
    this.scale = scale;
    const halfW = iw / scale / 2;
    const halfH = ih / scale / 2;
    const left = this.centerX - halfW;
    const top = this.centerY - halfH;
    // Só as zonas à vista (o mundo tem centenas).
    const rects = content.world
      .all()
      .filter((r) => r.x < left + halfW * 2 && r.x + r.w > left && r.y < top + halfH * 2 && r.y + r.h > top);
    const toScreen = (tx: number, ty: number): { x: number; y: number } => ({
      x: ix + (tx - left) * scale,
      y: iy + (ty - top) * scale,
    });
    const g = this.add(scene.add.graphics().setDepth(DEPTH.panel + 1));
    const clipRect = (x: number, y: number, w: number, h: number, color: PaletteColor): void => {
      const x0 = Math.max(ix, Math.round(x));
      const y0 = Math.max(iy, Math.round(y));
      const x1 = Math.min(ix + iw, Math.round(x + w));
      const y1 = Math.min(iy + ih, Math.round(y + h));
      if (x1 > x0 && y1 > y0) g.fillStyle(paletteNumber(color), 1).fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const questZones = new Set(
      simulation.quests
        .active()
        .flatMap((q) => q.goals.flatMap((goal) => (goal.type === 'reach' ? [goal.zone] : []))),
    );
    const drawZone = (rect: ZoneRect): void => {
      const locked = !simulation.progression.isZoneUnlocked(rect.zoneId);
      const a = toScreen(rect.x, rect.y);
      const w = rect.w * scale;
      const h = rect.h * scale;
      const current = rect.zoneId === player.zoneId;
      // Contorno: onde se está (dourado), destino de uma missão (verde), resto (escuro).
      clipRect(a.x, a.y, w, h, current ? 'gold' : questZones.has(rect.zoneId) ? 'lime' : 'ink');
      clipRect(a.x + 1, a.y + 1, w - 2, h - 2, zoneColor(rect.zoneId, locked));
      const zone = content.zones[rect.zoneId];
      const wild = content.wild(rect.zoneId);
      // Nomes: as zonas do mapa-mundo, as aldeias e a zona onde se está (o resto enchia o mapa).
      if (!zone || (zone.hidden && !wild?.village && !current) || w < 14) return;
      // Só a parte do bloco à vista conta (o nome não sai do desenho).
      const vx0 = Math.max(a.x, ix);
      const vx1 = Math.min(a.x + w, ix + iw);
      if (vx1 - vx0 < 14) return;
      const cx = (vx0 + vx1) / 2;
      // Na zona onde se está e nas aldeias, o nome vai para cima (o jogador e os "!" ficam à vista).
      const cy = current || wild?.village ? a.y + Math.min(h / 2, 9) : a.y + h / 2;
      if (cy < iy + 6 || cy > iy + ih - 6) return;
      const name = tKey(zone.name);
      const text = locked ? `${name} (${t('map.level', { n: zone.unlockLevel })})` : name;
      // Se nem encolhido cabe no bloco, não se escreve (o mapa ficava com nomes por cima de tudo).
      if (measureTextWidth(text, 7) > (vx1 - vx0 - 4) * 1.6) return;
      this.add(
        new Label(
          scene,
          Math.round(cx),
          Math.round(cy),
          text,
          { size: 7, color: 'cream', stroke: true, fit: Math.max(8, Math.floor(vx1 - vx0 - 4)) },
          [0.5, 0.5],
        ).setDepth(DEPTH.content),
      );
    };
    // Contorno de 1 px só com zoom perto; de longe, cada zona é um bloco de cor.
    for (const rect of rects) drawZone(rect);
    this.drawMarkers(rects, toScreen, { x: ix, y: iy, w: iw, h: ih });
    // O jogador: um ponto vermelho com contorno claro.
    const here = content.world.rect(player.zoneId);
    if (here) {
      const p = toScreen(here.x + player.x / TILE_PX, here.y + player.y / TILE_PX);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (y > iy && y < iy + ih && x > ix && x < ix + iw) {
        const dot = this.add(scene.add.graphics().setDepth(DEPTH.content + 1));
        // "Tu": losango azul-claro com contorno (o vermelho é dos chefes).
        dot
          .fillStyle(paletteNumber('ink'), 1)
          .fillRect(x - 1, y - 5, 2, 10)
          .fillRect(x - 5, y - 1, 10, 2);
        dot.fillStyle(paletteNumber('ink'), 1).fillRect(x - 3, y - 3, 6, 6);
        dot
          .fillStyle(paletteNumber('ice'), 1)
          .fillRect(x - 2, y - 2, 4, 4)
          .fillRect(x - 1, y - 4, 2, 8)
          .fillRect(x - 4, y - 1, 8, 2);
      }
    }
  }

  /** Legenda por baixo do título: mochila, poste, missão, chefe. */
  private drawLegend(x: number, y: number): void {
    const scene = this.scene;
    const g = this.add(scene.add.graphics().setDepth(DEPTH.content));
    let cx = x;
    const entry = (draw: (x: number) => number, text: string): void => {
      cx = draw(cx) + 3;
      const label = this.add(
        new Label(scene, cx, y, text, { size: 6, color: 'stone_light' }, [0, 0.5]).setDepth(DEPTH.content),
      );
      cx += Math.ceil(label.text.width) + 8;
    };
    const square = (color: PaletteColor, size: number) => (at: number) => {
      g.fillStyle(paletteNumber('ink'), 1).fillRect(at, y - size / 2 - 1, size + 2, size + 2);
      g.fillStyle(paletteNumber(color), 1).fillRect(at + 1, y - size / 2, size, size);
      return at + size + 2;
    };
    entry((at) => {
      g.fillStyle(paletteNumber('ink'), 1).fillRect(at, y - 3, 6, 6);
      g.fillStyle(paletteNumber('ice'), 1).fillRect(at + 1, y - 2, 4, 4);
      return at + 6;
    }, t('map.legend_you'));
    entry((at) => {
      this.add(scene.add.image(at, y, 'bag_dropped').setOrigin(0, 0.5).setScale(0.5).setDepth(DEPTH.content));
      return at + 8;
    }, t('map.legend_bag'));
    entry(square('sky', 4), t('map.legend_waystone'));
    entry((at) => {
      this.add(
        new Label(scene, at, y, '!', { size: 8, color: 'gold', stroke: true }, [0, 0.5]).setDepth(
          DEPTH.content,
        ),
      );
      return at + 3;
    }, t('map.legend_quest'));
    entry(square('red', 6), t('map.legend_boss'));
  }

  /**
   * Coisas importantes no mapa: a mochila caída ao morrer (e as pilhas largadas), os postes de
   * teletransporte (azul = ativo), NPCs com missão ("!" nova, "?" para entregar) e chefes.
   */
  private drawMarkers(
    rects: readonly ZoneRect[],
    toScreen: (tx: number, ty: number) => { x: number; y: number },
    area: { x: number; y: number; w: number; h: number },
  ): void {
    const scene = this.scene;
    const data = gameState.data;
    const g = this.add(scene.add.graphics().setDepth(DEPTH.content + 1));
    const quests = simulation.quests;
    const at = (zoneId: string, px: number, py: number): { x: number; y: number } | null => {
      const rect = rects.find((r) => r.zoneId === zoneId);
      if (!rect) return null;
      const p = toScreen(rect.x + px / TILE_PX, rect.y + py / TILE_PX);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const inside = x > area.x + 3 && x < area.x + area.w - 3 && y > area.y + 3 && y < area.y + area.h - 3;
      return inside ? { x, y } : null;
    };
    const box = (x: number, y: number, size: number, color: PaletteColor): void => {
      g.fillStyle(paletteNumber('ink'), 1).fillRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
      g.fillStyle(paletteNumber(color), 1).fillRect(x - size / 2, y - size / 2, size, size);
    };
    const mark = (zoneId: string, npc: string, x: number, y: number): void => {
      const ready = quests.handIns(npc).some((q) => quests.ready(q.id));
      const text = ready ? '?' : quests.offers(npc).length > 0 ? '!' : '';
      const p = text ? at(zoneId, x, y) : null;
      if (p)
        this.add(
          new Label(scene, p.x, p.y - 4, text, { size: 9, color: 'gold', stroke: true }, [0.5, 1]).setDepth(
            DEPTH.content + 2,
          ),
        );
    };
    for (const rect of rects) {
      const zoneId = rect.zoneId;
      // Zonas selvagens: sem gerar o mapa (só os NPCs das aldeias, que se sabe onde estão).
      const wild = content.wild(zoneId);
      if (wild?.village) {
        for (const npc of Object.values(villageNpcIds(wild))) {
          const home = content.npcHome(npc);
          if (home) mark(zoneId, npc, home.x, home.y);
        }
      }
      const map = wild ? null : content.zoneMap(zoneId);
      for (const prop of map?.props ?? []) {
        if (prop.id !== WAYSTONE_PROP) continue;
        const p = at(zoneId, prop.x, prop.y);
        if (p) box(p.x, p.y, 4, data.waystones.includes(zoneId) ? 'sky' : 'stone_dark');
      }
      // Chefes ainda por derrotar.
      const bossAway = (data.bosses[zoneId] ?? 0) > data.world.tick;
      for (const spawn of map?.enemySpawns ?? []) {
        const members = content.enemyGroups[spawn.id]?.members ?? [];
        if (bossAway || !members.some((m) => content.enemies[m.enemy]?.boss)) continue;
        const p = at(zoneId, spawn.x, spawn.y);
        if (p) box(p.x, p.y, 6, 'red');
      }
      // NPCs com missão.
      for (const npc of map?.npcs ?? []) mark(zoneId, npc.id, npc.x, npc.y);
      // Mochila da morte (ícone) e pilhas largadas (quadradinho).
      for (const bag of data.zones[zoneId]?.bags ?? []) {
        if (bag.corpse) continue;
        const p = at(zoneId, bag.x, bag.y);
        if (!p) continue;
        if (bag.death)
          this.add(
            scene.add
              .image(p.x, p.y + 4, 'bag_dropped')
              .setOrigin(0.5, 1)
              .setDepth(DEPTH.content + 2),
          );
        else box(p.x, p.y, 2, 'wheat');
      }
    }
  }

  /** Arrastar (rato ou dedo) no painel move o mapa; a roda aproxima/afasta. */
  private dragToScroll(panel: Phaser.GameObjects.Rectangle): void {
    const scene = this.scene;
    const point = (pointer: Phaser.Input.Pointer): { x: number; y: number } =>
      scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    panel
      .setInteractive()
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.drag = point(pointer);
      })
      .on('pointerup', () => {
        this.drag = null;
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (this.drag === null || !pointer.isDown) return;
        const p = point(pointer);
        const dx = p.x - this.drag.x;
        const dy = p.y - this.drag.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        this.drag = p;
        this.centerX -= dx / this.scale;
        this.centerY -= dy / this.scale;
        this.rebuildSoon();
      })
      .on('wheel', (_pointer: Phaser.Input.Pointer, _dx: number, dy: number) => {
        this.zoom = Phaser.Math.Clamp(this.zoom + Math.sign(dy), 0, ZOOM_TILES.length - 1);
        this.rebuildSoon();
      });
  }

  private rebuildSoon(): void {
    this.scene.time.delayedCall(0, () => {
      if (this.opened) this.build();
    });
  }
}
