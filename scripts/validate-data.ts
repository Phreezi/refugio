// Valida os dados do jogo e as referências cruzadas entre eles (CLAUDE.md §13).
// Corre em Node com type stripping nativo: `npm run validate-data`. Sai com código 1 se falhar.
// Cada fase acrescenta aqui as suas verificações (items, recipes, lootTables, zones…).

import { readdirSync, readFileSync } from 'node:fs';
import { ManifestError, parseManifest } from '../src/assets/manifest.ts';
import {
  DataError,
  HORDE_GROUP,
  HORDE_REWARD_TABLE,
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
  type EnemyGroups,
  type ItemDefs,
  type ZoneDefs,
  type PropDefs,
  type StationDefs,
  type ResourceDefs,
} from '../src/data/types.ts';
import { BASE_FLOOR_TILES, BASE_TILES, BASE_TILESET_NAME, baseTileIndex } from '../src/world/tileset.ts';
import { ZoneMapError, parseZoneMap, type ZoneMap } from '../src/world/zoneMap.ts';
import { buildWorldLayout } from '../src/world/worldLayout.ts';
import { QuestDataError, parseNpcs, parseQuests, parseWaystoneCosts } from '../src/systems/quests/quests.ts';
import { parseTalents } from '../src/systems/progression/talents.ts';

const ROOT = new URL('../', import.meta.url);
const PALETTE_SIZE = 32;
/** Igual a TILE_SIZE em src/config.ts (os scripts não importam módulos com dependências). */
const TILE_SIZE = 16;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, ROOT), 'utf8'));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

/** Existe com estas maiúsculas/minúsculas exatas? (o Windows ignora-as; o GitHub Pages não). */
function existsExactCase(relativePath: string, baseDir: string): boolean {
  let dir = new URL(baseDir, ROOT);
  const parts = relativePath.split('/');
  for (const [i, part] of parts.entries()) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    if (!entries.includes(part)) return false;
    dir = new URL(i < parts.length - 1 ? `${part}/` : part, dir);
  }
  return true;
}

function checkPalette(): string[] {
  const palette = readJson('src/assets/palette.json');
  if (!isStringRecord(palette)) return ['palette.json: tem de ser um objeto nome → "#rrggbb"'];
  const problems: string[] = [];
  const names = Object.keys(palette);
  if (names.length !== PALETTE_SIZE) {
    problems.push(`palette.json: tem ${String(names.length)} cores, devem ser ${String(PALETTE_SIZE)}`);
  }
  for (const [name, hex] of Object.entries(palette)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) problems.push(`palette.json: "${name}" não está em snake_case`);
    if (!/^#[0-9a-f]{6}$/.test(hex))
      problems.push(`palette.json: ${name} = "${hex}" (esperado #rrggbb minúsculo)`);
  }
  const values = Object.values(palette);
  if (new Set(values).size !== values.length) problems.push('palette.json: há cores repetidas');
  if (!existsExactCase('palette.png', 'public/assets/')) {
    problems.push('public/assets/palette.png em falta — correr `npm run palette`');
  }
  return problems;
}

function manifestKeys(): string[] {
  const palette = readJson('src/assets/palette.json');
  const colors = isStringRecord(palette) ? Object.keys(palette) : [];
  try {
    return Object.keys(parseManifest(readJson('public/assets/manifest.json'), colors).assets);
  } catch {
    return []; // os problemas do manifest são reportados por checkManifest
  }
}

function checkManifest(): string[] {
  const palette = readJson('src/assets/palette.json');
  const colors = isStringRecord(palette) ? Object.keys(palette) : [];
  let manifest;
  try {
    manifest = parseManifest(readJson('public/assets/manifest.json'), colors);
  } catch (error) {
    if (error instanceof ManifestError) return error.problems.map((p) => `manifest.json: ${p}`);
    throw error;
  }
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(manifest.assets)) {
    if (entry.file !== undefined && !existsExactCase(entry.file, 'public/assets/')) {
      problems.push(`manifest.json: assets.${key}.file "${entry.file}" não existe em public/assets/`);
    }
  }
  return problems;
}

function checkBalance(): string[] {
  const problems: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0)
        problems.push(`balance.json: ${path} = ${String(value)} (tem de ser > 0)`);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
    } else {
      problems.push(`balance.json: ${path || 'raiz'} tem de ser um número ou um objeto de números`);
    }
  };
  walk(readJson('src/data/balance.json'), '');
  return problems;
}

function loadItems(): ItemDefs | string[] {
  try {
    return parseItems(readJson('src/data/items.json'), manifestKeys());
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `items.json: ${p}`);
    throw error;
  }
}

/** Itens válidos e com nome traduzido em todas as línguas. */
function checkItems(): string[] {
  const items = loadItems();
  if (Array.isArray(items)) return items;
  const problems: string[] = [];
  for (const lang of ['pt-PT', 'en']) {
    const dict = readJson(`src/i18n/${lang}.json`);
    if (!isStringRecord(dict)) continue;
    for (const [id, item] of Object.entries(items)) {
      if (!(item.name in dict))
        problems.push(`items.json: "${id}" sem nome em i18n/${lang}.json (${item.name})`);
    }
  }
  return problems;
}

function loadResources(): ResourceDefs | string[] {
  const items = loadItems();
  if (Array.isArray(items)) return ['items.json inválido (ver acima)'];
  try {
    return parseResources(readJson('src/data/resources.json'), manifestKeys(), Object.keys(items));
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `resources.json: ${p}`);
    throw error;
  }
}

function checkResources(): string[] {
  const resources = loadResources();
  return Array.isArray(resources) ? resources : [];
}

function loadProps(): PropDefs | string[] {
  try {
    return parseProps(readJson('src/data/props.json'), manifestKeys());
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `props.json: ${p}`);
    throw error;
  }
}

function loadStations(): StationDefs | string[] {
  try {
    return parseStations(readJson('src/data/stations.json'), manifestKeys());
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `stations.json: ${p}`);
    throw error;
  }
}

/** Estações e receitas (ingredientes, resultados e estações existem; tempos válidos). */
function checkCrafting(): string[] {
  const items = loadItems();
  const stations = loadStations();
  if (Array.isArray(items)) return ['items.json inválido (ver acima)'];
  if (Array.isArray(stations)) return stations;
  try {
    const recipes = parseRecipes(
      readJson('src/data/recipes.json'),
      Object.keys(items),
      Object.keys(stations),
    );
    return Object.entries(items)
      .filter(([, item]) => item.teaches !== undefined && !recipes.some((r) => r.id === item.teaches))
      .map(([id, item]) => `items.json: "${id}" ensina uma receita que não existe (${String(item.teaches)})`);
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `recipes.json: ${p}`);
    throw error;
  }
}

/** Peças de construção (sprites, custos, estações) com nome traduzido em todas as línguas. */
function checkStructures(): string[] {
  const items = loadItems();
  const stations = loadStations();
  if (Array.isArray(items)) return ['items.json inválido (ver acima)'];
  if (Array.isArray(stations)) return ['stations.json inválido (ver acima)'];
  let defs;
  try {
    defs = parseStructures(
      readJson('src/data/structures.json'),
      manifestKeys(),
      Object.keys(items),
      Object.keys(stations),
    );
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `structures.json: ${p}`);
    throw error;
  }
  const problems: string[] = [];
  for (const lang of ['pt-PT', 'en']) {
    const dict = readJson(`src/i18n/${lang}.json`);
    if (!isStringRecord(dict)) continue;
    for (const id of Object.keys(defs)) {
      if (!(`structure.${id}` in dict))
        problems.push(`structures.json: "${id}" sem nome em i18n/${lang}.json (structure.${id})`);
    }
  }
  return problems;
}

function checkProps(): string[] {
  const props = loadProps();
  return Array.isArray(props) ? props : [];
}

function loadEnemyGroups(): EnemyGroups | string[] {
  const items = loadItems();
  if (Array.isArray(items)) return ['items.json inválido (ver acima)'];
  try {
    const enemies = parseEnemies(readJson('src/data/enemies.json'), manifestKeys(), Object.keys(items));
    return parseEnemyGroups(readJson('src/data/enemyGroups.json'), Object.keys(enemies));
  } catch (error) {
    if (error instanceof DataError) return [...error.problems];
    throw error;
  }
}

/** Inimigos (sprites, drops) e grupos, com nome traduzido em todas as línguas. */
function checkEnemies(): string[] {
  const groups = loadEnemyGroups();
  if (Array.isArray(groups)) return groups.map((p) => `enemies: ${p}`);
  const problems: string[] = [];
  if (!(HORDE_GROUP in groups)) problems.push(`enemyGroups.json: falta o grupo "${HORDE_GROUP}" (hordas)`);
  const ids = Object.keys(readJson('src/data/enemies.json') as object).filter((id) => id !== '$comment');
  for (const lang of ['pt-PT', 'en']) {
    const dict = readJson(`src/i18n/${lang}.json`);
    if (!isStringRecord(dict)) continue;
    for (const id of ids) {
      if (!(`enemy.${id}` in dict)) problems.push(`enemies.json: "${id}" sem nome em i18n/${lang}.json`);
    }
  }
  return problems;
}

function loadZones(): ZoneDefs | string[] {
  try {
    return parseZones(readJson('src/data/zones.json'));
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `zones.json: ${p}`);
    throw error;
  }
}

function loadNpcIds(): string[] | null {
  const stations = loadStations();
  if (Array.isArray(stations)) return null;
  try {
    return Object.keys(parseNpcs(readJson('src/data/npcs.json'), manifestKeys(), Object.keys(stations)));
  } catch {
    return null;
  }
}

/** NPCs, missões e postes a reparar (§7.18), com nomes e textos em todas as línguas. */
function checkQuests(): string[] {
  const items = loadItems();
  const stations = loadStations();
  const zones = loadZones();
  if (Array.isArray(items) || Array.isArray(stations) || Array.isArray(zones))
    return ['dados base inválidos'];
  const enemies = Object.keys(readJson('src/data/enemies.json') as object).filter((id) => id !== '$comment');
  const problems: string[] = [];
  try {
    const npcs = parseNpcs(readJson('src/data/npcs.json'), manifestKeys(), Object.keys(stations));
    const quests = parseQuests(readJson('src/data/quests.json'), {
      items: Object.keys(items),
      npcs: Object.keys(npcs),
      zones: Object.keys(zones),
      enemies,
    });
    parseWaystoneCosts(readJson('src/data/waystones.json'), Object.keys(items), Object.keys(zones));
    for (const lang of ['pt-PT', 'en']) {
      const dict = readJson(`src/i18n/${lang}.json`);
      if (!isStringRecord(dict)) continue;
      for (const id of Object.keys(npcs))
        for (const key of [`npc.${id}`, `npc.${id}.hello`])
          if (!(key in dict)) problems.push(`npcs.json: falta "${key}" em i18n/${lang}.json`);
      for (const q of quests)
        for (const key of [`quest.${q.id}`, `quest.${q.id}.text`, `quest.${q.id}.done`])
          if (!(key in dict)) problems.push(`quests.json: falta "${key}" em i18n/${lang}.json`);
    }
  } catch (error) {
    if (error instanceof QuestDataError) problems.push(...error.problems);
    else throw error;
  }
  return problems;
}

function loadLootIds(): string[] | null {
  const items = loadItems();
  if (Array.isArray(items)) return null;
  try {
    return Object.keys(
      parseLootTables(readJson('src/data/lootTables.json'), manifestKeys(), Object.keys(items)),
    );
  } catch {
    return null;
  }
}

function checkLoot(): string[] {
  const items = loadItems();
  if (Array.isArray(items)) return ['items.json inválido (ver acima)'];
  try {
    const tables = parseLootTables(readJson('src/data/lootTables.json'), manifestKeys(), Object.keys(items));
    return HORDE_REWARD_TABLE in tables
      ? []
      : [`lootTables.json: falta "${HORDE_REWARD_TABLE}" (prémio das hordas)`];
  } catch (error) {
    if (error instanceof DataError) return error.problems.map((p) => `lootTables.json: ${p}`);
    throw error;
  }
}

function checkZones(): string[] {
  const zones = loadZones();
  if (Array.isArray(zones)) return zones;
  const problems: string[] = [];
  for (const lang of ['pt-PT', 'en']) {
    const dict = readJson(`src/i18n/${lang}.json`);
    if (!isStringRecord(dict)) continue;
    for (const [id, zone] of Object.entries(zones)) {
      if (!(zone.name in dict)) problems.push(`zones.json: "${id}" sem nome em i18n/${lang}.json`);
      if (zone.hint && !(zone.hint in dict))
        problems.push(`zones.json: "${id}" com pista sem texto em i18n/${lang}.json`);
    }
  }
  const items = loadItems();
  if (!Array.isArray(items)) {
    for (const [id, zone] of Object.entries(zones)) {
      if (zone.requiresItem && !(zone.requiresItem in items))
        problems.push(`zones.json: "${id}" pede o item desconhecido "${zone.requiresItem}"`);
    }
  }
  return problems;
}

function checkMaps(): string[] {
  const resources = loadResources();
  if (Array.isArray(resources)) return ['resources.json inválido (ver acima)'];
  const props = loadProps();
  if (Array.isArray(props)) return ['props.json inválido (ver acima)'];
  const stations = loadStations();
  if (Array.isArray(stations)) return ['stations.json inválido (ver acima)'];
  const zones = loadZones();
  if (Array.isArray(zones)) return ['zones.json inválido (ver acima)'];
  const groups = loadEnemyGroups();
  if (Array.isArray(groups)) return ['enemies.json/enemyGroups.json inválidos (ver acima)'];
  const problems: string[] = [];
  const parsed = new Map<string, ZoneMap>();
  for (const [zoneId, file] of Object.entries(zones).map(([id, z]) => [id, z.map] as const)) {
    if (!existsExactCase(file, 'public/assets/')) {
      problems.push(`${file} não existe em public/assets/`);
      continue;
    }
    try {
      const map = parseZoneMap(
        readJson(`public/assets/${file}`),
        {
          tileSize: TILE_SIZE,
          tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
          resourceIds: Object.keys(resources),
          propIds: Object.keys(props),
          stationIds: Object.keys(stations),
          floorTiles: { [BASE_TILESET_NAME]: BASE_FLOOR_TILES.map(baseTileIndex) },
          zoneIds: Object.keys(zones),
          enemyGroupIds: Object.keys(groups),
          lootTableIds: loadLootIds() ?? [],
          npcIds: loadNpcIds() ?? [],
        },
        file,
      );
      parsed.set(zoneId, map);
    } catch (error) {
      if (error instanceof ZoneMapError) problems.push(...error.problems.map((p) => `${file}: ${p}`));
      else problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problems.length === 0) problems.push(...checkWorld(zones, parsed));
  return problems;
}

/**
 * Mundo contínuo (Etapa E): os blocos não se sobrepõem, e cada abertura na borda de um Caminho
 * dá para um tile livre de outra zona (senão era um beco sem saída).
 */
function checkWorld(zones: ZoneDefs, maps: ReadonlyMap<string, ZoneMap>): string[] {
  const layout = buildWorldLayout(zones, (zoneId) => {
    const map = maps.get(zoneId);
    if (!map) throw new Error(`sem mapa: ${zoneId}`);
    return map;
  });
  const problems = layout.overlaps();
  for (const rect of layout.all()) {
    if (!rect.zoneId.startsWith('zone_route_')) continue;
    const map = maps.get(rect.zoneId);
    if (!map) continue;
    const { width: w, height: h } = map;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        if (map.solid[ty * w + tx] || (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1)) continue;
        const outside: [number, number][] = [];
        if (tx === 0) outside.push([-1, ty]);
        if (tx === w - 1) outside.push([w, ty]);
        if (ty === 0) outside.push([tx, -1]);
        if (ty === h - 1) outside.push([tx, h]);
        for (const [ox, oy] of outside) {
          const hit = layout.resolve(rect.zoneId, ox, oy);
          const other = hit ? maps.get(hit.zone.zoneId) : undefined;
          if (!hit || !other || other.solid[hit.ty * other.width + hit.tx])
            problems.push(
              `${rect.zoneId}: a abertura (${String(tx)}, ${String(ty)}) não dá para lado nenhum`,
            );
        }
      }
    }
  }
  return problems;
}

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

function checkI18n(): string[] {
  const reference = 'pt-PT';
  const languages = ['pt-PT', 'en'];
  const dicts = new Map<string, Record<string, string>>();
  const problems: string[] = [];
  for (const lang of languages) {
    const dict = readJson(`src/i18n/${lang}.json`);
    if (isStringRecord(dict)) dicts.set(lang, dict);
    else problems.push(`i18n/${lang}.json: tem de ser um objeto chave → texto`);
  }
  const ref = dicts.get(reference);
  if (!ref) return problems;

  for (const [lang, dict] of dicts) {
    for (const [key, text] of Object.entries(dict)) {
      if (text.trim() === '') problems.push(`i18n/${lang}.json: "${key}" está vazio`);
      if (lang === reference) continue;
      const refText = ref[key];
      if (refText === undefined) {
        problems.push(`i18n/${lang}.json: "${key}" não existe em ${reference}`);
      } else if (placeholdersOf(text).join() !== placeholdersOf(refText).join()) {
        problems.push(`i18n/${lang}.json: "${key}" tem marcadores {…} diferentes de ${reference}`);
      }
    }
    for (const key of Object.keys(ref)) {
      if (!(key in dict)) problems.push(`i18n/${lang}.json: falta "${key}"`);
    }
  }
  return problems;
}

/** Talentos (§7.15): dados válidos e nome traduzido em todas as línguas. */
function checkTalents(): string[] {
  let ids: string[];
  try {
    ids = Object.keys(parseTalents(readJson('src/data/talents.json')));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const problems: string[] = [];
  for (const lang of ['pt-PT', 'en']) {
    const dict = readJson(`src/i18n/${lang}.json`);
    if (!isStringRecord(dict)) continue;
    for (const id of ids)
      if (!(`talent.${id}` in dict)) problems.push(`talents.json: "${id}" sem nome em i18n/${lang}.json`);
  }
  return problems;
}

const checks: [string, () => string[]][] = [
  ['paleta', checkPalette],
  ['manifest de assets', checkManifest],
  ['balance', checkBalance],
  ['itens', checkItems],
  ['recursos', checkResources],
  ['obstáculos', checkProps],
  ['crafting', checkCrafting],
  ['construção', checkStructures],
  ['inimigos', checkEnemies],
  ['talentos', checkTalents],
  ['loot', checkLoot],
  ['zonas', checkZones],
  ['missões', checkQuests],
  ['mapas', checkMaps],
  ['i18n', checkI18n],
];

let failed = false;
for (const [name, check] of checks) {
  const problems = check();
  if (problems.length === 0) {
    console.log(`✔ ${name}`);
  } else {
    failed = true;
    console.error(`✖ ${name}`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
}
if (failed) process.exit(1);
