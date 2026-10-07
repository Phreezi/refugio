/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Caminhos relativos: o mesmo build serve no GitHub Pages (subpasta), no Capacitor e no Playables.
  base: './',
  // 'mpa': um ficheiro em falta dá 404 (como no GitHub Pages) em vez de devolver o index.html,
  // o que faria o Phaser "carregar" HTML como imagem ou JSON.
  appType: 'mpa',
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
