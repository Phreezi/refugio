// Mundo contínuo (Etapa E, estilo Pokémon): cada zona com `world: [x, y]` em zones.json é um
// bloco num mapa único (coordenadas em tiles do canto superior esquerdo). Os blocos tocam-se
// pelas bordas: onde as duas bordas estão abertas passa-se de uma zona para a outra sem ecrã de
// viagem, e só se desenham as zonas perto do jogador. Módulo puro (também usado nos testes).

export interface ZoneRect {
  zoneId: string;
  /** Canto superior esquerdo e tamanho, em tiles do mundo. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldTile {
  zone: ZoneRect;
  /** Tile dentro da zona. */
  tx: number;
  ty: number;
}

export class WorldLayout {
  private readonly rects: ReadonlyMap<string, ZoneRect>;

  constructor(rects: Iterable<ZoneRect>) {
    this.rects = new Map([...rects].map((r) => [r.zoneId, r]));
  }

  /** O bloco de uma zona (undefined = fora do mundo contínuo: masmorras, eventos). */
  rect(zoneId: string): ZoneRect | undefined {
    return this.rects.get(zoneId);
  }

  all(): ZoneRect[] {
    return [...this.rects.values()];
  }

  /** A zona que tem o tile (x, y) do mundo, e o tile dentro dela. */
  at(x: number, y: number): WorldTile | undefined {
    for (const zone of this.rects.values()) {
      if (x >= zone.x && y >= zone.y && x < zone.x + zone.w && y < zone.y + zone.h)
        return { zone, tx: x - zone.x, ty: y - zone.y };
    }
    return undefined;
  }

  /** O tile (tx, ty) da zona `zoneId` (pode estar fora dela) visto no mundo. */
  resolve(zoneId: string, tx: number, ty: number): WorldTile | undefined {
    const from = this.rects.get(zoneId);
    return from ? this.at(from.x + tx, from.y + ty) : undefined;
  }

  /** Zonas a `margin` tiles ou menos do bloco de `zoneId` (as que lhe tocam contam; sem ela própria). */
  near(zoneId: string, margin: number): ZoneRect[] {
    const from = this.rects.get(zoneId);
    if (!from) return [];
    return this.all().filter(
      (r) =>
        r.zoneId !== zoneId &&
        r.x <= from.x + from.w + margin &&
        r.x + r.w >= from.x - margin &&
        r.y <= from.y + from.h + margin &&
        r.y + r.h >= from.y - margin,
    );
  }

  /** Blocos que se sobrepõem (erro nos dados). */
  overlaps(): string[] {
    const list = this.all();
    const problems: string[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a || !b) continue;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
          problems.push(`${a.zoneId} sobrepõe-se a ${b.zoneId}`);
      }
    }
    return problems;
  }
}

/** Monta o mundo a partir das zonas com `world` e do tamanho dos mapas. */
export function buildWorldLayout(
  zones: Readonly<Record<string, { world?: { x: number; y: number } }>>,
  size: (zoneId: string) => { width: number; height: number },
): WorldLayout {
  const rects: ZoneRect[] = [];
  for (const [zoneId, zone] of Object.entries(zones)) {
    if (!zone.world) continue;
    const { width, height } = size(zoneId);
    rects.push({ zoneId, x: zone.world.x, y: zone.world.y, w: width, h: height });
  }
  return new WorldLayout(rects);
}

/** O que a lógica de uma zona precisa do mundo contínuo (ver ZoneContext.neighborAt). */
export interface WorldLinks {
  /** Tile fora do mapa (coordenadas desta zona): sólido? (o da zona vizinha, ou sólido se nada) */
  outside: (tx: number, ty: number) => boolean;
  /** Ponto fora do mapa (px desta zona): a zona vizinha que o tem e o ponto nas coordenadas dela. */
  neighborAt: (x: number, y: number) => { zoneId: string; x: number; y: number } | null;
}

/** Ligações de `zoneId` às zonas vizinhas (null = não está no mundo contínuo). */
export function worldLinks(
  layout: WorldLayout,
  zoneId: string,
  tileSize: number,
  mapOf: (zoneId: string) => { width: number; solid: readonly boolean[] },
): WorldLinks | null {
  const rect = layout.rect(zoneId);
  if (!rect) return null;
  return {
    outside: (tx, ty) => {
      const hit = layout.resolve(zoneId, tx, ty);
      if (!hit) return true;
      const other = mapOf(hit.zone.zoneId);
      return other.solid[hit.ty * other.width + hit.tx] === true;
    },
    neighborAt: (x, y) => {
      const hit = layout.resolve(zoneId, Math.floor(x / tileSize), Math.floor(y / tileSize));
      if (!hit || hit.zone.zoneId === zoneId) return null;
      return {
        zoneId: hit.zone.zoneId,
        x: x + (rect.x - hit.zone.x) * tileSize,
        y: y + (rect.y - hit.zone.y) * tileSize,
      };
    },
  };
}
