import { PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { EnemyDefs, EnemyGroups, ItemDefs } from '../data/types';
import { createEnemy, hitEnemy, stepEnemy, type Enemy } from '../systems/ai/enemyAi';
import {
  armorPct,
  reduceDamage,
  rollEnemyDrops,
  wearSlots,
  weaponStats,
  type WeaponStats,
} from '../systems/combat/combat';
import { addItem, createContainer, type Container } from '../systems/inventory/inventory';
import type { Rect } from '../systems/movement/geometry';
import { moveWithCollision, normalize } from '../systems/movement/movement';
import { secondsToTicks, TICKS_PER_SECOND } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import { zoneState, type GameState, type GroundBag } from './GameState';
import type { ZoneContext } from './Interaction';
import type { PlayerActions } from './PlayerActions';
import { isNight } from './DayNight';
import { nextRandom, randomInt } from './Rng';

export interface CombatContent {
  items: ItemDefs;
  enemies: EnemyDefs;
  enemyGroups: EnemyGroups;
}

/** Altura (px) da área do corpo de um inimigo, acima dos pés (para lhe acertar). */
const BODY_HEIGHT = 14;
const HOURS_MS = 3_600_000;

/**
 * Combate (CLAUDE.md §7.8–§7.12): os inimigos da zona (nascem nos pontos `enemy_spawn` ao
 * entrar; não se gravam), os golpes do jogador, o dano que ele leva (com armadura e um instante
 * de invulnerabilidade) e as mochilas no chão (morte, ou drops que não couberam).
 */
export class Combat {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly actions: PlayerActions;
  private readonly content: () => CombatContent;
  private zone: ZoneContext | null = null;
  private enemies: Enemy[] = [];
  private nextUid = 1;
  private invulnerableUntil = 0;
  /** Hora real (ms): as mochilas no chão duram horas reais (§7.12). Substituível nos testes. */
  now: () => number = () => Date.now();

  constructor(
    state: GameState,
    bus: EventBus<GameEvents>,
    actions: PlayerActions,
    content: () => CombatContent,
  ) {
    this.state = state;
    this.bus = bus;
    this.actions = actions;
    this.content = content;
  }

  /** Entra numa zona: os inimigos nascem nos pontos do mapa; mochilas expiradas desaparecem. */
  setZone(zone: ZoneContext | null): void {
    this.zone = zone;
    this.enemies = [];
    this.invulnerableUntil = 0;
    if (!zone) return;
    const bags = zoneState(this.state.data, zone.zoneId).bags;
    const now = this.now();
    const alive = bags.filter((bag) => bag.expiresAt > now);
    if (alive.length !== bags.length) {
      bags.splice(0, bags.length, ...alive);
      this.state.markDirty();
    }
    if (zone.map.enemySpawns.length === 0) return;
    const { enemies, enemyGroups } = this.content();
    const rng = this.state.data.world;
    // À noite há mais inimigos (e aparecem os grupos só de noite, §7.11).
    const night = isNight(rng.tick, BALANCE);
    const multiplier = night ? (zone.nightEnemyMultiplier ?? 1) : 1;
    for (const spawn of zone.map.enemySpawns) {
      const group = enemyGroups[spawn.id];
      if (!group || (group.night && !night)) continue;
      for (const member of group.members) {
        const def = enemies[member.enemy];
        if (!def) continue;
        const count = Math.round(randomInt(rng, member.min, member.max) * multiplier);
        for (let i = 0; i < count; i++) {
          const at = {
            x: Math.round(spawn.x + (nextRandom(rng) - 0.5) * 24),
            y: Math.round(spawn.y + (nextRandom(rng) - 0.5) * 24),
          };
          this.enemies.push(createEnemy(this.nextUid++, member.enemy, def, at));
        }
      }
    }
  }

  /** Inimigos vivos na zona (para desenhar). */
  get list(): readonly Enemy[] {
    return this.enemies;
  }

  get(uid: number): Enemy | undefined {
    return this.enemies.find((e) => e.uid === uid);
  }

  /** Mochilas no chão da zona atual. */
  bags(): readonly GroundBag[] {
    return this.zone ? zoneState(this.state.data, this.zone.zoneId).bags : [];
  }

  /** Área do corpo de um inimigo (onde os golpes acertam). */
  bodyArea(enemy: Enemy): Rect {
    const def = this.content().enemies[enemy.id];
    const w = def?.footprint.width ?? 10;
    return { x: enemy.x - w / 2, y: enemy.y - BODY_HEIGHT, w, h: BODY_HEIGHT };
  }

  /** Arma equipada (ou punhos). */
  weapon(): WeaponStats {
    return weaponStats(this.state.data.player.equipment, this.content().items, BALANCE);
  }

  /** Ticks entre golpes com a arma atual. */
  attackTicks(): number {
    return secondsToTicks(this.weapon().attackSec);
  }

  get playerInvulnerable(): boolean {
    return this.state.data.world.tick < this.invulnerableUntil;
  }

  /** Um tick: a IA de cada inimigo; os ataques que acertam tiram vida ao jogador. */
  tick(sneaking: boolean): void {
    const zone = this.zone;
    if (!zone || this.enemies.length === 0) return;
    const { enemies } = this.content();
    const player = this.state.data.player;
    const ctx = {
      player,
      sneaking,
      world: zone.collision,
      rng: this.state.data.world,
      ticksPerSec: TICKS_PER_SECOND,
      windupTicks: secondsToTicks(BALANCE.enemyWindupSec),
      sneakDetectMultiplier: BALANCE.sneakDetectMultiplier,
    };
    for (const enemy of [...this.enemies]) {
      const def = enemies[enemy.id];
      if (!def) continue;
      if (enemy.dying > 0) {
        enemy.dying -= 1;
        if (enemy.dying === 0) this.explode(enemy);
        continue;
      }
      if (stepEnemy(enemy, def, ctx) === 'attack') this.damagePlayer(def.damage, enemy);
    }
  }

  /** O jogador bate no inimigo `uid`. @returns true se acertou. */
  attack(uid: number): boolean {
    const enemy = this.get(uid);
    const def = enemy ? this.content().enemies[enemy.id] : undefined;
    if (!enemy || !def || enemy.dying > 0) return false;
    const player = this.state.data.player;
    const { damage } = this.weapon();
    const equipment = player.equipment;
    const weaponBefore = equipment[0];
    const broken =
      weaponBefore && this.content().items[weaponBefore[0]]?.damage !== undefined
        ? wearSlots(equipment, [0])
        : [];
    for (const item of broken) this.bus.emit('item:broken', { item });
    const died = hitEnemy(
      enemy,
      damage,
      player,
      BALANCE.enemyKnockbackPx,
      secondsToTicks(BALANCE.enemyHitStunSec),
    );
    this.bus.emit('enemy:hit', { uid, damage, x: enemy.x, y: enemy.y - BODY_HEIGHT });
    this.state.markDirty();
    if (died) {
      // O inchado não morre logo: incha e rebenta ao fim do aviso (dá tempo de fugir).
      if (def.explode) {
        enemy.dying = secondsToTicks(def.explode.delaySec);
        enemy.stun = 0;
        this.bus.emit('enemy:dying', { uid });
      } else this.kill(enemy);
    }
    return true;
  }

  /** O inchado rebenta: dano em área (com armadura) e depois conta como derrotado. */
  private explode(enemy: Enemy): void {
    const blast = this.content().enemies[enemy.id]?.explode;
    if (blast) {
      const player = this.state.data.player;
      this.bus.emit('enemy:exploded', { x: enemy.x, y: enemy.y, radius: blast.radius });
      if (Math.hypot(player.x - enemy.x, player.y - enemy.y) <= blast.radius)
        this.damagePlayer(blast.damage, enemy);
    }
    this.kill(enemy);
  }

  /** Dano ao jogador (com armadura e invulnerabilidade curta a seguir). */
  damagePlayer(amount: number, from: { x: number; y: number }): void {
    if (amount <= 0 || this.playerInvulnerable) return;
    const player = this.state.data.player;
    const { items } = this.content();
    const dealt = reduceDamage(amount, armorPct(player.equipment, items, BALANCE.maxArmorReductionPct));
    player.hp = Math.max(0, player.hp - dealt);
    // A armadura gasta-se um pouco com cada golpe.
    const armorSlots = player.equipment.flatMap((slot, i) =>
      slot && items[slot[0]]?.type === 'armor' ? [i] : [],
    );
    for (const item of wearSlots(player.equipment, armorSlots)) this.bus.emit('item:broken', { item });
    this.invulnerableUntil = this.state.data.world.tick + secondsToTicks(BALANCE.playerInvulnSec);
    const world = this.zone?.collision;
    if (world) {
      const away = normalize({ x: player.x - from.x, y: player.y - from.y });
      const next = moveWithCollision(
        player,
        PLAYER_FOOTPRINT,
        { x: away.x * BALANCE.playerKnockbackPx, y: away.y * BALANCE.playerKnockbackPx },
        world,
      );
      player.x = next.x;
      player.y = next.y;
    }
    this.state.markDirty();
    this.bus.emit('player:damaged', { amount: dealt, x: player.x, y: player.y });
  }

  /**
   * Deixa uma mochila no chão da zona. As da morte juntam-se à que já lá estiver (nada se perde).
   * @returns a mochila (ou null se não havia nada para deixar).
   */
  dropBag(zoneId: string, x: number, y: number, items: Container, death: boolean): GroundBag | null {
    const kept = items.filter((slot) => slot !== null);
    if (kept.length === 0) return null;
    const bags = zoneState(this.state.data, zoneId).bags;
    const expiresAt = this.now() + BALANCE.deathBagHoursReal * HOURS_MS;
    const existing = death ? bags.find((bag) => bag.death) : undefined;
    const bag = existing ?? { x: Math.round(x), y: Math.round(y), items: [], expiresAt, death };
    bag.items.push(...kept);
    bag.x = Math.round(x);
    bag.y = Math.round(y);
    bag.expiresAt = expiresAt;
    if (!existing) bags.push(bag);
    this.state.markDirty();
    this.bus.emit('bag:changed', { zoneId });
    return bag;
  }

  /** Apanha o que couber da mochila `index` da zona atual. @returns true se ficou vazia. */
  takeBag(index: number): boolean {
    const zone = this.zone;
    if (!zone) return false;
    const bags = zoneState(this.state.data, zone.zoneId).bags;
    const bag = bags[index];
    if (!bag) return false;
    const containers = this.actions.pickupContainers();
    const items = this.content().items;
    bag.items = bag.items.flatMap((slot) => {
      if (!slot) return [];
      // Itens com durabilidade vão inteiros para um slot vazio (mantêm o desgaste).
      if (slot[2] !== undefined) {
        const target = containers.find((c) => c.includes(null));
        if (!target) return [slot];
        target[target.indexOf(null)] = slot;
        return [];
      }
      const left = addItem(containers, slot[0], slot[1], items);
      return left > 0 ? [[slot[0], left]] : [];
    });
    const empty = bag.items.length === 0;
    if (empty) bags.splice(index, 1);
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
    this.bus.emit('bag:changed', { zoneId: zone.zoneId });
    return empty;
  }

  private kill(enemy: Enemy): void {
    const zone = this.zone;
    const def = this.content().enemies[enemy.id];
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this.bus.emit('enemy:killed', { uid: enemy.uid, enemy: enemy.id, x: enemy.x, y: enemy.y });
    if (!def || !zone) return;
    const containers = this.actions.pickupContainers();
    const leftovers = createContainer(0);
    for (const drop of rollEnemyDrops(def, this.state.data.world)) {
      const left = addItem(containers, drop.item, drop.qty, this.content().items);
      if (drop.qty - left > 0)
        this.bus.emit('item:gained', { item: drop.item, qty: drop.qty - left, x: enemy.x, y: enemy.y });
      if (left > 0) leftovers.push([drop.item, left]);
    }
    // O que não coube fica numa mochila no chão, no sítio do inimigo.
    if (leftovers.length > 0) {
      this.dropBag(zone.zoneId, enemy.x, enemy.y, leftovers, false);
      this.bus.emit('action:blocked', { reason: 'inventory_full' });
    }
    this.bus.emit('inventory:changed', {});
  }
}
