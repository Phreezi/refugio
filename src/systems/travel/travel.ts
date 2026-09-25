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

export interface TravelCost {
  hunger: number;
  thirst: number;
}

/** Pode pagar a viagem? Fica sempre com pelo menos 1 de fome e de sede (viajar nunca mata). */
export function canTravel(player: { hunger: number; thirst: number }, cost: TravelCost): boolean {
  // Viagens grátis (ir para casa, o Pinhal) fazem-se sempre, mesmo com fome ou sede a 0.
  if (cost.hunger <= 0 && cost.thirst <= 0) return true;
  return player.hunger > cost.hunger && player.thirst > cost.thirst;
}

/**
 * Onde o jogador aparece ao chegar a uma zona vindo de `from` (null = do mapa-mundo): junto à saída que leva de volta
 * (um pouco para dentro do mapa, para não sair logo), ou no `player_spawn` se não houver.
 */
export function arrivalPoint(map: TravelMap, from: string | null, via?: Vec2): Vec2 {
  // Pela saída indicada (voltar do mapa-mundo pelo mesmo sítio), senão pela que leva a `from`.
  const exit =
    (via ? map.exits.find((e) => e.x === via.x && e.y === via.y) : undefined) ??
    map.exits.find((e) => e.to === from);
  if (!exit) return { ...map.playerSpawn };
  const cx = (map.width * map.tileSize) / 2;
  const cy = (map.height * map.tileSize) / 2;
  const dx = cx - exit.x;
  const dy = cy - exit.y;
  // Entra na direção do eixo principal (as saídas estão nas bordas).
  if (Math.abs(dx) > Math.abs(dy)) return { x: exit.x + Math.sign(dx) * ARRIVAL_INSET, y: exit.y };
  return { x: exit.x, y: exit.y + Math.sign(dy) * ARRIVAL_INSET };
}
