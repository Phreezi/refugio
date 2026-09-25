import { LOOSE_OBJECT_AREA } from '../config';
import { BALANCE } from '../data/balance';
import type { ItemDefs, LootTables, PropDefs, ResourceDefs, StationDefs, StructureDefs } from '../data/types';
import { structureArea, structureFeet } from '../systems/building/building';
import { bestTool, hitPower, maxDrops, rollDrops, wearTool } from '../systems/gathering/gathering';
import { addItem, spaceFor } from '../systems/inventory/inventory';
import { pickTarget, type Target } from '../systems/interaction/targeting';
import type { CollisionWorld } from '../systems/movement/CollisionWorld';
import { footprintRect, type Rect } from '../systems/movement/geometry';
import type { ResourcePlacement, ZoneMap } from '../world/zoneMap';
import { secondsToTicks } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import { zoneState, type GameState } from './GameState';
import { structureChestId, structureStationKey, type Building } from './Building';
import type { Combat } from './Combat';
import type { Fishing } from './Fishing';
import type { Homestead } from './Homestead';
import { rollLoot } from '../systems/loot/loot';
import { stationKey } from './Crafting';
import type { PlayerActions } from './PlayerActions';

/** Tudo o que a lógica precisa de saber da zona onde o jogador está. */
export interface ZoneContext {
  zoneId: string;
  map: ZoneMap;
  collision: CollisionWorld;
  items: ItemDefs;
  resources: ResourceDefs;
  props: PropDefs;
  stations: StationDefs;
  structures: StructureDefs;
  lootTables: LootTables;
  /** Dias de jogo até os contentores voltarem a encher (zones.json; omisso = 1). */
  respawnDays?: number;
  /** Multiplicador de inimigos à noite (zones.json; omisso = 1). */
  nightEnemyMultiplier?: number;
}

/**
 * Alvo da ação contextual. `placement` = onde está (pés), para a seta da UI; nas peças
 * construídas, `objectId` é o uid negativo.
 */
export type TargetData =
  | { type: 'resource'; placement: ResourcePlacement }
  | { type: 'chest'; placement: ResourcePlacement; chestId: string }
  | { type: 'drink'; placement: ResourcePlacement }
  | { type: 'station'; placement: ResourcePlacement; key: string }
  | { type: 'door'; placement: ResourcePlacement; uid: number }
  | { type: 'enemy'; placement: ResourcePlacement; uid: number }
  | { type: 'bag'; placement: ResourcePlacement; index: number }
  | { type: 'loot'; placement: ResourcePlacement }
  | { type: 'plot'; placement: ResourcePlacement; uid: number }
  | { type: 'producer'; placement: ResourcePlacement; uid: number }
  | { type: 'repair'; placement: ResourcePlacement; uid: number }
  | { type: 'fish'; placement: ResourcePlacement };
/** Os recursos que reaparecem verificam-se uma vez por segundo de jogo. */
const RESPAWN_CHECK_TICKS = 20;

/**
 * Ação contextual e recolha (CLAUDE.md §7.2, §7.4): escolhe o alvo em frente, aplica golpes,
 * dá os drops, desgasta a ferramenta e faz os recursos reaparecerem com o tempo de jogo.
 * Corre dentro do passo fixo (Simulation); não usa o Phaser.
 */
export class Interaction {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly actions: PlayerActions;
  private readonly building: Building;
  private readonly combat: Combat;
  private readonly fishing: Fishing;
  private readonly homestead: Homestead;
  private zone: ZoneContext | null = null;
  /** Vida dos recursos já golpeados (não se grava: ao recarregar voltam a estar inteiros). */
  private readonly nodeHp = new Map<number, number>();

  constructor(
    state: GameState,
    bus: EventBus<GameEvents>,
    actions: PlayerActions,
    building: Building,
    combat: Combat,
    fishing: Fishing,
    homestead: Homestead,
  ) {
    this.state = state;
    this.bus = bus;
    this.actions = actions;
    this.building = building;
    this.combat = combat;
    this.fishing = fishing;
    this.homestead = homestead;
  }

  /** O contentor está vazio (já aberto e ainda sem voltar a encher)? */
  isLooted(objectId: number): boolean {
    const zone = this.zone;
    if (!zone) return false;
    const entry = zoneState(this.state.data, zone.zoneId).loot[String(objectId)];
    return entry !== undefined && this.state.data.world.tick < entry[0] && entry[1].every((s) => s === null);
  }

  /**
   * Abre um contentor (§7.10): na primeira vez (ou quando voltou a encher) sorteia o loot, que
   * fica guardado até ao fim de `respawnDays` dias de jogo. O painel mostra-o ao lado da mochila.
   */
  private openLoot(placement: ResourcePlacement): void {
    const zone = this.zone;
    const table = zone?.lootTables[placement.id];
    if (!zone || !table) return;
    const loot = zoneState(this.state.data, zone.zoneId).loot;
    const key = String(placement.objectId);
    const world = this.state.data.world;
    const entry = loot[key];
    if (!entry || world.tick >= entry[0]) {
      const days = zone.respawnDays ?? 1;
      loot[key] = [
        world.tick + secondsToTicks(days * BALANCE.dayLengthSec),
        rollLoot(table, zone.items, world),
      ];
      this.state.markDirty();
      this.bus.emit('loot:rolled', { table: placement.id });
    }
    this.bus.emit('container:open', { container: `loot:${zone.zoneId}:${key}` });
  }

  setZone(zone: ZoneContext | null): void {
    this.zone = zone;
    this.nodeHp.clear();
    this.refreshCollisions();
  }

  /** Recursos apanhados não bloqueiam (ao entrar; co-op: quando chega o mundo do anfitrião). */
  refreshCollisions(): void {
    const zone = this.zone;
    if (!zone) return;
    const depleted = zoneState(this.state.data, zone.zoneId).depleted;
    for (const placement of zone.map.resources) {
      zone.collision.setEnabled(placement.objectId, depleted[String(placement.objectId)] === undefined);
    }
  }

  /** O recurso está apanhado (à espera de reaparecer)? */
  isDepleted(objectId: number): boolean {
    if (!this.zone) return false;
    return zoneState(this.state.data, this.zone.zoneId).depleted[String(objectId)] !== undefined;
  }

  /** Alvos possíveis na zona (recursos disponíveis, baús, poço). */
  targets(): Target<TargetData>[] {
    const zone = this.zone;
    if (!zone) return [];
    const list: Target<TargetData>[] = [];
    const areaOf = (
      placement: ResourcePlacement,
      footprint: { width: number; height: number } | undefined,
    ): Rect => footprintRect(placement, footprint ?? LOOSE_OBJECT_AREA);
    for (const placement of zone.map.resources) {
      if (this.isDepleted(placement.objectId)) continue;
      const def = zone.resources[placement.id];
      if (def)
        list.push({
          kind: 'resource',
          area: areaOf(placement, def.footprint),
          data: { type: 'resource', placement },
        });
    }
    for (const placement of zone.map.chests) {
      list.push({
        kind: 'container',
        area: areaOf(placement, zone.props.chest?.footprint),
        data: { type: 'chest', placement, chestId: placement.id },
      });
    }
    for (const placement of zone.map.stations) {
      list.push({
        kind: 'container',
        area: areaOf(placement, zone.stations[placement.id]?.footprint),
        data: { type: 'station', placement, key: stationKey(placement.id, placement.objectId) },
      });
    }
    for (const placement of zone.map.props) {
      const def = zone.props[placement.id];
      if (def?.action) {
        list.push({
          kind: 'container',
          area: areaOf(placement, def.footprint),
          data: { type: def.action, placement },
        });
      }
    }
    for (const placement of zone.map.containers) {
      list.push({
        kind: 'container',
        area: areaOf(placement, zone.lootTables[placement.id]?.footprint),
        data: { type: 'loot', placement },
      });
    }
    list.push(...this.structureTargets());
    this.combat.bags().forEach((bag, index) => {
      const placement = { id: 'bag', objectId: 0, x: bag.x, y: bag.y };
      list.push({
        kind: 'container',
        area: areaOf(placement, undefined),
        data: { type: 'bag', placement, index },
      });
    });
    return list;
  }

  /** Inimigos que se podem atacar (área do corpo). */
  private enemyTargets(): Target<TargetData>[] {
    return this.combat.list
      .filter((enemy) => enemy.dying === 0)
      .map((enemy) => ({
        kind: 'enemy' as const,
        area: this.combat.bodyArea(enemy),
        data: {
          type: 'enemy' as const,
          placement: { id: enemy.id, objectId: 0, x: enemy.x, y: enemy.y },
          uid: enemy.uid,
        },
      }));
  }

  /** Portas, estações, baús, canteiros e peças que produzem (construídos). */
  private structureTargets(): Target<TargetData>[] {
    const list: Target<TargetData>[] = [];
    const tileSize = this.building.tileSize;
    for (const [uid, id, tx, ty] of this.building.structures()) {
      const def = this.building.def(id);
      const damaged = this.building.damageOf(uid) > 0;
      if (!def || !(damaged || def.door || def.station || def.chest || def.farm || def.produce)) continue;
      const feet = structureFeet(def, tx, ty, tileSize);
      const placement = { id, objectId: -uid, ...feet };
      const area = def.footprint ? footprintRect(feet, def.footprint) : structureArea(def, tx, ty, tileSize);
      let data: TargetData;
      // Uma peça danificada pela horda (ou armadilha gasta) repara-se com a ação.
      if (damaged) data = { type: 'repair', placement, uid };
      else if (def.station) data = { type: 'station', placement, key: structureStationKey(def.station, uid) };
      else if (def.chest) data = { type: 'chest', placement, chestId: structureChestId(uid) };
      else if (def.farm) data = { type: 'plot', placement, uid };
      else if (def.produce) data = { type: 'producer', placement, uid };
      else data = { type: 'door', placement, uid };
      list.push({ kind: 'container', area, data });
    }
    return list;
  }

  /** Alvo atual da ação contextual (também para a UI o destacar). */
  currentTarget(footprint: { width: number; height: number }): Target<TargetData> | null {
    if (!this.zone) return null;
    const player = this.state.data.player;
    const from = { x: player.x, y: player.y - footprint.height / 2 };
    // Arma à distância: o alvo é o inimigo da mira (o preso, ou o mais perto ao alcance, §7.8).
    const aimed = this.combat.aimTarget();
    if (aimed) {
      const target = this.enemyTargets().find((t) => t.data.type === 'enemy' && t.data.uid === aimed.uid);
      if (target) return target;
    }
    // Inimigos primeiro (§7.2), com o alcance da arma.
    const enemy = pickTarget(from, player.facing, this.enemyTargets(), this.combat.weapon().reach);
    return enemy ?? pickTarget(from, player.facing, this.targets(), BALANCE.actionReachPx);
  }

  /**
   * Faz a ação contextual.
   * @returns o tipo de ação feita (para a animação), ou null se não houver zona.
   */
  act(footprint: { width: number; height: number }): TargetData['type'] | 'swing' | null {
    if (!this.zone) return null;
    const target = this.currentTarget(footprint);
    if (!target) {
      this.bus.emit('player:action', { kind: 'swing' });
      return 'swing';
    }
    const data = target.data;
    if (data.type === 'enemy') {
      this.bus.emit('player:action', { kind: 'attack' });
      this.combat.attack(data.uid);
    } else if (data.type === 'bag') {
      this.bus.emit('player:action', { kind: 'open' });
      this.combat.takeBag(data.index);
    } else if (data.type === 'loot') {
      this.bus.emit('player:action', { kind: 'open' });
      this.openLoot(data.placement);
    } else if (data.type === 'fish') {
      this.fishing.start();
    } else if (data.type === 'repair') {
      this.bus.emit('player:action', { kind: 'gather' });
      const missing = this.building.repair(data.uid);
      if (missing) this.bus.emit('action:blocked', { reason: 'needs_item', item: missing });
    } else if (data.type === 'plot') {
      this.homestead.usePlot(data.uid);
    } else if (data.type === 'producer') {
      this.homestead.collect(data.uid);
    } else if (data.type === 'resource') this.gather(data.placement);
    else if (data.type === 'chest') {
      this.bus.emit('player:action', { kind: 'open' });
      this.bus.emit('container:open', { container: `chest:${data.chestId}` });
    } else if (data.type === 'station') {
      this.bus.emit('player:action', { kind: 'open' });
      this.bus.emit('station:open', { stationKey: data.key });
    } else if (data.type === 'door') {
      this.bus.emit('player:action', { kind: 'open' });
      if (this.building.toggleDoor(data.uid) === 'door_blocked')
        this.bus.emit('action:blocked', { reason: 'door_blocked' });
    } else {
      this.bus.emit('player:action', { kind: 'use' });
      this.actions.drink();
    }
    return data.type;
  }

  /** Recursos que já devem ter reaparecido (chamar a cada tick). */
  tick(tick: number): void {
    const zone = this.zone;
    if (!zone || tick % RESPAWN_CHECK_TICKS !== 0) return;
    const depleted = zoneState(this.state.data, zone.zoneId).depleted;
    for (const [key, respawnAt] of Object.entries(depleted)) {
      if (tick < respawnAt) continue;
      const objectId = Number(key);
      // Com uma peça construída por cima, espera até o sítio ficar livre.
      const placement = zone.map.resources.find((p) => p.objectId === objectId);
      const footprint = placement ? zone.resources[placement.id]?.footprint : undefined;
      if (placement && this.building.covers(footprintRect(placement, footprint ?? LOOSE_OBJECT_AREA)))
        continue;
      Reflect.deleteProperty(depleted, key);
      zone.collision.setEnabled(objectId, true);
      this.bus.emit('resource:respawned', { zoneId: zone.zoneId, objectId });
    }
  }

  private gather(placement: ResourcePlacement): void {
    const zone = this.zone;
    const def = zone?.resources[placement.id];
    if (!zone || !def) return;
    const containers = this.actions.pickupContainers();
    // A ferramenta pode estar na mochila, na hotbar ou equipada como arma (um machado).
    const toolSources = [...containers, this.state.data.player.equipment];
    const tool = def.tool ? bestTool(toolSources, def.tool, zone.items) : null;
    const power = hitPower(def, tool);
    if (power === 0) {
      this.bus.emit('action:blocked', { reason: 'needs_tool', ...(def.tool ? { tool: def.tool } : {}) });
      return;
    }
    const hp = this.nodeHp.get(placement.objectId) ?? def.hp;
    const finalHit = hp - power <= 0;
    // Antes do último golpe, confirmar que os drops cabem (nada se perde).
    if (finalHit && !maxDrops(def).every((drop) => spaceFor(containers, drop.item, zone.items) >= drop.qty)) {
      this.bus.emit('action:blocked', { reason: 'inventory_full' });
      return;
    }

    this.bus.emit('player:action', { kind: 'gather' });
    if (tool) {
      const toolItem = tool.container[tool.index]?.[0];
      if (wearTool(tool) && toolItem) this.bus.emit('item:broken', { item: toolItem });
    }
    const left = Math.max(0, hp - power);
    this.bus.emit('resource:hit', {
      zoneId: zone.zoneId,
      objectId: placement.objectId,
      resource: placement.id,
      hp: left,
      maxHp: def.hp,
    });
    this.state.markDirty();
    if (!finalHit) {
      this.nodeHp.set(placement.objectId, left);
      return;
    }

    this.nodeHp.delete(placement.objectId);
    const world = this.state.data.world;
    for (const drop of rollDrops(def, world)) {
      addItem(containers, drop.item, drop.qty, zone.items);
      this.bus.emit('item:gained', { item: drop.item, qty: drop.qty, x: placement.x, y: placement.y });
    }
    zoneState(this.state.data, zone.zoneId).depleted[String(placement.objectId)] =
      world.tick + secondsToTicks(def.respawnSec);
    zone.collision.setEnabled(placement.objectId, false);
    this.bus.emit('inventory:changed', {});
  }
}
