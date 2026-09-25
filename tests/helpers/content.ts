import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/assets/manifest';
import { PALETTE_NAMES } from '../../src/assets/palette';
import enemies from '../../src/data/enemies.json';
import enemyGroups from '../../src/data/enemyGroups.json';
import items from '../../src/data/items.json';
import lootTables from '../../src/data/lootTables.json';
import props from '../../src/data/props.json';
import recipes from '../../src/data/recipes.json';
import resources from '../../src/data/resources.json';
import stations from '../../src/data/stations.json';
import structures from '../../src/data/structures.json';
import zones from '../../src/data/zones.json';
import npcs from '../../src/data/npcs.json';
import quests from '../../src/data/quests.json';
import waystones from '../../src/data/waystones.json';
import { parseNpcs, parseQuests, parseWaystoneCosts } from '../../src/systems/quests/quests';
import {
  parseEnemies,
  parseEnemyGroups,
  parseItems,
  parseLootTables,
  parseProps,
  parseRecipes,
  parseResources,
  parseStations,
  parseStructures,
  parseZones,
} from '../../src/data/types';

/** Conteúdo real do jogo (JSON validados), para testes de integração da lógica. */
export function loadContent() {
  const url = new URL('../../public/assets/manifest.json', import.meta.url);
  const manifest = parseManifest(JSON.parse(readFileSync(url, 'utf8')), PALETTE_NAMES);
  const keys = Object.keys(manifest.assets);
  const itemDefs = parseItems(items, keys);
  const stationDefs = parseStations(stations, keys);
  const enemyDefs = parseEnemies(enemies, keys, Object.keys(itemDefs));
  const zoneDefs = parseZones(zones);
  const npcDefs = parseNpcs(npcs, keys, Object.keys(stationDefs));
  return {
    npcs: npcDefs,
    quests: parseQuests(quests, {
      items: Object.keys(itemDefs),
      npcs: Object.keys(npcDefs),
      zones: Object.keys(zoneDefs),
      enemies: Object.keys(enemyDefs),
    }),
    waystones: parseWaystoneCosts(waystones, Object.keys(itemDefs), Object.keys(zoneDefs)),
    items: itemDefs,
    resources: parseResources(resources, keys, Object.keys(itemDefs)),
    props: parseProps(props, keys),
    stations: stationDefs,
    recipes: parseRecipes(recipes, Object.keys(itemDefs), Object.keys(stationDefs)),
    structures: parseStructures(structures, keys, Object.keys(itemDefs), Object.keys(stationDefs)),
    enemies: enemyDefs,
    zones: zoneDefs,
    lootTables: parseLootTables(lootTables, keys, Object.keys(itemDefs)),
    enemyGroups: parseEnemyGroups(enemyGroups, Object.keys(enemyDefs)),
  };
}
