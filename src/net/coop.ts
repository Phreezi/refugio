// Co-op online a 2 (CLAUDE.md §11, Fase 15). Os dois jogadores são completos e autónomos (cada
// um com a sua personagem: mochila, equipamento, nível, fome/sede), no mundo do anfitrião — que
// partilham: baús, peças, estações, recursos e contentores. Podem estar em zonas diferentes.
//
// O anfitrião corre a lógica dos dois (uma segunda Simulation, sobre o mesmo mundo); o convidado
// anda no ecrã dele, faz as ações dos painéis logo (e manda-as ao anfitrião, que tem a última
// palavra) e recebe o estado. Ligação WebRTC com o PeerJS: o servidor de sinalização recusa ids
// repetidos, por isso o código de 5 caracteres (o id) é único entre as sessões ativas.

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { EventBus, eventBus, type GameEvents } from '../core/EventBus';
import {
  BASE_ZONE_ID,
  createNewGameState,
  gameState,
  GameState,
  type CharacterLook,
  type GameStateData,
} from '../core/GameState';
import { simulation, Simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import type { Container } from '../systems/inventory/inventory';
import { createEnemy, type Enemy } from '../systems/ai/enemyAi';
import type { Facing } from '../systems/movement/movement';
import { saves } from '../save';
import { validateState } from '../save/schema';
import { uiState } from '../ui/uiState';
import { content } from '../world/content';
import {
  GUEST_COMMANDS,
  HOST_VISUAL_EVENTS,
  PEER_PREFIX,
  PROGRESSION_EVENTS,
  SNAPSHOT_QUIET_EVENTS,
  parseGuestMessage,
  randomCode,
  type CommandSystem,
  type GuestCharacter,
  type GuestMessage,
  type HostMessage,
} from './protocol';

/** Intervalos (ms). */
const FRAME_MS = 100;
const SNAP_MIN_MS = 250;
const SNAP_MAX_MS = 3000;
const ME_MS = 66;
const OWN_SAVE_MS = 10000;
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
  /** Zona onde está. */
  zone: string;
  look: CharacterLook;
  /** Quando chegou a posição (ms, performance.now) — para interpolar. */
  at: number;
}

/**
 * Anfitrião: eventos da simulação do convidado (o que lhe acontece: vão para o ecrã dele; os que
 * mudam o mundo também se veem no ecrã do anfitrião, se estiverem na mesma zona).
 */
export const guestBus = new EventBus<GameEvents>();

/** Servidor de sinalização: o do PeerJS, ou outro com `?peer=host:porta` (testes locais). */
function peerOptions(): Partial<PeerOptions> {
  const custom = new URLSearchParams(window.location.search).get('peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host: host ?? 'localhost', port: Number(port ?? 9000), path: '/', secure: false, debug: 0 };
}

/** Tira itens que este jogo não conhece (o save do outro pode ser de outra versão). */
function knownItems(container: Container): Container {
  return container.map((slot) => (slot && content.items[slot[0]] ? slot : null));
}

class Coop {
  role: CoopRole | null = null;
  /** Código da sessão (anfitrião). */
  code: string | null = null;
  /** Há um convidado ligado (anfitrião) / ligado ao anfitrião (convidado). */
  connected = false;
  /** Convidado: a ligação caiu (volta ao menu). */
  onLost: (() => void) | null = null;
  /** Convidado: chegou o mundo (`warped`: o anfitrião mudou-o de sítio). */
  onSnapshot: ((warped: boolean) => void) | null = null;
  /** Quando o outro jogador deu o último golpe (ms), para a animação. */
  otherAttackAt = -Infinity;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private offEvents: (() => void)[] = [];
  /** Anfitrião: o convidado. Convidado: o anfitrião. */
  private other: AvatarView | null = null;
  private lastFrame = 0;
  private lastSnap = 0;
  private lastMe = 0;

  // Anfitrião.
  private guestState: GameState | null = null;
  private guestSim: Simulation | null = null;
  private warp = 0;
  private ack = 0;
  private snapDirty = false;
  /** A executar um comando do convidado (os eventos dele já aconteceram no ecrã dele). */
  private executing = false;

  // Convidado.
  private seq = 0;
  private localWarp = -1;
  private frameAt = 0;
  /** O save do convidado (o mundo dele), onde a personagem volta a ser gravada. */
  private ownSave: GameStateData | null = null;
  private lastOwnSave = 0;
  private restoreCommands: (() => void)[] = [];

  get isGuest(): boolean {
    return this.role === 'guest';
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Anfitrião: o convidado está na zona `zoneId` (vê-se e partilham o que acontece)? */
  guestHere(zoneId: string): boolean {
    return this.guestState?.data.player.zoneId === zoneId;
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
      this.guestJoined(message.character);
      return;
    }
    const sim = this.guestSim;
    const player = this.guestState?.data.player;
    if (!sim || !player) return;
    if (message.t === 'me') {
      if (message.zone !== player.zoneId) return; // posição antiga (estava a mudar de zona)
      const moved = message.moved === 1;
      const sneak = message.sneak === 1;
      sim.setRemotePlayer(message.x, message.y, message.facing, moved, sneak);
      sim.autoAttack = message.auto === 1;
      this.other = this.avatar(message.x, message.y, message.facing, moved, sneak, message.zone, player.look);
    } else if (message.t === 'act') sim.setActionHeld(message.held === 1, message.tick);
    else if (message.t === 'away') sim.away = message.on === 1;
    else this.runCommand(message.sys, message.m, message.args, message.seq);
  }

  /** O convidado entrou com a personagem dele: aparece ao pé do anfitrião. */
  private guestJoined(character: GuestCharacter): void {
    if (!gameState.hasGame || this.guestSim) return;
    const host = gameState.data;
    let state: GameStateData;
    try {
      // O mundo é o do anfitrião (os mesmos objetos: o que um muda, o outro vê); a personagem,
      // a do convidado (validada como se fosse um save).
      const checked = validateState(
        structuredClone({
          ...host,
          player: character.player,
          unlocks: character.unlocks,
          stats: character.stats,
          tutorial: character.tutorial,
        }),
      );
      const player = checked.player;
      player.inventory = knownItems(player.inventory);
      player.hotbar = knownItems(player.hotbar);
      player.equipment = knownItems(player.equipment);
      Object.assign(player, {
        zoneId: host.player.zoneId,
        x: host.player.x,
        y: host.player.y,
        facing: host.player.facing,
      });
      state = { ...host, player, unlocks: checked.unlocks, stats: checked.stats, tutorial: checked.tutorial };
    } catch (error) {
      console.warn('[coop] personagem do convidado recusada:', error);
      this.send({ t: 'bye' });
      return;
    }
    const guestState = new GameState();
    guestState.load(state);
    const sim = new Simulation(guestState, guestBus);
    sim.setRespawnPoint(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    this.guestState = guestState;
    this.guestSim = sim;
    simulation.attach(sim);
    simulation.setDifficulty(BALANCE.coopEnemyMultiplier);
    uiState.coop = true;
    this.connected = true;
    this.warp += 1;
    this.forwardEvents();
    this.sendSnapshot();
    eventBus.emit('coop:changed', {});
  }

  private guestLeft(): void {
    for (const off of this.offEvents) off();
    this.offEvents = [];
    this.conn = null;
    this.connected = false;
    this.other = null;
    if (this.guestSim) simulation.detach(this.guestSim);
    this.guestSim = null;
    this.guestState = null;
    simulation.setDifficulty(1);
    simulation.away = false;
    uiState.coop = false;
    eventBus.emit('coop:changed', {});
  }

  /** Um comando dos painéis do convidado (só os da lista; o que ele já fez no ecrã dele). */
  private runCommand(sys: CommandSystem, method: string, args: unknown[], seq: number): void {
    const sim = this.guestSim;
    if (!sim) return;
    this.executing = true;
    try {
      if (sys === 'sim') this.guestTravel(sim, method, args);
      else {
        const targets: Record<Exclude<CommandSystem, 'sim'>, object> = {
          actions: sim.actions,
          crafting: sim.crafting,
          building: sim.building,
          fishing: sim.fishing,
          tutorial: sim.tutorial,
        };
        const target = targets[sys];
        const fn: unknown = Reflect.get(target, method);
        if (typeof fn === 'function') Reflect.apply(fn, target, args);
      }
    } catch (error) {
      console.warn('[coop] comando do convidado falhou:', sys, method, error);
    } finally {
      this.executing = false;
      this.ack = seq;
      this.snapDirty = true;
    }
  }

  /** O convidado viajou (mapa-mundo) ou passou uma saída para outra zona. */
  private guestTravel(sim: Simulation, method: string, args: unknown[]): void {
    const zoneId = String(args[0]);
    if (!content.zones[zoneId]) return;
    const map = content.zoneMap(zoneId);
    if (method === 'travel') {
      const cost = (args[1] ?? {}) as { hunger?: unknown; thirst?: unknown };
      const hunger = Number(cost.hunger) || 0;
      const thirst = Number(cost.thirst) || 0;
      sim.travel(zoneId, map, { hunger, thirst }, args[2] === true);
    } else {
      const via = args[1] as { x: number; y: number } | null | undefined;
      sim.enterZone(zoneId, map, via ?? undefined);
    }
  }

  /** Eventos: os do convidado vão para o ecrã dele; os do anfitrião, se estiverem na mesma zona. */
  private forwardEvents(): void {
    this.offEvents.push(
      guestBus.onAny((name, payload) => {
        if (!SNAPSHOT_QUIET_EVENTS.has(name)) this.snapDirty = true;
        if (name === 'world:tick') return;
        if (name === 'player:action') this.otherAttackAt = performance.now();
        if (name === 'player:died') this.warp += 1; // reaparece na base
        // Os eventos dos comandos já aconteceram no ecrã dele (menos a XP e os níveis).
        if (this.executing && !PROGRESSION_EVENTS.has(name)) return;
        this.send({ t: 'ev', name, payload });
      }),
      eventBus.onAny((name, payload) => {
        if (!SNAPSHOT_QUIET_EVENTS.has(name)) this.snapDirty = true;
        const zoneId = simulation.zoneId;
        if (!HOST_VISUAL_EVENTS.has(name) || zoneId === null || !this.guestHere(zoneId)) return;
        this.send({ t: 'ev', name, payload, host: 1 });
      }),
    );
  }

  private sendSnapshot(): void {
    const state = this.guestState;
    if (!state?.hasGame) return;
    this.lastSnap = performance.now();
    this.snapDirty = false;
    this.send({ t: 'snap', state: state.data, ack: this.ack, warp: this.warp });
  }

  private sendFrame(): void {
    const sim = this.guestSim;
    const state = this.guestState;
    if (!sim || !state?.hasGame) return;
    const guest = state.data.player;
    const host = gameState.data.player;
    const together = simulation.zoneId !== null && simulation.zoneId === guest.zoneId;
    this.send({
      t: 'frame',
      tick: state.data.world.tick,
      host: together
        ? [
            host.x,
            host.y,
            host.facing,
            simulation.playerMoved ? 1 : 0,
            simulation.playerSneaking ? 1 : 0,
            host.look,
          ]
        : null,
      you: [guest.hp, guest.hunger, guest.thirst, guest.bleed],
      enemies: sim.combat.list.map((e) => [
        e.uid,
        e.id,
        Math.round(e.x * 10) / 10,
        Math.round(e.y * 10) / 10,
        e.hp,
        e.maxHp,
        e.state,
        e.flip ? 1 : 0,
        e.dying > 0 ? 1 : 0,
      ]),
      fish: sim.fishing.session,
    });
  }

  // ——— Convidado ———

  /**
   * Entra na sessão `code` com a personagem do save `own` (ou uma nova, com a aparência `look`)
   * e espera pelo mundo.
   * @returns o estado a mostrar (o mundo do anfitrião com a personagem do convidado).
   */
  join(code: string, own: GameStateData | null, look: CharacterLook): Promise<GameStateData> {
    this.leave();
    const mine = own ?? createNewGameState(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    mine.player.look = look;
    const character: GuestCharacter = {
      player: mine.player,
      unlocks: mine.unlocks,
      stats: mine.stats,
      tutorial: mine.tutorial,
    };
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
            this.send({ t: 'join', character });
          });
          conn.on('data', (raw) => {
            const message = raw as HostMessage;
            if (message.t === 'snap' && !settled) {
              settled = true;
              window.clearTimeout(timer);
              this.role = 'guest';
              this.connected = true;
              this.ownSave = mine;
              this.localWarp = message.warp;
              this.startGuest();
              resolve(message.state);
              return;
            }
            if (message.t === 'bye' && !settled) {
              fail('refused');
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

  /** Convidado: as ações dos painéis passam a ir também para o anfitrião; o botão de ação, só. */
  private startGuest(): void {
    uiState.coop = true;
    simulation.remote = {
      act: (held, tick) => {
        this.send({ t: 'act', held: held ? 1 : 0, tick });
      },
    };
    const targets: Record<CommandSystem, object> = {
      actions: simulation.actions,
      crafting: simulation.crafting,
      building: simulation.building,
      fishing: simulation.fishing,
      tutorial: simulation.tutorial,
      sim: simulation,
    };
    for (const sys of Object.keys(GUEST_COMMANDS) as CommandSystem[]) {
      const target = targets[sys];
      for (const method of GUEST_COMMANDS[sys]) {
        const original: unknown = Reflect.get(target, method);
        if (typeof original !== 'function') continue;
        const wrapped = (...args: unknown[]): unknown => {
          const result: unknown = Reflect.apply(original, target, args);
          this.sendCommand(sys, method, args);
          return result;
        };
        Reflect.set(target, method, wrapped);
        this.restoreCommands.push(() => {
          Reflect.deleteProperty(target, method);
        });
      }
    }
    const onHide = (): void => {
      this.saveOwn(true);
    };
    window.addEventListener('pagehide', onHide);
    this.restoreCommands.push(() => {
      window.removeEventListener('pagehide', onHide);
    });
  }

  private sendCommand(sys: CommandSystem, method: string, args: unknown[]): void {
    // As viagens levam o mapa da zona: vai só o id (o anfitrião tem os mesmos mapas).
    const sent =
      sys === 'sim' ? (method === 'travel' ? [args[0], args[2], args[3]] : [args[0], args[2]]) : args;
    this.seq += 1;
    this.send({ t: 'cmd', seq: this.seq, sys, m: method, args: sent });
  }

  private fromHost(message: HostMessage): void {
    if (message.t === 'bye') {
      this.lost();
      return;
    }
    if (message.t === 'ev') {
      if (message.host && message.name === 'player:action') {
        this.otherAttackAt = performance.now();
        return;
      }
      const emit = eventBus.emit.bind(eventBus) as (name: string, payload: unknown) => void;
      emit(message.name, message.payload);
      return;
    }
    if (message.t === 'snap') {
      this.applySnapshot(message.state, message.ack, message.warp);
      return;
    }
    // Frame: o anfitrião, a vida/fome/sede, os inimigos (para interpolar) e a pesca.
    this.frameAt = performance.now();
    const zone = gameState.hasGame ? gameState.data.player.zoneId : '';
    if (message.host) {
      const [x, y, facing, moved, sneak, look] = message.host;
      this.other = this.avatar(x, y, facing, moved === 1, sneak === 1, zone, look);
    } else this.other = null;
    if (!gameState.hasGame) return;
    const player = gameState.data.player;
    [player.hp, player.hunger, player.thirst, player.bleed] = message.you;
    gameState.data.world.tick = message.tick;
    simulation.fishing.mirror(message.fish);
    const previous = new Map(simulation.combat.list.map((e) => [e.uid, e]));
    const enemies: Enemy[] = [];
    for (const [uid, id, ex, ey, hp, maxHp, state, flip, dying] of message.enemies) {
      const def = content.enemies[id];
      if (!def) continue;
      const enemy = previous.get(uid) ?? createEnemy(uid, id, def, { x: ex, y: ey });
      enemy.px = enemy.x;
      enemy.py = enemy.y;
      enemy.x = ex;
      enemy.y = ey;
      enemy.hp = hp;
      enemy.maxHp = maxHp;
      enemy.state = state as Enemy['state'];
      enemy.flip = flip === 1;
      enemy.dying = dying === 1 ? 1 : 0;
      enemies.push(enemy);
    }
    simulation.combat.setRemote(enemies);
  }

  /**
   * O mundo do anfitrião com a personagem do convidado. Só se aplica quando o anfitrião já fez
   * todos os comandos enviados (senão desfazia o que o convidado acabou de fazer); a posição é a
   * do ecrã do convidado, exceto quando o anfitrião o mudou de sítio (`warp`).
   */
  private applySnapshot(state: GameStateData, ack: number, warp: number): void {
    if (ack !== this.seq) return;
    const warped = warp !== this.localWarp;
    if (gameState.hasGame && !warped) {
      const { x, y, facing, zoneId } = gameState.data.player;
      Object.assign(state.player, { x, y, facing, zoneId });
    }
    gameState.load(state, true);
    if (warped) {
      this.localWarp = warp;
      simulation.reset();
    }
    this.saveOwn(false);
    eventBus.emit('inventory:changed', {});
    this.onSnapshot?.(warped);
  }

  /** Grava a personagem do convidado no save dele (no sítio onde estava no mundo dele). */
  private saveOwn(now: boolean): void {
    const own = this.ownSave;
    if (!own || !this.isGuest || !gameState.hasGame) return;
    const time = performance.now();
    if (!now && time - this.lastOwnSave < OWN_SAVE_MS) return;
    this.lastOwnSave = time;
    const data = gameState.data;
    const { x, y, facing, zoneId } = own.player;
    own.player = { ...structuredClone(data.player), x, y, facing, zoneId };
    own.unlocks = structuredClone(data.unlocks);
    own.stats = structuredClone(data.stats);
    own.tutorial = structuredClone(data.tutorial);
    if (now) saves.saveSync(own);
    else void saves.save(own);
  }

  /** No mapa-mundo ou em pausa: os inimigos ignoram este jogador (só em co-op). */
  setAway(away: boolean): void {
    if (this.isGuest) this.send({ t: 'away', on: away ? 1 : 0 });
    else simulation.away = away && this.isHost && this.connected;
  }

  private lost(): void {
    const handler = this.onLost;
    this.leave();
    handler?.();
  }

  // ——— Os dois ———

  /** Chamar em todos os frames (cena de jogo e mapa-mundo): envia o que for preciso. */
  update(now: number): void {
    if (!this.connected) return;
    if (this.isHost) {
      if (now - this.lastFrame >= FRAME_MS) {
        this.lastFrame = now;
        this.sendFrame();
      }
      const since = now - this.lastSnap;
      if ((this.snapDirty && since >= SNAP_MIN_MS) || since >= SNAP_MAX_MS) this.sendSnapshot();
    } else if (now - this.lastMe >= ME_MS && gameState.hasGame) {
      this.lastMe = now;
      const p = gameState.data.player;
      this.send({
        t: 'me',
        x: p.x,
        y: p.y,
        facing: p.facing,
        moved: simulation.playerMoved ? 1 : 0,
        sneak: simulation.playerSneaking ? 1 : 0,
        zone: p.zoneId,
        auto: simulation.autoAttack ? 1 : 0,
      });
    }
  }

  /** O outro jogador (para desenhar), se estiver na zona `zoneId`. */
  otherAvatar(zoneId: string): AvatarView | null {
    const other = this.other;
    if (other?.zone !== zoneId) return null;
    if (this.isHost && !this.guestHere(zoneId)) return null;
    return other;
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

  private avatar(
    x: number,
    y: number,
    facing: Facing,
    moved: boolean,
    sneak: boolean,
    zone: string,
    look: CharacterLook,
  ): AvatarView {
    const old = this.other?.zone === zone ? this.other : null;
    return {
      x,
      y,
      px: old ? old.x : x,
      py: old ? old.y : y,
      facing,
      moved,
      sneak,
      zone,
      look,
      at: performance.now(),
    };
  }

  private send(message: HostMessage | GuestMessage): void {
    if (this.conn?.open) void this.conn.send(message);
  }

  /** Sai do co-op (fecha a ligação; o convidado grava a personagem no save dele). */
  leave(): void {
    if (this.isHost && this.conn?.open) this.send({ t: 'bye' });
    if (this.isGuest) this.saveOwn(true);
    for (const off of this.offEvents) off();
    this.offEvents = [];
    for (const restore of this.restoreCommands) restore();
    this.restoreCommands = [];
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.code = null;
    this.connected = false;
    this.other = null;
    this.ownSave = null;
    this.seq = 0;
    simulation.remote = null;
    simulation.away = false;
    uiState.coop = false;
    if (this.guestSim) {
      simulation.detach(this.guestSim);
      simulation.setDifficulty(1);
    }
    this.guestSim = null;
    this.guestState = null;
    eventBus.emit('coop:changed', {});
  }
}

/** Instância única (há no máximo uma sessão de co-op). */
export const coop = new Coop();
