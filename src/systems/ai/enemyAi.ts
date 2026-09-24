import { nextRandom, type RngState } from '../../core/Rng';
import type { EnemyDef } from '../../data/types';
import type { CollisionWorld } from '../movement/CollisionWorld';
import type { Vec2 } from '../movement/geometry';
import { moveWithCollision, normalize } from '../movement/movement';

// IA dos inimigos (CLAUDE.md §7.8, §7.9), lógica pura no passo fixo:
// idle → wander → chase → windup (aviso) → recover → … → return (leash).
// As presas (`flee`) fogem do jogador em vez de o perseguir.

export type EnemyState = 'idle' | 'wander' | 'chase' | 'windup' | 'recover' | 'return' | 'flee' | 'charge';

export interface Enemy {
  uid: number;
  id: string;
  x: number;
  y: number;
  /** Posição no tick anterior (para interpolar no ecrã). */
  px: number;
  py: number;
  /** Onde nasceu: não se afasta mais do que `leashRadius` daqui. */
  home: Vec2;
  hp: number;
  state: EnemyState;
  /** Ticks que faltam no estado atual (idle, windup, recover…). */
  timer: number;
  /** Para onde vai a passear. */
  goal: Vec2 | null;
  /** Olha para a esquerda (sprite espelhado)? */
  flip: boolean;
  /** Atordoado por um golpe (não age; só é empurrado). */
  stun: number;
  /** Empurrão por tick enquanto está atordoado. */
  knock: Vec2;
  /** O aviso em curso é para uma carga (javali) e não para um golpe. */
  charging: boolean;
  /** Direção da carga. */
  dir: Vec2;
  /** Derrotado, a rebentar (inchado): ticks até explodir (0 = vivo). */
  dying: number;
  /** Da horda (§7.13): vê sempre o jogador e não desiste (sem leash). */
  horde: boolean;
  /** Ticks seguidos sem se aproximar do jogador (preso numa parede). */
  stuck: number;
  /** Peça construída que está a atacar (uid), quando o aviso é contra ela. */
  siege: number | null;
  /** Alertado por um grito: ticks em que vai à procura do jogador (sem desistir). */
  alert: number;
  /** Gritador: ticks até poder gritar outra vez. */
  cooldown: number;
}

export interface AiContext {
  player: Vec2;
  /** O jogador anda agachado: vê-se de mais perto (§7.8). */
  sneaking: boolean;
  world: CollisionWorld;
  rng: RngState;
  /** Ticks por segundo de jogo. */
  ticksPerSec: number;
  windupTicks: number;
  sneakDetectMultiplier: number;
  /** Hordas: ticks presos até atacarem o que os bloqueia. */
  stuckTicks?: number;
  /** Hordas: peça construída que bloqueia o caminho até ao jogador (uid) ou null. */
  obstacle?: (enemy: Enemy) => number | null;
}

/** Distância a mais que o ataque ainda alcança no fim do aviso (o jogador tem de recuar). */
export const ATTACK_SLACK_PX = 4;
/** Distância a que se passeia à volta de casa. */
const WANDER_RADIUS = 48;

export function createEnemy(uid: number, id: string, def: EnemyDef, at: Vec2): Enemy {
  return {
    uid,
    id,
    x: at.x,
    y: at.y,
    px: at.x,
    py: at.y,
    home: { ...at },
    hp: def.hp,
    state: 'idle',
    timer: 0,
    goal: null,
    flip: false,
    stun: 0,
    knock: { x: 0, y: 0 },
    charging: false,
    dir: { x: 0, y: 0 },
    dying: 0,
    horde: false,
    stuck: 0,
    siege: null,
    alert: 0,
    cooldown: 0,
  };
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Anda em direção a `to` à velocidade `speed` (px/s). @returns true se chegou. */
function walk(enemy: Enemy, def: EnemyDef, to: Vec2, speed: number, ctx: AiContext, stopAt = 0): boolean {
  const gap = distance(enemy, to);
  if (gap <= stopAt + 0.5) return true;
  const dir = normalize({ x: to.x - enemy.x, y: to.y - enemy.y });
  const step = Math.min(speed / ctx.ticksPerSec, gap - stopAt);
  const next = moveWithCollision(enemy, def.footprint, { x: dir.x * step, y: dir.y * step }, ctx.world);
  if (dir.x !== 0) enemy.flip = dir.x < 0;
  const stuck = next.x === enemy.x && next.y === enemy.y;
  enemy.x = next.x;
  enemy.y = next.y;
  return stuck;
}

function startIdle(enemy: Enemy, ctx: AiContext): void {
  enemy.state = 'idle';
  enemy.goal = null;
  enemy.timer = Math.round((1 + nextRandom(ctx.rng) * 2) * ctx.ticksPerSec);
}

/**
 * Um tick de IA.
 * @returns 'attack' quando um ataque acaba o aviso com o jogador ao alcance, 'siege' quando acaba
 * o aviso contra a peça `enemy.siege` (quem chama aplica o dano).
 */
export function stepEnemy(enemy: Enemy, def: EnemyDef, ctx: AiContext): 'attack' | 'siege' | 'scream' | null {
  enemy.px = enemy.x;
  enemy.py = enemy.y;
  if (enemy.dying > 0) return null; // a rebentar: quem trata é o Combat
  if (enemy.stun > 0) {
    enemy.stun -= 1;
    const next = moveWithCollision(enemy, def.footprint, enemy.knock, ctx.world);
    enemy.x = next.x;
    enemy.y = next.y;
    return null;
  }
  if (enemy.alert > 0) enemy.alert -= 1;
  if (enemy.cooldown > 0) enemy.cooldown -= 1;
  const toPlayer = distance(enemy, ctx.player);
  const windupTicks = def.windupSec ? Math.round(def.windupSec * ctx.ticksPerSec) : ctx.windupTicks;
  const detect = def.detectRadius * (ctx.sneaking ? ctx.sneakDetectMultiplier : 1);
  // A horda vem à procura do jogador e não desiste.
  // Alertado por um grito: também vem à procura (sem leash) enquanto durar o alerta.
  const hunting = enemy.horde || enemy.alert > 0;
  const sees = hunting || toPlayer <= detect;
  const playerFarFromHome = !hunting && distance(ctx.player, enemy.home) > def.leashRadius;

  if (def.behavior === 'flee') {
    if (sees) {
      enemy.state = 'flee';
      const away = normalize({ x: enemy.x - ctx.player.x, y: enemy.y - ctx.player.y });
      walk(enemy, def, { x: enemy.x + away.x * 32, y: enemy.y + away.y * 32 }, def.speed, ctx);
      return null;
    }
    if (enemy.state === 'flee') startIdle(enemy, ctx);
    wander(enemy, def, ctx);
    return null;
  }

  switch (enemy.state) {
    case 'windup':
      // O ataque está comprometido: não se move; no fim acerta se o jogador não recuou.
      enemy.flip = ctx.player.x < enemy.x;
      enemy.timer -= 1;
      if (enemy.timer > 0) return null;
      if (enemy.charging && def.charge) {
        // Carga: corre em linha reta para onde o jogador estava no fim do aviso.
        enemy.state = 'charge';
        enemy.dir = normalize({ x: ctx.player.x - enemy.x, y: ctx.player.y - enemy.y });
        enemy.timer = Math.round(def.charge.sec * ctx.ticksPerSec);
        return null;
      }
      enemy.state = 'recover';
      enemy.timer = Math.round(def.attackSec * ctx.ticksPerSec);
      if (enemy.siege !== null) return 'siege';
      return toPlayer <= def.attackRange + ATTACK_SLACK_PX ? 'attack' : null;
    case 'charge': {
      const speed = (def.charge?.speed ?? def.speed) / ctx.ticksPerSec;
      const next = moveWithCollision(
        enemy,
        def.footprint,
        { x: enemy.dir.x * speed, y: enemy.dir.y * speed },
        ctx.world,
      );
      const stuck = next.x === enemy.x && next.y === enemy.y;
      enemy.x = next.x;
      enemy.y = next.y;
      if (enemy.dir.x !== 0) enemy.flip = enemy.dir.x < 0;
      enemy.timer -= 1;
      const hit = distance(enemy, ctx.player) <= def.attackRange + ATTACK_SLACK_PX;
      if (hit || stuck || enemy.timer <= 0) {
        enemy.state = 'recover';
        enemy.charging = false;
        enemy.timer = Math.round(def.attackSec * ctx.ticksPerSec);
        return hit ? 'attack' : null;
      }
      return null;
    }
    case 'recover':
      enemy.timer -= 1;
      if (enemy.timer <= 0) enemy.state = 'chase';
      return null;
    case 'return':
      if (sees && !playerFarFromHome) {
        enemy.state = 'chase';
        return null;
      }
      if (walk(enemy, def, enemy.home, def.speed, ctx, 2) || distance(enemy, enemy.home) <= 2) {
        enemy.hp = def.hp; // desistiu: volta inteiro (como no original)
        startIdle(enemy, ctx);
      }
      return null;
    case 'chase':
      if ((!hunting && distance(enemy, enemy.home) > def.leashRadius) || playerFarFromHome) {
        enemy.state = 'return';
        return null;
      }
      // Gritador: mantém a distância e grita de tempos a tempos.
      if (def.scream) {
        const scream = def.scream;
        if (toPlayer < scream.keepAway * 0.7) {
          const away = normalize({ x: enemy.x - ctx.player.x, y: enemy.y - ctx.player.y });
          walk(enemy, def, { x: enemy.x + away.x * 16, y: enemy.y + away.y * 16 }, def.speed, ctx);
        } else walk(enemy, def, ctx.player, def.speed, ctx, scream.keepAway);
        if (enemy.cooldown > 0) return null;
        enemy.cooldown = Math.round(scream.everySec * ctx.ticksPerSec);
        return 'scream';
      }
      if (toPlayer <= def.attackRange && def.damage > 0) {
        enemy.state = 'windup';
        enemy.siege = null;
        enemy.charging = false;
        enemy.timer = windupTicks;
        return null;
      }
      // Javali: de longe, avisa e carrega (um aviso mais longo, para dar tempo de sair da frente).
      if (def.charge && toPlayer <= def.charge.range) {
        enemy.state = 'windup';
        enemy.siege = null;
        enemy.charging = true;
        enemy.timer = windupTicks * 2;
        return null;
      }
      walk(enemy, def, ctx.player, def.speed, ctx, def.attackRange - 2);
      if (enemy.horde) besiege(enemy, def, ctx, toPlayer);
      return null;
    default:
      if (sees && !playerFarFromHome) {
        enemy.state = 'chase';
        return null;
      }
      wander(enemy, def, ctx);
      return null;
  }
}

/**
 * Hordas: quem não se consegue aproximar do jogador (preso contra uma parede construída) ataca a
 * peça que o bloqueia, com o mesmo aviso de um ataque normal.
 */
function besiege(enemy: Enemy, def: EnemyDef, ctx: AiContext, before: number): void {
  const progress = before - distance(enemy, ctx.player);
  enemy.stuck = progress < (def.speed / ctx.ticksPerSec) * 0.3 ? enemy.stuck + 1 : 0;
  if (enemy.stuck < (ctx.stuckTicks ?? Infinity) || !ctx.obstacle || def.damage <= 0) return;
  const uid = ctx.obstacle(enemy);
  if (uid === null) return;
  enemy.stuck = 0;
  enemy.siege = uid;
  enemy.state = 'windup';
  enemy.charging = false;
  enemy.timer = def.windupSec ? Math.round(def.windupSec * ctx.ticksPerSec) : ctx.windupTicks;
}

/** Parado um bocado, depois anda devagar para um ponto perto de casa. */
function wander(enemy: Enemy, def: EnemyDef, ctx: AiContext): void {
  if (enemy.state !== 'wander') {
    enemy.state = 'idle';
    enemy.timer -= 1;
    if (enemy.timer > 0) return;
    const angle = nextRandom(ctx.rng) * Math.PI * 2;
    const radius = nextRandom(ctx.rng) * WANDER_RADIUS;
    enemy.goal = { x: enemy.home.x + Math.cos(angle) * radius, y: enemy.home.y + Math.sin(angle) * radius };
    enemy.state = 'wander';
    enemy.timer = 6 * ctx.ticksPerSec;
    return;
  }
  enemy.timer -= 1;
  const goal = enemy.goal ?? enemy.home;
  if (walk(enemy, def, goal, def.speed / 2, ctx, 1) || enemy.timer <= 0) startIdle(enemy, ctx);
}

/** Um golpe do jogador: tira vida e, fora do aviso de ataque, empurra e atordoa. @returns morreu? */
export function hitEnemy(
  enemy: Enemy,
  damage: number,
  from: Vec2,
  knockbackPx: number,
  stunTicks: number,
): boolean {
  enemy.hp = Math.max(0, enemy.hp - damage);
  if (enemy.hp === 0) return true;
  if (enemy.state !== 'windup' && stunTicks > 0) {
    const away = normalize({ x: enemy.x - from.x, y: enemy.y - from.y });
    enemy.stun = stunTicks;
    enemy.knock = { x: (away.x * knockbackPx) / stunTicks, y: (away.y * knockbackPx) / stunTicks };
    // Quem foge continua a fugir; os outros passam a perseguir quem lhes bateu.
    if (enemy.state !== 'flee') enemy.state = 'chase';
  }
  return false;
}
