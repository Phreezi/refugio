// Formato e validação de public/assets/manifest.json (CLAUDE.md §6.1).
// Módulo puro: também é usado por scripts/validate-data.ts (Node, sem bundler),
// por isso não importa outros módulos em runtime.

export const MANIFEST_VERSION = 1;

/** Limite de tamanho de um placeholder, em píxeis de jogo. */
export const MAX_PLACEHOLDER_SIZE = 256;

export interface PlaceholderSpec {
  width: number;
  height: number;
  /** Nome de uma cor da paleta (fundo). */
  color: string;
  /** Contorno de 1 px com esta cor da paleta. Omisso = sem contorno. */
  border?: string;
  /** Um carácter desenhado ao centro (ex.: "Á" para árvore). */
  letter?: string;
}

export interface ImageAsset {
  type: 'image';
  /** Ficheiro relativo a `public/assets/`. Omisso, ou falha ao carregar → placeholder. */
  file?: string;
  placeholder: PlaceholderSpec;
}

export type AssetEntry = ImageAsset;

export interface AssetManifest {
  version: typeof MANIFEST_VERSION;
  assets: Readonly<Record<string, AssetEntry>>;
}

export class ManifestError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Manifest de assets inválido:\n- ${problems.join('\n- ')}`);
    this.name = 'ManifestError';
    this.problems = problems;
  }
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const FILE_PATTERN = /^[a-z0-9_\-/]+\.(png|webp)$/;
const TOP_LEVEL_KEYS = new Set(['version', 'assets', '$comment']);
const ENTRY_KEYS = new Set(['type', 'file', 'placeholder']);
const PLACEHOLDER_KEYS = new Set(['width', 'height', 'color', 'border', 'letter']);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Carácteres visíveis (ex.: "Á" decomposto em "A" + acento conta como 1). */
function graphemeCount(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}

function describe(value: unknown): string {
  return value === undefined ? 'em falta' : JSON.stringify(value);
}

function checkKeys(obj: JsonObject, allowed: ReadonlySet<string>, where: string, problems: string[]) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) problems.push(`${where}: campo desconhecido "${key}"`);
  }
}

function parseSize(value: unknown, field: string, where: string, problems: string[]): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PLACEHOLDER_SIZE) {
    return value;
  }
  problems.push(
    `${where}: ${field} deve ser um inteiro entre 1 e ${String(MAX_PLACEHOLDER_SIZE)} (${describe(value)})`,
  );
  return 1;
}

function parseColor(
  value: unknown,
  field: string,
  where: string,
  palette: ReadonlySet<string>,
  problems: string[],
): string {
  if (typeof value === 'string' && palette.has(value)) return value;
  problems.push(`${where}: ${field} tem de ser uma cor da paleta (${describe(value)})`);
  return '';
}

function parsePlaceholder(
  raw: unknown,
  where: string,
  palette: ReadonlySet<string>,
  problems: string[],
): PlaceholderSpec {
  if (!isObject(raw)) {
    problems.push(`${where}: falta o objeto "placeholder"`);
    return { width: 1, height: 1, color: '' };
  }
  checkKeys(raw, PLACEHOLDER_KEYS, `${where}.placeholder`, problems);
  const spec: PlaceholderSpec = {
    width: parseSize(raw.width, 'width', where, problems),
    height: parseSize(raw.height, 'height', where, problems),
    color: parseColor(raw.color, 'color', where, palette, problems),
  };
  if (raw.border !== undefined) spec.border = parseColor(raw.border, 'border', where, palette, problems);
  if (raw.letter !== undefined) {
    const letter = typeof raw.letter === 'string' ? raw.letter.normalize('NFC') : '';
    if (graphemeCount(letter) === 1 && letter.trim() !== '') spec.letter = letter;
    else problems.push(`${where}: letter deve ser um único carácter visível (${describe(raw.letter)})`);
  }
  return spec;
}

function parseEntry(
  key: string,
  raw: unknown,
  palette: ReadonlySet<string>,
  problems: string[],
): AssetEntry | null {
  const where = `assets.${key}`;
  if (!KEY_PATTERN.test(key)) problems.push(`${where}: a chave tem de estar em snake_case`);
  if (!isObject(raw)) {
    problems.push(`${where}: a entrada tem de ser um objeto`);
    return null;
  }
  checkKeys(raw, ENTRY_KEYS, where, problems);
  if (raw.type !== 'image') problems.push(`${where}: type tem de ser "image" (${describe(raw.type)})`);

  const entry: ImageAsset = {
    type: 'image',
    placeholder: parsePlaceholder(raw.placeholder, where, palette, problems),
  };
  if (raw.file !== undefined) {
    if (typeof raw.file === 'string' && FILE_PATTERN.test(raw.file) && !raw.file.startsWith('/')) {
      entry.file = raw.file;
    } else {
      problems.push(
        `${where}: file deve ser um caminho relativo a public/assets/, em minúsculas, .png ou .webp (${describe(raw.file)})`,
      );
    }
  }
  return entry;
}

/**
 * Valida o JSON do manifest e devolve-o tipado. Junta todos os problemas num
 * único `ManifestError`, para se corrigirem de uma vez.
 * @param paletteColors nomes válidos de cores (chaves de `palette.json`).
 */
export function parseManifest(input: unknown, paletteColors: Iterable<string>): AssetManifest {
  if (!isObject(input)) throw new ManifestError(['o ficheiro não contém um objeto JSON']);
  const palette = new Set(paletteColors);
  const problems: string[] = [];

  checkKeys(input, TOP_LEVEL_KEYS, 'manifest', problems);
  if (input.version !== MANIFEST_VERSION) {
    problems.push(`manifest: version deve ser ${String(MANIFEST_VERSION)} (${describe(input.version)})`);
  }
  if (!isObject(input.assets)) {
    problems.push('manifest: falta o objeto "assets"');
    throw new ManifestError(problems);
  }

  const assets: Record<string, AssetEntry> = {};
  for (const [key, raw] of Object.entries(input.assets)) {
    const entry = parseEntry(key, raw, palette, problems);
    if (entry) assets[key] = entry;
  }
  if (problems.length > 0) throw new ManifestError(problems);
  return { version: MANIFEST_VERSION, assets };
}
