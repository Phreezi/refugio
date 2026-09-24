// Valida os dados do jogo e as referências cruzadas entre eles (CLAUDE.md §13).
// Corre em Node com type stripping nativo: `npm run validate-data`. Sai com código 1 se falhar.
// Cada fase acrescenta aqui as suas verificações (items, recipes, lootTables, zones…).

import { readdirSync, readFileSync } from 'node:fs';
import { ManifestError, parseManifest } from '../src/assets/manifest.ts';
import {
  DataError,
  parseProps,
  parseResources,
  type PropDefs,
  type ResourceDefs,
} from '../src/data/types.ts';
import { BASE_TILES, BASE_TILESET_NAME } from '../src/world/tileset.ts';
import { ZoneMapError, parseZoneMap } from '../src/world/zoneMap.ts';

const ROOT = new URL('../', import.meta.url);
const PALETTE_SIZE = 32;
/** Igual a TILE_SIZE em src/config.ts (os scripts não importam módulos com dependências). */
const TILE_SIZE = 16;
/** Mapas Tiled validados (relativos a public/assets/). */
const MAP_FILES = ['maps/base.json'];

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

function loadResources(): ResourceDefs | string[] {
  try {
    return parseResources(readJson('src/data/resources.json'), manifestKeys());
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

function checkProps(): string[] {
  const props = loadProps();
  return Array.isArray(props) ? props : [];
}

function checkMaps(): string[] {
  const resources = loadResources();
  if (Array.isArray(resources)) return ['resources.json inválido (ver acima)'];
  const props = loadProps();
  if (Array.isArray(props)) return ['props.json inválido (ver acima)'];
  const problems: string[] = [];
  for (const file of MAP_FILES) {
    if (!existsExactCase(file, 'public/assets/')) {
      problems.push(`${file} não existe em public/assets/`);
      continue;
    }
    try {
      parseZoneMap(
        readJson(`public/assets/${file}`),
        {
          tileSize: TILE_SIZE,
          tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
          resourceIds: Object.keys(resources),
          propIds: Object.keys(props),
        },
        file,
      );
    } catch (error) {
      if (error instanceof ZoneMapError) problems.push(...error.problems.map((p) => `${file}: ${p}`));
      else problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
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

const checks: [string, () => string[]][] = [
  ['paleta', checkPalette],
  ['manifest de assets', checkManifest],
  ['balance', checkBalance],
  ['recursos', checkResources],
  ['obstáculos', checkProps],
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
