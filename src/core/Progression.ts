import { BALANCE } from '../data/balance';
import type { EnemyDefs, Recipe, Recipes, ResourceDefs, StructureDefs, ZoneDefs } from '../data/types';
import { countItem } from '../systems/inventory/inventory';
import { addXp } from '../systems/progression/progression';
import { learnTalent, type LearnCheck } from '../systems/progression/talents';
import { TALENTS } from '../data/talents';
import { discountedCost, eventActive, eventTicksLeft } from '../systems/travel/events';
import { secondsToTicks } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import type { GameState } from './GameState';

export interface ProgressionContent {
  recipes: Recipes;
  structures: StructureDefs;
  zones: ZoneDefs;
  resources: ResourceDefs;
  enemies: EnemyDefs;
}

/** O que um nível novo desbloqueou (para o ecrã "Subiste de nível!"). */
export interface Unlocked {
  recipes: string[];
  structures: string[];
  zones: string[];
}

/**
 * XP e níveis (CLAUDE.md §7.1, Fase 8): ganha-se XP a recolher, fabricar, construir, abrir
 * contentores, pescar e derrotar inimigos (ouve os eventos do jogo). Cada nível desbloqueia
 * receitas, peças de construção e zonas; as notas encontradas ensinam receitas antes do tempo.
 */
export class Progression {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly content: () => ProgressionContent;

  constructor(state: GameState, bus: EventBus<GameEvents>, content: () => ProgressionContent) {
    this.state = state;
    this.bus = bus;
    this.content = content;
    bus.on('resource:hit', ({ resource, hp }) => {
      if (hp === 0) this.gain(this.content().resources[resource]?.xp ?? BALANCE.xpGather);
    });
    bus.on('enemy:killed', ({ enemy }) => {
      this.gain(this.content().enemies[enemy]?.xp ?? 0);
    });
    bus.on('craft:finished', ({ recipe }) => {
      const def = this.content().recipes.find((r) => r.id === recipe);
      if (def) this.gain(def.xp ?? Math.max(BALANCE.xpCraftMin, Math.round(def.timeSec / 5)));
    });
    bus.on('structure:placed', () => {
      this.gain(BALANCE.xpBuild);
    });
    bus.on('loot:rolled', () => {
      this.gain(BALANCE.xpLoot);
    });
    bus.on('crop:harvested', () => {
      this.gain(BALANCE.xpFarm);
    });
    bus.on('produce:collected', () => {
      this.gain(BALANCE.xpProduce);
    });
    bus.on('fishing:result', ({ caught }) => {
      if (caught) this.gain(BALANCE.xpFish);
    });
  }

  get level(): number {
    return this.state.data.player.level;
  }

  isRecipeUnlocked(recipe: Recipe): boolean {
    return recipe.unlockLevel <= this.level || this.state.data.unlocks.recipes.includes(recipe.id);
  }

  isStructureUnlocked(id: string): boolean {
    return (this.content().structures[id]?.unlockLevel ?? 1) <= this.level;
  }

  isZoneUnlocked(zoneId: string): boolean {
    return (this.content().zones[zoneId]?.unlockLevel ?? 1) <= this.level;
  }

  /** A zona existe agora? (as zonas-evento só durante o evento, §8.3) */
  isZoneAvailable(zoneId: string): boolean {
    const event = this.content().zones[zoneId]?.event;
    return !event || eventActive(event, this.state.data.world.tick, secondsToTicks(BALANCE.dayLengthSec));
  }

  /** Horas de jogo até a zona-evento desaparecer (0 se não for um evento a decorrer). */
  eventHoursLeft(zoneId: string): number {
    const event = this.content().zones[zoneId]?.event;
    if (!event) return 0;
    const ticks = eventTicksLeft(event, this.state.data.world.tick, secondsToTicks(BALANCE.dayLengthSec));
    return Math.ceil(ticks / secondsToTicks(BALANCE.dayLengthSec / 24));
  }

  /** Desconto (%) nas viagens dado pelo melhor veículo construído na base (a moto). */
  travelDiscount(): number {
    const structures = this.content().structures;
    return Math.max(
      0,
      ...this.state.data.base.structures.map((r) => structures[r[1]]?.travelDiscountPct ?? 0),
    );
  }

  /** Custo de viajar até à zona, já com o desconto do veículo. */
  travelCost(zoneId: string): { hunger: number; thirst: number } {
    const cost = this.content().zones[zoneId]?.travelCost ?? { hunger: 0, thirst: 0 };
    return discountedCost(cost, this.travelDiscount());
  }

  /** Item que falta levar para poder viajar para a zona (ex.: a chave do bunker), ou null. */
  missingItem(zoneId: string): string | null {
    const item = this.content().zones[zoneId]?.requiresItem;
    if (!item) return null;
    const { inventory, hotbar } = this.state.data.player;
    return countItem([inventory, hotbar], item) > 0 ? null : item;
  }

  /**
   * Para onde leva uma viagem à zona: numa masmorra, ao piso mais fundo já alcançado
   * (checkpoint por piso, §11 Fase 10); nas outras zonas, a própria zona.
   */
  dungeonEntry(zoneId: string): string {
    const zones = this.content().zones;
    const dungeon = zones[zoneId]?.dungeon;
    if (!dungeon) return zoneId;
    const floor = this.state.data.dungeons[dungeon.id] ?? 1;
    const target = Object.entries(zones).find(
      ([, z]) => z.dungeon?.id === dungeon.id && z.dungeon.floor === floor,
    );
    return target?.[0] ?? zoneId;
  }

  /** Entrou numa zona: nas masmorras, o piso fica como checkpoint (se for o mais fundo). */
  visit(zoneId: string): void {
    const dungeon = this.content().zones[zoneId]?.dungeon;
    if (!dungeon) return;
    const reached = this.state.data.dungeons;
    if ((reached[dungeon.id] ?? 0) >= dungeon.floor) return;
    reached[dungeon.id] = dungeon.floor;
    this.state.markDirty();
    if (dungeon.floor > 1) this.bus.emit('dungeon:checkpoint', { floor: dungeon.floor });
  }

  /** Soma XP; ao subir de nível avisa com o que ficou desbloqueado. */
  gain(amount: number): void {
    // Co-op (convidado): a XP conta-se no anfitrião (e chega com o estado dele).
    if (!this.state.hasGame || amount <= 0 || this.state.borrowed) return;
    const player = this.state.data.player;
    const reached = addXp(player, amount, BALANCE.xpCurve, BALANCE.maxLevel);
    this.state.markDirty();
    this.bus.emit('xp:gained', { amount });
    for (const level of reached) this.bus.emit('player:levelUp', { level, unlocked: this.unlockedAt(level) });
  }

  /**
   * Aprende a receita de uma nota. @returns 'learned', 'known' (já se sabia, a nota fica) ou
   * 'unknown' (receita que não existe).
   */
  learn(recipeId: string): 'learned' | 'known' | 'unknown' {
    const recipe = this.content().recipes.find((r) => r.id === recipeId);
    if (!recipe) return 'unknown';
    if (this.isRecipeUnlocked(recipe)) return 'known';
    if (this.state.borrowed) return 'learned'; // co-op (convidado): o anfitrião é que regista
    this.state.data.unlocks.recipes.push(recipeId);
    this.state.markDirty();
    this.bus.emit('recipe:learned', { recipe: recipeId });
    return 'learned';
  }

  /** Gasta 1 ponto no talento `id` (§7.15). */
  learnTalent(id: string): LearnCheck {
    if (!this.state.hasGame) return 'unknown';
    const player = this.state.data.player;
    const result = learnTalent(id, player.level, player.talents, TALENTS);
    if (result === 'ok') {
      this.state.markDirty();
      this.bus.emit('talent:learned', { talent: id, rank: player.talents[id] ?? 0 });
    }
    return result;
  }

  /** O que passa a estar disponível exatamente no nível `level`. */
  unlockedAt(level: number): Unlocked {
    const { recipes, structures, zones } = this.content();
    const learned = this.state.data.unlocks.recipes;
    return {
      recipes: recipes.filter((r) => r.unlockLevel === level && !learned.includes(r.id)).map((r) => r.id),
      structures: Object.entries(structures)
        .filter(([, def]) => def.unlockLevel === level)
        .map(([id]) => id),
      zones: Object.entries(zones)
        .filter(([, def]) => def.unlockLevel === level && !def.hidden)
        .map(([id]) => id),
    };
  }
}
