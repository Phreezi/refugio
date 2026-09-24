import type { EventBus, GameEvents } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { SaveManager } from './SaveManager';

/** Debounce das gravações pedidas (CLAUDE.md §10.2: não gravar várias vezes seguidas). */
export const SAVE_DEBOUNCE_MS = 500;

/**
 * Quando gravar (CLAUDE.md §10.2): a cada `everyTicks` de jogo se houver alterações, logo a
 * seguir a eventos importantes (morte; depois: zona, craft, construção, nível) e em `flush()`
 * (separador escondido, saída da cena). Nunca bloqueia: as escritas encadeiam-se em fundo.
 */
export class Autosave {
  private readonly saves: SaveManager;
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly everyTicks: number;
  private readonly debounceMs: number;
  private unsubscribers: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    saves: SaveManager,
    state: GameState,
    bus: EventBus<GameEvents>,
    everyTicks: number,
    debounceMs = SAVE_DEBOUNCE_MS,
  ) {
    this.saves = saves;
    this.state = state;
    this.bus = bus;
    this.everyTicks = everyTicks;
    this.debounceMs = debounceMs;
  }

  get running(): boolean {
    return this.unsubscribers.length > 0;
  }

  start(): void {
    if (this.running) return;
    this.unsubscribers = [
      this.bus.on('world:tick', ({ tick }) => {
        if (tick % this.everyTicks === 0) this.request();
      }),
      this.bus.on('player:died', () => {
        this.request();
      }),
      // CLAUDE.md §10.2: gravar logo no fim de um craft e ao construir/demolir.
      this.bus.on('craft:finished', () => {
        this.request();
      }),
      this.bus.on('structure:placed', () => {
        this.request();
      }),
      this.bus.on('structure:removed', () => {
        this.request();
      }),
    ];
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  /** Pede uma gravação (com debounce); só grava se houver alterações. */
  request(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, this.debounceMs);
  }

  /** Grava já (se houver alterações). A promessa resolve quando a escrita terminar. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.write();
  }

  /**
   * Grava já, de forma síncrona (cópia de emergência): para `pagehide`/separador escondido,
   * quando o browser pode cortar escritas assíncronas. Se não houver armazenamento síncrono,
   * recorre ao `flush()` normal.
   */
  flushSync(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.state.hasGame || !this.state.dirty) return;
    if (this.saves.saveSync(this.state.data)) this.state.markSaved();
    else void this.write();
  }

  private write(): Promise<void> {
    if (!this.state.hasGame || !this.state.dirty) return this.writing;
    const data = this.state.data;
    this.state.markSaved();
    // save() serializa já; a escrita em si espera pela anterior (nunca duas ao mesmo tempo).
    const saving = this.saves.save(data);
    this.writing = this.writing
      .then(() => saving)
      .catch((error: unknown) => {
        console.error('[save] falhou a gravação:', error);
        this.state.markDirty(); // tenta de novo na próxima oportunidade
      });
    return this.writing;
  }
}
