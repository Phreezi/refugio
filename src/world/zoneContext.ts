import type { ZoneContext } from '../core/Interaction';
import { CollisionWorld } from '../systems/movement/CollisionWorld';
import { content } from './content';

/**
 * Contexto de uma zona para a lógica (mapa, colisões, definições). Cada chamada cria uma grelha
 * de colisões nova: a cena de jogo usa-o ao entrar numa zona e, no co-op, o anfitrião também
 * para o convidado quando este está noutra zona.
 */
export function buildZoneContext(zoneId: string): ZoneContext {
  const map = content.zoneMap(zoneId);
  return {
    zoneId,
    map,
    collision: CollisionWorld.fromZone(
      map,
      content.resources,
      content.props,
      content.stations,
      content.lootTables,
    ),
    items: content.items,
    resources: content.resources,
    props: content.props,
    stations: content.stations,
    structures: content.structures,
    lootTables: content.lootTables,
    nightEnemyMultiplier: content.zones[zoneId]?.nightEnemyMultiplier ?? 1,
    respawnDays: content.zones[zoneId]?.respawnDays ?? 1,
  };
}
