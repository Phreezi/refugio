import type { StructureDef, StructureDefs } from '../../data/types';
import { footprintRect, overlaps, type Rect, type Vec2 } from '../movement/geometry';

// Construção da base (CLAUDE.md §7.7), lógica pura: onde se pode pôr cada peça, que tiles
// ocupa, que caixa sólida tem e quanto se devolve ao demolir. O estado (as peças colocadas)
// vive no GameState; esta grelha é só um índice para responder depressa.

/**
 * Peça colocada, compacta para o save (§10.5): [uid, id da peça, tile x, tile y, rotação 0/1,
 * estado (portas: 1 = aberta)]. O uid nunca se reutiliza (identifica estações e baús).
 */
export type StructureRecord = [uid: number, id: string, tx: number, ty: number, rot: number, state: number];

/** Porque é que uma peça não pode ser colocada (ou demolida) ali. */
export type BuildProblem =
  | 'unknown'
  | 'locked'
  | 'out_of_bounds'
  | 'blocked'
  | 'occupied'
  | 'needs_foundation'
  | 'player'
  | 'no_materials'
  | 'supports'
  | 'station_busy'
  | 'chest_not_empty'
  | 'plot_busy'
  | 'inventory_full'
  | 'door_blocked';

/** O que o mapa da zona diz sobre onde se pode construir. */
export interface BuildSite {
  /** Em tiles. */
  width: number;
  height: number;
  tileSize: number;
  /** Tiles de colisão do mapa (paredes, água, vedação…). */
  solid: readonly boolean[];
  /** Chão do mapa que conta como fundação. */
  floor: readonly boolean[];
  /** Tiles ocupados por objetos sólidos do mapa (obstáculos, baús): nada se constrói aí. */
  blocked: ReadonlySet<number>;
  /** Tiles onde não se põem peças sólidas (onde o jogador aparece, saídas). */
  reserved: ReadonlySet<number>;
}

/** Tiles (índices) que um retângulo em píxeis toca. */
export function tilesOf(rect: Rect, tileSize: number, width: number, height: number): number[] {
  const tiles: number[] = [];
  const tx0 = Math.max(0, Math.floor(rect.x / tileSize));
  const ty0 = Math.max(0, Math.floor(rect.y / tileSize));
  const tx1 = Math.min(width - 1, Math.ceil((rect.x + rect.w) / tileSize) - 1);
  const ty1 = Math.min(height - 1, Math.ceil((rect.y + rect.h) / tileSize) - 1);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push(ty * width + tx);
  return tiles;
}

/**
 * Local de construção a partir do mapa.
 * @param objectAreas áreas dos objetos do mapa (caixa sólida, ou à volta dos pés).
 * @param reservedPoints pontos onde não pode haver peças sólidas (spawn, saídas).
 */
export function createBuildSite(
  map: {
    width: number;
    height: number;
    tileSize: number;
    solid: readonly boolean[];
    floor: readonly boolean[];
  },
  objectAreas: readonly Rect[],
  reservedPoints: readonly Vec2[],
): BuildSite {
  const blocked = new Set<number>();
  for (const area of objectAreas) {
    for (const tile of tilesOf(area, map.tileSize, map.width, map.height)) blocked.add(tile);
  }
  const reserved = new Set<number>();
  for (const p of reservedPoints) {
    const tx = Math.floor(p.x / map.tileSize);
    const ty = Math.floor(p.y / map.tileSize);
    if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height) reserved.add(ty * map.width + tx);
  }
  return { ...map, blocked, reserved };
}

/** Pés de uma peça (meio da base da área que ocupa), em píxeis: âncora do sprite e do Y-sort. */
export function structureFeet(def: StructureDef, tx: number, ty: number, tileSize: number): Vec2 {
  return { x: (tx + def.size.width / 2) * tileSize, y: (ty + def.size.height) * tileSize };
}

/** Retângulo (em píxeis) dos tiles ocupados. */
export function structureArea(def: StructureDef, tx: number, ty: number, tileSize: number): Rect {
  return { x: tx * tileSize, y: ty * tileSize, w: def.size.width * tileSize, h: def.size.height * tileSize };
}

/** Caixa sólida da peça (null = atravessável, ex.: fundação ou porta aberta). */
export function structureCollision(
  def: StructureDef,
  tx: number,
  ty: number,
  tileSize: number,
  open = false,
): Rect | null {
  if (def.solid) return def.door && open ? null : structureArea(def, tx, ty, tileSize);
  if (def.footprint) return footprintRect(structureFeet(def, tx, ty, tileSize), def.footprint);
  return null;
}

/** Materiais devolvidos: `pct`% de cada um (arredondado para baixo). */
export function refund(
  cost: readonly { item: string; qty: number }[],
  pct: number,
): { item: string; qty: number }[] {
  return cost.map(({ item, qty }) => ({ item, qty: Math.floor((qty * pct) / 100) })).filter((r) => r.qty > 0);
}

/**
 * Índice das peças colocadas por tile e por uid, com as regras de colocação.
 * Duas camadas: `floor` (fundações) e `top` (tudo o resto); cada tile tem no máximo uma de cada.
 */
export class StructureGrid {
  readonly site: BuildSite;
  private readonly defs: StructureDefs;
  private readonly byUid = new Map<number, StructureRecord>();
  private readonly floorAt = new Map<number, number>();
  private readonly topAt = new Map<number, number>();

  constructor(site: BuildSite, defs: StructureDefs, records: readonly StructureRecord[] = []) {
    this.site = site;
    this.defs = defs;
    for (const record of records) this.add(record);
  }

  get(uid: number): StructureRecord | undefined {
    return this.byUid.get(uid);
  }

  all(): IterableIterator<StructureRecord> {
    return this.byUid.values();
  }

  /** Tiles (índices) ocupados por uma peça em (tx, ty); null se sair do mapa. */
  tiles(def: StructureDef, tx: number, ty: number): number[] | null {
    const { width, height } = this.site;
    if (tx < 0 || ty < 0 || tx + def.size.width > width || ty + def.size.height > height) return null;
    const tiles: number[] = [];
    for (let y = ty; y < ty + def.size.height; y++) {
      for (let x = tx; x < tx + def.size.width; x++) tiles.push(y * width + x);
    }
    return tiles;
  }

  add(record: StructureRecord): void {
    const def = this.defs[record[1]];
    const tiles = def ? this.tiles(def, record[2], record[3]) : null;
    if (!def || !tiles) return; // peça desconhecida ou fora do mapa: ignora-se (não rebenta o save)
    this.byUid.set(record[0], record);
    const layer = def.layer === 'floor' ? this.floorAt : this.topAt;
    for (const tile of tiles) layer.set(tile, record[0]);
  }

  remove(uid: number): void {
    const record = this.byUid.get(uid);
    if (!record) return;
    this.byUid.delete(uid);
    for (const layer of [this.floorAt, this.topAt]) {
      for (const [tile, owner] of layer) if (owner === uid) layer.delete(tile);
    }
  }

  /** Peças no tile (tx, ty). */
  at(tx: number, ty: number): { floor?: StructureRecord; top?: StructureRecord } {
    const tile = ty * this.site.width + tx;
    const floor = this.floorAt.get(tile);
    const top = this.topAt.get(tile);
    return {
      ...(floor === undefined ? {} : { floor: this.byUid.get(floor) }),
      ...(top === undefined ? {} : { top: this.byUid.get(top) }),
    };
  }

  /** Há alguma peça (de qualquer camada) num destes tiles? */
  covers(tiles: readonly number[]): boolean {
    return tiles.some((tile) => this.floorAt.has(tile) || this.topAt.has(tile));
  }

  /** Há fundação no tile? (peça de chão, ou chão construído do próprio mapa). */
  isFoundation(tile: number): boolean {
    return this.floorAt.has(tile) || this.site.floor[tile] === true;
  }

  /**
   * Pode-se pôr a peça `id` em (tx, ty)? (sem contar com os materiais)
   * @param player caixa dos pés do jogador: uma peça sólida não pode ficar em cima dele.
   * @param occupied tiles ocupados agora por outras coisas (ex.: recursos por apanhar).
   */
  placementProblem(
    id: string,
    tx: number,
    ty: number,
    player: Rect | null,
    occupied: (tile: number) => boolean = () => false,
  ): BuildProblem | null {
    const def = this.defs[id];
    if (!def) return 'unknown';
    const tiles = this.tiles(def, tx, ty);
    if (!tiles) return 'out_of_bounds';
    const collision = structureCollision(def, tx, ty, this.site.tileSize);
    for (const tile of tiles) {
      if (this.site.solid[tile] === true || this.site.blocked.has(tile) || occupied(tile)) return 'blocked';
      if (collision && this.site.reserved.has(tile)) return 'blocked';
    }
    if (def.layer === 'floor') {
      if (tiles.some((tile) => this.isFoundation(tile))) return 'occupied';
    } else {
      if (tiles.some((tile) => this.topAt.has(tile))) return 'occupied';
      if (def.needsFoundation && !tiles.every((tile) => this.isFoundation(tile))) return 'needs_foundation';
    }
    if (collision && player && overlaps(collision, player)) return 'player';
    return null;
  }

  /** Peça a demolir no tile: primeiro a de cima, depois a fundação. */
  demolishTarget(tx: number, ty: number): StructureRecord | null {
    const { floor, top } = this.at(tx, ty);
    return top ?? floor ?? null;
  }

  /** Uma fundação com peças em cima não se pode tirar (primeiro o que está por cima). */
  supportsSomething(uid: number): boolean {
    const record = this.byUid.get(uid);
    const def = record ? this.defs[record[1]] : undefined;
    if (!record || def?.layer !== 'floor') return false;
    const tiles = this.tiles(def, record[2], record[3]) ?? [];
    return tiles.some((tile) => {
      const top = this.topAt.get(tile);
      const topDef = top === undefined ? undefined : this.defs[this.byUid.get(top)?.[1] ?? ''];
      return topDef?.needsFoundation === true;
    });
  }
}

const FACING_STEP: Readonly<Record<string, readonly [number, number]>> = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Tile (canto superior esquerdo) onde fica uma peça de `size` tiles posta à frente do jogador,
 * encostada ao tile onde ele está e centrada na direção perpendicular.
 */
export function tileInFront(
  feet: Vec2,
  facing: string,
  size: { width: number; height: number },
  tileSize: number,
): { tx: number; ty: number } {
  const px = Math.floor(feet.x / tileSize);
  const py = Math.floor((feet.y - 1) / tileSize); // os pés estão na base do tile
  const [dx, dy] = FACING_STEP[facing] ?? [0, 1];
  const centerX = px - Math.floor((size.width - 1) / 2);
  const centerY = py - Math.floor((size.height - 1) / 2);
  if (dx > 0) return { tx: px + 1, ty: centerY };
  if (dx < 0) return { tx: px - size.width, ty: centerY };
  if (dy < 0) return { tx: centerX, ty: py - size.height };
  return { tx: centerX, ty: py + 1 };
}
