// Protocolo do co-op (CLAUDE.md §11, Fase 15). Módulo puro (sem rede nem Phaser): o código da
// sessão e as mensagens trocadas entre o anfitrião e o convidado (JSON pelo canal de dados).

import type { GameStateData } from '../core/GameState';
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

/** Normaliza o que o jogador escreveu (minúsculas, espaços, O→0 não: o 0 não existe). */
export function normalizeCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) && code.split('').every((ch) => CODE_ALPHABET.includes(ch)) ? code : null;
}

/** Inimigo num frame: [uid, id, x, y, hp, estado, virado para a esquerda, a rebentar]. */
export type EnemyFrame = [number, string, number, number, number, string, 0 | 1, 0 | 1];

/** Anfitrião → convidado. */
export type HostMessage =
  /** Estado inteiro do mundo (ao entrar, ao mudar de zona e de vez em quando). */
  | { t: 'full'; state: GameStateData }
  /** Posições (10×/s): anfitrião, vida do convidado e inimigos. */
  | {
      t: 'frame';
      tick: number;
      host: [number, number, Facing, 0 | 1, 0 | 1];
      you: { hp: number; down: 0 | 1 };
      enemies: EnemyFrame[];
    }
  /** Evento do jogo reenviado (efeitos no ecrã do convidado). */
  | { t: 'ev'; name: string; payload: unknown }
  | { t: 'bye' };

/** Convidado → anfitrião. */
export type GuestMessage =
  | { t: 'join'; weapon: string | null }
  /** Onde está o convidado (15×/s). */
  | { t: 'me'; x: number; y: number; facing: Facing; moved: 0 | 1; sneak: 0 | 1 }
  | { t: 'act' };

const FACINGS: readonly string[] = ['down', 'up', 'left', 'right'];

/** Valida uma mensagem do convidado (o anfitrião não confia em dados da rede). */
export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.t === 'act') return { t: 'act' };
  if (m.t === 'join') return { t: 'join', weapon: typeof m.weapon === 'string' ? m.weapon : null };
  if (
    m.t === 'me' &&
    typeof m.x === 'number' &&
    Number.isFinite(m.x) &&
    typeof m.y === 'number' &&
    Number.isFinite(m.y) &&
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
    };
  return null;
}

/**
 * Eventos do jogo que o anfitrião reenvia ao convidado (só os que mudam o que se vê). As peças
 * construídas não: o convidado refaz a cena quando mudam no estado inteiro (`full`).
 */
export const FORWARDED_EVENTS = [
  'enemy:hit',
  'enemy:killed',
  'enemy:dying',
  'enemy:exploded',
  'enemy:scream',
  'resource:hit',
  'resource:respawned',
  'item:gained',
  'structure:damaged',
  'structure:destroyed',
  'bag:changed',
  'horde:started',
  'horde:ended',
  'player:action',
  'partner:action',
  'partner:damaged',
  'partner:down',
] as const;
