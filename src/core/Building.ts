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

interface BuildSiteState {
  grid: StructureGrid | null;
  resourceTiles: Map<number, number[]>;
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
  /**
   * Grelha das peças e recursos do mapa por tile (onde estão por apanhar não se constrói). No
   * co-op, com os dois jogadores na mesma zona, o convidado usa a do anfitrião.
   */
  private site: BuildSiteState = { grid: null, resourceTiles: new Map() };
  private linked = false;
  private zone: ZoneContext | null = null;
  /** A peça está desbloqueada (nível)? Por omissão, todas. */
  isUnlocked: (id: string) => boolean = () => true;
  /** Peças colocadas nesta sessão, para o Desfazer (não se grava). */
  private recent: { uid: number; tick: number }[] = [];

  constructor(state: GameState, bus: EventBus<GameEvents>, actions: PlayerActions) {
    this.state = state;
    this.bus = bus;
    this.actions = actions;
  }

  private get grid(): StructureGrid | null {
    return this.site.grid;
  }

  private set grid(grid: StructureGrid | null) {
    this.site.grid = grid;
  }

  private get resourceTiles(): Map<number, number[]> {
    return this.site.resourceTiles;
  }

  private set resourceTiles(tiles: Map<number, number[]>) {
    this.site.resourceTiles = tiles;
  }

  /** Co-op: usa a grelha de `primary` (os dois jogadores na mesma zona). */
  link(primary: Building): void {
    this.site = primary.site;
    this.zone = primary.zone;
    this.linked = true;
  }

  /** Co-op: deixa de partilhar (fica com a grelha atual como sua). */
  unlink(): void {
    if (!this.linked) return;
    this.site = { grid: this.site.grid, resourceTiles: this.site.resourceTiles };
    this.linked = false;
  }

  /**
   * Refaz a grelha e as colisões a partir do estado (co-op: o convidado recebeu o mundo do
   * anfitrião, com peças que podem ter mudado).
   */
  resync(): void {
    const collision = this.zone?.collision;
    if (collision) for (const record of this.structures()) collision.removeKeyed(collisionKey(record[0]));
    this.setZone(this.zone);
  }

  /** Só se constrói na base; noutras zonas (e fora do jogo) fica indisponível. */
  setZone(zone: ZoneContext | null): void {
    if (this.linked) {
      this.linked = false;
      this.site = { grid: null, resourceTiles: new Map() };
    }
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
    // Vedações construídas antes de se ligarem sozinhas (e as de jogos antigos) acertam-se já.
    for (const record of [...this.grid.all()]) if (this.def(record[1])?.connects) this.connect(record);
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
    // Uma porta ou janela por cima de uma parede troca-a (a parede volta toda para a mochila).
    if (this.swapTarget(id, tx, ty)) {
      const containers = this.actions.pickupContainers();
      return def.cost.some(({ item, qty }) => countItem(containers, item) < qty) ? 'no_materials' : null;
    }
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
    const swap = this.swapTarget(id, tx, ty);
    if (swap) {
      const swapProblem = this.check(id, tx, ty) ?? this.remove(swap, 100);
      if (swapProblem) return swapProblem;
    }
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
    if (def.connects) this.connect(record);
    this.changed();
    this.bus.emit('structure:placed', { uid });
    return null;
  }

  /**
   * Vedações: a peça nova e as vizinhas iguais viram-se para ligar umas às outras — com
   * vizinhas só em cima/em baixo ficam verticais; com vizinhas ao lado, horizontais. Sozinha,
   * fica como foi rodada.
   */
  private connect(record: StructureRecord): void {
    const grid = this.grid;
    if (!grid) return;
    const connected = (tx: number, ty: number): StructureRecord | undefined => {
      const top = grid.at(tx, ty).top;
      return top && this.def(top[1])?.connects ? top : undefined;
    };
    const orient = (r: StructureRecord, isNew: boolean): void => {
      const [, , tx, ty] = r;
      const horizontal = connected(tx - 1, ty) ?? connected(tx + 1, ty);
      const vertical = connected(tx, ty - 1) ?? connected(tx, ty + 1);
      if (!horizontal && !vertical) return;
      const rot = horizontal ? 0 : 1;
      if (r[4] === rot) return;
      r[4] = rot;
      if (!isNew) this.bus.emit('structure:changed', { uid: r[0] });
    };
    orient(record, true);
    const [, , tx, ty] = record;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const neighbour = connected(tx + dx, ty + dy);
      if (neighbour) orient(neighbour, false);
    }
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

  /**
   * Parede que uma porta ou janela (`id`) pode substituir no tile: uma peça sólida simples
   * (sem porta, estação, baú, sem rodar nem ligar), sem dano de hordas.
   */
  private swapTarget(id: string, tx: number, ty: number): StructureRecord | null {
    const def = this.def(id);
    if (!def?.solid || !def.rotatable || def.connects || !this.grid) return null;
    const top = this.grid.at(tx, ty).top;
    const old = top ? this.def(top[1]) : undefined;
    if (!top || !old?.solid || old.door || old.rotatable || old.connects || old.station || old.chest)
      return null;
    if (this.state.data.base.damage[String(top[0])] !== undefined) return null;
    return top;
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
    this.forget(uid);
    this.recent = this.recent.filter((r) => r.uid !== uid);
    this.changed();
    this.bus.emit('structure:removed', { uid });
    const feet = structureFeet(def, tx, ty, this.tileSize);
    for (const { item, qty } of gains) this.bus.emit('item:gained', { item, qty, x: feet.x, y: feet.y });
    return null;
  }

  /** Apaga o estado de uma peça que desapareceu (produção, horta, dano). */
  private forget(uid: number): void {
    const base = this.state.data.base;
    Reflect.deleteProperty(base.produce, String(uid));
    Reflect.deleteProperty(base.crops, String(uid));
    Reflect.deleteProperty(base.damage, String(uid));
  }

  /** Peça sólida (fechada) no tile: o que uma horda tem de partir para passar. */
  solidAt(tx: number, ty: number): number | null {
    const top = this.grid?.at(tx, ty).top;
    const def = top ? this.def(top[1]) : undefined;
    if (!top || !def?.solid || def.hp === undefined || (def.door && top[5] === 1)) return null;
    return top[0];
  }

  /** Dano acumulado de uma peça (hordas) ou golpes dados (armadilhas). */
  damageOf(uid: number): number {
    return this.state.data.base.damage[String(uid)] ?? 0;
  }

  /** Vida máxima de uma peça contra hordas (armadilhas: golpes que aguentam). */
  maxHp(def: StructureDef): number {
    return def.hp ?? def.trap?.uses ?? 0;
  }

  /** Dano de uma horda numa peça; a 0 de vida desaparece (sem reembolso). */
  damageStructure(uid: number, amount: number): void {
    const record = this.grid?.get(uid);
    const def = record ? this.def(record[1]) : undefined;
    if (!record || !def || this.maxHp(def) === 0 || amount <= 0) return;
    const damage = this.damageOf(uid) + amount;
    this.state.data.base.damage[String(uid)] = damage;
    this.state.markDirty();
    const feet = structureFeet(def, record[2], record[3], this.tileSize);
    this.bus.emit('structure:damaged', { uid, amount, x: feet.x, y: feet.y });
    if (damage >= this.maxHp(def)) this.destroy(uid);
    else this.bus.emit('structure:changed', { uid });
  }

  /** Tira uma peça destruída pela horda (ou uma armadilha gasta): sem reembolso nem verificações. */
  destroy(uid: number): void {
    const record = this.grid?.get(uid);
    const def = record ? this.def(record[1]) : undefined;
    if (!record || !def || !this.grid) return;
    const data = this.state.data;
    const index = data.base.structures.indexOf(record);
    if (index >= 0) data.base.structures.splice(index, 1);
    this.grid.remove(uid);
    this.zone?.collision.removeKeyed(collisionKey(uid));
    this.forget(uid);
    this.recent = this.recent.filter((r) => r.uid !== uid);
    this.state.markDirty();
    const feet = structureFeet(def, record[2], record[3], this.tileSize);
    this.bus.emit('structure:removed', { uid });
    this.bus.emit('structure:destroyed', { uid, x: feet.x, y: feet.y });
  }

  /** Materiais para reparar uma peça danificada: `structureRepairPct`% do custo (mín. 1 de cada). */
  repairCost(id: string): { item: string; qty: number }[] {
    const def = this.def(id);
    if (!def) return [];
    return def.cost.map(({ item, qty }) => ({
      item,
      qty: Math.max(1, Math.ceil((qty * BALANCE.structureRepairPct) / 100)),
    }));
  }

  /** Repara uma peça danificada (fica como nova). @returns o item que falta, ou null se reparou. */
  repair(uid: number): string | null {
    const record = this.grid?.get(uid);
    if (!record || this.damageOf(uid) === 0) return null;
    const containers = this.actions.pickupContainers();
    const cost = this.repairCost(record[1]);
    const missing = cost.find(({ item, qty }) => countItem(containers, item) < qty);
    if (missing) return missing.item;
    for (const { item, qty } of cost) removeItem(containers, item, qty);
    Reflect.deleteProperty(this.state.data.base.damage, String(uid));
    this.changed();
    this.bus.emit('structure:repaired', { uid });
    this.bus.emit('structure:changed', { uid });
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
