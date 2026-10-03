import type { PeerOptions } from 'peerjs';

/** Servidor de sinalização: o do PeerJS, ou outro com `?peer=host:porta` (testes locais). */
export function peerOptions(): Partial<PeerOptions> {
  const custom = new URLSearchParams(window.location.search).get('peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host: host ?? 'localhost', port: Number(port ?? 9000), path: '/', secure: false, debug: 0 };
}
