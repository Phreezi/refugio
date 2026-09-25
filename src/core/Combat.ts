import { PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import {
  skillOf,
  type EnemyDef,
  type EnemyDefs,
  type EnemyGroups,
  type ItemDef,
  type ItemDefs,
} from '../data/types';
import { missPct, skillLevel, trainSkill } from '../systems/combat/skills';
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
  /** Quem disparou (co-op: os drops e os eventos vão para esse jogador). */
  owner: Combat;
  /** Tiro falhado: passa pelo alvo (uid) sem lhe tocar. */
  ignore: number | null;
  /** A munição fica no chão se não acertar em ninguém (flechas). */
  recover: boolean;
}

/**
 * Inimigos e projéteis de uma zona. No co-op, quando os dois jogadores estão na mesma zona, o
 * do convidado aponta para o do anfitrião (os mesmos inimigos para os dois).
 */
interface EnemyPool {
  enemies: Enemy[];
  projectiles: Projectile[];
  nextUid: number;
  nextShot: number;
  /** Próximo tick em que cada armadilha pode voltar a ferir (não se grava). */
  trapReady: Map<number, number>;
  /** Quem derrotou um inimigo que ainda vai rebentar (inchado): recebe os drops. */
  killers: WeakMap<Enemy, Combat>;
}

function createPool(nextUid = 1, nextShot = 1): EnemyPool {
  return { enemies: [], projectiles: [], nextUid, nextShot, trapReady: new Map(), killers: new WeakMap() };
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
  private pool = createPool();
  /** Co-op: o combate do anfitrião cujos inimigos se partilham (mesma zona), ou null. */
  private linkedTo: Combat | null = null;
  /** Co-op: os outros jogadores na mesma zona (os inimigos atacam quem estiver mais perto). */
  private others: Combat[] = [];
  private invulnerableUntil = 0;
  /** Peças da base: as hordas partem-nas e as armadilhas ferem os inimigos. */
  building: Building | null = null;
  /** Multiplicador de vida e dano dos inimigos que nascem (co-op: `coopEnemyMultiplier`). */
  difficulty = 1;
  /** O jogador anda agachado (atualizado a cada tick; os inimigos veem-no de mais perto). */
  sneaking = false;
  /** Co-op: o jogador está no mapa-mundo ou em pausa (os inimigos ignoram-no). */
  away = false;
  /** Mira presa (arma à distância com a ação premida): uid do inimigo, ou null. */
  private lockedUid: number | null = null;
  /** Sorteio (0…1) de falhar golpes e tiros e do desvio. Substituível nos testes. */
  roll: () => number = () => nextRandom(this.state.data.world);
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

  private get enemies(): Enemy[] {
    return this.pool.enemies;
  }

  private set enemies(list: Enemy[]) {
    this.pool.enemies = list;
  }

  private get projectiles(): Projectile[] {
    return this.pool.projectiles;
  }

  private set projectiles(list: Projectile[]) {
    this.pool.projectiles = list;
  }

  /** Co-op: passa a partilhar os inimigos da zona de `primary` (os dois na mesma zona). */
  link(primary: Combat): void {
    if (this.linkedTo === primary) return;
    this.unlink();
    this.linkedTo = primary;
    this.pool = primary.pool;
    this.zone = primary.zone;
    this.invulnerableUntil = 0;
    primary.others.push(this);
  }

  /** Co-op: deixa de partilhar (fica com uma cópia dos inimigos que estavam na zona). */
  unlink(): void {
    const primary = this.linkedTo;
    if (!primary) return;
    primary.others = primary.others.filter((other) => other !== this);
    const shared = this.pool;
    this.pool = createPool(shared.nextUid, shared.nextShot);
    this.pool.enemies = [...shared.enemies];
    this.linkedTo = null;
  }

  /**
   * Co-op: multiplicador de vida e dano dos inimigos; os que já estão na zona ajustam-se logo
   * (mantendo a fração de vida que tinham).
   */
  setDifficulty(multiplier: number): void {
    this.difficulty = multiplier;
    for (const enemy of this.enemies) {
      if (enemy.power === multiplier) continue;
      const ratio = multiplier / enemy.power;
      enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * ratio));
      enemy.hp = Math.max(1, Math.round(enemy.hp * ratio));
      enemy.power = multiplier;
    }
  }

  /** Pode ser alvo dos inimigos da zona `zoneId` (vivo, lá, e não no mapa-mundo)? */
  private targetable(zoneId: string): boolean {
    const player = this.state.data.player;
    return !this.away && player.hp > 0 && player.zoneId === zoneId;
  }

  /** Entra numa zona: os inimigos nascem nos pontos do mapa; mochilas expiradas desaparecem. */
  setZone(zone: ZoneContext | null): void {
    this.unlink();
    for (const other of [...this.others]) other.unlink();
    this.zone = zone;
    this.pool = createPool(this.pool.nextUid, this.pool.nextShot);
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
          this.enemies.push(createEnemy(this.pool.nextUid++, member.enemy, def, at, this.difficulty));
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
        const enemy = createEnemy(this.pool.nextUid++, member.enemy, def, at, this.difficulty);
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
   * Inimigo vivo mais perto cujo corpo esteja ao alcance `reach` do jogador (ataque automático).
   * @param footprint caixa dos pés do jogador (o golpe sai do meio dela).
   */
  nearestInReach(footprint: { width: number; height: number }, reach: number): Enemy | null {
    const player = this.state.data.player;
    const fx = player.x;
    const fy = player.y - footprint.height / 2;
    let best: Enemy | null = null;
    let bestDist = reach;
    for (const enemy of this.enemies) {
      if (enemy.dying > 0) continue;
      const b = this.bodyArea(enemy);
      const dx = Math.max(b.x - fx, 0, fx - (b.x + b.w));
      const dy = Math.max(b.y - fy, 0, fy - (b.y + b.h));
      const dist = Math.hypot(dx, dy);
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
  shoot(lock = false): 'shot' | 'no_ammo' | null {
    const weapon = this.weapon();
    const ranged = weapon.ranged;
    if (!ranged) return null;
    const target = this.aimAt(ranged.range, lock);
    if (!target) return null;
    const containers = this.actions.pickupContainers();
    if (!removeItem(containers, ranged.ammo, 1)) return 'no_ammo';
    const player = this.state.data.player;
    const equipment = player.equipment;
    for (const item of wearSlots(equipment, [0])) this.bus.emit('item:broken', { item });
    const from = { x: player.x, y: player.y - SHOT_HEIGHT };
    const body = this.bodyArea(target);
    let dir = normalize({ x: body.x + body.w / 2 - from.x, y: body.y + body.h / 2 - from.y });
    const miss = this.trainAndRollMiss(true);
    if (miss) {
      // Falha: o tiro sai desviado (para um lado ou para o outro) e passa pelo alvo.
      const deg = BALANCE.missSpreadDeg * (1 + this.roll()) * (this.roll() < 0.5 ? -1 : 1);
      const a = (deg * Math.PI) / 180;
      dir = { x: dir.x * Math.cos(a) - dir.y * Math.sin(a), y: dir.x * Math.sin(a) + dir.y * Math.cos(a) };
    }
    player.facing =
      Math.abs(dir.x) > Math.abs(dir.y) ? (dir.x > 0 ? 'right' : 'left') : dir.y > 0 ? 'down' : 'up';
    this.projectiles.push({
      id: this.pool.nextShot++,
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
      owner: this,
      ignore: miss ? target.uid : null,
      recover: this.content().items[ranged.ammo]?.recoverable === true,
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
    this.projectiles = this.projectiles.filter((shot) => {
      const owner = shot.owner;
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
        if (world?.blocks(ground)) {
          // Fica no chão antes da parede (não dentro dela).
          if (shot.recover)
            owner.dropGround(shot.x - shot.dx * 6, shot.y - shot.dy * 6 + SHOT_HEIGHT, shot.ammo);
          return false;
        }
        const hit = this.enemies.find((e) => {
          if (e.dying > 0 || e.uid === shot.ignore) return false;
          const b = this.bodyArea(e);
          return shot.x >= b.x && shot.x <= b.x + b.w && shot.y >= b.y && shot.y <= b.y + b.h;
        });
        if (hit) {
          const def = enemies[hit.id];
          const died = hitEnemy(
            hit,
            shot.damage,
            owner.state.data.player,
            BALANCE.enemyKnockbackPx / 2,
            secondsToTicks(BALANCE.enemyHitStunSec),
          );
          owner.bus.emit('enemy:hit', {
            uid: hit.uid,
            damage: shot.damage,
            x: hit.x,
            y: hit.y - BODY_HEIGHT,
          });
          if (died && def) this.defeated(hit, def, owner);
          return false;
        }
      }
      if (shot.left > 0) return true;
      if (shot.recover) owner.dropGround(shot.x, shot.y + SHOT_HEIGHT, shot.ammo);
      return false;
    });
  }

  /**
   * Alvo da arma à distância: com a mira presa (`lock`, a ação premida), o mesmo inimigo
   * enquanto estiver vivo e ao alcance; senão, o mais perto (e prende-se nele).
   */
  private aimAt(range: number, lock: boolean): Enemy | null {
    const locked = lock && this.lockedUid !== null ? this.get(this.lockedUid) : undefined;
    if (locked?.dying === 0) {
      const player = this.state.data.player;
      if (Math.hypot(locked.x - player.x, locked.y - player.y) <= range) return locked;
    }
    const target = this.nearestInRange(range);
    this.lockedUid = lock && target ? target.uid : null;
    return target;
  }

  /** Larga a mira presa (a ação deixou de estar premida): o próximo tiro vai ao mais perto. */
  releaseLock(): void {
    this.lockedUid = null;
  }

  /** Inimigo para onde a arma à distância aponta (a seta do alvo), ou null. */
  aimTarget(): Enemy | null {
    const ranged = this.weapon().ranged;
    if (!ranged) return null;
    const locked = this.lockedUid !== null ? this.get(this.lockedUid) : undefined;
    if (locked?.dying === 0) return locked;
    return this.nearestInRange(ranged.range);
  }

  /**
   * Perícia da arma equipada: ganha 1 de experiência (avisa se subir de nível) e sorteia se
   * este golpe/tiro falha (§7.8).
   */
  private trainAndRollMiss(ranged: boolean): boolean {
    const player = this.state.data.player;
    const skill = skillOf(this.equippedWeaponDef());
    const level = skillLevel(player.skills[skill] ?? 0, BALANCE);
    const miss = this.roll() * 100 < missPct(level, ranged, BALANCE);
    const up = trainSkill(player.skills, skill, BALANCE);
    if (up !== null) this.bus.emit('skill:levelUp', { skill, level: up });
    return miss;
  }

  /** Arma equipada que conta (com durabilidade), ou undefined (punhos). */
  private equippedWeaponDef(): ItemDef | undefined {
    const slot = this.state.data.player.equipment[0];
    if (!slot || (slot[2] !== undefined && slot[2] <= 0)) return undefined;
    return this.content().items[slot[0]];
  }

  /** Deixa 1 de `item` no chão da zona (junta-se a uma pilha igual que esteja mesmo ao lado). */
  dropGround(x: number, y: number, item: string): void {
    const zoneId = this.zone?.zoneId;
    if (!zoneId) return;
    const ground = zoneState(this.state.data, zoneId).ground;
    const rx = Math.round(x);
    const ry = Math.round(y);
    const near = ground.find((g) => g[2] === item && Math.abs(g[0] - rx) <= 3 && Math.abs(g[1] - ry) <= 3);
    if (near) near[3] += 1;
    else {
      ground.push([rx, ry, item, 1]);
      if (ground.length > BALANCE.groundItemsMax) ground.shift();
    }
    this.state.markDirty();
    this.bus.emit('ground:changed', { zoneId });
  }

  /** Apanha a munição do chão por onde o jogador passa (o que não couber fica lá). */
  collectGround(): void {
    const zoneId = this.zone?.zoneId;
    if (!zoneId) return;
    const ground = this.state.data.zones[zoneId]?.ground;
    if (!ground || ground.length === 0) return;
    const { items } = this.content();
    const player = this.state.data.player;
    let changed = false;
    for (const g of ground) {
      if (items[g[2]]?.recoverable !== true) continue;
      if (Math.hypot(g[0] - player.x, g[1] - player.y) > BALANCE.groundPickupPx) continue;
      const left = addItem(this.actions.pickupContainers(), g[2], g[3], items);
      if (left === g[3]) continue;
      this.bus.emit('item:gained', { item: g[2], qty: g[3] - left, x: g[0], y: g[1] });
      g[3] = left;
      changed = true;
    }
    if (!changed) return;
    zoneState(this.state.data, zoneId).ground = ground.filter((g) => g[3] > 0);
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
    this.bus.emit('ground:changed', { zoneId });
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
    this.sneaking = sneaking;
    this.flyProjectiles();
    if (!zone || this.enemies.length === 0) return;
    const { enemies } = this.content();
    const player = this.state.data.player;
    // Co-op: cada inimigo vai atrás do jogador (desta zona) que estiver mais perto.
    const players = [this, ...this.others].filter((c) => c.targetable(zone.zoneId));
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
    for (const enemy of [...this.enemies]) {
      const def = enemies[enemy.id];
      if (!def) continue;
      if (enemy.dying > 0) {
        enemy.dying -= 1;
        if (enemy.dying === 0) this.explode(enemy);
        continue;
      }
      const target = this.nearestPlayer(players, enemy);
      const result = stepEnemy(
        enemy,
        def,
        target === this ? ctx : { ...ctx, player: target.state.data.player, sneaking: target.sneaking },
      );
      const damage = Math.round(def.damage * enemy.power);
      if (result === 'attack') target.damagePlayer(damage, enemy, def.bleedPct ?? 0);
      else if (result === 'scream' && def.scream) this.scream(enemy, def.scream);
      else if (result === 'siege' && enemy.siege !== null) {
        const amount = Math.round((damage * BALANCE.hordeStructureDamagePct) / 100);
        this.building?.damageStructure(enemy.siege, amount);
        enemy.siege = null;
      }
    }
    this.springTraps();
  }

  /** O jogador (co-op: de entre os que estão na zona) mais perto do inimigo. */
  private nearestPlayer(players: readonly Combat[], enemy: Enemy): Combat {
    const dist = (c: Combat): number => {
      const p = c.state.data.player;
      return Math.hypot(p.x - enemy.x, p.y - enemy.y);
    };
    return (
      players.reduce<Combat | null>((best, c) => (best && dist(best) <= dist(c) ? best : c), null) ?? this
    );
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
    const trapReady = this.pool.trapReady;
    for (const [uid, id, tx, ty] of building.structures()) {
      const trap = building.def(id)?.trap;
      if (!trap || tick < (trapReady.get(uid) ?? 0)) continue;
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
      trapReady.set(uid, tick + secondsToTicks(trap.everySec));
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
    if (this.trainAndRollMiss(false)) {
      this.bus.emit('enemy:missed', { x: enemy.x, y: enemy.y - BODY_HEIGHT });
      return true;
    }
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

  /** Vida a 0: morre (ou, o inchado, incha e rebenta ao fim do aviso — dá tempo de fugir). */
  private defeated(enemy: Enemy, def: EnemyDef, by: Combat = this): void {
    if (def.explode) {
      enemy.dying = secondsToTicks(def.explode.delaySec);
      enemy.stun = 0;
      this.pool.killers.set(enemy, by);
      by.bus.emit('enemy:dying', { uid: enemy.uid });
    } else this.kill(enemy, by);
  }

  /** O inchado rebenta: dano em área (com armadura) e depois conta como derrotado. */
  private explode(enemy: Enemy): void {
    const blast = this.content().enemies[enemy.id]?.explode;
    const zoneId = this.zone?.zoneId;
    if (blast && zoneId) {
      this.bus.emit('enemy:exploded', { x: enemy.x, y: enemy.y, radius: blast.radius });
      for (const target of [this, ...this.others]) {
        const p = target.state.data.player;
        if (target.targetable(zoneId) && Math.hypot(p.x - enemy.x, p.y - enemy.y) <= blast.radius)
          target.damagePlayer(Math.round(blast.damage * enemy.power), enemy);
      }
    }
    this.kill(enemy, this.pool.killers.get(enemy) ?? this);
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
    // A morte junta tudo na mesma mochila; itens largados juntam-se a uma pilha mesmo ao lado.
    const existing = death
      ? bags.find((bag) => bag.death)
      : bags.find((bag) => !bag.death && Math.hypot(bag.x - x, bag.y - y) <= BALANCE.groundPickupPx);
    const bag = existing ?? { x: Math.round(x), y: Math.round(y), items: [], expiresAt, death };
    for (const slot of kept) {
      const free = bag.items.indexOf(null);
      if (free >= 0) bag.items[free] = slot;
      else bag.items.push(slot);
    }
    bag.x = Math.round(x);
    bag.y = Math.round(y);
    bag.expiresAt = expiresAt;
    if (!existing) bags.push(bag);
    this.state.markDirty();
    this.bus.emit('bag:changed', { zoneId });
    return bag;
  }

  /** Larga itens no chão onde está o jogador (pilha que se abre com a ação). */
  dropHere(items: Container): boolean {
    const zoneId = this.zone?.zoneId;
    if (!zoneId) return false;
    const player = this.state.data.player;
    return this.dropBag(zoneId, player.x, player.y, items, false) !== null;
  }

  /** Tira da zona as mochilas/pilhas que ficaram vazias. */
  pruneBags(): void {
    const zoneId = this.zone?.zoneId;
    if (!zoneId) return;
    const zone = zoneState(this.state.data, zoneId);
    const kept = zone.bags.filter((bag) => bag.items.some((slot) => slot !== null));
    if (kept.length === zone.bags.length) return;
    zone.bags = kept;
    this.state.markDirty();
    this.bus.emit('bag:changed', { zoneId });
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

  /** Tira o inimigo e dá os drops a quem o derrotou (`by`; co-op: pode ser o outro jogador). */
  private kill(enemy: Enemy, by: Combat = this): void {
    const zone = this.zone;
    const def = this.content().enemies[enemy.id];
    this.enemies = this.enemies.filter((e) => e !== enemy);
    by.bus.emit('enemy:killed', { uid: enemy.uid, enemy: enemy.id, x: enemy.x, y: enemy.y });
    if (!def || !zone) return;
    if (def.boss) {
      const days = zone.respawnDays ?? 1;
      this.state.data.bosses[zone.zoneId] =
        this.state.data.world.tick + secondsToTicks(days * BALANCE.dayLengthSec);
      by.bus.emit('boss:defeated', { enemy: enemy.id });
    }
    const containers = by.actions.pickupContainers();
    const leftovers = createContainer(0);
    for (const drop of rollEnemyDrops(def, this.state.data.world)) {
      const left = addItem(containers, drop.item, drop.qty, this.content().items);
      if (drop.qty - left > 0)
        by.bus.emit('item:gained', { item: drop.item, qty: drop.qty - left, x: enemy.x, y: enemy.y });
      if (left > 0) leftovers.push([drop.item, left]);
    }
    // O que não coube fica numa mochila no chão, no sítio do inimigo.
    if (leftovers.length > 0) {
      by.dropBag(zone.zoneId, enemy.x, enemy.y, leftovers, false);
      by.bus.emit('action:blocked', { reason: 'inventory_full' });
    }
    by.state.markDirty();
    by.bus.emit('inventory:changed', {});
  }
}
