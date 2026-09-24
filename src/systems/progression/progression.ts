// Progressão (CLAUDE.md §7.1, §9.5), lógica pura: XP para subir de nível e o que cada nível
// desbloqueia. A curva é geométrica: do nível n para n+1 são precisos base × growth^(n−1) XP.

export interface XpCurve {
  base: number;
  growth: number;
}

/** XP para passar do nível `level` ao seguinte. */
export function xpToNext(level: number, curve: XpCurve): number {
  return Math.round(curve.base * curve.growth ** (level - 1));
}

/** XP total acumulado para chegar ao nível `level` (a partir do nível 1 com 0 XP). */
export function totalXpForLevel(level: number, curve: XpCurve): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l, curve);
  return total;
}

export interface Progress {
  level: number;
  /** XP dentro do nível atual (0 … xpToNext − 1). */
  xp: number;
}

/**
 * Soma XP e sobe os níveis que der (até `maxLevel`; no máximo o XP deixa de contar).
 * @returns os níveis a que se chegou (vazio se não subiu).
 */
export function addXp(progress: Progress, amount: number, curve: XpCurve, maxLevel: number): number[] {
  const reached: number[] = [];
  if (amount <= 0 || progress.level >= maxLevel) return reached;
  progress.xp += amount;
  while (progress.level < maxLevel && progress.xp >= xpToNext(progress.level, curve)) {
    progress.xp -= xpToNext(progress.level, curve);
    progress.level += 1;
    reached.push(progress.level);
  }
  if (progress.level >= maxLevel) progress.xp = 0;
  return reached;
}
