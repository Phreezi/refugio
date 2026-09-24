// Migrações do save (CLAUDE.md §5.4, regra 4). MIGRATIONS[v] converte o estado da versão v
// para v + 1. Nunca alterar uma migração já publicada: acrescentar uma nova.

export type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // Exemplo para a primeira mudança de formato:
  // 1: (s) => ({ ...s, stats: { kills: 0, deaths: 0 } }),
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
