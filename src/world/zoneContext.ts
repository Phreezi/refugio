import type { ZoneContext } from '../core/Interaction';
import { CollisionWorld } from '../systems/movement/CollisionWorld';
import { content } from './content';
import { worldLinks } from './worldLayout';

/**
 * Contexto de uma zona para a lógica (mapa, colisões, definições). Cada chamada cria uma grelha
 * de colisões nova: a cena de jogo usa-o ao entrar numa zona e, no co-op, o anfitrião também
 * para o convidado quando este está noutra zona.
 */
export function buildZoneContext(zoneId: string): ZoneContext {
  const map = content.zoneMap(zoneId);
  const collision = CollisionWorld.fromZone(
    map,
    content.resources,
    content.props,
    content.stations,
    content.lootTables,
  );
  // Mundo contínuo (Etapa E): fora do mapa estão os tiles das zonas vizinhas.
  const links = worldLinks(content.world, zoneId, map.tileSize, (id) => content.zoneMap(id));
  if (links) collision.outside = links.outside;
  return {
    zoneId,
    map,
    collision,
    ...(links ? { neighborAt: links.neighborAt } : {}),
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
