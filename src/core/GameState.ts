import { BALANCE } from '../data/balance';
import { EQUIP_SLOTS } from '../data/types';
import type { StructureRecord } from '../systems/building/building';
import { createStationState, type StationState } from '../systems/crafting/crafting';
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
  /** Equipamento, pela ordem de EQUIP_SLOTS (arma, cabeça, corpo, pernas, pés, mochila). */
  equipment: Container;
  /** Nível (1–maxLevel) e XP dentro do nível (CLAUDE.md §7.1). */
  level: number;
  xp: number;
}

export interface WorldState {
  /** Ticks de lógica decorridos desde o início do jogo (1 tick = FIXED_STEP_MS). */
  tick: number;
  /** Estado do gerador aleatório (core/Rng.ts): drops reproduzíveis e iguais depois de gravar. */
  rng: number;
}

export interface BaseState {
  /** Conteúdo dos baús: pelo id do objeto `chest:<id>` no mapa, ou `s<uid>` (baús construídos). */
  chests: Record<string, Container>;
  /** Peças construídas (CLAUDE.md §7.7), compactas. */
  structures: StructureRecord[];
  /** Próximo uid de peça (nunca se reutilizam: identificam estações e baús). */
  nextStructureId: number;
  /** Canteiros com planta, pelo uid: [semente, tick em que fica madura (null = por regar)]. */
  crops: Record<string, [seed: string, readyAt: number | null]>;
  /** Peças que produzem sozinhas, pelo uid: tick a partir do qual se conta a produção (pode ser < 0). */
  produce: Record<string, number>;
}

/** Mochila no chão: a da morte (§7.12) ou o que não coube ao matar um inimigo. */
export interface GroundBag {
  x: number;
  y: number;
  items: Container;
  /** Desaparece a esta hora (ms reais, Date.now). */
  expiresAt: number;
  /** A mochila deixada ao morrer (marcada no mapa-mundo, Fase 7). */
  death: boolean;
}

export interface ZoneState {
  /** Recursos apanhados: id do objeto no Tiled → tick em que reaparece. */
  depleted: Record<string, number>;
  bags: GroundBag[];
  /** Contentores já abertos: id do objeto → [tick em que volta a encher, conteúdo]. */
  loot: Record<string, [number, Container]>;
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
  /** Filas e saídas das estações de crafting, pela chave `<tipo>_<id do objeto>` (§10.5). */
  stations: Record<string, StationState>;
  /** Receitas aprendidas em notas (antes do nível que as desbloqueia). */
  unlocks: { recipes: string[] };
}

/** Baú da base num jogo novo: mantimentos para os primeiros minutos (e testar a fogueira). */
export const STARTING_CHEST_ID = 'base_1';

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
      equipment: createContainer(EQUIP_SLOTS.length),
      level: 1,
      xp: 0,
    },
    world: { tick: 0, rng: seed >>> 0 },
    base: {
      chests: { [STARTING_CHEST_ID]: startingChest() },
      structures: [],
      nextStructureId: 1,
      crops: {},
      produce: {},
    },
    zones: {},
    stations: {},
    unlocks: { recipes: [] },
  };
}

function startingChest(): Container {
  const chest = createContainer(BALANCE.chestSlots);
  chest[0] = ['raw_meat', 3];
  chest[1] = ['water_dirty', 2];
  chest[2] = ['cloth', 4];
  return chest;
}

/** Estado de uma estação (criado vazio na primeira vez). */
export function stationState(data: GameStateData, key: string): StationState {
  data.stations[key] ??= createStationState();
  return data.stations[key];
}

/** Estado de uma zona (criado se ainda não existir). */
export function zoneState(data: GameStateData, zoneId: string): ZoneState {
  data.zones[zoneId] ??= { depleted: {}, bags: [], loot: {} };
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
