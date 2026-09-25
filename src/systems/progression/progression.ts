// Progressão (CLAUDE.md §7.1, §9.5), lógica pura: XP para subir de nível e o que cada nível
// desbloqueia. A curva é geométrica até `softCapLevel` (do nível n para n+1 são precisos
// base × growth^(n−1) XP) e daí em diante cresce devagar (+`lateGrowthPct`% por nível), para
// haver sempre um nível seguinte ao alcance (um jogo sem fim).

export interface XpCurve {
  base: number;
  growth: number;
  /** A partir deste nível o crescimento passa a linear. */
  softCapLevel?: number;
  /** % a mais por nível acima de `softCapLevel`. */
  lateGrowthPct?: number;
}

/** XP para passar do nível `level` ao seguinte. */
export function xpToNext(level: number, curve: XpCurve): number {
  const cap = curve.softCapLevel ?? Infinity;
  const geometric = curve.base * curve.growth ** (Math.min(level, cap) - 1);
  const late = level > cap ? 1 + ((curve.lateGrowthPct ?? 0) / 100) * (level - cap) : 1;
  return Math.round(geometric * late);
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
