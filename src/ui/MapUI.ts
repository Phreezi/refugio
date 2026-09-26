import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { simulation, WAYSTONE_PROP } from '../core/Simulation';
import { getView } from '../display/view';
import { t, tKey } from '../i18n';
import { content } from '../world/content';
import type { ZoneRect } from '../world/worldLayout';
import { Button, CLOSE_ICON } from './Button';
import { Label } from './text';
import { uiState } from './uiState';

// Por cima dos botões do HUD (a pausa "II" está a 86).
const DEPTH = { dim: 88, panel: 89, content: 90 } as const;
const PAD = 6;
/** Altura do mundo (tiles) que cabe no painel: vê-se a zona onde se está e as de perto. */
const VISIBLE_TILES = 240;

interface Destroyable {
  destroy(): void;
}

/** Cor de uma zona no mapa: a casa, os caminhos e o perigo (T1 verde … T4 vermelho). */
function zoneColor(zoneId: string, locked: boolean): PaletteColor {
  if (locked) return 'stone_dark';
  if (zoneId === BASE_ZONE_ID) return 'wheat';
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
  /** Linha do mundo (tiles) ao centro do painel. */
  private centerY = 0;
  /** A arrastar: o último y do ponteiro (o painel refaz-se a cada passo). */
  private dragY: number | null = null;

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
    const size = content.zoneMap(player.zoneId).tileSize;
    this.centerY = here ? here.y + player.y / size : 0;
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
    const rects = content.world.all();
    if (rects.length === 0) return;
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const scale = Math.min(iw / (maxX - minX), ih / Math.min(VISIBLE_TILES, maxY - minY));
    // Não deixar passar das pontas do mundo.
    const halfTiles = ih / scale / 2;
    this.centerY = Phaser.Math.Clamp(
      this.centerY,
      minY + halfTiles,
      Math.max(minY + halfTiles, maxY - halfTiles),
    );
    const top = this.centerY - halfTiles;
    const left = ix + (iw - (maxX - minX) * scale) / 2;
    const toScreen = (tx: number, ty: number): { x: number; y: number } => ({
      x: left + (tx - minX) * scale,
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
      if (!zone || zone.hidden) return;
      const cx = a.x + w / 2;
      // Na zona onde se está, o nome vai para cima (o ponto do jogador fica à vista).
      const cy = current ? a.y + Math.min(h / 2, 9) : a.y + h / 2;
      if (cy < iy + 6 || cy > iy + ih - 6) return;
      const name = tKey(zone.name);
      this.add(
        new Label(
          scene,
          Math.round(cx),
          Math.round(cy),
          locked ? `${name} (${t('map.level', { n: zone.unlockLevel })})` : name,
          { size: 7, color: 'cream', stroke: true, fit: Math.max(8, Math.floor(w - 4)) },
          [0.5, 0.5],
        ).setDepth(DEPTH.content),
      );
    };
    for (const rect of rects) drawZone(rect);
    this.drawMarkers(rects, toScreen, { x: ix, y: iy, w: iw, h: ih });
    // O jogador: um ponto vermelho com contorno claro.
    const here = content.world.rect(player.zoneId);
    if (here) {
      const size = content.zoneMap(player.zoneId).tileSize;
      const p = toScreen(here.x + player.x / size, here.y + player.y / size);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (y > iy && y < iy + ih) {
        const dot = this.add(scene.add.graphics().setDepth(DEPTH.content + 1));
        dot.fillStyle(paletteNumber('cream'), 1).fillRect(x - 3, y - 3, 6, 6);
        dot.fillStyle(paletteNumber('red'), 1).fillRect(x - 2, y - 2, 4, 4);
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
      const size = content.zoneMap(zoneId).tileSize;
      const p = toScreen(rect.x + px / size, rect.y + py / size);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const inside = x > area.x + 3 && x < area.x + area.w - 3 && y > area.y + 3 && y < area.y + area.h - 3;
      return inside ? { x, y } : null;
    };
    const box = (x: number, y: number, size: number, color: PaletteColor): void => {
      g.fillStyle(paletteNumber('ink'), 1).fillRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
      g.fillStyle(paletteNumber(color), 1).fillRect(x - size / 2, y - size / 2, size, size);
    };
    for (const rect of rects) {
      const zoneId = rect.zoneId;
      const map = content.zoneMap(zoneId);
      // Postes de teletransporte.
      for (const prop of map.props) {
        if (prop.id !== WAYSTONE_PROP) continue;
        const p = at(zoneId, prop.x, prop.y);
        if (p) box(p.x, p.y, 4, data.waystones.includes(zoneId) ? 'sky' : 'stone_dark');
      }
      // Chefes ainda por derrotar.
      const bossAway = (data.bosses[zoneId] ?? 0) > data.world.tick;
      for (const spawn of map.enemySpawns) {
        const members = content.enemyGroups[spawn.id]?.members ?? [];
        if (bossAway || !members.some((m) => content.enemies[m.enemy]?.boss)) continue;
        const p = at(zoneId, spawn.x, spawn.y);
        if (p) box(p.x, p.y, 6, 'red');
      }
      // NPCs com missão.
      for (const npc of map.npcs ?? []) {
        const ready = quests.handIns(npc.id).some((q) => quests.ready(q.id));
        const mark = ready ? '?' : quests.offers(npc.id).length > 0 ? '!' : '';
        const p = mark ? at(zoneId, npc.x, npc.y) : null;
        if (p)
          this.add(
            new Label(scene, p.x, p.y, mark, { size: 9, color: 'gold', stroke: true }, [0.5, 0.5]).setDepth(
              DEPTH.content + 2,
            ),
          );
      }
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

  /** Arrastar (rato ou dedo) no painel move o mapa para cima/baixo; a roda também. */
  private dragToScroll(panel: Phaser.GameObjects.Rectangle): void {
    const scene = this.scene;
    const worldY = (pointer: Phaser.Input.Pointer): number =>
      scene.cameras.main.getWorldPoint(pointer.x, pointer.y).y;
    const tilesPerPx = (): number => {
      const rects = content.world.all();
      const minX = Math.min(...rects.map((r) => r.x));
      const maxX = Math.max(...rects.map((r) => r.x + r.w));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxY = Math.max(...rects.map((r) => r.y + r.h));
      const { width, height } = getView();
      const scale = Math.min(
        (width - 16 - PAD * 2) / (maxX - minX),
        (height - 58) / Math.min(VISIBLE_TILES, maxY - minY),
      );
      return 1 / scale;
    };
    panel
      .setInteractive()
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.dragY = worldY(pointer);
      })
      .on('pointerup', () => {
        this.dragY = null;
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (this.dragY === null || !pointer.isDown) return;
        const y = worldY(pointer);
        const dy = y - this.dragY;
        if (Math.abs(dy) < 2) return;
        this.dragY = y;
        this.centerY -= dy * tilesPerPx();
        this.rebuildSoon();
      })
      .on('wheel', (_pointer: Phaser.Input.Pointer, _dx: number, dy: number) => {
        this.centerY += Math.sign(dy) * 24;
        this.rebuildSoon();
      });
  }

  private rebuildSoon(): void {
    this.scene.time.delayedCall(0, () => {
      if (this.opened) this.build();
    });
  }
}
