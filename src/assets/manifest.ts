// Formato e validação de public/assets/manifest.json (CLAUDE.md §6.1).
// Módulo puro: também é usado por scripts/validate-data.ts (Node, sem bundler),
// por isso não importa outros módulos em runtime.

export const MANIFEST_VERSION = 1;

/**
 * Grelha das spritesheets de personagens (ver `characterSheet.ts`; repetido aqui porque este
 * módulo não pode importar outros em runtime; um teste garante que coincidem).
 */
export const CHARACTER_SHEET_LAYOUT = { frameWidth: 16, frameHeight: 32, columns: 10, rows: 4 } as const;

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
  /**
   * Só em spritesheets: "character" desenha uma personagem animada (layout de
   * `characterSheet.ts`) com `color` na roupa e `border` no contorno, em vez de repetir o retângulo.
   */
  style?: 'character';
}

export interface ImageAsset {
  type: 'image';
  /** Ficheiro relativo a `public/assets/`. Omisso, ou falha ao carregar → placeholder. */
  file?: string;
  placeholder: PlaceholderSpec;
}

/**
 * Folha de frames com a mesma grelha (colunas × linhas). O placeholder tem o tamanho de um
 * frame; as personagens usam o layout de `characterSheet.ts`.
 */
export interface SpritesheetAsset {
  type: 'spritesheet';
  file?: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  placeholder: PlaceholderSpec;
}

export type AssetEntry = ImageAsset | SpritesheetAsset;

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
const ENTRY_KEYS: Readonly<Record<AssetEntry['type'], ReadonlySet<string>>> = {
  image: new Set(['type', 'file', 'placeholder']),
  spritesheet: new Set(['type', 'file', 'placeholder', 'frameWidth', 'frameHeight', 'columns', 'rows']),
};
/** Limite de colunas/linhas de uma spritesheet. */
const MAX_SHEET_CELLS = 32;
const PLACEHOLDER_KEYS = new Set(['width', 'height', 'color', 'border', 'letter', 'style']);

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
  if (raw.style !== undefined) {
    if (raw.style === 'character') spec.style = 'character';
    else problems.push(`${where}: style só pode ser "character" (${describe(raw.style)})`);
  }
  return spec;
}

function parseFile(raw: unknown, where: string, problems: string[]): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && FILE_PATTERN.test(raw) && !raw.startsWith('/')) return raw;
  problems.push(
    `${where}: file deve ser um caminho relativo a public/assets/, em minúsculas, .png ou .webp (${describe(raw)})`,
  );
  return undefined;
}

function parseCount(value: unknown, field: string, where: string, problems: string[]): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SHEET_CELLS) {
    return value;
  }
  problems.push(
    `${where}: ${field} deve ser um inteiro entre 1 e ${String(MAX_SHEET_CELLS)} (${describe(value)})`,
  );
  return 1;
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
  if (raw.type !== 'image' && raw.type !== 'spritesheet') {
    problems.push(`${where}: type tem de ser "image" ou "spritesheet" (${describe(raw.type)})`);
    parsePlaceholder(raw.placeholder, where, palette, problems); // para reportar tudo de uma vez
    return null;
  }
  checkKeys(raw, ENTRY_KEYS[raw.type], where, problems);
  const placeholder = parsePlaceholder(raw.placeholder, where, palette, problems);
  const file = parseFile(raw.file, where, problems);

  let entry: AssetEntry;
  if (raw.type === 'image') {
    if (placeholder.style !== undefined) problems.push(`${where}: style só se usa em spritesheets`);
    entry = { type: 'image', placeholder };
  } else {
    entry = {
      type: 'spritesheet',
      frameWidth: parseSize(raw.frameWidth, 'frameWidth', where, problems),
      frameHeight: parseSize(raw.frameHeight, 'frameHeight', where, problems),
      columns: parseCount(raw.columns, 'columns', where, problems),
      rows: parseCount(raw.rows, 'rows', where, problems),
      placeholder,
    };
    if (placeholder.width !== entry.frameWidth || placeholder.height !== entry.frameHeight) {
      problems.push(`${where}: o placeholder tem de ter o tamanho de um frame (frameWidth × frameHeight)`);
    }
    if (placeholder.style === 'character') {
      const layout = CHARACTER_SHEET_LAYOUT;
      if (
        entry.frameWidth !== layout.frameWidth ||
        entry.frameHeight !== layout.frameHeight ||
        entry.columns !== layout.columns ||
        entry.rows !== layout.rows
      ) {
        problems.push(
          `${where}: style "character" exige frames de ${String(layout.frameWidth)}×${String(layout.frameHeight)} em ${String(layout.columns)} colunas × ${String(layout.rows)} linhas`,
        );
      }
    }
  }
  if (file !== undefined) entry.file = file;
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
