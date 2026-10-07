import type Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { content } from '../world/content';
import { npcWorldPoint, questKillTargets, questTarget, type WorldPoint } from '../world/questGuide';
import { TILE_PX } from '../world/wilds';

// Minimapa (pedido do jogador: "como se fosse GTA"): um quadrado no canto com o terreno à volta
// (1 píxel por tile), o jogador ao meio e as marcas do que interessa — o destino da missão ativa,
// os inimigos a derrotar e os NPCs com missões para dar ("!") ou entregar ("?"). O que fica fora
// do quadrado aparece como uma seta na borda, a apontar para lá (o destino da missão ou, sem
// missão ativa, o NPC com missão mais perto). Tocar no minimapa abre o mapa.

/** Lado do minimapa (px de jogo = tiles do mundo). */
export const MINIMAP_SIZE = 64;
/** De quanto em quanto tempo se redesenha o terreno e se procuram os destinos (ms). */
const TERRAIN_MS = 400;
const TARGETS_MS = 1000;
const DEPTH = 30;

const COLORS = {
  void: 'night',
  solid: 'forest_dark',
  floor: 'wood',
  free: 'grass',
  street: 'stone',
} as const satisfies Record<string, PaletteColor>;
type Cell = keyof typeof COLORS;

interface Marker {
  x: number;
  y: number;
  kind: 'goal' | 'offer' | 'ready' | 'enemy';
}

export class Minimap {
  private readonly terrain: Phaser.GameObjects.Graphics;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly frame: Phaser.GameObjects.Rectangle;
  private x = 0;
  private y = 0;
  private lastTerrain = 0;
  private terrainKey = '';
  private lastTargets = 0;
  /** NPC com missão (para dar ou entregar) mais perto: o HUD diz "fala com…" sem missão ativa. */
  nearestNpc: { npc: string; ready: boolean } | null = null;
  private markers: Marker[] = [];
  /** Para onde aponta a seta da borda (px do mundo), se o destino estiver fora do quadrado. */
  private pointer: { x: number; y: number; kind: Marker['kind'] } | null = null;

  constructor(scene: Phaser.Scene, onTap: () => void) {
    this.frame = scene.add
      .rectangle(0, 0, MINIMAP_SIZE + 4, MINIMAP_SIZE + 4, paletteNumber('ink'), 1)
      .setOrigin(0)
      .setDepth(DEPTH)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', onTap);
    this.terrain = scene.add.graphics().setDepth(DEPTH + 1);
    this.overlay = scene.add.graphics().setDepth(DEPTH + 2);
  }

  /** Canto superior esquerdo do minimapa (px de jogo da interface). */
  setPosition(x: number, y: number): void {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.frame.setPosition(this.x - 2, this.y - 2);
    this.terrainKey = '';
  }

  setVisible(visible: boolean): void {
    this.frame.setVisible(visible);
    this.terrain.setVisible(visible);
    this.overlay.setVisible(visible);
  }

  destroy(): void {
    this.frame.destroy();
    this.terrain.destroy();
    this.overlay.destroy();
  }

  /** Chamar em todos os frames (só redesenha o terreno e procura destinos de vez em quando). */
  update(now: number): void {
    if (!gameState.hasGame || !this.frame.visible) return;
    const here = this.playerWorld();
    if (!here) return;
    const cx = Math.floor(here.x / TILE_PX);
    const cy = Math.floor(here.y / TILE_PX);
    const key = `${String(cx)},${String(cy)}`;
    if (key !== this.terrainKey && now - this.lastTerrain >= TERRAIN_MS) {
      this.terrainKey = key;
      this.lastTerrain = now;
      this.drawTerrain(cx, cy);
    }
    if (now - this.lastTargets >= TARGETS_MS) {
      this.lastTargets = now;
      this.findTargets(here);
    }
    this.drawOverlay(here, now);
  }

  /** O jogador no mundo contínuo (px), ou null fora dele (masmorras, eventos). */
  private playerWorld(): WorldPoint | null {
    const player = gameState.data.player;
    const rect = content.world.rect(player.zoneId);
    if (!rect) return null;
    return { x: rect.x * TILE_PX + player.x, y: rect.y * TILE_PX + player.y };
  }

  /** Terreno à volta do tile (cx, cy) do mundo: livre, sólido, chão construído ou nada. */
  private drawTerrain(cx: number, cy: number): void {
    const g = this.terrain.clear();
    const half = MINIMAP_SIZE / 2;
    const world = content.world;
    for (let row = 0; row < MINIMAP_SIZE; row++) {
      const ty = cy - half + row;
      let runStart = 0;
      let runCell: Cell | null = null;
      const flush = (end: number): void => {
        if (runCell === null || end <= runStart) return;
        g.fillStyle(paletteNumber(COLORS[runCell]), 1).fillRect(
          this.x + runStart,
          this.y + row,
          end - runStart,
          1,
        );
      };
      for (let col = 0; col < MINIMAP_SIZE; col++) {
        const hit = world.at(cx - half + col, ty);
        // Só os mapas já carregados (não se gera nenhum mapa para o minimapa).
        const map = hit ? content.loadedZoneMap(hit.zone.zoneId) : undefined;
        let cell: Cell = 'void';
        if (hit && map) {
          const i = hit.ty * map.width + hit.tx;
          const free = content.wild(hit.zone.zoneId)?.biome === 'urban' ? 'street' : 'free';
          cell = map.solid[i] ? 'solid' : map.floor[i] ? 'floor' : free;
        }
        if (cell !== runCell) {
          flush(col);
          runStart = col;
          runCell = cell;
        }
      }
      flush(MINIMAP_SIZE);
    }
  }

  /** Destinos: o da missão ativa, os inimigos a derrotar perto, e os NPCs com missões. */
  private findTargets(here: WorldPoint): void {
    const quests = simulation.quests;
    const markers: Marker[] = [];
    let pointer: Minimap['pointer'] = null;
    const active = quests.active();
    for (const [i, quest] of active.entries()) {
      const progress = quests.progress(quest.id);
      const point = questTarget(quest, progress, quests.ready(quest.id), here);
      if (point) {
        markers.push({ ...point, kind: 'goal' });
        if (i === 0) pointer = { ...point, kind: 'goal' };
      }
      // Inimigos da missão na zona onde se está (os mais perto ficam à vista no minimapa).
      const kills = questKillTargets(quest, progress);
      const rect = content.world.rect(gameState.data.player.zoneId);
      if (rect && kills.size > 0)
        for (const enemy of simulation.combat.list)
          if (kills.has(enemy.id))
            markers.push({ x: rect.x * TILE_PX + enemy.x, y: rect.y * TILE_PX + enemy.y, kind: 'enemy' });
    }
    // NPCs com missões (para dar ou para entregar): marcas e, sem missão ativa, a seta para o
    // mais perto.
    let nearest: { x: number; y: number; d: number; kind: Marker['kind']; npc: string } | null = null;
    for (const npc of Object.keys(content.npcs)) {
      const ready = quests.handIns(npc).some((q) => quests.ready(q.id));
      const offers = !ready && quests.offers(npc).length > 0;
      if (!ready && !offers) continue;
      const point = npcWorldPoint(npc);
      if (!point) continue;
      const kind = ready ? 'ready' : 'offer';
      markers.push({ ...point, kind });
      const d = Math.hypot(point.x - here.x, point.y - here.y);
      if (!nearest || d < nearest.d) nearest = { ...point, d, kind, npc };
    }
    this.nearestNpc = nearest ? { npc: nearest.npc, ready: nearest.kind === 'ready' } : null;
    if (!pointer && nearest) pointer = { x: nearest.x, y: nearest.y, kind: nearest.kind };
    this.markers = markers;
    this.pointer = pointer;
  }

  private drawOverlay(here: WorldPoint, now: number): void {
    const g = this.overlay.clear();
    const half = MINIMAP_SIZE / 2;
    const ox = this.x + half;
    const oy = this.y + half;
    const toMap = (p: { x: number; y: number }): { x: number; y: number; inside: boolean } => {
      const mx = (p.x - here.x) / TILE_PX;
      const my = (p.y - here.y) / TILE_PX;
      return { x: ox + mx, y: oy + my, inside: Math.abs(mx) < half - 2 && Math.abs(my) < half - 2 };
    };
    const color = (kind: Marker['kind']): PaletteColor =>
      kind === 'goal' ? 'gold' : kind === 'enemy' ? 'red' : kind === 'ready' ? 'lime' : 'wheat';
    for (const marker of this.markers) {
      const p = toMap(marker);
      if (!p.inside) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const size = marker.kind === 'enemy' ? 2 : 4;
      g.fillStyle(paletteNumber('ink'), 1).fillRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
      g.fillStyle(paletteNumber(color(marker.kind)), 1).fillRect(x - size / 2, y - size / 2, size, size);
    }
    // O jogador: um losango claro ao meio.
    g.fillStyle(paletteNumber('ink'), 1)
      .fillRect(ox - 3, oy - 2, 6, 4)
      .fillRect(ox - 2, oy - 3, 4, 6);
    g.fillStyle(paletteNumber('ice'), 1)
      .fillRect(ox - 2, oy - 1, 4, 2)
      .fillRect(ox - 1, oy - 2, 2, 4);
    // Seta na borda para o destino que está fora (a piscar devagar, para chamar a atenção).
    const target = this.pointer;
    if (!target) return;
    const p = toMap(target);
    if (p.inside) return;
    const dx = p.x - ox;
    const dy = p.y - oy;
    const scale = (half - 5) / Math.max(Math.abs(dx), Math.abs(dy));
    const ax = ox + dx * scale;
    const ay = oy + dy * scale;
    const d = Math.hypot(dx, dy);
    const ux = dx / d;
    const uy = dy / d;
    const tri = (size: number): [number, number, number, number, number, number] => [
      ax + ux * size,
      ay + uy * size,
      ax - ux * size * 0.7 - uy * size * 0.8,
      ay - uy * size * 0.7 + ux * size * 0.8,
      ax - ux * size * 0.7 + uy * size * 0.8,
      ay - uy * size * 0.7 - ux * size * 0.8,
    ];
    const pulse = Math.floor(now / 500) % 2 === 0 ? 1 : 0.7;
    g.fillStyle(paletteNumber('ink'), 1).fillTriangle(...tri(6));
    g.fillStyle(paletteNumber(color(target.kind)), pulse).fillTriangle(...tri(4.5));
  }
}
