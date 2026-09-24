import { BASE_MAP_TILES, TILE_SIZE } from '../config';

/** Id da zona da base (casa do jogador). */
export const BASE_ZONE_ID = 'zone_base';

export interface PlayerState {
  /** Posição dos pés do jogador, em píxeis do mapa da zona atual. */
  x: number;
  y: number;
  zoneId: string;
}

export interface WorldState {
  /** Ticks de lógica decorridos desde o início do jogo (1 tick = FIXED_STEP_MS). */
  tick: number;
}

/**
 * Estado serializável do jogo. Só dados simples (sem classes nem referências ao Phaser),
 * para o SaveManager (Fase 2) o poder gravar tal como está.
 */
export interface GameStateData {
  player: PlayerState;
  world: WorldState;
}

export function createNewGameState(): GameStateData {
  const center = (BASE_MAP_TILES * TILE_SIZE) / 2;
  return {
    player: { x: center, y: center, zoneId: BASE_ZONE_ID },
    world: { tick: 0 },
  };
}

/**
 * Fonte de verdade única do jogo (CLAUDE.md §5.1). As cenas leem daqui e
 * alteram-no só através de sistemas/ações, nunca guardando cópias próprias.
 */
export class GameState {
  private current: GameStateData | null = null;

  get hasGame(): boolean {
    return this.current !== null;
  }

  /** Estado do jogo ativo. Lança erro se ainda não houver jogo (bug de fluxo de cenas). */
  get data(): GameStateData {
    if (this.current === null) {
      throw new Error('GameState: não há jogo ativo — chamar newGame() primeiro.');
    }
    return this.current;
  }

  newGame(): GameStateData {
    this.current = createNewGameState();
    return this.current;
  }

  clear(): void {
    this.current = null;
  }
}

/** Instância global usada pelas cenas. */
export const gameState = new GameState();
