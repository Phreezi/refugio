/** Contentores que abrem ao lado da mochila. */
export type OtherContainerRef = `chest:${string}` | `loot:${string}` | `bag:${string}`;

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
  /** Um golpe ou tiro falhou (perícia baixa, §7.8): "Falhou" por cima do alvo. */
  'enemy:missed': { x: number; y: number };
  /** Uma perícia de combate subiu de nível. */
  'skill:levelUp': { skill: string; level: number };
  'talent:learned': { talent: string; rank: number };
  'talents:reset': Record<string, never>;
  'item:enchanted': { item: string; level: number };
  /** O corpo de um inimigo desapareceu do chão (fumo em x, y). */
  'corpse:gone': { uid: number; x: number; y: number };
  /** Os itens soltos no chão da zona mudaram (flechas caídas ou apanhadas). */
  'ground:changed': { zoneId: string };
  'enemy:exploded': { x: number; y: number; radius: number };
  /** Um gritador gritou (os inimigos à volta ficam alertados). */
  'enemy:scream': { uid: number; x: number; y: number; radius: number };
  'enemy:spit': { uid: number; x: number; y: number };
  /** O jogador começou a sangrar (uma ligadura estanca). */
  'player:bleeding': Record<string, never>;
  /** Mochilas no chão de uma zona mudaram. */
  'bag:changed': { zoneId: string };
  /** O jogador pisou uma saída: vai para a zona `to` (null = abre o mapa-mundo). */
  'zone:change': { from: string; to: string | null; exit: { x: number; y: number } };
  /** Mundo contínuo (Etapa E): passou a borda para a zona vizinha; (x, y) já nas coordenadas dela. */
  'zone:cross': { from: string; to: string; x: number; y: number };
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
  /** Comida com efeito temporário (§7.17). */
  'buff:started': { item: string; effect: string; value: number; hours: number };
  /** NPCs e missões (§7.18). `npc:talk` abre a conversa; `npc:talked` já contou para as missões. */
  'npc:talk': { npc: string };
  'npc:talked': { npc: string };
  'quest:accepted': { quest: string };
  'quest:done': { quest: string };
  'quests:changed': Record<string, never>;
  /** Usou um pergaminho de viagem: abre o teletransporte a partir de onde está. */
  'scroll:use': Record<string, never>;
  /** Poste de teletransporte ativado pela primeira vez / usado (Etapa E). */
  'waystone:activated': { zoneId: string };
  'waystone:use': { zoneId: string };
  /** Encomenda entregue à porta de casa (§7.17). */
  'order:arrived': { item: string; qty: number };
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
      | 'needs_item'
      | 'no_ammo'
      | 'needs_level'
      | 'zone_level'
      | 'post_broken'
      | 'food_only';
    tool?: string;
    /** needs_item: o item que falta; no_ammo: a munição da arma. */
    item?: string;
    /** crop_growing: horas de jogo que faltam. */
    hours?: number;
    /** needs_level: nível do jogador que é preciso. */
    level?: number;
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
  /** Co-op: ligou-se/desligou-se alguém (o HUD atualiza o estado). */
  'coop:changed': Record<string, never>;
  /** Hordas (§7.13). */
  'horde:started': { size: number };
  'horde:ended': { won: boolean };
  /**
   * Abrir um baú (`chest:<id>`), contentor com loot (`loot:<zona>:<id>`) ou mochila/pilha no
   * chão (`bag:<zona>:<índice>`), ao lado da mochila.
   */
  'container:open': { container: OtherContainerRef };
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
  /**
   * No jogo, um erro num handler (som, texto a subir…) é reportado e os outros handlers
   * continuam: sem isto, a exceção subia até ao ciclo do Phaser e o jogo congelava. Sem
   * handler (testes), o erro propaga-se.
   */
  static onListenerError: ((error: unknown, event: string) => void) | null = null;

  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();
  private readonly anyHandlers = new Set<(event: keyof Events, payload: unknown) => void>();

  /** Subscreve todos os eventos (co-op: reenviar ao outro jogador). Devolve o cancelamento. */
  onAny(handler: (event: keyof Events, payload: unknown) => void): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

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
    for (const handler of [...this.anyHandlers])
      this.call(event, () => {
        handler(event, payload);
      });
    const set = this.handlers.get(event);
    if (!set) return;
    // Cópia: um handler pode subscrever/cancelar durante a emissão sem afetar esta volta.
    for (const handler of [...set]) {
      this.call(event, () => {
        (handler as Handler<Events[K]>)(payload);
      });
    }
  }

  private call(event: keyof Events, run: () => void): void {
    const report = EventBus.onListenerError;
    if (!report) {
      run();
      return;
    }
    try {
      run();
    } catch (error) {
      report(error, String(event));
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
