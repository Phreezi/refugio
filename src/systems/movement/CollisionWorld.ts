import type { ResourceDefs } from '../../data/types';
import type { ZoneMap } from '../../world/zoneMap';
import { footprintRect, overlaps, type Rect } from './geometry';

/**
 * Geometria sólida de uma zona: tiles da camada `collision`, caixas dos recursos e tudo o que
 * fica fora do mapa. Lógica pura (sem Phaser), para o movimento correr no passo fixo e ser testável.
 */
export class CollisionWorld {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: number;
  private readonly solid: readonly boolean[];
  private readonly obstacles: readonly Rect[];

  constructor(
    widthTiles: number,
    heightTiles: number,
    tileSize: number,
    solid: readonly boolean[],
    obstacles: readonly Rect[] = [],
  ) {
    if (solid.length !== widthTiles * heightTiles) {
      throw new Error('CollisionWorld: o tamanho de "solid" não corresponde ao mapa');
    }
    this.widthTiles = widthTiles;
    this.heightTiles = heightTiles;
    this.tileSize = tileSize;
    this.solid = solid;
    this.obstacles = obstacles;
  }

  static fromZone(map: ZoneMap, resources: ResourceDefs): CollisionWorld {
    const obstacles: Rect[] = [];
    for (const placement of map.resources) {
      const footprint = resources[placement.id]?.footprint;
      if (footprint) obstacles.push(footprintRect(placement, footprint));
    }
    return new CollisionWorld(map.width, map.height, map.tileSize, map.solid, obstacles);
  }

  get pixelWidth(): number {
    return this.widthTiles * this.tileSize;
  }

  get pixelHeight(): number {
    return this.heightTiles * this.tileSize;
  }

  /** Tile sólido? Fora do mapa conta como sólido. */
  isSolidTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.widthTiles || ty >= this.heightTiles) return true;
    return this.solid[ty * this.widthTiles + tx] === true;
  }

  /** Retângulos sólidos que se sobrepõem a `area`. */
  solidsIn(area: Rect): Rect[] {
    const size = this.tileSize;
    const found: Rect[] = [];
    const tx0 = Math.floor(area.x / size);
    const ty0 = Math.floor(area.y / size);
    const tx1 = Math.ceil((area.x + area.w) / size) - 1;
    const ty1 = Math.ceil((area.y + area.h) / size) - 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.isSolidTile(tx, ty)) found.push({ x: tx * size, y: ty * size, w: size, h: size });
      }
    }
    for (const obstacle of this.obstacles) {
      if (overlaps(obstacle, area)) found.push(obstacle);
    }
    return found;
  }

  blocks(area: Rect): boolean {
    return this.solidsIn(area).some((solid) => overlaps(solid, area));
  }
}
