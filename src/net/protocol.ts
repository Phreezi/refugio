// Protocolo do co-op (CLAUDE.md §11, Fase 15). Módulo puro (sem rede nem Phaser): o código da
// sessão e as mensagens trocadas entre o anfitrião e o convidado (pelo canal de dados).

import type { FishingSession } from '../core/Fishing';
import type { CharacterLook, GameStateData, PlayerState } from '../core/GameState';
import type { Facing } from '../systems/movement/movement';

/** Letras e números sem os que se confundem (0/O, 1/I/L): 31 símbolos. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 5;
/** Prefixo do id no servidor de sinalização (para não colidir com outras apps). */
export const PEER_PREFIX = 'refugio-coop-';

/** Código novo ao acaso (a unicidade garante-a o servidor: recusa ids em uso). */
export function randomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++)
    code += CODE_ALPHABET.charAt(Math.floor(random() * CODE_ALPHABET.length));
  return code;
}

/** Normaliza o que o jogador escreveu (minúsculas, espaços e hífenes). */
export function normalizeCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) && code.split('').every((ch) => CODE_ALPHABET.includes(ch)) ? code : null;
}

/** A personagem do convidado (vem do save dele e volta para lá): o resto é o mundo do anfitrião. */
export interface GuestCharacter {
  player: PlayerState;
  unlocks: GameStateData['unlocks'];
  stats: GameStateData['stats'];
  tutorial: GameStateData['tutorial'];
}

/** Inimigo num frame: [uid, id, x, y, vida, vida máx., estado, virado à esquerda, a rebentar]. */
export type EnemyFrame = [number, string, number, number, number, number, string, 0 | 1, 0 | 1];

/**
 * O que o convidado pode fazer nos painéis (mochila, fabrico, construção…): corre no ecrã dele
 * logo (para não esperar pela rede) e no anfitrião, que tem a última palavra.
 */
export const GUEST_COMMANDS = {
  actions: ['use', 'move', 'equip', 'unequip', 'split', 'sort', 'storeSimilar', 'takeAll'],
  crafting: ['craft', 'cancel', 'collect', 'repair'],
  building: ['place', 'undo', 'demolish'],
  fishing: ['cancel'],
  tutorial: ['dismiss'],
  sim: ['travel', 'enterZone'],
} as const;
export type CommandSystem = keyof typeof GUEST_COMMANDS;

/** Anfitrião → convidado. */
export type HostMessage =
  /**
   * O mundo com a personagem do convidado (depois dos comandos até `ack`). `warp` muda quando
   * o anfitrião muda o convidado de sítio (ao entrar, ao morrer): só aí conta a posição.
   */
  | { t: 'snap'; state: GameStateData; ack: number; warp: number }
  /** 10×/s: o anfitrião (se estiver na mesma zona), a vida/fome/sede, os inimigos, a pesca. */
  | {
      t: 'frame';
      tick: number;
      /** O anfitrião, se estiver na mesma zona: [x, y, direção, a andar, agachado, aparência]. */
      host: [number, number, Facing, 0 | 1, 0 | 1, CharacterLook] | null;
      you: [hp: number, hunger: number, thirst: number, bleed: number];
      enemies: EnemyFrame[];
      fish: FishingSession | null;
    }
  /** Evento do jogo: do convidado (o que lhe acontece) ou do anfitrião (`host`: o que se vê). */
  | { t: 'ev'; name: string; payload: unknown; host?: 1 }
  | { t: 'bye' };

/** Convidado → anfitrião. */
export type GuestMessage =
  | { t: 'join'; character: GuestCharacter }
  /** Onde está o convidado (15×/s). */
  | { t: 'me'; x: number; y: number; facing: Facing; moved: 0 | 1; sneak: 0 | 1; zone: string; auto?: 0 | 1 }
  /** Botão de ação premido/largado (`tick`: o do ecrã dele, para a pesca). */
  | { t: 'act'; held: 0 | 1; tick: number }
  | { t: 'cmd'; seq: number; sys: CommandSystem; m: string; args: unknown[] }
  /** No mapa-mundo ou em pausa: os inimigos ignoram-no e não gasta fome/sede. */
  | { t: 'away'; on: 0 | 1 };

const FACINGS: readonly string[] = ['down', 'up', 'left', 'right'];

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** O comando existe na lista do que o convidado pode fazer? */
export function isGuestCommand(sys: unknown, m: unknown): sys is CommandSystem {
  if (typeof sys !== 'string' || typeof m !== 'string' || !(sys in GUEST_COMMANDS)) return false;
  const methods: readonly string[] = GUEST_COMMANDS[sys as CommandSystem];
  return methods.includes(m);
}

/** Valida uma mensagem do convidado (o anfitrião não confia na forma dos dados da rede). */
export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isRecord(raw)) return null;
  const m = raw;
  if (m.t === 'act' && isNumber(m.tick)) return { t: 'act', held: m.held === 1 ? 1 : 0, tick: m.tick };
  if (m.t === 'away') return { t: 'away', on: m.on === 1 ? 1 : 0 };
  if (m.t === 'join' && isRecord(m.character) && isRecord(m.character.player))
    return { t: 'join', character: m.character as unknown as GuestCharacter };
  if (m.t === 'cmd' && isNumber(m.seq) && Array.isArray(m.args) && isGuestCommand(m.sys, m.m))
    return { t: 'cmd', seq: m.seq, sys: m.sys, m: m.m as string, args: m.args as unknown[] };
  if (
    m.t === 'me' &&
    isNumber(m.x) &&
    isNumber(m.y) &&
    typeof m.zone === 'string' &&
    typeof m.facing === 'string' &&
    FACINGS.includes(m.facing)
  )
    return {
      t: 'me',
      x: m.x,
      y: m.y,
      facing: m.facing as Facing,
      moved: m.moved === 1 ? 1 : 0,
      sneak: m.sneak === 1 ? 1 : 0,
      zone: m.zone,
      auto: m.auto === 1 ? 1 : 0,
    };
  return null;
}

/**
 * Eventos do anfitrião que o convidado também vê quando estão na mesma zona (golpes, recursos,
 * inimigos, mochilas…). As peças construídas chegam com o estado (`snap`).
 */
export const HOST_VISUAL_EVENTS: ReadonlySet<string> = new Set([
  'player:action',
  'resource:hit',
  'resource:respawned',
  'enemy:hit',
  'enemy:killed',
  'enemy:dying',
  'enemy:exploded',
  'enemy:scream',
  'structure:damaged',
  'structure:destroyed',
  'bag:changed',
  'horde:started',
  'horde:ended',
]);

/**
 * Eventos que não mudam o que se grava (e não pedem um estado novo ao convidado): acontecem
 * muitas vezes e o `frame` já leva o que importa.
 */
export const SNAPSHOT_QUIET_EVENTS: ReadonlySet<string> = new Set([
  'world:tick',
  'player:action',
  'player:damaged',
  'enemy:hit',
  'enemy:scream',
  'fishing:started',
]);

/**
 * Eventos da progressão do convidado (XP, níveis, receitas): no ecrã dele não se calculam, por
 * isso chegam sempre do anfitrião (os outros, dos comandos, já aconteceram no ecrã dele).
 */
export const PROGRESSION_EVENTS: ReadonlySet<string> = new Set([
  'xp:gained',
  'player:levelUp',
  'recipe:learned',
]);
