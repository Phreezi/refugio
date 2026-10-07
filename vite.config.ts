/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/** Ficheiros do build que o service worker não guarda (só servem para partilhar o link). */
const NOT_PRECACHED = new Set(['icons/og-image.png', 'sw.js']);

/** Todos os ficheiros de uma pasta (caminhos relativos, com `/`). */
function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path, root) : [relative(root, path).split('\\').join('/')];
  });
}

/**
 * Textos do ecrã de carregamento em index.html (antes do JS): as chaves `loader.*` de
 * src/i18n, nas duas línguas.
 */
function loaderTexts(): Plugin {
  return {
    name: 'refugio-loader-texts',
    transformIndexHtml(html) {
      const texts: Record<string, Record<string, string>> = {};
      for (const language of ['pt-PT', 'en']) {
        const messages = JSON.parse(readFileSync(`src/i18n/${language}.json`, 'utf8')) as Record<
          string,
          string
        >;
        texts[language] = Object.fromEntries(
          Object.entries(messages).filter(([key]) => key.startsWith('loader.')),
        );
      }
      return html.replace('__LOADER_TEXTS__', JSON.stringify(texts));
    },
  };
}

/**
 * Gera o `sw.js` (só no build): o modelo de src/serviceWorker/sw.js com a lista de ficheiros
 * do build (bundle + public/) e uma cache com o nome desta build — o hash do conteúdo de tudo,
 * para que qualquer alteração dê um service worker novo (e nunca se misturem versões).
 */
function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'refugio-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files: string[] = [];
      for (const file of listFiles(publicDir).sort()) {
        if (NOT_PRECACHED.has(file) || file.split('/').some((part) => part.startsWith('.'))) continue;
        files.push(file);
        hash.update(file).update(readFileSync(join(publicDir, file)));
      }
      for (const [file, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (NOT_PRECACHED.has(file)) continue;
        files.push(file);
        hash.update(file).update(output.type === 'chunk' ? output.code : output.source);
      }
      const cache = `refugio-${pkg.version}-${hash.digest('hex').slice(0, 12)}`;
      const source = readFileSync('src/serviceWorker/sw.js', 'utf8')
        .replace("'__CACHE_NAME__'", JSON.stringify(cache))
        .replace('const FILES = __PRECACHE_FILES__;', `const FILES = ${JSON.stringify(files)};`);
      if (source.includes("'__CACHE_NAME__'") || source.includes('= __PRECACHE_FILES__'))
        throw new Error('sw.js: ficou um marcador por substituir.');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Caminhos relativos: o mesmo build serve no GitHub Pages (subpasta), no Capacitor e no Playables.
  base: './',
  // 'mpa': um ficheiro em falta dá 404 (como no GitHub Pages) em vez de devolver o index.html,
  // o que faria o Phaser "carregar" HTML como imagem ou JSON.
  appType: 'mpa',
  plugins: [loaderTexts(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  },
  build: {
    target: 'es2022',
    // O Phaser sozinho ocupa ~1,4 MB minificado; o aviso por defeito (500 kB) seria só ruído.
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        // O Phaser num ficheiro à parte: não muda entre versões do jogo, por isso o browser
        // reaproveita-o da cache (o nome tem o hash do conteúdo) e só se descarrega o jogo.
        // O PeerJS (co-op) também fica à parte e só se descarrega quando é preciso (net/peer.ts).
        codeSplitting: {
          groups: [
            { name: 'phaser', test: /node_modules[\\/]phaser[\\/]/ },
            {
              name: 'peerjs',
              test: /node_modules[\\/](peerjs|peerjs-js-binarypack|webrtc-adapter|sdp)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
