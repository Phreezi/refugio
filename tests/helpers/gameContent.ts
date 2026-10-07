import { readFileSync } from 'node:fs';
import wildsJson from '../../src/data/wilds.json';
import { content } from '../../src/world/content';
import {
  BASE_FLOOR_TILES,
  BASE_LEDGE_TILES,
  BASE_TILES,
  BASE_TILESET_NAME,
  baseTileIndex,
  URBAN_TILES_COUNT,
  URBAN_TILESET_NAME,
} from '../../src/world/tileset';
import { installWilds } from '../../src/world/wildContent';
import { parseWildPlan } from '../../src/world/wilds';
import { parseZoneMap, type ZoneMapRules } from '../../src/world/zoneMap';
import { loadContent } from './content';

let installed = false;

/**
 * Enche o `content` global como o PreloadScene (JSON, mapas desenhados à mão e o mundo
 * selvagem), para testar a lógica com o jogo inteiro (`buildZoneContext`, mundo contínuo).
 */
export function installGameContent(): void {
  if (installed) return;
  installed = true;
  const c = loadContent();
  content.setItems(c.items);
  content.setResources(c.resources);
  content.setProps(c.props);
  content.setCrafting(c.stations, c.recipes);
  content.setStructures(c.structures);
  content.setEnemies(c.enemies, c.enemyGroups);
  content.setLootTables(c.lootTables);
  content.setZones(c.zones);
  content.setQuests(c.npcs, c.quests, c.waystones);
  const rules: ZoneMapRules = {
    tileSize: 16,
    tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length, [URBAN_TILESET_NAME]: URBAN_TILES_COUNT },
    resourceIds: Object.keys(c.resources),
    propIds: Object.keys(c.props),
    stationIds: Object.keys(c.stations),
    floorTiles: { [BASE_TILESET_NAME]: BASE_FLOOR_TILES.map(baseTileIndex) },
    ledgeTiles: { [BASE_TILESET_NAME]: BASE_LEDGE_TILES.map(baseTileIndex) },
    zoneIds: Object.keys(c.zones),
    enemyGroupIds: Object.keys(c.enemyGroups),
    lootTableIds: Object.keys(c.lootTables),
    npcIds: Object.keys(c.npcs),
  };
  for (const [zoneId, zone] of Object.entries(c.zones)) {
    const url = new URL(`../../public/assets/${zone.map}`, import.meta.url);
    content.setZoneMap(zoneId, parseZoneMap(JSON.parse(readFileSync(url, 'utf8')), rules, zone.map));
  }
  installWilds(parseWildPlan(wildsJson), rules);
}
