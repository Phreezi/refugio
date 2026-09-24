import type { ItemDefs } from '../data/types';
import { addItem, removeItem, type Container } from '../systems/inventory/inventory';
import { secondsToTicks } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import type { GameState } from './GameState';
import type { PlayerActions } from './PlayerActions';
import { nextRandom } from './Rng';

/** Segundos que o marcador leva a ir de uma ponta à outra da barra. */
const SWEEP_SEC = 0.9;
/** Largura da zona verde (fração da barra). */
const ZONE_WIDTH = 0.2;

export interface FishingSession {
  startTick: number;
  /** Centro da zona verde (0–1). */
  zone: number;
  width: number;
}

/** Posição do marcador (0–1, vai e volta) `ticks` depois de começar. */
export function fishingMarker(ticks: number, sweepTicks: number): number {
  const cycle = ticks % (2 * sweepTicks);
  return cycle <= sweepTicks ? cycle / sweepTicks : 2 - cycle / sweepTicks;
}

/**
 * Pesca simples (CLAUDE.md §11, Fase 7): num cais, com a cana, um mini-jogo de 1 botão — o
 * marcador anda para a frente e para trás e apanha-se o peixe carregando com ele na zona verde.
 * Sem cana mas com uma garrafa vazia, enche-se a garrafa com água (suja) do lago.
 */
export class Fishing {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly actions: PlayerActions;
  private readonly items: () => ItemDefs;
  private current: FishingSession | null = null;
  private readonly sweepTicks = secondsToTicks(SWEEP_SEC);

  constructor(state: GameState, bus: EventBus<GameEvents>, actions: PlayerActions, items: () => ItemDefs) {
    this.state = state;
    this.bus = bus;
    this.actions = actions;
    this.items = items;
  }

  get session(): FishingSession | null {
    return this.current;
  }

  get active(): boolean {
    return this.current !== null;
  }

  /** Posição atual do marcador (0–1). */
  get marker(): number {
    const session = this.current;
    if (!session) return 0;
    return fishingMarker(this.state.data.world.tick - session.startTick, this.sweepTicks);
  }

  /** Começa a pescar (ou enche uma garrafa, se não houver cana). */
  start(): void {
    if (this.current) return;
    const containers = this.actions.pickupContainers();
    if (this.rod(containers)) {
      const world = this.state.data.world;
      this.current = {
        startTick: world.tick,
        zone: 0.25 + nextRandom(world) * 0.6,
        width: ZONE_WIDTH,
      };
      this.bus.emit('fishing:started', {});
      return;
    }
    if (removeItem(containers, 'empty_bottle', 1)) {
      addItem(containers, 'water_dirty', 1, this.items());
      this.state.markDirty();
      this.bus.emit('inventory:changed', {});
      this.bus.emit('fishing:filled', {});
      return;
    }
    this.bus.emit('action:blocked', { reason: 'needs_rod' });
  }

  /** Carregar no botão: apanha o peixe se o marcador estiver na zona verde. */
  strike(): void {
    const session = this.current;
    if (!session) return;
    const caught = Math.abs(this.marker - session.zone) <= session.width / 2 || this.hit(session);
    this.current = null;
    const containers = this.actions.pickupContainers();
    const rod = this.rod(containers);
    if (rod) {
      const slot = rod.container[rod.index];
      if (slot?.[2] !== undefined) {
        slot[2] -= 1;
        if (slot[2] <= 0) {
          rod.container[rod.index] = null;
          this.bus.emit('item:broken', { item: slot[0] });
        }
      }
    }
    if (caught && addItem(containers, 'fish', 1, this.items()) > 0) {
      this.bus.emit('action:blocked', { reason: 'inventory_full' });
    }
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
    this.bus.emit('fishing:result', { caught });
  }

  cancel(): void {
    if (!this.current) return;
    this.current = null;
    this.bus.emit('fishing:result', { caught: false });
  }

  /** O marcador visto pelo jogador é o do tick anterior ao clique: aceita-se também esse. */
  private hit(session: FishingSession): boolean {
    const ticks = this.state.data.world.tick - session.startTick;
    const before = fishingMarker(Math.max(0, ticks - 1), this.sweepTicks);
    return Math.abs(before - session.zone) <= session.width / 2;
  }

  private rod(containers: readonly Container[]): { container: Container; index: number } | null {
    for (const container of containers) {
      const index = container.findIndex((slot) => slot?.[0] === 'fishing_rod');
      if (index >= 0) return { container, index };
    }
    return null;
  }
}
