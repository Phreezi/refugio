import type { default as PeerClass, PeerOptions } from 'peerjs';

/** Servidor de sinalização: o do PeerJS, ou outro com `?peer=host:porta` (testes locais). */
export function peerOptions(): Partial<PeerOptions> {
  const custom = new URLSearchParams(window.location.search).get('peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host: host ?? 'localhost', port: Number(port ?? 9000), path: '/', secure: false, debug: 0 };
}

/** A classe `Peer` do PeerJS, a quem a pede. */
export type PeerConstructor = typeof PeerClass;

let loading: Promise<PeerConstructor> | null = null;

/**
 * O PeerJS só serve no co-op: importa-se sob demanda (fica num ficheiro à parte e não atrasa o
 * arranque). Se falhar (sem rede a meio de uma atualização), a próxima chamada tenta de novo.
 */
export function loadPeer(): Promise<PeerConstructor> {
  loading ??= import('peerjs').then(
    (module) => module.default,
    (error: unknown) => {
      loading = null;
      throw error instanceof Error ? error : new Error(String(error));
    },
  );
  return loading;
}
