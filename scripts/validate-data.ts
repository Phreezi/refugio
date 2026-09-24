// Valida os dados do jogo e as referências cruzadas entre eles (CLAUDE.md §13).
// Corre em Node com type stripping nativo: `npm run validate-data`. Sai com código 1 se falhar.
// Cada fase acrescenta aqui as suas verificações (items, recipes, lootTables, zones…).

import { readdirSync, readFileSync } from 'node:fs';
import { ManifestError, parseManifest } from '../src/assets/manifest.ts';

const ROOT = new URL('../', import.meta.url);
const PALETTE_SIZE = 32;

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
