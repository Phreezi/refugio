// Identificador deste aparelho (Fase 15): um jogo co-op fica ligado aos dois aparelhos que o
// jogam (mais tarde, a contas). Gerado uma vez e guardado no localStorage.

const STORAGE_KEY = 'refugio.device';
const ID = /^[a-z0-9]{12}$/;
let memory: string | null = null;

function randomId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return id;
}

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && ID.test(saved)) return saved;
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memory ??= randomId();
    return memory;
  }
}

/** Um id de aparelho válido (vem da rede: não se confia na forma). */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
