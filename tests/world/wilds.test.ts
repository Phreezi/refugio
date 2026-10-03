import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import wildsJson from '../../src/data/wilds.json';
import { tKey } from '../../src/i18n';
import { content } from '../../src/world/content';
import { BASE_TILES, BASE_TILESET_NAME, baseTileIndex, type BaseTile } from '../../src/world/tileset';
import { installWilds } from '../../src/world/wildContent';
import {
  generateWild,
  levelAt,
  parseWildPlan,
  planWilds,
  type Rect,
  type WildZone,
} from '../../src/world/wilds';
import { WorldLayout } from '../../src/world/worldLayout';
import { parseZoneMap, type ZoneMapRules } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const gid = (tile: string): number => baseTileIndex(tile as BaseTile) + 1;
const TILESET = { name: BASE_TILESET_NAME, image: '../tiles/base_tiles.png', count: BASE_TILES.length };

function rules(): ZoneMapRules {
  const c = loadContent();
  return {
    tileSize: 16,
    tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
    resourceIds: Object.keys(c.resources),
    propIds: Object.keys(c.props),
    stationIds: Object.keys(c.stations),
    lootTableIds: Object.keys(c.lootTables),
    enemyGroupIds: Object.keys(c.enemyGroups),
    minExits: 0,
  };
}

const HAND: Rect[] = [
  { zoneId: 'zone_base', x: 0, y: 0, w: 48, h: 48 },
  { zoneId: 'zone_route_1', x: 48, y: -16, w: 20, h: 64 },
];

describe('planWilds', () => {
  it('é determinista, não se sobrepõe às zonas à mão e as passagens vêm aos pares', () => {
    const a = planWilds(HAND, 7);
    const b = planWilds(HAND, 7);
    expect(a).toEqual(b);
    expect(a.zones.length).toBeGreaterThan(50);
    const layout = new WorldLayout([
      ...HAND,
      ...a.zones.map((z) => ({ zoneId: z.id, x: z.x, y: z.y, w: z.w, h: z.h })),
    ]);
    expect(layout.overlaps()).toEqual([]);
    // Cada passagem de uma zona selvagem tem a do outro lado (mesmo ponto da borda).
    const edge = (z: Omit<Rect, 'zoneId'>, [side, at]: readonly [string, number, number]): string =>
      side === 'n'
        ? `h${String(z.x + at)},${String(z.y)}`
        : side === 's'
          ? `h${String(z.x + at)},${String(z.y + z.h)}`
          : side === 'w'
            ? `v${String(z.x)},${String(z.y + at)}`
            : `v${String(z.x + z.w)},${String(z.y + at)}`;
    const count = new Map<string, number>();
    for (const z of a.zones) for (const o of z.open) count.set(edge(z, o), (count.get(edge(z, o)) ?? 0) + 1);
    for (const h of a.hand) {
      const r = HAND.find((x) => x.zoneId === h.zone);
      if (r) count.set(edge(r, h.open), (count.get(edge(r, h.open)) ?? 0) + 1);
    }
    expect([...count.values()].every((n) => n === 2)).toBe(true);
  });

  it('o nível cresce com a distância a casa', () => {
    expect(levelAt(24, 24)).toBe(1);
    expect(levelAt(24, -600)).toBeGreaterThan(levelAt(24, -200));
  });
});

/** Tiles livres a que se chega a partir de (x, y), em 4 direções. */
function reachable(
  width: number,
  height: number,
  solid: readonly boolean[],
  x: number,
  y: number,
): Set<number> {
  const seen = new Set([y * width + x]);
  const queue = [[x, y] as const];
  while (queue.length > 0) {
    const [cx, cy] = queue.pop() ?? [0, 0];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const i = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(i) || solid[i]) continue;
      seen.add(i);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

describe('generateWild', () => {
  const plan = parseWildPlan(wildsJson);
  const sample: WildZone[] = [
    ...plan.zones.filter((z) => z.village).slice(0, 3),
    ...['meadow', 'forest', 'hills', 'marsh'].flatMap((b) =>
      plan.zones.filter((z) => z.biome === b && !z.village).slice(0, 2),
    ),
  ];

  it.each(sample.map((z) => [z.id, z] as const))(
    '%s: mapa válido, igual de cada vez, passagens ligadas à praça',
    (_id, zone) => {
      const json = generateWild(zone, gid, TILESET);
      expect(generateWild(zone, gid, TILESET)).toEqual(json);
      const npcIds = zone.village ? [`w${zone.id.slice(7)}_elder`, `w${zone.id.slice(7)}_trader`] : [];
      const map = parseZoneMap(json, { ...rules(), npcIds }, zone.id);
      expect(map.width).toBe(zone.w);
      expect(map.height).toBe(zone.h);
      const spawn = { x: Math.floor(map.playerSpawn.x / 16), y: Math.floor(map.playerSpawn.y / 16) };
      const seen = reachable(map.width, map.height, map.solid, spawn.x, spawn.y);
      for (const [side, at, width] of zone.open) {
        for (let k = 0; k < width; k++) {
          const [x, y] =
            side === 'n'
              ? [at + k, 0]
              : side === 's'
                ? [at + k, zone.h - 1]
                : side === 'w'
                  ? [0, at + k]
                  : [zone.w - 1, at + k];
          expect(seen.has(y * zone.w + x)).toBe(true);
        }
      }
      if (zone.village) expect(map.npcs?.length).toBe(2);
    },
  );
});

describe('wilds.json (o mundo do jogo)', () => {
  const plan = parseWildPlan(wildsJson);
  it('é cerca de 20× maior do que o mundo desenhado à mão, com aldeias', () => {
    const zones = JSON.parse(
      readFileSync(new URL('../../src/data/zones.json', import.meta.url), 'utf8'),
    ) as Record<string, { map?: string; world?: unknown }>;
    let hand = 0;
    for (const zone of Object.values(zones)) {
      if (!zone.world || !zone.map) continue;
      const map = JSON.parse(
        readFileSync(new URL(`../../public/assets/${zone.map}`, import.meta.url), 'utf8'),
      ) as {
        width: number;
        height: number;
      };
      hand += map.width * map.height;
    }
    const wild = plan.zones.reduce((sum, z) => sum + z.w * z.h, 0);
    expect((wild + hand) / hand).toBeGreaterThan(18);
    expect(plan.zones.filter((z) => z.village).length).toBeGreaterThan(15);
  });

  it('installWilds: zonas, NPCs das aldeias, missões em cadeia e textos', () => {
    const c = loadContent();
    content.setZones(c.zones);
    content.setQuests(c.npcs, c.quests, c.waystones);
    const handRules = { ...rules(), npcIds: Object.keys(c.npcs), minExits: 1 };
    for (const [id, zone] of Object.entries(c.zones)) {
      const file = new URL(`../../public/assets/${zone.map}`, import.meta.url);
      content.setZoneMap(id, parseZoneMap(JSON.parse(readFileSync(file, 'utf8')), handRules, zone.map));
    }
    installWilds(plan, { ...rules(), npcIds: Object.keys(c.npcs) });
    expect(content.isWild('zone_w_0')).toBe(true);
    expect(content.zones.zone_w_0?.hidden).toBe(true);
    expect(tKey('zone.w_0')).not.toBe('zone.w_0');
    const villages = plan.zones
      .filter((z) => z.village)
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
    const first = villages[0];
    const second = villages[1];
    if (!first || !second) throw new Error('sem aldeias');
    const elder = `w${first.id.slice(7)}_elder`;
    expect(content.npcs[elder]?.role).toBe('quests');
    expect(content.npcHome(elder)?.zoneId).toBe(first.id);
    const chain = content.quests.filter((q) => q.giver === elder);
    expect(chain.map((q) => q.goals[0]?.type)).toEqual(['kill', 'collect', 'talk']);
    expect(chain[2]?.turnIn).toBe(`w${second.id.slice(7)}_elder`);
    expect(tKey(`quest.${chain[0]?.id ?? ''}.text`)).not.toContain('quest.');
    // O mapa gera-se quando é preciso e o mundo encontra-o pelas coordenadas.
    const map = content.zoneMap(first.id);
    expect(map.npcs?.map((n) => n.id)).toContain(elder);
    expect(content.world.at(first.x + 1, first.y + 1)?.zone.zoneId).toBe(first.id);
  });
});
