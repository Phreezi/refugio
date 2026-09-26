import { BALANCE } from '../data/balance';
import { EQUIP_SLOTS } from '../data/types';
import type { StructureRecord } from '../systems/building/building';
import type { Skills } from '../systems/combat/skills';
import type { TalentEffect, Talents } from '../systems/progression/talents';
import { emptyQuestState, type QuestState } from '../systems/quests/quests';
import type { GameStatsCounters } from './Stats';
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
  /** Resistência (§7.19): 0 até ao máximo do nível (com frações; gasta-se a correr e a atacar). */
  stamina: number;
  /** Mochila (CLAUDE.md §7.3). Slots compactos [itemId, qtd, durabilidade?]. */
  inventory: Container;
  /** Hotbar de acesso rápido (teclas 1–4); mantém-se ao morrer (§7.12). */
  hotbar: Container;
  /** Equipamento, pela ordem de EQUIP_SLOTS (arma, cabeça, corpo, pernas, pés, mochila). */
  equipment: Container;
  /** Nível (1–maxLevel) e XP dentro do nível (CLAUDE.md §7.1). */
  level: number;
  xp: number;
  /** A sangrar: ticks que faltam (0 = não). Uma ligadura estanca. */
  bleed: number;
  /** Aspeto da personagem (escolhido ao criar o jogo). */
  look: CharacterLook;
  /** Nome da personagem (e do jogo na lista do menu; aparece no co-op). */
  name: string;
  /** Experiência de cada perícia (combate §7.8: menos falhanços; recolha §7.15: mais recursos). */
  skills: Skills;
  /** Pontos gastos em cada talento (§7.15). */
  talents: Talents;
  /**
   * Munição "dentro" da arma à distância equipada (aljava): [item, quantidade] sem limite de
   * stack. Não ocupa espaço na mochila; ao trocar de arma volta para a mochila (o que não
   * couber fica no chão).
   */
  quiver: [item: string, qty: number][];
  /** Moedas (§7.16): um contador (aparece no HUD), não um item nos slots. */
  coins: number;
  /** Efeitos temporários da comida (§7.17): [efeito, valor, tick em que acaba]. */
  buffs: Buff[];
  /** Missões (§7.18): ativas (progresso de cada objetivo) e feitas. */
  quests: QuestState;
}

/** Efeito temporário (comida encomendada): soma-se aos talentos até `until`. */
export type Buff = [effect: TalentEffect, value: number, until: number];

export type CharacterLook = 'boy' | 'girl';
/** Nome de quem ainda não escolheu nenhum (saves antigos). */
export const DEFAULT_PLAYER_NAME = 'Sobrevivente';
/** Tamanho máximo do nome (curto: cabe no HUD e na lista de jogos). */
export const PLAYER_NAME_MAX = 14;
export const CHARACTER_LOOKS: readonly CharacterLook[] = ['boy', 'girl'];

/** Dificuldade escolhida (save v23): multiplica a vida e o dano dos inimigos e a XP (§12). */
export type Difficulty = 'relaxed' | 'normal' | 'hard' | 'nightmare';
export const DIFFICULTIES: readonly Difficulty[] = ['relaxed', 'normal', 'hard', 'nightmare'];

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
  /** Dano das peças pelo uid (só em hordas; armadilhas: golpes dados). Repara-se na base. */
  damage: Record<string, number>;
}

/** Hordas opcionais (CLAUDE.md §7.13). */
export interface HordeState {
  /** Tick em que chega a próxima horda (0 = por marcar). */
  at: number;
  /** Hordas já enfrentadas (as seguintes são maiores). */
  count: number;
  /** Há uma horda a atacar a base (volta a aparecer se o jogo recarregar). */
  active: boolean;
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
  /** Corpo de um inimigo (id): desenha-se o inimigo a cinzento em vez da mochila. */
  corpse?: string;
}

export interface ZoneState {
  /** Recursos apanhados: id do objeto no Tiled → tick em que reaparece. */
  depleted: Record<string, number>;
  bags: GroundBag[];
  /** Contentores já abertos: id do objeto → [tick em que volta a encher, conteúdo]. */
  loot: Record<string, [number, Container]>;
  /** Itens soltos no chão (flechas que falharam o alvo…): [x, y, item, quantidade]. */
  ground: GroundItem[];
}

/** Item no chão: posição (pés, px da zona), item e quantidade. */
export type GroundItem = [x: number, y: number, item: string, qty: number];

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
  /** Definições do jogo gravadas no save (§10.5). */
  settings: { hordes: boolean; difficulty: Difficulty };
  horde: HordeState;
  /** Masmorras (bunker): piso mais fundo já alcançado (checkpoint), pelo id da masmorra. */
  dungeons: Record<string, number>;
  /** Chefes derrotados: zona → tick em que o chefe volta (respawn semanal). */
  bosses: Record<string, number>;
  /** Etapa E: zonas com o poste de teletransporte ativado (a base está sempre). */
  waystones: string[];
  /** Estatísticas do jogador (menu de pausa). */
  stats: GameStatsCounters & { playTicks: number };
  /** Tutorial (Fase 11): passos já feitos e se as dicas estão desligadas. */
  tutorial: { done: string[]; off: boolean };
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
      stamina: BALANCE.staminaMax,
      inventory: createContainer(BALANCE.inventorySlots),
      hotbar,
      equipment: createContainer(EQUIP_SLOTS.length),
      level: 1,
      xp: 0,
      bleed: 0,
      look: 'boy',
      name: DEFAULT_PLAYER_NAME,
      skills: {},
      talents: {},
      quiver: [],
      coins: 0,
      buffs: [],
      quests: emptyQuestState(),
    },
    world: { tick: 0, rng: seed >>> 0 },
    base: {
      chests: { [STARTING_CHEST_ID]: startingChest() },
      structures: [],
      nextStructureId: 1,
      crops: {},
      produce: {},
      damage: {},
    },
    zones: {},
    stations: {},
    unlocks: { recipes: [] },
    settings: { hordes: false, difficulty: 'normal' },
    horde: { at: 0, count: 0, active: false },
    dungeons: {},
    bosses: {},
    waystones: [],
    stats: { kills: 0, deaths: 0, crafted: 0, gathered: 0, looted: 0, playTicks: 0 },
    tutorial: { done: [], off: false },
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
  data.zones[zoneId] ??= { depleted: {}, bags: [], loot: {}, ground: [] };
  return data.zones[zoneId];
}

/** Conteúdo de um baú (criado vazio na primeira vez que se abre; `slots` espaços). */
export function chestContents(data: GameStateData, chestId: string, slots = BALANCE.chestSlots): Container {
  const chest = (data.base.chests[chestId] ??= createContainer(slots));
  while (chest.length < slots) chest.push(null);
  return chest;
}

/**
 * Fonte de verdade única do jogo (CLAUDE.md §5.1). As cenas leem daqui e
 * alteram-no só através de sistemas/ações, nunca guardando cópias próprias.
 */
export class GameState {
  private current: GameStateData | null = null;
  private changed = false;
  /**
   * Mundo emprestado (co-op, Fase 15): o convidado mostra o mundo do anfitrião, que nunca se
   * grava no save dele (o autosave vê sempre "sem alterações").
   */
  borrowed = false;

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
    this.borrowed = false;
    this.current = createNewGameState(spawn, seed);
    this.changed = true;
    return this.current;
  }

  /** Continua um jogo gravado (já validado e migrado pelo SaveManager). */
  load(data: GameStateData, borrowed = false): GameStateData {
    this.current = data;
    this.changed = false;
    this.borrowed = borrowed;
    return this.current;
  }

  clear(): void {
    this.current = null;
    this.changed = false;
    this.borrowed = false;
  }

  /** Há alterações por gravar? (CLAUDE.md §10.2: o autosave só grava se houver). */
  get dirty(): boolean {
    return this.changed && !this.borrowed;
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
