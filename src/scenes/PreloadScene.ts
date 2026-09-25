import Phaser from 'phaser';
import type { AssetManifest } from '../assets/manifest';
import { paletteNumber } from '../assets/palette';
import { ensurePlaceholderTextures } from '../assets/placeholders';
import { TILE_SIZE, versioned, zoneMapKey } from '../config';
import enemiesJson from '../data/enemies.json';
import enemyGroupsJson from '../data/enemyGroups.json';
import itemsJson from '../data/items.json';
import lootTablesJson from '../data/lootTables.json';
import propsJson from '../data/props.json';
import recipesJson from '../data/recipes.json';
import stationsJson from '../data/stations.json';
import structuresJson from '../data/structures.json';
import zonesJson from '../data/zones.json';
import resourcesJson from '../data/resources.json';
import npcsJson from '../data/npcs.json';
import questsJson from '../data/quests.json';
import waystonesJson from '../data/waystones.json';
import { parseNpcs, parseQuests, parseWaystoneCosts } from '../systems/quests/quests';
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
  type ZoneDefs,
} from '../data/types';
import { getView, setupFixedCamera } from '../display/view';
import { t } from '../i18n';
import { Label } from '../ui/text';
import { content } from '../world/content';
import { BASE_FLOOR_TILES, BASE_TILES, BASE_TILESET_NAME, baseTileIndex } from '../world/tileset';
import { parseZoneMap } from '../world/zoneMap';
import { showFatalError } from '../ui/fatalError';
import { SceneKey } from './keys';

export interface PreloadSceneData {
  manifest: AssetManifest;
}

const BAR_WIDTH = 160;
const BAR_HEIGHT = 6;

/**
 * Carrega os ficheiros listados no manifest e, no fim, gera placeholders para
 * todas as chaves sem textura (sem ficheiro, 404, ou ficheiro inválido).
 */
export class PreloadScene extends Phaser.Scene {
  private manifest: AssetManifest | null = null;
  private zones: ZoneDefs | null = null;

  constructor() {
    super(SceneKey.Preload);
  }

  init(data: Partial<PreloadSceneData>): void {
    this.manifest = data.manifest ?? null;
  }

  preload(): void {
    setupFixedCamera(this.cameras.main);
    const { width, height } = getView();
    const x = Math.round((width - BAR_WIDTH) / 2);
    const y = Math.round(height / 2);
    new Label(
      this,
      Math.round(width / 2),
      y - 16,
      t('boot.loading'),
      { size: 8, color: 'parchment' },
      [0.5, 0],
    );
    this.add.rectangle(x, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber('shadow')).setOrigin(0);
    const bar = this.add.rectangle(x, y, 0, BAR_HEIGHT, paletteNumber('amber')).setOrigin(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => {
      bar.width = Math.round(BAR_WIDTH * progress);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[assets] "${file.key}" falhou (${file.src}) — a usar placeholder.`);
    });

    if (!this.manifest) return;
    this.load.setPath('assets/');
    for (const [key, entry] of Object.entries(this.manifest.assets)) {
      if (entry.file === undefined) continue;
      if (entry.type === 'image') this.load.image(key, versioned(entry.file));
      else
        this.load.spritesheet(key, versioned(entry.file), {
          frameWidth: entry.frameWidth,
          frameHeight: entry.frameHeight,
        });
    }
    // Os mapas de todas as zonas (são pequenos): o Phaser desenha-os e a lógica valida-os.
    this.zones = parseZones(zonesJson);
    for (const [zoneId, zone] of Object.entries(this.zones)) {
      this.load.tilemapTiledJSON(zoneMapKey(zoneId), versioned(zone.map));
    }
  }

  create(): void {
    try {
      if (!this.manifest) throw new Error('PreloadScene iniciada sem manifest.');
      const generated = ensurePlaceholderTextures(this.textures, this.manifest);
      this.loadContent(this.manifest);
      if (import.meta.env.DEV && generated.length > 0) {
        console.info(`[assets] ${String(generated.length)} placeholders gerados por código.`);
      }
      this.scene.start(SceneKey.MainMenu, {});
    } catch (error) {
      showFatalError(this, error);
    }
  }

  /** Valida o conteúdo data-driven (recursos, mapas) e deixa-o pronto para as cenas. */
  private loadContent(manifest: AssetManifest): void {
    const items = parseItems(itemsJson, Object.keys(manifest.assets));
    content.setItems(items);
    const resources = parseResources(resourcesJson, Object.keys(manifest.assets), Object.keys(items));
    content.setResources(resources);
    const props = parseProps(propsJson, Object.keys(manifest.assets));
    content.setProps(props);
    const stations = parseStations(stationsJson, Object.keys(manifest.assets));
    const recipes = parseRecipes(recipesJson, Object.keys(items), Object.keys(stations));
    content.setCrafting(stations, recipes);
    for (const [id, item] of Object.entries(items)) {
      if (item.teaches !== undefined && !recipes.some((r) => r.id === item.teaches))
        throw new Error(`items.json: "${id}" ensina uma receita que não existe (${item.teaches}).`);
    }
    content.setStructures(
      parseStructures(
        structuresJson,
        Object.keys(manifest.assets),
        Object.keys(items),
        Object.keys(stations),
      ),
    );

    const enemies = parseEnemies(enemiesJson, Object.keys(manifest.assets), Object.keys(items));
    const groups = parseEnemyGroups(enemyGroupsJson, Object.keys(enemies));
    content.setEnemies(enemies, groups);

    const lootTables = parseLootTables(lootTablesJson, Object.keys(manifest.assets), Object.keys(items));
    content.setLootTables(lootTables);

    const zones = this.zones ?? parseZones(zonesJson);
    content.setZones(zones);
    // NPCs, missões e postes a reparar (§7.18).
    const npcs = parseNpcs(npcsJson, Object.keys(manifest.assets), Object.keys(stations));
    content.setQuests(
      npcs,
      parseQuests(questsJson, {
        items: Object.keys(items),
        npcs: Object.keys(npcs),
        zones: Object.keys(zones),
        enemies: Object.keys(enemies),
      }),
      parseWaystoneCosts(waystonesJson, Object.keys(items), Object.keys(zones)),
    );
    for (const [zoneId, zone] of Object.entries(zones)) {
      const cached: unknown = this.cache.tilemap.get(zoneMapKey(zoneId));
      const data =
        typeof cached === 'object' && cached !== null && 'data' in cached ? cached.data : undefined;
      if (data === undefined) throw new Error(`Não foi possível carregar ${zone.map}.`);
      const map = parseZoneMap(
        data,
        {
          tileSize: TILE_SIZE,
          tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
          resourceIds: Object.keys(resources),
          propIds: Object.keys(props),
          stationIds: Object.keys(stations),
          floorTiles: { [BASE_TILESET_NAME]: BASE_FLOOR_TILES.map(baseTileIndex) },
          zoneIds: Object.keys(zones),
          enemyGroupIds: Object.keys(groups),
          lootTableIds: Object.keys(lootTables),
          npcIds: Object.keys(npcs),
        },
        zone.map,
      );
      content.setZoneMap(zoneId, map);
    }
  }
}
