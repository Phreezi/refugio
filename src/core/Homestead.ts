import { BALANCE } from '../data/balance';
import type { ItemDefs, ProduceDef } from '../data/types';
import { structureFeet } from '../systems/building/building';
import { addItem, countItem, fitsAll, removeItem, type Container } from '../systems/inventory/inventory';
import type { Building } from './Building';
import { secondsToTicks } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import type { GameState } from './GameState';
import type { PlayerActions } from './PlayerActions';
import { randomInt } from './Rng';

/** Estado de um canteiro: vazio, plantado por regar, a crescer ou pronto a colher. */
export type CropStage = 'empty' | 'dry' | 'growing' | 'ready';

/** Ticks de jogo em `hours` horas de jogo. */
export function hoursToTicks(hours: number): number {
  return secondsToTicks((hours * BALANCE.dayLengthSec) / 24);
}

/** Unidades prontas a recolher numa peça que produz (limitadas a `max`). */
export function producedUnits(produce: ProduceDef, since: number, tick: number): number {
  return Math.min(produce.max, Math.floor(Math.max(0, tick - since) / hoursToTicks(produce.everyHours)));
}

/**
 * Base avançada (CLAUDE.md §11, Fase 9): a horta (plantar uma semente, regar, colher) e as peças
 * que produzem sozinhas com o tempo de jogo (coletor de água da chuva, armadilha de caça).
 * O estado vive em `base.crops` e `base.produce` (pelo uid da peça); os prazos são ticks.
 */
export class Homestead {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly actions: PlayerActions;
  private readonly building: Building;
  private readonly items: () => ItemDefs;

  constructor(
    state: GameState,
    bus: EventBus<GameEvents>,
    actions: PlayerActions,
    building: Building,
    items: () => ItemDefs,
  ) {
    this.state = state;
    this.bus = bus;
    this.actions = actions;
    this.building = building;
    this.items = items;
  }

  /** Semente plantada no canteiro `uid` (ou undefined). */
  seedOf(uid: number): string | undefined {
    return this.state.data.base.crops[String(uid)]?.[0];
  }

  stage(uid: number): CropStage {
    const crop = this.state.data.base.crops[String(uid)];
    if (!crop) return 'empty';
    if (crop[1] === null) return 'dry';
    return this.state.data.world.tick >= crop[1] ? 'ready' : 'growing';
  }

  /** Horas de jogo que faltam para o canteiro estar pronto (0 se não estiver a crescer). */
  hoursLeft(uid: number): number {
    const readyAt = this.state.data.base.crops[String(uid)]?.[1];
    if (readyAt === undefined || readyAt === null) return 0;
    return Math.max(0, Math.ceil((readyAt - this.state.data.world.tick) / hoursToTicks(1)));
  }

  /** Unidades prontas a recolher na peça `uid` (coletor, armadilha). */
  produced(uid: number): number {
    const produce = this.produceDef(uid);
    const since = this.state.data.base.produce[String(uid)];
    return produce && since !== undefined ? producedUnits(produce, since, this.state.data.world.tick) : 0;
  }

  /** Ação contextual num canteiro: planta, rega ou colhe, conforme o estado. */
  usePlot(uid: number): void {
    const stage = this.stage(uid);
    if (stage === 'empty') this.plant(uid);
    else if (stage === 'dry') this.water(uid);
    else if (stage === 'growing')
      this.bus.emit('action:blocked', { reason: 'crop_growing', hours: this.hoursLeft(uid) });
    else this.harvest(uid);
  }

  private plant(uid: number): void {
    const items = this.items();
    const containers = this.actions.pickupContainers();
    const seed = firstItem(containers, (id) => items[id]?.plant !== undefined);
    if (!seed) {
      this.bus.emit('action:blocked', { reason: 'needs_seeds' });
      return;
    }
    removeItem(containers, seed, 1);
    this.state.data.base.crops[String(uid)] = [seed, null];
    this.changed(uid);
  }

  private water(uid: number): void {
    const items = this.items();
    const containers = this.actions.pickupContainers();
    // Primeiro a água pior (a suja serve bem para regar).
    const waters = Object.keys(items)
      .filter((id) => items[id]?.waters === true && countItem(containers, id) > 0)
      .sort((a, b) => (items[a]?.effects?.thirst ?? 0) - (items[b]?.effects?.thirst ?? 0));
    const water = waters[0];
    const crop = this.state.data.base.crops[String(uid)];
    const plant = crop ? items[crop[0]]?.plant : undefined;
    if (!water || !crop || !plant) {
      this.bus.emit('action:blocked', { reason: 'needs_water' });
      return;
    }
    removeItem(containers, water, 1);
    const bottle = items[water]?.returns;
    if (bottle && addItem(containers, bottle, 1, items) > 0) {
      addItem(containers, water, 1, items); // a garrafa não cabe: fica tudo como estava
      this.bus.emit('action:blocked', { reason: 'inventory_full' });
      return;
    }
    crop[1] = this.state.data.world.tick + hoursToTicks(plant.growHours);
    this.bus.emit('player:action', { kind: 'gather' });
    this.changed(uid);
  }

  private harvest(uid: number): void {
    const items = this.items();
    const key = String(uid);
    const crop = this.state.data.base.crops[key];
    const plant = crop ? items[crop[0]]?.plant : undefined;
    if (!crop || !plant) return;
    const containers = this.actions.pickupContainers();
    // Nada se perde: só se colhe se o máximo possível couber.
    const most = [
      { item: plant.crop, qty: plant.yield[1] },
      { item: crop[0], qty: plant.seeds[1] },
    ];
    if (!fitsAll(containers, most, items)) {
      this.bus.emit('action:blocked', { reason: 'inventory_full' });
      return;
    }
    const rng = this.state.data.world;
    const gains = [
      { item: plant.crop, qty: randomInt(rng, plant.yield[0], plant.yield[1]) },
      { item: crop[0], qty: randomInt(rng, plant.seeds[0], plant.seeds[1]) },
    ].filter((g) => g.qty > 0);
    Reflect.deleteProperty(this.state.data.base.crops, key);
    const at = this.feet(uid);
    for (const { item, qty } of gains) {
      addItem(containers, item, qty, items);
      this.bus.emit('item:gained', { item, qty, ...at });
    }
    this.bus.emit('player:action', { kind: 'gather' });
    this.bus.emit('crop:harvested', { crop: plant.crop });
    this.changed(uid);
  }

  /** Ação contextual numa peça que produz: recolhe o que houver (gastando `needs`, se preciso). */
  collect(uid: number): void {
    const produce = this.produceDef(uid);
    const key = String(uid);
    const since = this.state.data.base.produce[key];
    if (!produce || since === undefined) return;
    const tick = this.state.data.world.tick;
    const every = hoursToTicks(produce.everyHours);
    const ready = producedUnits(produce, since, tick);
    if (ready === 0) {
      this.bus.emit('action:blocked', { reason: 'nothing_yet' });
      return;
    }
    const items = this.items();
    const containers = this.actions.pickupContainers();
    const needs = produce.needs;
    const allowed = needs ? Math.min(ready, countItem(containers, needs)) : ready;
    if (allowed === 0 && needs) {
      this.bus.emit('action:blocked', { reason: 'needs_item', item: needs });
      return;
    }
    const rng = this.state.data.world;
    const at = this.feet(uid);
    let taken = 0;
    const gained = new Map<string, number>();
    for (; taken < allowed; taken++) {
      const unit = produce.drops
        .map((d) => ({ item: d.item, qty: randomInt(rng, d.min, d.max) }))
        .filter((d) => d.qty > 0);
      // O item gasto (garrafa) liberta espaço: tira-se primeiro e devolve-se se não couber.
      if (needs) removeItem(containers, needs, 1);
      if (!fitsAll(containers, unit, items)) {
        if (needs) addItem(containers, needs, 1, items);
        break;
      }
      for (const d of unit) {
        addItem(containers, d.item, d.qty, items);
        gained.set(d.item, (gained.get(d.item) ?? 0) + d.qty);
      }
    }
    if (taken === 0) {
      this.bus.emit('action:blocked', { reason: 'inventory_full' });
      return;
    }
    // O que fica por recolher continua a contar; o tempo a meio de uma unidade não se perde.
    const partial = ready < produce.max ? (tick - since) % every : 0;
    this.state.data.base.produce[key] = tick - (ready - taken) * every - partial;
    for (const [item, qty] of gained) this.bus.emit('item:gained', { item, qty, ...at });
    this.bus.emit('player:action', { kind: 'gather' });
    this.bus.emit('produce:collected', { uid });
    this.changed(uid);
  }

  private produceDef(uid: number): ProduceDef | undefined {
    const record = this.building.get(uid);
    return record ? this.building.def(record[1])?.produce : undefined;
  }

  private feet(uid: number): { x: number; y: number } {
    const record = this.building.get(uid);
    const def = record ? this.building.def(record[1]) : undefined;
    if (!record || !def) return { x: 0, y: 0 };
    return structureFeet(def, record[2], record[3], this.building.tileSize);
  }

  private changed(uid: number): void {
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
    this.bus.emit('structure:changed', { uid });
  }
}

/** Primeiro item (mochila, depois hotbar) que satisfaz `match`. */
function firstItem(containers: readonly Container[], match: (id: string) => boolean): string | undefined {
  for (const container of containers) {
    for (const slot of container) if (slot && match(slot[0])) return slot[0];
  }
  return undefined;
}
