/* global self, caches, fetch, URL, Request, Response, __PRECACHE_FILES__ */
// Service worker do Refúgio (só no build de produção; gerado por vite.config.ts → `sw.js`).
//
// Regra principal: NUNCA misturar versões (já houve um arranque partido por JS novo com um
// manifest antigo). Por isso:
// - cada build tem a sua cache (`refugio-<build>`), preenchida inteira na instalação (addAll:
//   se faltar um ficheiro, a instalação falha e fica a versão anterior);
// - uma página controlada por este SW recebe TUDO desta cache (o `?v=<build>` ignora-se: a
//   cache já é só desta build); só o que não está na lista vai à rede;
// - a versão nova instala-se em segundo plano e fica à espera: ativa-se quando todas as abas
//   do jogo fecharem (próxima abertura) ou quando o menu inicial pede ("Nova versão").
//   Sem `clients.claim()`: a página que já está aberta nunca muda de versão a meio.
// Pedidos a outras origens (servidor do PeerJS, etc.) não passam por aqui. Os saves
// (IndexedDB/localStorage) não são tocados.

const CACHE = '__CACHE_NAME__';
/** Ficheiros do build, relativos ao sw.js. */
const FILES = __PRECACHE_FILES__;
const PREFIX = 'refugio-';

self.addEventListener('install', (event) => {
  // `cache: 'reload'`: sempre da rede, nunca da cache HTTP do browser (o GitHub Pages deixa os
  // ficheiros 10 min em cache; um mapa antigo com o JS novo seria outra vez a mistura).
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  // Apaga as caches das builds anteriores (só as nossas).
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener('message', (event) => {
  // O menu inicial pede para ativar a versão nova (e depois recarrega a página).
  if (event.data && event.data.type === 'refugio:activate') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Abrir o jogo (qualquer URL de navegação, ex.: `?debug`) = o index.html desta build.
      const target = request.mode === 'navigate' ? new URL('./index.html', scope).href : request;
      const hit = await cache.match(target, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(request);
      } catch {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    }),
  );
});
