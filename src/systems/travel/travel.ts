import type { Vec2 } from '../movement/geometry';

/** Distância (px) que se entra no mapa a partir da saída por onde se chega. */
const ARRIVAL_INSET = 28;

interface TravelMap {
  width: number;
  height: number;
  tileSize: number;
  playerSpawn: Vec2;
  exits: readonly { x: number; y: number; to: string | null }[];
}

/**
 * Onde o jogador aparece ao chegar a uma zona vindo de `from`: junto à saída que leva de volta
 * (um pouco para dentro do mapa, para não sair logo), ou no `player_spawn` se não houver.
 */
export function arrivalPoint(map: TravelMap, from: string): Vec2 {
  const exit = map.exits.find((e) => e.to === from);
  if (!exit) return { ...map.playerSpawn };
  const cx = (map.width * map.tileSize) / 2;
  const cy = (map.height * map.tileSize) / 2;
  const dx = cx - exit.x;
  const dy = cy - exit.y;
  // Entra na direção do eixo principal (as saídas estão nas bordas).
  if (Math.abs(dx) > Math.abs(dy)) return { x: exit.x + Math.sign(dx) * ARRIVAL_INSET, y: exit.y };
  return { x: exit.x, y: exit.y + Math.sign(dy) * ARRIVAL_INSET };
}
