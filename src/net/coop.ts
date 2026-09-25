// Co-op online a 2 (CLAUDE.md §11, Fase 15). O anfitrião corre o jogo (a Simulation); o
// convidado vê o mundo dele e controla um segundo boneco. Ligação WebRTC com o PeerJS: o
// servidor de sinalização gratuito do PeerJS liga os dois browsers e recusa ids repetidos,
// por isso o código de 5 caracteres (o id) é sempre único entre as sessões ativas.

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { eventBus, type GameEvents } from '../core/EventBus';
import { gameState, type GameStateData } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import { createEnemy, type Enemy } from '../systems/ai/enemyAi';
import type { Facing } from '../systems/movement/movement';
import { content } from '../world/content';
import {
  FORWARDED_EVENTS,
  PEER_PREFIX,
  parseGuestMessage,
  randomCode,
  type HostMessage,
  type GuestMessage,
} from './protocol';

/** Intervalos de envio (ms). */
const FRAME_MS = 100;
const FULL_MS = 2000;
const ME_MS = 66;
const CODE_ATTEMPTS = 6;
const JOIN_TIMEOUT_MS = 15000;

export type CoopRole = 'host' | 'guest';

/** Boneco do outro jogador para desenhar: posição anterior/atual e quando chegou. */
export interface AvatarView {
  x: number;
  y: number;
  px: number;
  py: number;
  facing: Facing;
  moved: boolean;
  sneak: boolean;
  down: boolean;
  /** Quando chegou a posição (ms, performance.now) — para interpolar. */
  at: number;
}

/** Servidor de sinalização: o do PeerJS, ou outro com `?peer=host:porta` (testes locais). */
function peerOptions(): Partial<PeerOptions> {
  const custom = new URLSearchParams(window.location.search).get('peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host: host ?? 'localhost', port: Number(port ?? 9000), path: '/', secure: false, debug: 0 };
}

class Coop {
  role: CoopRole | null = null;
  /** Código da sessão (anfitrião). */
  code: string | null = null;
  /** Há um convidado ligado (anfitrião) / ligado ao anfitrião (convidado). */
  connected = false;
  /** Chamado quando a ligação cai (o convidado volta ao menu). */
  onLost: (() => void) | null = null;
  /** Convidado: o mundo mudou de zona ou de peças (a cena tem de se refazer). */
  onWorldChanged: ((zoneId: string) => void) | null = null;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private lastFrame = 0;
  private lastFull = 0;
  private lastMe = 0;
  private offEvents: (() => void)[] = [];
  /** Anfitrião: o parceiro (a posição chega pela rede). Convidado: o anfitrião. */
  private other: AvatarView | null = null;
  /** Convidado: quando chegou o último frame (para interpolar os inimigos). */
  private frameAt = 0;
  private structuresKey = '';
  /** Convidado: caído (à espera de voltar ao pé do anfitrião). */
  private down = false;
  /** Quando o outro jogador deu o último golpe (ms), para a animação. */
  otherAttackAt = -Infinity;

  get isGuest(): boolean {
    return this.role === 'guest';
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Convidado caído: não anda até voltar ao pé do anfitrião. */
  get guestDown(): boolean {
    return this.isGuest && this.down;
  }

  // ——— Anfitrião ———

  /** Abre uma sessão e espera por um convidado. @returns o código a partilhar. */
  async host(): Promise<string> {
    if (this.role === 'host' && this.code) return this.code;
    this.leave();
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = randomCode();
      const peer = await this.openPeer(PEER_PREFIX + code).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'taken') return null; // código em uso: tenta outro
        throw error instanceof Error ? error : new Error(String(error));
      });
      if (!peer) continue;
      this.peer = peer;
      this.role = 'host';
      this.code = code;
      peer.on('connection', (conn) => {
        this.acceptGuest(conn);
      });
      return code;
    }
    throw new Error('Não foi possível arranjar um código livre.');
  }

  private openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const options = peerOptions() as PeerOptions;
      const peer = id ? new Peer(id, options) : new Peer(options);
      peer.once('open', () => {
        resolve(peer);
      });
      peer.once('error', (error) => {
        peer.destroy();
        reject(new Error(error.type === 'unavailable-id' ? 'taken' : error.type));
      });
    });
  }

  private acceptGuest(conn: DataConnection): void {
    if (this.conn) {
      conn.on('open', () => {
        conn.close();
      });
      return;
    }
    this.conn = conn;
    conn.on('data', (raw) => {
      const message = parseGuestMessage(raw);
      if (message) this.fromGuest(message);
    });
    conn.on('close', () => {
      this.guestLeft();
    });
    conn.on('error', () => {
      this.guestLeft();
    });
  }

  private fromGuest(message: GuestMessage): void {
    if (message.t === 'join') {
      // Só armas que existem (o save do convidado pode ser de outra versão).
      const weapon = message.weapon && content.items[message.weapon]?.damage ? message.weapon : null;
      simulation.setPartner(weapon);
      this.connected = true;
      this.forwardEvents();
      this.offEvents.push(
        eventBus.on('partner:action', () => {
          this.otherAttackAt = performance.now();
        }),
      );
      this.sendFull();
      eventBus.emit('coop:changed', {});
    } else if (message.t === 'me') {
      simulation.movePartner(message.x, message.y, message.facing, message.moved === 1, message.sneak === 1);
      const partner = simulation.partner;
      if (partner) this.other = this.avatar(partner.x, partner.y, message.facing, message.moved === 1, false);
    } else simulation.partnerAction();
  }

  private guestLeft(): void {
    for (const off of this.offEvents) off();
    this.offEvents = [];
    this.conn = null;
    this.connected = false;
    this.other = null;
    simulation.setPartner(undefined);
    eventBus.emit('coop:changed', {});
  }

  /** Reenvia ao convidado os eventos que mudam o que se vê (golpes, recolha, loot…). */
  private forwardEvents(): void {
    for (const name of FORWARDED_EVENTS) {
      this.offEvents.push(
        eventBus.on(name, (payload: GameEvents[typeof name]) => {
          this.send({ t: 'ev', name, payload });
        }),
      );
    }
  }

  /** O anfitrião entrou numa zona (manda logo o mundo inteiro; o parceiro vem com ele). */
  hostZoneEntered(): void {
    if (!this.isHost || !this.connected) return;
    const partner = simulation.partner;
    if (partner) {
      const { x, y } = gameState.data.player;
      Object.assign(partner, { x, y, px: x, py: y });
    }
    this.sendFull();
  }

  private sendFull(): void {
    if (!gameState.hasGame) return;
    this.lastFull = performance.now();
    this.send({ t: 'full', state: gameState.data });
  }

  private sendFrame(): void {
    const data = gameState.data;
    const player = data.player;
    const partner = simulation.partner;
    this.send({
      t: 'frame',
      tick: data.world.tick,
      host: [
        player.x,
        player.y,
        player.facing,
        simulation.playerMoved ? 1 : 0,
        simulation.playerSneaking ? 1 : 0,
      ],
      you: { hp: partner?.hp ?? 0, down: partner && partner.downUntil > 0 ? 1 : 0 },
      enemies: simulation.combat.list.map((e) => [
        e.uid,
        e.id,
        Math.round(e.x * 10) / 10,
        Math.round(e.y * 10) / 10,
        e.hp,
        e.state,
        e.flip ? 1 : 0,
        e.dying > 0 ? 1 : 0,
      ]),
    });
  }

  // ——— Convidado ———

  /**
   * Entra na sessão `code` e espera pelo mundo do anfitrião.
   * @param weapon a arma equipada no save do convidado (dá o dano dele), ou null.
   */
  join(code: string, weapon: string | null): Promise<GameStateData> {
    this.leave();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string): void => {
        if (settled) return;
        settled = true;
        this.leave();
        reject(new Error(reason));
      };
      const timer = window.setTimeout(() => {
        fail('timeout');
      }, JOIN_TIMEOUT_MS);
      this.openPeer()
        .then((peer) => {
          this.peer = peer;
          peer.on('error', (error) => {
            fail(error.type === 'peer-unavailable' ? 'not_found' : error.type);
          });
          const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
          this.conn = conn;
          conn.on('open', () => {
            this.send({ t: 'join', weapon });
          });
          conn.on('data', (raw) => {
            const message = raw as HostMessage;
            if (message.t === 'full' && !settled) {
              settled = true;
              window.clearTimeout(timer);
              this.role = 'guest';
              this.connected = true;
              this.structuresKey = JSON.stringify(message.state.base.structures);
              resolve(this.guestState(message.state));
              return;
            }
            this.fromHost(message);
          });
          conn.on('close', () => {
            if (!settled) fail('closed');
            else this.lost();
          });
        })
        .catch((error: unknown) => {
          fail(error instanceof Error ? error.message : 'network');
        });
    });
  }

  /**
   * O mundo do anfitrião visto pelo convidado: o `player` passa a ser o boneco do convidado
   * (na mesma posição do anfitrião se mudou de zona); a mochila é a do anfitrião (partilhada).
   */
  private guestState(host: GameStateData): GameStateData {
    const state = structuredClone(host);
    const hostPlayer = host.player;
    const mine = gameState.hasGame && gameState.borrowed ? gameState.data.player : null;
    // Na mesma zona fica onde está; noutra, aparece ao pé do anfitrião.
    const at = mine?.zoneId === hostPlayer.zoneId ? mine : hostPlayer;
    state.player = {
      ...state.player,
      x: at.x,
      y: at.y,
      facing: at.facing,
      hp: mine?.hp ?? BALANCE.statMax,
      hunger: BALANCE.statMax,
      thirst: BALANCE.statMax,
      bleed: 0,
    };
    this.other = this.avatar(hostPlayer.x, hostPlayer.y, hostPlayer.facing, false, false);
    return state;
  }

  private fromHost(message: HostMessage): void {
    if (message.t === 'bye') {
      this.lost();
      return;
    }
    if (message.t === 'ev') {
      const emit = eventBus.emit.bind(eventBus) as (name: string, payload: unknown) => void;
      // Visto do convidado, o "parceiro" é ele próprio e o "jogador" é o anfitrião.
      if (message.name === 'player:action') this.otherAttackAt = performance.now();
      else if (message.name === 'partner:action')
        return; // o golpe já se animou aqui
      else if (message.name === 'partner:damaged') emit('player:damaged', message.payload);
      else emit(message.name, message.payload);
      return;
    }
    if (message.t === 'full') {
      const previousZone = gameState.hasGame ? gameState.data.player.zoneId : null;
      const structures = JSON.stringify(message.state.base.structures);
      const changed = structures !== this.structuresKey;
      this.structuresKey = structures;
      gameState.load(this.guestState(message.state), true);
      const zoneId = gameState.data.player.zoneId;
      if (zoneId !== previousZone || changed) this.onWorldChanged?.(zoneId);
      return;
    }
    // Frame: o anfitrião, a vida do convidado e os inimigos (para interpolar).
    this.frameAt = performance.now();
    const [x, y, facing, moved, sneak] = message.host;
    this.other = this.avatar(x, y, facing, moved === 1, sneak === 1);
    if (gameState.hasGame) {
      const player = gameState.data.player;
      player.hp = message.you.hp;
      gameState.data.world.tick = message.tick;
      // Voltou a levantar-se: aparece ao pé do anfitrião (como o anfitrião o pôs).
      if (this.down && message.you.down === 0) {
        player.x = x;
        player.y = y;
        simulation.reset();
      }
      this.down = message.you.down === 1;
    }
    const previous = new Map(simulation.combat.list.map((e) => [e.uid, e]));
    const enemies: Enemy[] = [];
    for (const [uid, id, ex, ey, hp, state, flip, dying] of message.enemies) {
      const def = content.enemies[id];
      if (!def) continue;
      const enemy = previous.get(uid) ?? createEnemy(uid, id, def, { x: ex, y: ey });
      enemy.px = enemy.x;
      enemy.py = enemy.y;
      enemy.x = ex;
      enemy.y = ey;
      enemy.hp = hp;
      enemy.state = state as Enemy['state'];
      enemy.flip = flip === 1;
      enemy.dying = dying === 1 ? 1 : 0;
      enemies.push(enemy);
    }
    simulation.combat.setRemote(enemies);
  }

  /** Convidado: pede ao anfitrião a ação (bater/apanhar) do boneco dele. */
  sendAct(): void {
    this.send({ t: 'act' });
  }

  private lost(): void {
    const handler = this.onLost;
    this.leave();
    handler?.();
  }

  // ——— Os dois ———

  /** Chamar em todos os frames da cena de jogo: envia posições/estado ao ritmo certo. */
  update(now: number): void {
    if (!this.connected || !gameState.hasGame) return;
    if (this.isHost) {
      if (now - this.lastFrame >= FRAME_MS) {
        this.lastFrame = now;
        this.sendFrame();
      }
      if (now - this.lastFull >= FULL_MS) this.sendFull();
    } else if (now - this.lastMe >= ME_MS) {
      this.lastMe = now;
      const p = gameState.data.player;
      this.send({
        t: 'me',
        x: p.x,
        y: p.y,
        facing: p.facing,
        moved: simulation.playerMoved ? 1 : 0,
        sneak: simulation.playerSneaking ? 1 : 0,
      });
    }
  }

  /** O outro jogador (para desenhar), ou null. */
  otherAvatar(): AvatarView | null {
    if (this.isHost) {
      const partner = simulation.partner;
      if (!partner || !this.other) return null;
      this.other.down = partner.downUntil > 0;
      if (this.other.down)
        Object.assign(this.other, { x: partner.x, y: partner.y, px: partner.x, py: partner.y });
    }
    return this.other;
  }

  /** Fração [0, 1] entre a posição anterior e a atual de uma coisa que chegou em `at`. */
  alpha(now: number, at: number, interval: number): number {
    return Math.max(0, Math.min(1, (now - at) / interval));
  }

  /** Convidado: interpolação dos inimigos entre frames. */
  enemyAlpha(now: number): number {
    return this.alpha(now, this.frameAt, FRAME_MS);
  }

  /** Intervalo esperado entre posições do outro jogador. */
  get otherInterval(): number {
    return this.isHost ? ME_MS : FRAME_MS;
  }

  private avatar(x: number, y: number, facing: Facing, moved: boolean, sneak: boolean): AvatarView {
    const old = this.other;
    return {
      x,
      y,
      px: old ? old.x : x,
      py: old ? old.y : y,
      facing,
      moved,
      sneak,
      down: false,
      at: performance.now(),
    };
  }

  private send(message: HostMessage | GuestMessage): void {
    if (this.conn?.open) void this.conn.send(message);
  }

  /** Sai do co-op (fecha a ligação). */
  leave(): void {
    if (this.isHost && this.conn?.open) this.send({ t: 'bye' });
    for (const off of this.offEvents) off();
    this.offEvents = [];
    const wasGuest = this.isGuest;
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.code = null;
    this.connected = false;
    this.other = null;
    this.down = false;
    if (wasGuest) simulation.remoteAction = null;
    else simulation.setPartner(undefined);
    eventBus.emit('coop:changed', {});
  }
}

/** Instância única (há no máximo uma sessão de co-op). */
export const coop = new Coop();
