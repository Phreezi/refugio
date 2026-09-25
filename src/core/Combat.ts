import { PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import { talentOf } from '../data/talents';
import {
  ammoFits,
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
import { beginnerProtected, secondsToTicks, TICKS_PER_SECOND } from './Clock';
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
  /** % de partir (ao acertar; metade ao cair no chão). */
  breakPct: number;
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
  /** Corpos no chão (ficam `corpseSec`), com as flechas que se podem reaproveitar. */
}

function createPool(nextUid = 1, nextShot = 1): EnemyPool {
  return {
    enemies: [],
    projectiles: [],
    nextUid,
    nextShot,
    trapReady: new Map(),
    killers: new WeakMap(),
  };
}

/** Altura dos tiros acima dos pés (px). */
const SHOT_HEIGHT = 8;

/** Junta `qty` de `item` à aljava (sem limite de stack). */
function addToQuiver(quiver: [string, number][], item: string, qty: number): void {
  const entry = quiver.find(([id]) => id === item);
  if (entry) entry[1] += qty;
  else quiver.push([item, qty]);
}

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
      if (dist <= bestDist && this.canSee(enemy)) {
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
      if (dist <= bestDist && this.canSee(enemy)) {
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
    const ammo = this.takeAmmo(ranged.ammo);
    if (!ammo) return 'no_ammo';
    const ammoDef = this.content().items[ammo];
    const player = this.state.data.player;
    const equipment = player.equipment;
    if (!this.beginner) for (const item of wearSlots(equipment, [0])) this.bus.emit('item:broken', { item });
    const from = { x: player.x, y: player.y - SHOT_HEIGHT };
    const body = this.bodyArea(target);
    let dir = normalize({ x: body.x + body.w / 2 - from.x, y: body.y + body.h / 2 - from.y });
    // Mais perto, falha-se menos: a `missNearFactor` da falha encostado, a toda ao alcance máximo.
    const closeness = Math.min(1, Math.hypot(target.x - player.x, target.y - player.y) / ranged.range);
    const miss = this.trainAndRollMiss(
      true,
      BALANCE.missNearFactor + (1 - BALANCE.missNearFactor) * closeness,
    );
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
      ammo,
      x: from.x,
      y: from.y,
      px: from.x,
      py: from.y,
      dx: dir.x,
      dy: dir.y,
      step: ranged.speed / TICKS_PER_SECOND,
      left: ranged.range,
      damage: Math.round(
        (weapon.damage + (ammoDef?.ammoDamage ?? 0)) * (1 + talentOf(player, 'rangedDamagePct') / 100),
      ),
      owner: this,
      ignore: miss ? target.uid : null,
      recover: ammoDef?.recoverable === true,
      breakPct: ammoDef?.breakPct ?? 100,
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
          if (shot.recover && !owner.breaks(shot.breakPct / 2))
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
          // A flecha que não parte fica espetada: apanha-se do corpo.
          if (shot.recover && !owner.breaks(shot.breakPct)) {
            hit.arrows ??= {};
            hit.arrows[shot.ammo] = (hit.arrows[shot.ammo] ?? 0) + 1;
          }
          if (died && def) this.defeated(hit, def, owner);
          return false;
        }
      }
      if (shot.left > 0) return true;
      if (shot.recover && !owner.breaks(shot.breakPct / 2))
        owner.dropGround(shot.x, shot.y + SHOT_HEIGHT, shot.ammo);
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
  private trainAndRollMiss(ranged: boolean, factor = 1): boolean {
    const player = this.state.data.player;
    const skill = skillOf(this.equippedWeaponDef());
    const level = skillLevel(player.skills[skill] ?? 0, BALANCE);
    const pct = Math.max(BALANCE.missPctMin, missPct(level, ranged, BALANCE) - talentOf(player, 'missPts'));
    const miss = this.roll() * 100 < pct * factor;
    const up = trainSkill(player.skills, skill, BALANCE);
    if (up !== null) this.bus.emit('skill:levelUp', { skill, level: up });
    return miss;
  }

  /** Talento "mãos cuidadosas": sorteia se este golpe não gasta a arma. */
  savesWear(): boolean {
    const pct = Math.min(BALANCE.talentCapPct, talentOf(this.state.data.player, 'wearSavePct'));
    return pct > 0 && this.roll() * 100 < pct;
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

  /**
   * Linha de vista do jogador ao corpo do inimigo, pelo mesmo caminho que um tiro faria: sem
   * paredes nem obstáculos pelo meio (a mira e o ataque automático não apontam através delas).
   */
  canSee(enemy: Enemy): boolean {
    const world = this.zone?.collision;
    if (!world) return true;
    const player = this.state.data.player;
    const body = this.bodyArea(enemy);
    const fromX = player.x;
    const fromY = player.y - SHOT_HEIGHT;
    const toX = body.x + body.w / 2;
    const toY = body.y + body.h / 2;
    const length = Math.hypot(toX - fromX, toY - fromY);
    // Até ao corpo (o próprio inimigo não conta), em passos de 4 px como os projéteis.
    for (let d = 4; d < length - 4; d += 4) {
      const x = fromX + ((toX - fromX) * d) / length;
      const y = fromY + ((toY - fromY) * d) / length;
      if (world.blocks({ x: x - 1, y: y + SHOT_HEIGHT - 1, w: 2, h: 2 })) return false;
    }
    return true;
  }

  /** Proteção de principiante (até às 00:00 do dia 4): armas, ferramentas e armadura não gastam usos. */
  get beginner(): boolean {
    return beginnerProtected(
      this.state.data.world.tick,
      BALANCE.dayLengthSec,
      BALANCE.dayStartHour,
      BALANCE.beginnerUntilDay,
    );
  }

  /** Parte (sorteio com `pct`% de probabilidade)? */
  breaks(pct: number): boolean {
    return this.roll() * 100 < pct;
  }

  /** Munição que serve na arma equipada vai para a aljava; a outra para a mochila. @returns o que sobrou. */
  giveAmmo(item: string, qty: number): number {
    const base = this.weapon().ranged?.ammo;
    const items = this.content().items;
    if (base && ammoFits(item, items[item], base)) {
      addToQuiver(this.state.data.player.quiver, item, qty);
      this.state.markDirty();
      this.bus.emit('inventory:changed', {});
      return 0;
    }
    const left = this.actions.give(item, qty);
    if (left < qty) {
      this.state.markDirty();
      this.bus.emit('inventory:changed', {});
    }
    return left;
  }

  /**
   * Gasta 1 de munição para a arma que usa `base`: primeiro a da aljava (a que dá mais dano),
   * depois a da mochila. @returns o item gasto, ou null se não houver.
   */
  private takeAmmo(base: string): string | null {
    const items = this.content().items;
    const quiver = this.state.data.player.quiver;
    // A primeira da aljava é a que está em uso; quando acaba, passa a ser a mais forte.
    const active = quiver.find(([item]) => ammoFits(item, items[item], base));
    if (active) {
      active[1] -= 1;
      if (active[1] <= 0) {
        quiver.splice(quiver.indexOf(active), 1);
        this.sortQuiver();
      }
      return active[0];
    }
    const containers = this.actions.pickupContainers();
    for (const container of containers) {
      for (const slot of container) {
        if (slot && ammoFits(slot[0], items[slot[0]], base) && removeItem(containers, slot[0], 1))
          return slot[0];
      }
    }
    return null;
  }

  /**
   * Aljava (cada tick): com uma arma à distância equipada, a munição que lhe serve passa da
   * mochila/hotbar para dentro dela (sem ocupar espaço); a que já não serve (trocou de arma)
   * volta para a mochila, e o que não couber fica no chão.
   */
  syncQuiver(): void {
    if (!this.zone) return;
    const player = this.state.data.player;
    const items = this.content().items;
    const base = this.weapon().ranged?.ammo;
    let changed = false;
    const keep = player.quiver.filter(([item]) => base !== undefined && ammoFits(item, items[item], base));
    if (keep.length !== player.quiver.length) {
      const leftovers = createContainer(0);
      for (const [item, qty] of player.quiver) {
        if (keep.some((k) => k[0] === item)) continue;
        const left = addItem(this.actions.pickupContainers(), item, qty, items);
        if (left > 0) leftovers.push([item, left]);
      }
      if (leftovers.length > 0) this.dropHere(leftovers);
      player.quiver = keep;
      changed = true;
    }
    if (base !== undefined) {
      const wasEmpty = player.quiver.length === 0;
      for (const container of this.actions.pickupContainers()) {
        container.forEach((slot, i) => {
          if (!slot || !ammoFits(slot[0], items[slot[0]], base)) return;
          addToQuiver(player.quiver, slot[0], slot[1]);
          container[i] = null;
          changed = true;
        });
      }
      // Ao equipar a arma entra primeiro a melhor munição.
      if (changed && wasEmpty) this.sortQuiver();
    }
    if (!changed) return;
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
  }

  /** Munição em uso na arma equipada (a primeira da aljava) e quantas há, para o HUD. */
  activeAmmo(): { item: string; qty: number } | null {
    const base = this.weapon().ranged?.ammo;
    if (!base) return null;
    const items = this.content().items;
    const active = this.state.data.player.quiver.find(([item]) => ammoFits(item, items[item], base));
    return active ? { item: active[0], qty: active[1] } : null;
  }

  /** Munição de todos os tipos da arma equipada (aljava + mochila). */
  ammoCount(): number {
    const base = this.weapon().ranged?.ammo;
    if (!base) return 0;
    const items = this.content().items;
    let total = 0;
    for (const [item, qty] of this.state.data.player.quiver)
      if (ammoFits(item, items[item], base)) total += qty;
    for (const container of this.actions.pickupContainers())
      for (const slot of container) if (slot && ammoFits(slot[0], items[slot[0]], base)) total += slot[1];
    return total;
  }

  /** Escolhe a munição em uso (passa para o início da aljava). @returns false se não estiver lá. */
  selectAmmo(item: string): boolean {
    const quiver = this.state.data.player.quiver;
    const index = quiver.findIndex(([id]) => id === item);
    if (index < 0) return false;
    if (index > 0) {
      const [entry] = quiver.splice(index, 1);
      if (entry) quiver.unshift(entry);
      this.state.markDirty();
      this.bus.emit('inventory:changed', {});
    }
    return true;
  }

  /** Passa à munição seguinte da aljava (o botão da arma no HUD). */
  cycleAmmo(): void {
    const quiver = this.state.data.player.quiver;
    if (quiver.length < 2) return;
    const first = quiver.shift();
    if (first) quiver.push(first);
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
  }

  /** Aljava da mais forte para a mais fraca. */
  private sortQuiver(): void {
    const items = this.content().items;
    this.state.data.player.quiver.sort(
      (a, b) => (items[b[0]]?.ammoDamage ?? 0) - (items[a[0]]?.ammoDamage ?? 0),
    );
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
      const left = this.giveAmmo(g[2], g[3]);
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
    const damage = Math.round(this.weapon().damage * (1 + talentOf(player, 'meleeDamagePct') / 100));
    const equipment = player.equipment;
    const weaponBefore = equipment[0];
    const broken =
      weaponBefore && this.content().items[weaponBefore[0]]?.damage !== undefined
        ? this.beginner || this.savesWear()
          ? []
          : wearSlots(equipment, [0])
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
    const armor = Math.min(
      BALANCE.maxArmorReductionPct,
      armorPct(player.equipment, items, BALANCE.maxArmorReductionPct, BALANCE.enchantArmor) +
        talentOf(player, 'armorPct'),
    );
    const dealt = reduceDamage(amount, armor);
    player.hp = Math.max(0, player.hp - dealt);
    if (bleedPct > 0 && nextRandom(this.state.data.world) * 100 < bleedPct) {
      if (player.bleed === 0) this.bus.emit('player:bleeding', {});
      player.bleed = secondsToTicks(BALANCE.bleedSec);
    }
    // A armadura gasta-se um pouco com cada golpe.
    const armorSlots = player.equipment.flatMap((slot, i) =>
      slot && items[slot[0]]?.type === 'armor' ? [i] : [],
    );
    if (!this.beginner)
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
      : bags.find(
          (bag) => !bag.death && !bag.corpse && Math.hypot(bag.x - x, bag.y - y) <= BALANCE.groundPickupPx,
        );
    const bag = existing ?? { x: Math.round(x), y: Math.round(y), items: [], expiresAt, death };
    for (const slot of kept) {
      const free = bag.items.indexOf(null);
      if (free >= 0) bag.items[free] = slot;
      else bag.items.push(slot);
    }
    bag.x = Math.round(x);
    bag.y = Math.round(y);
    bag.expiresAt = expiresAt;
    if (!existing) {
      bags.push(bag);
      this.capGround(zoneId);
    }
    this.state.markDirty();
    this.bus.emit('bag:changed', { zoneId });
    return bag;
  }

  /**
   * O corpo de um inimigo: uma "mochila" no chão com os drops, desenhada como o inimigo a
   * cinzento; dura `corpseDays` dias de jogo (se o jogador sair e voltar) ou até se esvaziar.
   */
  private corpseBag(zoneId: string, enemy: Enemy, items: Container): void {
    const bags = zoneState(this.state.data, zoneId).bags;
    bags.push({
      x: Math.round(enemy.x),
      y: Math.round(enemy.y),
      items,
      expiresAt: this.now() + BALANCE.corpseDays * BALANCE.dayLengthSec * 1000,
      death: false,
      corpse: enemy.id,
    });
    this.capGround(zoneId);
    this.state.markDirty();
    this.bus.emit('bag:changed', { zoneId });
  }

  /**
   * No máximo `groundThingsMax` coisas no chão por zona (corpos, pilhas e itens soltos): as mais
   * antigas desaparecem (as mochilas da morte nunca).
   */
  capGround(zoneId: string): void {
    const zone = zoneState(this.state.data, zoneId);
    let excess = zone.bags.length + zone.ground.length - BALANCE.groundThingsMax;
    if (excess <= 0) return;
    const ground = Math.min(excess, zone.ground.length);
    if (ground > 0) {
      zone.ground.splice(0, ground);
      excess -= ground;
      this.bus.emit('ground:changed', { zoneId });
    }
    while (excess > 0) {
      const oldest = zone.bags.findIndex((bag) => !bag.death);
      if (oldest < 0) break;
      zone.bags.splice(oldest, 1);
      excess -= 1;
    }
    this.bus.emit('bag:changed', { zoneId });
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
    // Um corpo vazio desaparece numa nuvem de fumo.
    for (const bag of zone.bags)
      if (bag.corpse && !kept.includes(bag)) this.bus.emit('corpse:gone', { uid: 0, x: bag.x, y: bag.y });
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
    bag.items = bag.items.flatMap((slot) => {
      if (!slot) return [];
      // Itens com durabilidade vão inteiros para um slot vazio (mantêm o desgaste).
      if (slot[2] !== undefined) {
        const target = containers.find((c) => c.includes(null));
        if (!target) return [slot];
        target[target.indexOf(null)] = slot;
        return [];
      }
      const left = this.actions.give(slot[0], slot[1]);
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
    // O corpo fica no chão, na posição em que estava, com os drops e as flechas espetadas:
    // abre-se com a ação (como uma mochila) e desaparece quando se apanhar tudo.
    const items: Record<string, number> = { ...enemy.arrows };
    if (def) {
      for (const drop of rollEnemyDrops(def, this.state.data.world))
        items[drop.item] = (items[drop.item] ?? 0) + drop.qty;
    }
    const slots: Container = Object.entries(items).map(([item, qty]): [string, number] => [item, qty]);
    if (zone && slots.length > 0) this.corpseBag(zone.zoneId, enemy, slots);
    else this.bus.emit('corpse:gone', { uid: enemy.uid, x: enemy.x, y: enemy.y });
    by.bus.emit('enemy:killed', { uid: enemy.uid, enemy: enemy.id, x: enemy.x, y: enemy.y });
    if (!def || !zone) return;
    if (def.boss) {
      const days = zone.respawnDays ?? 1;
      this.state.data.bosses[zone.zoneId] =
        this.state.data.world.tick + secondsToTicks(days * BALANCE.dayLengthSec);
      by.bus.emit('boss:defeated', { enemy: enemy.id });
    }
    by.state.markDirty();
  }
}
