// Migrações do save (CLAUDE.md §5.4, regra 4). MIGRATIONS[v] converte o estado da versão v
// para v + 1. Nunca alterar uma migração já publicada: acrescentar uma nova.

export type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

const emptySlots = (n: number): null[] => new Array<null>(n).fill(null);

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v1 → v2 (Fase 3): inventário, hotbar, baús, recursos apanhados por zona, estado do RNG.
  1: (s) => {
    const player = s.player as Record<string, unknown>;
    const world = s.world as Record<string, unknown>;
    return {
      ...s,
      player: { ...player, inventory: emptySlots(20), hotbar: emptySlots(4) },
      world: { ...world, rng: 1 },
      base: { chests: {} },
      zones: {},
    };
  },
  // v2 → v3 (Fase 4): filas e saídas das estações de crafting.
  2: (s) => ({ ...s, stations: {} }),
  // v3 → v4 (Fase 5): peças construídas. A fogueira e a bancada deixaram de estar no mapa da
  // base (objetos 90 e 91) e passam a ser peças, nos mesmos sítios, com as filas que tinham.
  3: (s) => {
    const base = s.base as Record<string, unknown>;
    const stations = { ...(s.stations as Record<string, unknown>) };
    const structures: [number, string, number, number, number, number][] = [];
    for (const [objectId, id, tx, ty] of [
      [90, 'campfire', 28, 24],
      [91, 'wood_bench', 20, 15],
    ] as const) {
      const uid = structures.length + 1;
      structures.push([uid, id, tx, ty, 0, 0]);
      const oldKey = `${id}_${String(objectId)}`;
      if (oldKey in stations) {
        stations[`${id}_s${String(uid)}`] = stations[oldKey];
        Reflect.deleteProperty(stations, oldKey);
      }
    }
    return { ...s, base: { ...base, structures, nextStructureId: structures.length + 1 }, stations };
  },
  // v4 → v5 (Fase 6): equipamento (6 slots) e mochilas no chão por zona.
  4: (s) => {
    const player = s.player as Record<string, unknown>;
    const zones: Record<string, unknown> = {};
    for (const [id, zone] of Object.entries(s.zones as Record<string, Record<string, unknown>>)) {
      zones[id] = { ...zone, bags: [] };
    }
    return { ...s, player: { ...player, equipment: emptySlots(6) }, zones };
  },
  // v5 → v6 (Fase 7): contentores com loot já abertos, por zona.
  5: (s) => {
    const zones: Record<string, unknown> = {};
    for (const [id, zone] of Object.entries(s.zones as Record<string, Record<string, unknown>>)) {
      zones[id] = { ...zone, loot: {} };
    }
    return { ...s, zones };
  },
  // v6 → v7 (Fase 8): nível, XP e receitas aprendidas. Quem já jogava começa no nível 3 (a
  // Quinta e o Lago, que já podia visitar, continuam abertos).
  6: (s) => {
    const player = s.player as Record<string, unknown>;
    return { ...s, player: { ...player, level: 3, xp: 0 }, unlocks: { recipes: [] } };
  },
  // v7 → v8 (Fase 9): canteiros da horta e peças que produzem sozinhas (ainda não havia nenhum).
  7: (s) => {
    const base = s.base as Record<string, unknown>;
    return { ...s, base: { ...base, crops: {}, produce: {} } };
  },
  // v8 → v9 (Fase 9): hordas opcionais (desligadas) e dano das peças.
  8: (s) => {
    const base = s.base as Record<string, unknown>;
    return {
      ...s,
      base: { ...base, damage: {} },
      settings: { hordes: false },
      horde: { at: 0, count: 0, active: false },
    };
  },
  // v9 → v10 (Fase 10): sangramento (ninguém estava a sangrar).
  9: (s) => {
    const player = s.player as Record<string, unknown>;
    return { ...s, player: { ...player, bleed: 0 } };
  },
  // v10 → v11 (Fase 10): bunker (checkpoint por piso) e chefes derrotados.
  10: (s) => ({ ...s, dungeons: {}, bosses: {} }),
  // v11 → v12 (Fase 11): estatísticas do jogador (começam a contar agora).
  11: (s) => ({
    ...s,
    stats: { kills: 0, deaths: 0, crafted: 0, gathered: 0, looted: 0, playTicks: 0 },
  }),
  // v12 → v13 (Fase 11): tutorial. Quem já jogava não precisa das dicas (ficam desligadas).
  12: (s) => ({ ...s, tutorial: { done: [], off: true } }),
  // v13 → v14 (Fase 12): aspeto da personagem (quem já jogava é o rapaz).
  13: (s) => {
    const player = s.player as Record<string, unknown>;
    return { ...s, player: { ...player, look: 'boy' } };
  },
  // v14 → v15: perícias de combate (começam do zero) e itens soltos no chão das zonas.
  14: (s) => {
    const player = s.player as Record<string, unknown>;
    const zones = (s.zones ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...s,
      player: { ...player, skills: {} },
      zones: Object.fromEntries(Object.entries(zones).map(([id, zone]) => [id, { ...zone, ground: [] }])),
    };
  },
  // v15 → v16: aljava (a munição passa a entrar na arma à distância quando se equipa).
  15: (s) => {
    const player = s.player as Record<string, unknown>;
    return { ...s, player: { ...player, quiver: [] } };
  },
  // v16 → v17: nome da personagem (jogos antigos ficam "Sobrevivente"; muda-se ao criar um novo).
  16: (s) => {
    const player = s.player as Record<string, unknown>;
    return { ...s, player: { ...player, name: 'Sobrevivente' } };
  },
  // v17 → v18: talentos (§7.15). Os pontos contam-se pelo nível, por isso quem já jogava fica
  // com todos os pontos dos níveis que tem para gastar.
  17: (s) => {
    const player = s.player as Record<string, unknown>;
    return { ...s, player: { ...player, talents: {} } };
  },
};

/** Aplica as migrações de `from` até `to`. Lança erro se faltar algum passo. */
export function migrate(
  state: unknown,
  from: number,
  to: number,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): unknown {
  let current = state as Record<string, unknown>;
  for (let version = from; version < to; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`Falta a migração do save ${String(version)} → ${String(version + 1)}`);
    current = step(current);
  }
  return current;
}
