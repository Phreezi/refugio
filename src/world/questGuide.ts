import type { QuestDef } from '../systems/quests/quests';
import { content } from './content';

// Seta da missão (pedido do jogador): para onde ir na missão ativa, em coordenadas do MUNDO
// contínuo (px). Pronta a entregar → o NPC que a recebe; senão, o primeiro objetivo por fazer:
// ir a uma zona (o meio dela), falar com alguém (o NPC), derrotar inimigos (a zona mais perto
// onde nascem). Recolher itens não tem sítio certo (a ajuda dos materiais diz onde há).

export interface WorldPoint {
  x: number;
  y: number;
}

/** Onde está o NPC (px do mundo), na primeira zona do mundo contínuo que o tenha. */
export function npcWorldPoint(npc: string): WorldPoint | null {
  for (const [zoneId] of Object.entries(content.zones)) {
    const rect = content.world.rect(zoneId);
    if (!rect) continue;
    const map = content.zoneMap(zoneId);
    const placement = map.npcs?.find((p) => p.id === npc);
    if (placement) return { x: rect.x * map.tileSize + placement.x, y: rect.y * map.tileSize + placement.y };
  }
  return null;
}

/** Meio de uma zona (px do mundo). */
export function zoneWorldPoint(zoneId: string): WorldPoint | null {
  const rect = content.world.rect(zoneId);
  if (!rect) return null;
  const tile = content.zoneMap(zoneId).tileSize;
  return { x: (rect.x + rect.w / 2) * tile, y: (rect.y + rect.h / 2) * tile };
}

/** Pontos (px do mundo) onde nasce o inimigo `enemy`, em todas as zonas do mundo contínuo. */
export function enemySpawnPoints(enemy: string): WorldPoint[] {
  const points: WorldPoint[] = [];
  for (const zoneId of Object.keys(content.zones)) {
    const rect = content.world.rect(zoneId);
    if (!rect) continue;
    const map = content.zoneMap(zoneId);
    for (const spawn of map.enemySpawns) {
      const group = content.enemyGroups[spawn.id];
      if (!group?.members.some((m) => m.enemy === enemy)) continue;
      points.push({ x: rect.x * map.tileSize + spawn.x, y: rect.y * map.tileSize + spawn.y });
    }
  }
  return points;
}

/**
 * Para onde aponta a seta da missão `quest` (px do mundo), a partir de `from` (o jogador, px do
 * mundo). @returns null se não houver sítio (ex.: recolher itens) ou se o objetivo for fora do
 * mundo contínuo (masmorras).
 */
export function questTarget(
  quest: QuestDef,
  progress: readonly [number, number][],
  ready: boolean,
  from: WorldPoint,
): WorldPoint | null {
  if (ready) return npcWorldPoint(quest.turnIn);
  for (const [i, goal] of quest.goals.entries()) {
    const [done, total] = progress[i] ?? [0, 1];
    if (done >= total) continue;
    if (goal.type === 'reach') return zoneWorldPoint(goal.zone);
    if (goal.type === 'talk') return npcWorldPoint(goal.npc);
    if (goal.type === 'kill') {
      const points = enemySpawnPoints(goal.enemy);
      let best: WorldPoint | null = null;
      for (const p of points)
        if (!best || Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y))
          best = p;
      return best;
    }
  }
  return null;
}

/** Inimigos a derrotar na missão (para as marcas por cima deles). */
export function questKillTargets(
  quest: QuestDef | undefined,
  progress: readonly [number, number][],
): Set<string> {
  const ids = new Set<string>();
  quest?.goals.forEach((goal, i) => {
    const [done, total] = progress[i] ?? [0, 1];
    if (goal.type === 'kill' && done < total) ids.add(goal.enemy);
  });
  return ids;
}
