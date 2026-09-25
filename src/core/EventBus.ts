export type Handler<T> = (payload: T) => void;

/**
 * Mapa de eventos do jogo: nome → payload. Cada evento novo é declarado aqui,
 * com nomes `dominio:acao` (ex.: `item:added`, `player:damaged`).
 */
export interface GameEvents {
  /** Um jogo novo começou (o GameState acabou de ser criado). */
  'game:started': { zoneId: string };
  /** A lógica avançou um tick de passo fixo. */
  'world:tick': { tick: number };
  /** A vida chegou a 0; o jogador já reapareceu na base (CLAUDE.md §7.12). `bag` = deixou mochila. */
  'player:died': { zoneId: string; bag: boolean };
  /** O jogador levou dano (já descontada a armadura). */
  'player:damaged': { amount: number; x: number; y: number };
  /** Um golpe acertou num inimigo. */
  'enemy:hit': { uid: number; damage: number; x: number; y: number };
  'enemy:killed': { uid: number; enemy: string; x: number; y: number };
  /** Um inchado foi derrotado e vai rebentar (aviso). */
  'enemy:dying': { uid: number };
  'enemy:exploded': { x: number; y: number; radius: number };
  /** Um gritador gritou (os inimigos à volta ficam alertados). */
  'enemy:scream': { uid: number; x: number; y: number; radius: number };
  /** O jogador começou a sangrar (uma ligadura estanca). */
  'player:bleeding': Record<string, never>;
  /** Mochilas no chão de uma zona mudaram. */
  'bag:changed': { zoneId: string };
  /** O jogador pisou uma saída: vai para a zona `to` (null = abre o mapa-mundo). */
  'zone:change': { from: string; to: string | null; exit: { x: number; y: number } };
  /** O jogador fez a ação contextual (para a animação de ataque/recolha). */
  'player:action': { kind: 'gather' | 'use' | 'open' | 'swing' | 'attack' };
  /** Um recurso levou um golpe (hp restante; 0 = apanhado). */
  'resource:hit': { zoneId: string; objectId: number; resource: string; hp: number; maxHp: number };
  'resource:respawned': { zoneId: string; objectId: number };
  /** Itens ganhos num sítio do mundo (texto flutuante). */
  'item:gained': { item: string; qty: number; x: number; y: number };
  /** Algum contentor do jogador ou baú mudou (a UI redesenha-se). */
  'inventory:changed': Record<string, never>;
  /** Uma ferramenta chegou a 0 de durabilidade e partiu-se. */
  'item:broken': { item: string };
  'player:consumed': { item: string };
  /** A ação não foi possível (a UI mostra o motivo). */
  'action:blocked': {
    reason:
      | 'needs_tool'
      | 'inventory_full'
      | 'door_blocked'
      | 'needs_rod'
      | 'needs_seeds'
      | 'needs_water'
      | 'crop_growing'
      | 'nothing_yet'
      | 'needs_item';
    tool?: string;
    /** needs_item: o item que falta. */
    item?: string;
    /** crop_growing: horas de jogo que faltam. */
    hours?: number;
  };
  /** Colheita num canteiro da horta (dá XP). */
  'crop:harvested': { crop: string };
  /** Recolheu o que uma peça produziu (coletor, armadilha). */
  'produce:collected': { uid: number };
  /** Pesca (Fase 7): começou o mini-jogo; acabou (apanhou ou não); encheu uma garrafa no lago. */
  'fishing:started': Record<string, never>;
  'fishing:result': { caught: boolean };
  'fishing:filled': Record<string, never>;
  /** Peça construída colocada (CLAUDE.md §7.7). */
  'structure:placed': { uid: number };
  /** Peça demolida ou desfeita. */
  'structure:removed': { uid: number };
  /** Uma peça mudou de estado (porta aberta/fechada). */
  'structure:changed': { uid: number };
  /** Uma horda bateu numa peça (ou uma armadilha gastou-se um pouco). */
  'structure:damaged': { uid: number; amount: number; x: number; y: number };
  /** A peça foi destruída (vida a 0) ou a armadilha gastou-se toda. */
  'structure:destroyed': { uid: number; x: number; y: number };
  'structure:repaired': { uid: number };
  /** Chegou a um piso novo de uma masmorra (fica como checkpoint). */
  'dungeon:checkpoint': { floor: number };
  /** Um chefe foi derrotado (só volta daqui a uns dias). */
  'boss:defeated': { enemy: string };
  /** Troca feita com o comerciante (não dá XP). */
  traded: { item: string };
  /** Co-op: o parceiro levou dano, caiu ou voltou. */
  'partner:damaged': { amount: number; x: number; y: number };
  'partner:down': Record<string, never>;
  'partner:revived': Record<string, never>;
  /** Co-op: o parceiro fez uma ação (para a animação). */
  'partner:action': { kind: 'gather' | 'attack' | 'swing' };
  /** Co-op: ligou-se/desligou-se alguém (o HUD atualiza o estado). */
  'coop:changed': Record<string, never>;
  /** Hordas (§7.13). */
  'horde:started': { size: number };
  'horde:ended': { won: boolean };
  /** Abrir um baú (`chest:<id>`) ou contentor com loot (`loot:<zona>:<id>`), ao lado da mochila. */
  'container:open': { container: `chest:${string}` | `loot:${string}` };
  /** Abrir o painel de crafting de uma estação (`<tipo>_<id do objeto>`). */
  'station:open': { stationKey: string };
  /** Um craft terminou (mãos: já está no inventário; estação: à espera de ser recolhido). */
  'craft:finished': { stationKey: string; item: string; recipe: string };
  /** Um contentor sorteou loot (aberto pela primeira vez, ou depois de voltar a encher). */
  'loot:rolled': { table: string };
  /** XP ganho e subida de nível (com o que ficou desbloqueado). */
  'xp:gained': { amount: number };
  'player:levelUp': { level: number; unlocked: { recipes: string[]; structures: string[]; zones: string[] } };
  /** Receita aprendida numa nota. */
  'recipe:learned': { recipe: string };
  /** Leu uma nota de uma receita que já sabia. */
  'note:known': { recipe: string };
}

/** Emissor de eventos tipado e sem dependências do Phaser (testável com Vitest). */
export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscreve um evento. Devolve a função que cancela a subscrição. */
  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      this.off(event, handler);
    };
  }

  /** Subscreve só a próxima emissão. Para cancelar antes, usar a função devolvida. */
  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Cópia: um handler pode subscrever/cancelar durante a emissão sem afetar esta volta.
    for (const handler of [...set]) {
      (handler as Handler<Events[K]>)(payload);
    }
  }

  listenerCount(event: keyof Events): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /** Remove todos os handlers (de um evento, ou de todos). */
  clear(event?: keyof Events): void {
    if (event === undefined) this.handlers.clear();
    else this.handlers.delete(event);
  }
}

/** Barramento global do jogo. */
export const eventBus = new EventBus<GameEvents>();
