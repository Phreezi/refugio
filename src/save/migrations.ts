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
