import { LOOSE_OBJECT_AREA, PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { ItemDefs, StructureDef } from '../data/types';
import {
  createBuildSite,
  refund,
  tilesOf,
  structureCollision,
  structureFeet,
  StructureGrid,
  type BuildProblem,
  type StructureRecord,
} from '../systems/building/building';
import { addItem, countItem, removeItem, type Container, type Slot } from '../systems/inventory/inventory';
import { footprintRect, overlaps, type Rect } from '../systems/movement/geometry';
import { secondsToTicks } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import { BASE_ZONE_ID, zoneState, type GameState } from './GameState';
import type { ZoneContext } from './Interaction';
import type { PlayerActions } from './PlayerActions';

/** Chave de uma estação construída no save: `<tipo>_s<uid>` (ex.: `campfire_s3`). */
export function structureStationKey(station: string, uid: number): string {
  return `${station}_s${String(uid)}`;
}

/** Id de um baú construído em `base.chests`: `s<uid>`. */
export function structureChestId(uid: number): string {
  return `s${String(uid)}`;
}

/** Na grelha de colisões, as peças usam chaves negativas (as positivas são objetos do mapa). */
const collisionKey = (uid: number): number => -uid;

/**
 * Construção da base (CLAUDE.md §7.7): colocar peças (gastando materiais), desfazer nos
 * primeiros segundos com reembolso total, demolir com reembolso parcial, abrir/fechar portas.
 * Altera o GameState (a fonte de verdade), a grelha de colisões da zona e emite eventos.
 */
export class Building {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly actions: PlayerActions;
  private grid: StructureGrid | null = null;
  private zone: ZoneContext | null = null;
  /** Recursos do mapa por tile: onde estão por apanhar não se constrói. */
  private resourceTiles = new Map<number, number[]>();
  /** A peça está desbloqueada (nível)? Por omissão, todas. */
  isUnlocked: (id: string) => boolean = () => true;
  /** Peças colocadas nesta sessão, para o Desfazer (não se grava). */
  private recent: { uid: number; tick: number }[] = [];

  constructor(state: GameState, bus: EventBus<GameEvents>, actions: PlayerActions) {
    this.state = state;
    this.bus = bus;
    this.actions = actions;
  }

  /** Só se constrói na base; noutras zonas (e fora do jogo) fica indisponível. */
  setZone(zone: ZoneContext | null): void {
    this.zone = zone;
    this.recent = [];
    if (zone?.zoneId !== BASE_ZONE_ID) {
      this.grid = null;
      return;
    }
    const { map, resources, props, stations } = zone;
    const areaOf = (p: { x: number; y: number }, footprint?: { width: number; height: number }): Rect =>
      footprintRect(p, footprint ?? LOOSE_OBJECT_AREA);
    // Obstáculos sólidos bloqueiam sempre; decoração sem caixa (pedrinhas) não.
    const areas: Rect[] = [];
    for (const p of map.props) {
      const footprint = props[p.id]?.footprint;
      if (footprint) areas.push(footprintRect(p, footprint));
    }
    areas.push(...map.chests.map((p) => areaOf(p, props.chest?.footprint)));
    areas.push(...map.stations.map((p) => areaOf(p, stations[p.id]?.footprint)));
    // Recursos: só bloqueiam enquanto não forem apanhados (corta-se a árvore para construir).
    this.resourceTiles = new Map();
    for (const p of map.resources) {
      for (const tile of tilesOf(
        areaOf(p, resources[p.id]?.footprint),
        map.tileSize,
        map.width,
        map.height,
      )) {
        this.resourceTiles.set(tile, [...(this.resourceTiles.get(tile) ?? []), p.objectId]);
      }
    }
    const site = createBuildSite(map, areas, [map.playerSpawn, ...map.exits]);
    this.grid = new StructureGrid(site, zone.structures, this.state.data.base.structures);
    for (const record of this.grid.all()) this.applyCollision(record);
  }

  /** Há onde construir (o jogador está na base)? */
  get available(): boolean {
    return this.grid !== null;
  }

  get tileSize(): number {
    return this.grid?.site.tileSize ?? 16;
  }

  /** Peças colocadas (válidas) na zona atual. */
  structures(): StructureRecord[] {
    return this.grid ? [...this.grid.all()] : [];
  }

  /** Há peças por cima desta área? (um recurso apanhado só reaparece com o sítio livre) */
  covers(area: Rect): boolean {
    const grid = this.grid;
    if (!grid) return false;
    const { tileSize, width, height } = grid.site;
    return grid.covers(tilesOf(area, tileSize, width, height));
  }

  get(uid: number): StructureRecord | undefined {
    return this.grid?.get(uid);
  }

  def(id: string): StructureDef | undefined {
    return this.zone?.structures[id];
  }

  /** Pode-se pôr a peça `id` em (tx, ty) agora? (inclui materiais) null = sim. */
  check(id: string, tx: number, ty: number): BuildProblem | null {
    const grid = this.grid;
    const def = this.def(id);
    if (!grid || !def) return 'unknown';
    if (!this.isUnlocked(id)) return 'locked';
    const depleted = zoneState(this.state.data, BASE_ZONE_ID).depleted;
    const resourceHere = (tile: number): boolean =>
      this.resourceTiles.get(tile)?.some((objectId) => depleted[String(objectId)] === undefined) ?? false;
    const problem = grid.placementProblem(id, tx, ty, this.playerRect(), resourceHere);
    if (problem) return problem;
    const containers = this.actions.pickupContainers();
    if (def.cost.some(({ item, qty }) => countItem(containers, item) < qty)) return 'no_materials';
    return null;
  }

  place(id: string, tx: number, ty: number, rot: number): BuildProblem | null {
    const problem = this.check(id, tx, ty);
    const def = this.def(id);
    if (problem || !def || !this.grid) return problem ?? 'unknown';
    const containers = this.actions.pickupContainers();
    for (const { item, qty } of def.cost) removeItem(containers, item, qty);
    const base = this.state.data.base;
    const uid = base.nextStructureId++;
    const record: StructureRecord = [uid, id, tx, ty, def.rotatable ? rot & 1 : 0, 0];
    base.structures.push(record);
    // As peças que produzem começam a contar a partir de agora.
    if (def.produce) base.produce[String(uid)] = this.state.data.world.tick;
    this.grid.add(record);
    this.applyCollision(record);
    this.recent.push({ uid, tick: this.state.data.world.tick });
    this.changed();
    this.bus.emit('structure:placed', { uid });
    return null;
  }

  /** A peça que o Desfazer tiraria: a última colocada há menos de `undoWindowSec`. */
  undoable(): StructureRecord | null {
    const window = secondsToTicks(BALANCE.undoWindowSec);
    const now = this.state.data.world.tick;
    this.recent = this.recent.filter((r) => now - r.tick < window && this.grid?.get(r.uid));
    const last = this.recent[this.recent.length - 1];
    return last ? (this.grid?.get(last.uid) ?? null) : null;
  }

  /** Desfaz a última peça (reembolso total). */
  undo(): BuildProblem | null {
    const record = this.undoable();
    return record ? this.remove(record, 100) : 'unknown';
  }

  /** Peça que seria demolida no tile (a de cima primeiro). */
  demolishTarget(tx: number, ty: number): StructureRecord | null {
    return this.grid?.demolishTarget(tx, ty) ?? null;
  }

  /** Porque não se pode demolir (null = pode). */
  demolishProblem(record: StructureRecord): BuildProblem | null {
    const [uid, id] = record;
    const def = this.def(id);
    if (!def || !this.grid) return 'unknown';
    if (this.grid.supportsSomething(uid)) return 'supports';
    const data = this.state.data;
    if (def.station) {
      const station = data.stations[structureStationKey(def.station, uid)];
      if (station && (station.queue.length > 0 || station.output.some((slot) => slot !== null)))
        return 'station_busy';
    }
    if (def.chest && data.base.chests[structureChestId(uid)]?.some((slot) => slot !== null))
      return 'chest_not_empty';
    if (def.farm && data.base.crops[String(uid)]) return 'plot_busy';
    return null;
  }

  /** Reembolso de demolir agora: total se ainda estiver na janela do Desfazer. */
  demolishRefund(record: StructureRecord): { item: string; qty: number }[] {
    const def = this.def(record[1]);
    if (!def) return [];
    return refund(def.cost, this.isRecent(record[0]) ? 100 : BALANCE.demolishRefundPct);
  }

  /** Demolir a peça do tile (a de cima primeiro). */
  demolish(tx: number, ty: number): BuildProblem | null {
    const record = this.demolishTarget(tx, ty);
    if (!record) return 'unknown';
    return this.remove(record, this.isRecent(record[0]) ? 100 : BALANCE.demolishRefundPct);
  }

  /** Abre ou fecha uma porta (não fecha em cima do jogador). */
  toggleDoor(uid: number): BuildProblem | null {
    const record = this.grid?.get(uid);
    const def = record ? this.def(record[1]) : undefined;
    if (!record || !def?.door) return 'unknown';
    const closing = record[5] === 1;
    if (closing) {
      const rect = structureCollision(def, record[2], record[3], this.tileSize);
      if (rect && overlaps(rect, this.playerRect())) return 'door_blocked';
    }
    record[5] = closing ? 0 : 1;
    this.applyCollision(record);
    this.state.markDirty();
    this.bus.emit('structure:changed', { uid });
    return null;
  }

  private isRecent(uid: number): boolean {
    this.undoable(); // limpa as que já saíram da janela
    return this.recent.some((r) => r.uid === uid);
  }

  private remove(record: StructureRecord, pct: number): BuildProblem | null {
    const problem = this.demolishProblem(record);
    const def = this.def(record[1]);
    if (problem || !def || !this.grid) return problem ?? 'unknown';
    const [uid, , tx, ty] = record;
    const items = this.itemDefs();
    const gains = refund(def.cost, pct);
    const containers = this.actions.pickupContainers();
    const saved = snapshot(containers);
    for (const { item, qty } of gains) {
      if (addItem(containers, item, qty, items) > 0) {
        restore(containers, saved); // "nada se perde": só demole se o reembolso couber
        return 'inventory_full';
      }
    }
    const data = this.state.data;
    const index = data.base.structures.indexOf(record);
    if (index >= 0) data.base.structures.splice(index, 1);
    this.grid.remove(uid);
    this.zone?.collision.removeKeyed(collisionKey(uid));
    if (def.station) Reflect.deleteProperty(data.stations, structureStationKey(def.station, uid));
    if (def.chest) Reflect.deleteProperty(data.base.chests, structureChestId(uid));
    Reflect.deleteProperty(data.base.produce, String(uid));
    Reflect.deleteProperty(data.base.crops, String(uid));
    this.recent = this.recent.filter((r) => r.uid !== uid);
    this.changed();
    this.bus.emit('structure:removed', { uid });
    const feet = structureFeet(def, tx, ty, this.tileSize);
    for (const { item, qty } of gains) this.bus.emit('item:gained', { item, qty, x: feet.x, y: feet.y });
    return null;
  }

  private applyCollision(record: StructureRecord): void {
    const collision = this.zone?.collision;
    const def = this.def(record[1]);
    if (!collision || !def) return;
    const key = collisionKey(record[0]);
    const rect = structureCollision(def, record[2], record[3], this.tileSize, record[5] === 1);
    if (rect) collision.addKeyed(key, rect);
    else collision.removeKeyed(key);
  }

  private playerRect(): Rect {
    return footprintRect(this.state.data.player, PLAYER_FOOTPRINT);
  }

  private itemDefs(): ItemDefs {
    return this.zone?.items ?? {};
  }

  private changed(): void {
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
  }
}

function snapshot(containers: readonly Container[]): (Slot | null)[][] {
  return containers.map((c) => c.map((slot) => (slot ? [...slot] : null)));
}

function restore(containers: readonly Container[], saved: (Slot | null)[][]): void {
  containers.forEach((c, i) => {
    c.splice(0, c.length, ...(saved[i] ?? []));
  });
}
