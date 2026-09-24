import type { GameStateData } from '../core/GameState';
import { MIGRATIONS, migrate, type Migration } from './migrations';

// Formato do save (CLAUDE.md §10). Qualquer alteração ao formato de GameStateData obriga a
// incrementar SAVE_VERSION, acrescentar a migração em migrations.ts e um teste.

export const SAVE_VERSION = 1;

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
  }
  if (!isObject(world)) problems.push('falta world');
  else if (!stat(world.tick)) problems.push('world.tick inválido');
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
