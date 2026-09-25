import { PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { EnemyDef, EnemyDefs, EnemyGroups, ItemDefs } from '../data/types';
import { createEnemy, hitEnemy, stepEnemy, type Enemy } from '../systems/ai/enemyAi';
import {
  armorPct,
  reduceDamage,
  rollEnemyDrops,
  wearSlots,
  weaponStats,
  type WeaponStats,
} from '../systems/combat/combat';
import { addItem, createContainer, removeItem, type Container } from '../systems/inventory/inventory';
import type { Rect } from '../systems/movement/geometry';
import { moveWithCollision, normalize } from '../systems/movement/movement';
import { secondsToTicks, TICKS_PER_SECOND } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import { zoneState, type GameState, type GroundBag } from './GameState';
import type { ZoneContext } from './Interaction';
import type { PlayerActions } from './PlayerActions';
import type { Building } from './Building';
import { isNight } from './DayNight';
import { partnerUp, type Partner } from './Partner';
import { nextRandom, randomInt } from './Rng';

/** Projétil em voo (seta, bala). Não se grava. */
export interface Projectile {
  id: number;
  /** Munição (para o desenho). */
  ammo: string;
  /** Posição à altura do peito (o chão fica `SHOT_HEIGHT` px abaixo). */
  x: number;
  y: number;
  px: number;
  py: number;
  /** Direção (normalizada) e px por tick. */
  dx: number;
  dy: number;
  step: number;
  /** Distância que ainda pode voar. */
  left: number;
  damage: number;
}

/** Altura dos tiros acima dos pés (px). */
const SHOT_HEIGHT = 8;

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
  /** Peças da base: as hordas partem-nas e as armadilhas ferem os inimigos. */
  building: Building | null = null;
  /** O boneco do convidado (co-op), ou null. Os inimigos atacam quem estiver mais perto. */
  partner: Partner | null = null;
  /** Próximo tick em que cada armadilha pode voltar a ferir (não se grava). */
  private trapReady = new Map<number, number>();
  private projectiles: Projectile[] = [];
  private nextShot = 1;
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
    this.trapReady.clear();
    this.projectiles = [];
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
    // Um chefe derrotado só volta ao fim de uns dias (respawn da zona).
    const bossAway = (this.state.data.bosses[zone.zoneId] ?? 0) > rng.tick;
    for (const spawn of zone.map.enemySpawns) {
      const group = enemyGroups[spawn.id];
      if (!group || (group.night && !night)) continue;
      for (const member of group.members) {
        const def = enemies[member.enemy];
        if (!def || (def.boss && bossAway)) continue;
        const count = Math.round(randomInt(rng, member.min, member.max) * (def.boss ? 1 : multiplier));
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

  /**
   * Uma horda chega à zona (§7.13): os inimigos do grupo aparecem à volta dos pontos dados (as
   * saídas da base), vêm atrás do jogador e partem o que estiver no caminho.
   * @param scale multiplica o número de cada membro do grupo.
   * @returns quantos apareceram.
   */
  spawnHorde(group: string, points: readonly { x: number; y: number }[], scale: number): number {
    const { enemies, enemyGroups } = this.content();
    const members = enemyGroups[group]?.members ?? [];
    const rng = this.state.data.world;
    let placed = 0;
    for (const member of members) {
      const def = enemies[member.enemy];
      if (!def) continue;
      const count = Math.round(randomInt(rng, member.min, member.max) * scale);
      for (let i = 0; i < count; i++) {
        const point = points[placed % Math.max(1, points.length)];
        if (!point) break;
        const at = {
          x: Math.round(point.x + (nextRandom(rng) - 0.5) * 32),
          y: Math.round(point.y + (nextRandom(rng) - 0.5) * 32),
        };
        const enemy = createEnemy(this.nextUid++, member.enemy, def, at);
        enemy.horde = true;
        enemy.state = 'chase';
        this.enemies.push(enemy);
        placed++;
      }
    }
    return placed;
  }

  /** Inimigos da horda ainda de pé (a rebentar também contam). */
  get hordeLeft(): number {
    return this.enemies.filter((e) => e.horde).length;
  }

  /** A horda vai-se embora (o jogador morreu): tiram-se os inimigos dela. */
  clearHorde(): void {
    this.enemies = this.enemies.filter((e) => !e.horde);
  }

  /** Projéteis em voo (para desenhar). */
  get shots(): readonly Projectile[] {
    return this.projectiles;
  }

  /** Inimigo vivo mais perto do jogador, até `range` px (a mira automática, §7.8). */
  nearestInRange(range: number): Enemy | null {
    const player = this.state.data.player;
    let best: Enemy | null = null;
    let bestDist = range;
    for (const enemy of this.enemies) {
      if (enemy.dying > 0) continue;
      const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (dist <= bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Dispara a arma à distância equipada no inimigo mais perto (gasta 1 de munição).
   * @returns 'shot', 'no_ammo' (há alvo mas falta munição) ou null (sem arma à distância/alvo).
   */
  shoot(): 'shot' | 'no_ammo' | null {
    const weapon = this.weapon();
    const ranged = weapon.ranged;
    if (!ranged) return null;
    const target = this.nearestInRange(ranged.range);
    if (!target) return null;
    const containers = this.actions.pickupContainers();
    if (!removeItem(containers, ranged.ammo, 1)) return 'no_ammo';
    const player = this.state.data.player;
    const equipment = player.equipment;
    for (const item of wearSlots(equipment, [0])) this.bus.emit('item:broken', { item });
    const from = { x: player.x, y: player.y - SHOT_HEIGHT };
    const body = this.bodyArea(target);
    const dir = normalize({ x: body.x + body.w / 2 - from.x, y: body.y + body.h / 2 - from.y });
    player.facing =
      Math.abs(dir.x) > Math.abs(dir.y) ? (dir.x > 0 ? 'right' : 'left') : dir.y > 0 ? 'down' : 'up';
    this.projectiles.push({
      id: this.nextShot++,
      ammo: ranged.ammo,
      x: from.x,
      y: from.y,
      px: from.x,
      py: from.y,
      dx: dir.x,
      dy: dir.y,
      step: ranged.speed / TICKS_PER_SECOND,
      left: ranged.range,
      damage: weapon.damage,
    });
    this.state.markDirty();
    this.bus.emit('player:action', { kind: 'attack' });
    this.bus.emit('inventory:changed', {});
    return 'shot';
  }

  /** Projéteis: avançam em passos curtos; param numa parede ou no primeiro inimigo em que tocam. */
  private flyProjectiles(): void {
    if (this.projectiles.length === 0) return;
    const world = this.zone?.collision;
    const { enemies } = this.content();
    const player = this.state.data.player;
    this.projectiles = this.projectiles.filter((shot) => {
      shot.px = shot.x;
      shot.py = shot.y;
      let travelled = 0;
      while (travelled < shot.step && shot.left > 0) {
        const d = Math.min(4, shot.step - travelled, shot.left);
        shot.x += shot.dx * d;
        shot.y += shot.dy * d;
        shot.left -= d;
        travelled += d;
        const ground = { x: shot.x - 1, y: shot.y + SHOT_HEIGHT - 1, w: 2, h: 2 };
        if (world?.blocks(ground)) return false;
        const hit = this.enemies.find((e) => {
          if (e.dying > 0) return false;
          const b = this.bodyArea(e);
          return shot.x >= b.x && shot.x <= b.x + b.w && shot.y >= b.y && shot.y <= b.y + b.h;
        });
        if (hit) {
          const def = enemies[hit.id];
          const died = hitEnemy(
            hit,
            shot.damage,
            player,
            BALANCE.enemyKnockbackPx / 2,
            secondsToTicks(BALANCE.enemyHitStunSec),
          );
          this.bus.emit('enemy:hit', { uid: hit.uid, damage: shot.damage, x: hit.x, y: hit.y - BODY_HEIGHT });
          if (died && def) this.defeated(hit, def);
          return false;
        }
      }
      return shot.left > 0;
    });
  }

  /** Inimigos vivos na zona (para desenhar). */
  get list(): readonly Enemy[] {
    return this.enemies;
  }

  /** Co-op (convidado): os inimigos vêm do anfitrião; esta lista substitui a local. */
  setRemote(list: Enemy[]): void {
    this.enemies = list;
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
    this.flyProjectiles();
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
      stuckTicks: secondsToTicks(BALANCE.hordeStuckSec),
      obstacle: (enemy: Enemy) => this.obstacle(enemy),
    };
    const partner = partnerUp(this.partner) ? this.partner : null;
    for (const enemy of [...this.enemies]) {
      const def = enemies[enemy.id];
      if (!def) continue;
      if (enemy.dying > 0) {
        enemy.dying -= 1;
        if (enemy.dying === 0) this.explode(enemy);
        continue;
      }
      // Co-op: cada inimigo vai atrás de quem estiver mais perto (o jogador ou o parceiro).
      const target =
        partner &&
        Math.hypot(partner.x - enemy.x, partner.y - enemy.y) <
          Math.hypot(player.x - enemy.x, player.y - enemy.y)
          ? partner
          : null;
      const result = stepEnemy(enemy, def, target ? { ...ctx, player: target, sneaking: target.sneak } : ctx);
      if (result === 'attack' && target) this.damagePartner(def.damage);
      else if (result === 'attack') this.damagePlayer(def.damage, enemy, def.bleedPct ?? 0);
      else if (result === 'scream' && def.scream) this.scream(enemy, def.scream);
      else if (result === 'siege' && enemy.siege !== null) {
        const amount = Math.round((def.damage * BALANCE.hordeStructureDamagePct) / 100);
        this.building?.damageStructure(enemy.siege, amount);
        enemy.siege = null;
      }
    }
    this.springTraps();
  }

  /** O gritador grita: os inimigos à volta vêm à procura do jogador durante `alertSec`. */
  private scream(from: Enemy, scream: NonNullable<EnemyDef['scream']>): void {
    const { enemies } = this.content();
    const alert = secondsToTicks(scream.alertSec);
    for (const enemy of this.enemies) {
      if (enemy === from || enemies[enemy.id]?.behavior !== 'hostile') continue;
      if (Math.hypot(enemy.x - from.x, enemy.y - from.y) > scream.radius) continue;
      enemy.alert = Math.max(enemy.alert, alert);
      if (enemy.state === 'idle' || enemy.state === 'wander' || enemy.state === 'return')
        enemy.state = 'chase';
    }
    this.bus.emit('enemy:scream', { uid: from.uid, x: from.x, y: from.y, radius: scream.radius });
  }

  /** Peça construída sólida entre o inimigo e o jogador (o que a horda tem de partir). */
  private obstacle(enemy: Enemy): number | null {
    const building = this.building;
    const def = this.content().enemies[enemy.id];
    if (!building || !def) return null;
    const player = this.state.data.player;
    const dir = normalize({ x: player.x - enemy.x, y: player.y - enemy.y });
    const cy = enemy.y - def.footprint.height / 2;
    const ahead = Math.max(def.footprint.width, def.footprint.height) / 2 + 3;
    const tile = building.tileSize;
    // Em frente, e só na horizontal ou só na vertical (quando desliza ao longo de uma parede).
    const probes = [
      { x: enemy.x + dir.x * ahead, y: cy + dir.y * ahead },
      { x: enemy.x + Math.sign(dir.x) * ahead, y: cy },
      { x: enemy.x, y: cy + Math.sign(dir.y) * ahead },
    ];
    for (const p of probes) {
      const uid = building.solidAt(Math.floor(p.x / tile), Math.floor(p.y / tile));
      if (uid !== null) return uid;
    }
    return null;
  }

  /** Armadilhas de estacas: ferem quem as pisa (a cada `everySec`) e gastam-se. */
  private springTraps(): void {
    const building = this.building;
    if (!building || this.enemies.length === 0) return;
    const tick = this.state.data.world.tick;
    const { enemies } = this.content();
    for (const [uid, id, tx, ty] of building.structures()) {
      const trap = building.def(id)?.trap;
      if (!trap || tick < (this.trapReady.get(uid) ?? 0)) continue;
      const size = building.tileSize;
      const area = { x: tx * size, y: ty * size, w: size, h: size };
      const inside = this.enemies.filter(
        (e) =>
          e.dying === 0 &&
          e.x >= area.x &&
          e.x < area.x + area.w &&
          e.y > area.y &&
          e.y <= area.y + area.h + 2,
      );
      if (inside.length === 0) continue;
      this.trapReady.set(uid, tick + secondsToTicks(trap.everySec));
      for (const enemy of inside) {
        const def = enemies[enemy.id];
        if (!def) continue;
        const died = hitEnemy(enemy, trap.damage, enemy, 0, 0);
        this.bus.emit('enemy:hit', {
          uid: enemy.uid,
          damage: trap.damage,
          x: enemy.x,
          y: enemy.y - BODY_HEIGHT,
        });
        if (died) this.defeated(enemy, def);
      }
      building.damageStructure(uid, 1);
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
    if (died) this.defeated(enemy, def);
    return true;
  }

  /**
   * Golpe do parceiro (co-op) no inimigo `uid`, com o dano da arma dele (sem desgaste: a arma é
   * do save do convidado). @returns true se acertou.
   */
  attackAs(uid: number, from: { x: number; y: number }, damage: number): boolean {
    const enemy = this.get(uid);
    const def = enemy ? this.content().enemies[enemy.id] : undefined;
    if (!enemy || !def || enemy.dying > 0) return false;
    const died = hitEnemy(
      enemy,
      damage,
      from,
      BALANCE.enemyKnockbackPx,
      secondsToTicks(BALANCE.enemyHitStunSec),
    );
    this.bus.emit('enemy:hit', { uid, damage, x: enemy.x, y: enemy.y - BODY_HEIGHT });
    this.state.markDirty();
    if (died) this.defeated(enemy, def);
    return true;
  }

  /** Dano ao parceiro (sem armadura). A 0 fica caído e volta pouco depois ao pé do anfitrião. */
  damagePartner(amount: number): void {
    const partner = this.partner;
    const tick = this.state.data.world.tick;
    if (!partnerUp(partner) || amount <= 0 || tick < partner.invulnerableUntil) return;
    partner.hp = Math.max(0, partner.hp - amount);
    partner.invulnerableUntil = tick + secondsToTicks(BALANCE.playerInvulnSec);
    this.bus.emit('partner:damaged', { amount, x: partner.x, y: partner.y });
    if (partner.hp === 0) {
      partner.downUntil = tick + secondsToTicks(BALANCE.partnerDownSec);
      this.bus.emit('partner:down', {});
    }
  }

  /** Vida a 0: morre (ou, o inchado, incha e rebenta ao fim do aviso — dá tempo de fugir). */
  private defeated(enemy: Enemy, def: EnemyDef): void {
    if (def.explode) {
      enemy.dying = secondsToTicks(def.explode.delaySec);
      enemy.stun = 0;
      this.bus.emit('enemy:dying', { uid: enemy.uid });
    } else this.kill(enemy);
  }

  /** O inchado rebenta: dano em área (com armadura) e depois conta como derrotado. */
  private explode(enemy: Enemy): void {
    const blast = this.content().enemies[enemy.id]?.explode;
    if (blast) {
      const player = this.state.data.player;
      this.bus.emit('enemy:exploded', { x: enemy.x, y: enemy.y, radius: blast.radius });
      if (Math.hypot(player.x - enemy.x, player.y - enemy.y) <= blast.radius)
        this.damagePlayer(blast.damage, enemy);
      const partner = this.partner;
      if (partnerUp(partner) && Math.hypot(partner.x - enemy.x, partner.y - enemy.y) <= blast.radius)
        this.damagePartner(blast.damage);
    }
    this.kill(enemy);
  }

  /**
   * Dano ao jogador (com armadura e invulnerabilidade curta a seguir).
   * @param bleedPct % de hipótese de o pôr a sangrar (§7.8).
   */
  damagePlayer(amount: number, from: { x: number; y: number }, bleedPct = 0): void {
    if (amount <= 0 || this.playerInvulnerable) return;
    const player = this.state.data.player;
    const { items } = this.content();
    const dealt = reduceDamage(amount, armorPct(player.equipment, items, BALANCE.maxArmorReductionPct));
    player.hp = Math.max(0, player.hp - dealt);
    if (bleedPct > 0 && nextRandom(this.state.data.world) * 100 < bleedPct) {
      if (player.bleed === 0) this.bus.emit('player:bleeding', {});
      player.bleed = secondsToTicks(BALANCE.bleedSec);
    }
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
    if (def.boss) {
      const days = zone.respawnDays ?? 1;
      this.state.data.bosses[zone.zoneId] =
        this.state.data.world.tick + secondsToTicks(days * BALANCE.dayLengthSec);
      this.bus.emit('boss:defeated', { enemy: enemy.id });
    }
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
