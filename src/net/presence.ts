// Presença (Fase 15): enquanto o jogo está aberto, cada aparelho escuta num id próprio do
// servidor de sinalização (`refugio-dev-<aparelho>`). Quando um dos dois abre o jogo co-op que
// partilham, manda um convite ao outro aparelho; se o outro estiver noutro jogo, aparece-lhe um
// aviso a perguntar se quer entrar (o jogo atual fica gravado).

import type Peer from 'peerjs';
import { deviceId } from './device';
import { normalizeCode } from './protocol';
import { loadPeer, peerOptions, type PeerConstructor } from './peer';

const PREFIX = 'refugio-dev-';
/** Tempo para o convite chegar antes de fechar a ligação (ms). */
const SEND_MS = 3000;

export interface CoopInvite {
  t: 'invite';
  /** Código do jogo co-op. */
  code: string;
  /** Nome de quem convida. */
  name: string;
}

function parseInvite(raw: unknown): CoopInvite | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const code = typeof m.code === 'string' ? normalizeCode(m.code) : null;
  if (m.t !== 'invite' || !code) return null;
  const name = typeof m.name === 'string' ? m.name.slice(0, 24) : '?';
  return { t: 'invite', code, name };
}

class Presence {
  /** Chegou um convite (o menu ou o HUD perguntam se se quer entrar). */
  onInvite: ((invite: CoopInvite) => void) | null = null;
  private peer: Peer | null = null;
  private opening: Promise<Peer | null> | null = null;

  /** Começa a escutar (sem rede, ou com o id em uso noutro separador, fica calado). */
  start(): Promise<Peer | null> {
    if (this.peer) return Promise.resolve(this.peer);
    this.opening ??= new Promise((resolve) => {
      loadPeer().then(
        (PeerClass) => {
          this.listen(PeerClass, resolve);
        },
        () => {
          this.opening = null;
          resolve(null);
        },
      );
    });
    return this.opening;
  }

  /** Abre o id deste aparelho no servidor e escuta convites. */
  private listen(PeerClass: PeerConstructor, resolve: (peer: Peer | null) => void): void {
    let peer: Peer;
    try {
      peer = new PeerClass(PREFIX + deviceId(), peerOptions());
    } catch {
      resolve(null);
      return;
    }
    peer.once('open', () => {
      this.peer = peer;
      resolve(peer);
    });
    peer.on('error', () => {
      if (this.peer !== peer) {
        peer.destroy();
        this.opening = null;
        resolve(null);
      }
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const invite = parseInvite(raw);
        if (invite) this.onInvite?.(invite);
        conn.close();
      });
    });
  }

  /** Convida o aparelho `partner` (se estiver com o jogo aberto, aparece-lhe o aviso). */
  async invite(partner: string, invite: Omit<CoopInvite, 't'>): Promise<void> {
    const peer = await this.start();
    if (!peer) return;
    const conn = peer.connect(PREFIX + partner, { reliable: true });
    conn.on('open', () => {
      void conn.send({ t: 'invite', ...invite } satisfies CoopInvite);
      window.setTimeout(() => {
        conn.close();
      }, SEND_MS);
    });
    conn.on('error', () => {
      conn.close();
    });
  }
}

/** Instância única (um por aparelho). */
export const presence = new Presence();
