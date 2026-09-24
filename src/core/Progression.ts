import { BALANCE } from '../data/balance';
import type { EnemyDefs, Recipe, Recipes, ResourceDefs, StructureDefs, ZoneDefs } from '../data/types';
import { addXp } from '../systems/progression/progression';
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

  /** Soma XP; ao subir de nível avisa com o que ficou desbloqueado. */
  gain(amount: number): void {
    if (!this.state.hasGame || amount <= 0) return;
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
    this.state.data.unlocks.recipes.push(recipeId);
    this.state.markDirty();
    this.bus.emit('recipe:learned', { recipe: recipeId });
    return 'learned';
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
        .filter(([, def]) => def.unlockLevel === level)
        .map(([id]) => id),
    };
  }
}
