import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/assets/manifest';
import { PALETTE_NAMES } from '../../src/assets/palette';
import enemies from '../../src/data/enemies.json';
import enemyGroups from '../../src/data/enemyGroups.json';
import items from '../../src/data/items.json';
import props from '../../src/data/props.json';
import recipes from '../../src/data/recipes.json';
import resources from '../../src/data/resources.json';
import stations from '../../src/data/stations.json';
import structures from '../../src/data/structures.json';
import {
  parseEnemies,
  parseEnemyGroups,
  parseItems,
  parseProps,
  parseRecipes,
  parseResources,
  parseStations,
  parseStructures,
} from '../../src/data/types';

/** Conteúdo real do jogo (JSON validados), para testes de integração da lógica. */
export function loadContent() {
  const url = new URL('../../public/assets/manifest.json', import.meta.url);
  const manifest = parseManifest(JSON.parse(readFileSync(url, 'utf8')), PALETTE_NAMES);
  const keys = Object.keys(manifest.assets);
  const itemDefs = parseItems(items, keys);
  const stationDefs = parseStations(stations, keys);
  const enemyDefs = parseEnemies(enemies, keys, Object.keys(itemDefs));
  return {
    items: itemDefs,
    resources: parseResources(resources, keys, Object.keys(itemDefs)),
    props: parseProps(props, keys),
    stations: stationDefs,
    recipes: parseRecipes(recipes, Object.keys(itemDefs), Object.keys(stationDefs)),
    structures: parseStructures(structures, keys, Object.keys(itemDefs), Object.keys(stationDefs)),
    enemies: enemyDefs,
    enemyGroups: parseEnemyGroups(enemyGroups, Object.keys(enemyDefs)),
  };
}
