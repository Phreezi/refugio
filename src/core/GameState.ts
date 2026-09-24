import { BALANCE } from '../data/balance';
import { createContainer, type Container } from '../systems/inventory/inventory';
import type { Facing } from '../systems/movement/movement';

/** Id da zona da base (casa do jogador). */
export const BASE_ZONE_ID = 'zone_base';

export interface PlayerState {
  /** Posição dos pés do jogador, em píxeis do mapa da zona atual. */
  x: number;
  y: number;
  facing: Facing;
  zoneId: string;
  /** Vida, fome e sede: inteiros de 0 a BALANCE.statMax. */
  hp: number;
  hunger: number;
  thirst: number;
  /** Mochila (CLAUDE.md §7.3). Slots compactos [itemId, qtd, durabilidade?]. */
  inventory: Container;
  /** Hotbar de acesso rápido (teclas 1–4); mantém-se ao morrer (§7.12). */
  hotbar: Container;
}

export interface WorldState {
  /** Ticks de lógica decorridos desde o início do jogo (1 tick = FIXED_STEP_MS). */
  tick: number;
  /** Estado do gerador aleatório (core/Rng.ts): drops reproduzíveis e iguais depois de gravar. */
  rng: number;
}

export interface BaseState {
  /** Conteúdo dos baús, pelo id do objeto `chest:<id>` no mapa. */
  chests: Record<string, Container>;
}

export interface ZoneState {
  /** Recursos apanhados: id do objeto no Tiled → tick em que reaparece. */
  depleted: Record<string, number>;
}

/**
 * Estado serializável do jogo. Só dados simples (sem classes nem referências ao Phaser),
 * para o SaveManager o poder gravar tal como está. Mudar isto = SAVE_VERSION + migração.
 */
export interface GameStateData {
  player: PlayerState;
  world: WorldState;
  base: BaseState;
  zones: Record<string, ZoneState>;
}

/**
 * @param spawn posição inicial dos pés do jogador (o `player_spawn` do mapa da base).
 * @param seed semente do gerador aleatório.
 */
export function createNewGameState(spawn: { x: number; y: number }, seed = 1): GameStateData {
  const hotbar = createContainer(BALANCE.hotbarSlots);
  // Um pouco de comida e água para os primeiros minutos (até encontrar bagas e o poço).
  hotbar[0] = ['berries', 5];
  hotbar[1] = ['water_clean', 2];
  return {
    player: {
      x: spawn.x,
      y: spawn.y,
      facing: 'down',
      zoneId: BASE_ZONE_ID,
      hp: BALANCE.statMax,
      hunger: BALANCE.statMax,
      thirst: BALANCE.statMax,
      inventory: createContainer(BALANCE.inventorySlots),
      hotbar,
    },
    world: { tick: 0, rng: seed >>> 0 },
    base: { chests: {} },
    zones: {},
  };
}

/** Estado de uma zona (criado se ainda não existir). */
export function zoneState(data: GameStateData, zoneId: string): ZoneState {
  data.zones[zoneId] ??= { depleted: {} };
  return data.zones[zoneId];
}

/** Conteúdo de um baú (criado vazio na primeira vez que se abre). */
export function chestContents(data: GameStateData, chestId: string): Container {
  data.base.chests[chestId] ??= createContainer(BALANCE.chestSlots);
  return data.base.chests[chestId];
}

/**
 * Fonte de verdade única do jogo (CLAUDE.md §5.1). As cenas leem daqui e
 * alteram-no só através de sistemas/ações, nunca guardando cópias próprias.
 */
export class GameState {
  private current: GameStateData | null = null;
  private changed = false;

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

  newGame(spawn: { x: number; y: number }, seed?: number): GameStateData {
    this.current = createNewGameState(spawn, seed);
    this.changed = true;
    return this.current;
  }

  /** Continua um jogo gravado (já validado e migrado pelo SaveManager). */
  load(data: GameStateData): GameStateData {
    this.current = data;
    this.changed = false;
    return this.current;
  }

  clear(): void {
    this.current = null;
    this.changed = false;
  }

  /** Há alterações por gravar? (CLAUDE.md §10.2: o autosave só grava se houver). */
  get dirty(): boolean {
    return this.changed;
  }

  markDirty(): void {
    this.changed = true;
  }

  markSaved(): void {
    this.changed = false;
  }
}

/** Instância global usada pelas cenas. */
export const gameState = new GameState();
