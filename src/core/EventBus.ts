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
  /** A vida chegou a 0; o jogador já reapareceu na base (CLAUDE.md §7.12). */
  'player:died': { zoneId: string };
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
