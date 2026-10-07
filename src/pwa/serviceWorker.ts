// Registo do service worker (só no build de produção; o sw.js é gerado por vite.config.ts).
// Funcionar offline e instalar como app; uma versão nova fica à espera e ativa-se na próxima
// abertura, ou já, quando o jogador carrega em "Nova versão" no menu inicial.

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function notify(worker: ServiceWorker): void {
  waiting = worker;
  for (const listener of listeners) listener();
}

/** Há uma versão nova pronta (instalada e à espera)? */
export function updateReady(): boolean {
  return waiting !== null;
}

/** Avisa quando houver uma versão nova pronta. Devolve a função que deixa de ouvir. */
export function onUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ativa a versão nova e recarrega a página (só no menu inicial: nada por gravar). */
export function applyUpdate(): void {
  const worker = waiting;
  if (!worker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
  worker.postMessage({ type: 'refugio:activate' });
}

export function installServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Depois do arranque, para não competir com o carregamento do jogo.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      (registration) => {
        // Só conta como "nova versão" se já houver uma a controlar a página (a primeira
        // instalação não precisa de aviso: a próxima abertura já vem da cache).
        const check = (): void => {
          if (registration.waiting && navigator.serviceWorker.controller) notify(registration.waiting);
        };
        check();
        // Procura já uma versão nova (o browser nem sempre o faz ao abrir a página).
        void registration.update().catch(() => undefined);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed') check();
          });
        });
        // Jogos abertos durante muito tempo (app instalada): procura versões novas de hora a hora.
        window.setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
      },
      (error: unknown) => {
        console.warn('[sw] não foi possível registar o service worker:', error);
      },
    );
  });
}
