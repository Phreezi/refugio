import type { WorldObjectDef } from '../../data/types';
import type { ZoneMap } from '../../world/zoneMap';
import { footprintRect, overlaps, type Rect } from './geometry';
import { NPC_FOOTPRINT } from '../quests/quests';

/**
 * Geometria sólida de uma zona: tiles da camada `collision`, caixas dos recursos e tudo o que
 * fica fora do mapa. Lógica pura (sem Phaser), para o movimento correr no passo fixo e ser testável.
 */
export class CollisionWorld {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: number;
  private readonly solid: readonly boolean[];
  /** Degraus: tiles sólidos que não bloqueiam quem desce (salta-se para baixo, não se sobe). */
  private readonly ledge: readonly boolean[] | undefined;
  private readonly obstacles: readonly Rect[];
  /** Obstáculos com chave (ex.: id do objeto de um recurso), que se podem desligar. */
  private readonly keyed = new Map<number, Rect>();
  private readonly disabled = new Set<number>();
  /**
   * Mundo contínuo (Etapa E): o que há fora do mapa — o tile da zona vizinha (sólido ou não).
   * null = fora do mapa é tudo sólido.
   */
  outside: ((tx: number, ty: number) => boolean) | null = null;

  constructor(
    widthTiles: number,
    heightTiles: number,
    tileSize: number,
    solid: readonly boolean[],
    obstacles: readonly Rect[] = [],
    ledge?: readonly boolean[],
  ) {
    if (solid.length !== widthTiles * heightTiles) {
      throw new Error('CollisionWorld: o tamanho de "solid" não corresponde ao mapa');
    }
    this.widthTiles = widthTiles;
    this.heightTiles = heightTiles;
    this.tileSize = tileSize;
    this.solid = solid;
    this.ledge = ledge;
    this.obstacles = obstacles;
  }

  static fromZone(
    map: ZoneMap,
    resources: Readonly<Record<string, WorldObjectDef>>,
    props: Readonly<Record<string, WorldObjectDef>> = {},
    stations: Readonly<Record<string, WorldObjectDef>> = {},
    lootTables: Readonly<Record<string, WorldObjectDef>> = {},
  ): CollisionWorld {
    const obstacles: Rect[] = [];
    const keyed: [number, Rect][] = [];
    for (const placement of map.resources) {
      const footprint = resources[placement.id]?.footprint;
      // Recursos têm chave: quando são apanhados deixam de bloquear.
      if (footprint) keyed.push([placement.objectId, footprintRect(placement, footprint)]);
    }
    for (const placement of [...map.props, ...map.chests]) {
      const def = map.chests.includes(placement) ? props.chest : props[placement.id];
      if (def?.footprint) obstacles.push(footprintRect(placement, def.footprint));
    }
    for (const placement of map.stations) {
      const footprint = stations[placement.id]?.footprint;
      if (footprint) obstacles.push(footprintRect(placement, footprint));
    }
    for (const placement of map.npcs ?? []) obstacles.push(footprintRect(placement, NPC_FOOTPRINT));
    for (const placement of map.containers) {
      const footprint = lootTables[placement.id]?.footprint;
      if (footprint) obstacles.push(footprintRect(placement, footprint));
    }
    const world = new CollisionWorld(map.width, map.height, map.tileSize, map.solid, obstacles, map.ledge);
    for (const [key, rect] of keyed) world.addKeyed(key, rect);
    return world;
  }

  /** Obstáculo que se pode ligar/desligar (ex.: um recurso apanhado deixa de bloquear). */
  addKeyed(key: number, rect: Rect): void {
    this.keyed.set(key, rect);
  }

  removeKeyed(key: number): void {
    this.keyed.delete(key);
    this.disabled.delete(key);
  }

  setEnabled(key: number, enabled: boolean): void {
    if (enabled) this.disabled.delete(key);
    else this.disabled.add(key);
  }

  get pixelWidth(): number {
    return this.widthTiles * this.tileSize;
  }

  get pixelHeight(): number {
    return this.heightTiles * this.tileSize;
  }

  /** Tile sólido? Fora do mapa conta como sólido (ou o da zona vizinha, no mundo contínuo). */
  isSolidTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.widthTiles || ty >= this.heightTiles)
      return this.outside ? this.outside(tx, ty) : true;
    return this.solid[ty * this.widthTiles + tx] === true;
  }

  /** É um degrau (só bloqueia a subir)? */
  isLedgeTile(tx: number, ty: number): boolean {
    if (!this.ledge || tx < 0 || ty < 0 || tx >= this.widthTiles || ty >= this.heightTiles) return false;
    return this.ledge[ty * this.widthTiles + tx] === true;
  }

  /**
   * Retângulos sólidos que se sobrepõem a `area`.
   * @param descending a andar para baixo (sul): os degraus não contam (salta-se).
   */
  solidsIn(area: Rect, descending = false): Rect[] {
    const size = this.tileSize;
    const found: Rect[] = [];
    const tx0 = Math.floor(area.x / size);
    const ty0 = Math.floor(area.y / size);
    const tx1 = Math.ceil((area.x + area.w) / size) - 1;
    const ty1 = Math.ceil((area.y + area.h) / size) - 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.isSolidTile(tx, ty) && !(descending && this.isLedgeTile(tx, ty)))
          found.push({ x: tx * size, y: ty * size, w: size, h: size });
      }
    }
    for (const obstacle of this.obstacles) {
      if (overlaps(obstacle, area)) found.push(obstacle);
    }
    for (const [key, obstacle] of this.keyed) {
      if (!this.disabled.has(key) && overlaps(obstacle, area)) found.push(obstacle);
    }
    return found;
  }

  blocks(area: Rect): boolean {
    return this.solidsIn(area).some((solid) => overlaps(solid, area));
  }
}
