import type { GameStateData } from '../core/GameState';
import { MIGRATIONS, migrate, type Migration } from './migrations';
import { SKILLS } from '../data/types';

// Formato do save (CLAUDE.md §10). Qualquer alteração ao formato de GameStateData obriga a
// incrementar SAVE_VERSION, acrescentar a migração em migrations.ts e um teste.

export const SAVE_VERSION = 19;

/** O que fica gravado (JSON): a versão e o timestamp também entram no checksum. */
export interface SaveEnvelope {
  version: number;
  /** Momento da gravação, em ms reais (Date.now()). */
  timestamp: number;
  checksum: string;
  state: GameStateData;
}

export interface ParsedSave {
  version: number;
  timestamp: number;
  state: GameStateData;
}

export type SaveProblem = 'json' | 'format' | 'checksum' | 'future_version' | 'state';

export class SaveError extends Error {
  readonly problem: SaveProblem;

  constructor(problem: SaveProblem, detail: string) {
    super(`Save inválido (${problem}): ${detail}`);
    this.name = 'SaveError';
    this.problem = problem;
  }
}

/** Hash FNV-1a de 32 bits em hexadecimal: deteta corrupção, não é segurança. */
export function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function checksumOf(version: number, timestamp: number, stateJson: string): string {
  return checksum(`${String(version)}|${String(timestamp)}|${stateJson}`);
}

export function serializeSave(state: GameStateData, timestamp: number): string {
  const stateJson = JSON.stringify(state);
  const sum = checksumOf(SAVE_VERSION, timestamp, stateJson);
  // Montado à mão para o checksum se referir exatamente ao texto gravado do estado.
  return `{"version":${String(SAVE_VERSION)},"timestamp":${String(timestamp)},"checksum":"${sum}","state":${stateJson}}`;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stat(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const FACINGS = new Set(['down', 'left', 'right', 'up']);

/** Slot compacto: null ou [itemId, qtd ≥ 1] / [itemId, qtd, durabilidade ≥ 0]. */
function validSlot(slot: unknown): boolean {
  if (slot === null) return true;
  if (!Array.isArray(slot) || slot.length < 2 || slot.length > 4) return false;
  const [id, qty, durability, enchant] = slot as unknown[];
  if (
    enchant !== undefined &&
    !(Number.isInteger(enchant) && (enchant as number) >= 1 && (enchant as number) <= 10)
  )
    return false;
  return (
    typeof id === 'string' &&
    id !== '' &&
    typeof qty === 'number' &&
    Number.isInteger(qty) &&
    qty >= 1 &&
    (durability === undefined || stat(durability))
  );
}

/** Peça construída: [uid ≥ 1, id, tx, ty, rot 0/1, estado 0/1]. */
function validStructure(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 6) return false;
  const [uid, id, tx, ty, rot, state] = value as unknown[];
  return (
    stat(uid) &&
    uid >= 1 &&
    typeof id === 'string' &&
    id !== '' &&
    stat(tx) &&
    stat(ty) &&
    (rot === 0 || rot === 1) &&
    (state === 0 || state === 1)
  );
}

function validBag(value: unknown): boolean {
  return (
    isObject(value) &&
    finite(value.x) &&
    finite(value.y) &&
    validContainer(value.items) &&
    finite(value.expiresAt) &&
    typeof value.death === 'boolean'
  );
}

function validContainer(value: unknown): boolean {
  return Array.isArray(value) && value.every(validSlot);
}

/** Valida o estado (já migrado para a versão atual) e devolve-o tipado. */
export function validateState(input: unknown): GameStateData {
  const problems: string[] = [];
  const player = isObject(input) ? input.player : undefined;
  const world = isObject(input) ? input.world : undefined;
  if (!isObject(player)) problems.push('falta player');
  else {
    if (!finite(player.x) || !finite(player.y)) problems.push('player.x/y inválidos');
    if (typeof player.facing !== 'string' || !FACINGS.has(player.facing))
      problems.push('player.facing inválido');
    if (typeof player.zoneId !== 'string' || player.zoneId === '') problems.push('player.zoneId inválido');
    for (const key of ['hp', 'hunger', 'thirst'] as const) {
      if (!stat(player[key])) problems.push(`player.${key} inválido`);
    }
    if (!validContainer(player.inventory)) problems.push('player.inventory inválido');
    if (!validContainer(player.hotbar)) problems.push('player.hotbar inválido');
    if (!validContainer(player.equipment) || (player.equipment as unknown[]).length !== 6)
      problems.push('player.equipment inválido');
    if (!stat(player.level) || player.level < 1) problems.push('player.level inválido');
    if (!stat(player.xp)) problems.push('player.xp inválido');
    if (!stat(player.bleed)) problems.push('player.bleed inválido');
    if (player.look !== 'boy' && player.look !== 'girl') problems.push('player.look inválido');
    const skills = player.skills;
    if (
      !isObject(skills) ||
      !Object.entries(skills).every(([k, xp]) => (SKILLS as readonly string[]).includes(k) && stat(xp))
    )
      problems.push('player.skills inválido');
    if (
      !Array.isArray(player.quiver) ||
      !player.quiver.every(
        (q) =>
          Array.isArray(q) &&
          q.length === 2 &&
          typeof q[0] === 'string' &&
          q[0] !== '' &&
          stat(q[1]) &&
          q[1] > 0,
      )
    )
      problems.push('player.quiver inválido');
    if (
      !isObject(player.talents) ||
      !Object.values(player.talents).every(
        (rank) => typeof rank === 'number' && Number.isInteger(rank) && rank > 0,
      )
    )
      problems.push('player.talents inválido');
    if (typeof player.name !== 'string' || player.name.trim() === '' || player.name.length > 14)
      problems.push('player.name inválido');
  }
  if (!isObject(world)) problems.push('falta world');
  else {
    if (!stat(world.tick)) problems.push('world.tick inválido');
    if (!stat(world.rng)) problems.push('world.rng inválido');
  }
  const base = isObject(input) ? input.base : undefined;
  if (!isObject(base) || !isObject(base.chests) || !Object.values(base.chests).every(validContainer)) {
    problems.push('base.chests inválido');
  }
  if (!isObject(base) || !Array.isArray(base.structures) || !base.structures.every(validStructure)) {
    problems.push('base.structures inválido');
  }
  if (!isObject(base) || !stat(base.nextStructureId) || base.nextStructureId < 1) {
    problems.push('base.nextStructureId inválido');
  }
  const validCrop = (crop: unknown): boolean =>
    Array.isArray(crop) &&
    crop.length === 2 &&
    typeof crop[0] === 'string' &&
    crop[0] !== '' &&
    (crop[1] === null || stat(crop[1]));
  if (!isObject(base) || !isObject(base.crops) || !Object.values(base.crops).every(validCrop)) {
    problems.push('base.crops inválido');
  }
  // Pode ser negativo: o tempo offline recua o início da contagem (mesmo no início do jogo).
  if (!isObject(base) || !isObject(base.produce) || !Object.values(base.produce).every(Number.isInteger)) {
    problems.push('base.produce inválido');
  }
  const zones = isObject(input) ? input.zones : undefined;
  if (
    !isObject(zones) ||
    !Object.values(zones).every(
      (z) =>
        isObject(z) &&
        isObject(z.depleted) &&
        Object.values(z.depleted).every(stat) &&
        Array.isArray(z.bags) &&
        z.bags.every(validBag) &&
        Array.isArray(z.ground) &&
        z.ground.every(
          (g) =>
            Array.isArray(g) &&
            g.length === 4 &&
            finite(g[0]) &&
            finite(g[1]) &&
            typeof g[2] === 'string' &&
            g[2] !== '' &&
            stat(g[3]) &&
            g[3] > 0,
        ) &&
        isObject(z.loot) &&
        Object.values(z.loot).every(
          (entry) => Array.isArray(entry) && entry.length === 2 && stat(entry[0]) && validContainer(entry[1]),
        ),
    )
  ) {
    problems.push('zones inválido');
  }
  const stations = isObject(input) ? input.stations : undefined;
  const validJob = (job: unknown): boolean =>
    Array.isArray(job) && job.length === 2 && typeof job[0] === 'string' && stat(job[1]);
  if (
    !isObject(stations) ||
    !Object.values(stations).every(
      (st) =>
        isObject(st) && Array.isArray(st.queue) && st.queue.every(validJob) && validContainer(st.output),
    )
  ) {
    problems.push('stations inválido');
  }
  const unlocks = isObject(input) ? input.unlocks : undefined;
  if (
    !isObject(unlocks) ||
    !Array.isArray(unlocks.recipes) ||
    !unlocks.recipes.every((r) => typeof r === 'string')
  ) {
    problems.push('unlocks inválido');
  }
  if (!isObject(base) || !isObject(base.damage) || !Object.values(base.damage).every(stat)) {
    problems.push('base.damage inválido');
  }
  const settings = isObject(input) ? input.settings : undefined;
  if (!isObject(settings) || typeof settings.hordes !== 'boolean') problems.push('settings inválido');
  const horde = isObject(input) ? input.horde : undefined;
  if (!isObject(horde) || !stat(horde.at) || !stat(horde.count) || typeof horde.active !== 'boolean')
    problems.push('horde inválido');
  const dungeons = isObject(input) ? input.dungeons : undefined;
  if (!isObject(dungeons) || !Object.values(dungeons).every((f) => stat(f) && f >= 1))
    problems.push('dungeons inválido');
  const bosses = isObject(input) ? input.bosses : undefined;
  if (!isObject(bosses) || !Object.values(bosses).every(stat)) problems.push('bosses inválido');
  const stats = isObject(input) ? input.stats : undefined;
  const STAT_KEYS = ['kills', 'deaths', 'crafted', 'gathered', 'looted', 'playTicks'] as const;
  if (!isObject(stats) || !STAT_KEYS.every((k) => stat(stats[k]))) problems.push('stats inválido');
  const tutorial = isObject(input) ? input.tutorial : undefined;
  if (
    !isObject(tutorial) ||
    !Array.isArray(tutorial.done) ||
    !tutorial.done.every((d) => typeof d === 'string') ||
    typeof tutorial.off !== 'boolean'
  )
    problems.push('tutorial inválido');
  if (problems.length > 0) throw new SaveError('state', problems.join('; '));
  return input as GameStateData;
}

/**
 * Lê um save (do armazenamento ou importado): verifica o JSON, o checksum e a versão,
 * migra para a versão atual e valida o estado.
 */
export function parseSave(
  text: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): ParsedSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('json', 'não é JSON válido');
  }
  if (
    !isObject(raw) ||
    !Number.isInteger(raw.version) ||
    !finite(raw.timestamp) ||
    typeof raw.checksum !== 'string'
  ) {
    throw new SaveError('format', 'faltam version/timestamp/checksum');
  }
  const version = raw.version as number;
  const timestamp = raw.timestamp;
  if (!isObject(raw.state)) throw new SaveError('format', 'falta o estado');
  if (checksumOf(version, timestamp, JSON.stringify(raw.state)) !== raw.checksum) {
    throw new SaveError('checksum', 'o conteúdo não corresponde ao checksum');
  }
  if (version > SAVE_VERSION) {
    throw new SaveError('future_version', `versão ${String(version)} é mais recente do que este jogo`);
  }
  let migrated: unknown;
  try {
    migrated = migrate(raw.state, version, SAVE_VERSION, migrations);
  } catch (error) {
    throw new SaveError('format', error instanceof Error ? error.message : String(error));
  }
  return { version, timestamp, state: validateState(migrated) };
}
