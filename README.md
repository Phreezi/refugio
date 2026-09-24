# Refúgio

Jogo de sobrevivência top-down em pixel art, single player, para o browser (HTML5).
Design, regras e plano por fases: [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node.js ≥ 22.18 (recomendado 24). Os scripts em `scripts/` são TypeScript executado
  diretamente pelo Node (type stripping nativo), sem ferramentas extra.

## Comandos

| Comando                 | O que faz                                                                    |
| ----------------------- | ---------------------------------------------------------------------------- |
| `npm install`           | Instala as dependências                                                      |
| `npm run dev`           | Servidor de desenvolvimento (Vite) em http://localhost:5173                  |
| `npm run dev:host`      | Igual, mas acessível na rede local (para testar no telemóvel)                |
| `npm run build`         | Typecheck + validação de dados + build de produção em `dist/`                |
| `npm run preview`       | Serve o `dist/` localmente                                                   |
| `npm run test`          | Testes unitários (Vitest)                                                    |
| `npm run lint`          | ESLint + verificação de formatação (Prettier)                                |
| `npm run format`        | Formata tudo com o Prettier                                                  |
| `npm run validate-data` | Valida paleta, manifest de assets e i18n (e, no futuro, os JSON de conteúdo) |
| `npm run palette`       | Regenera `public/assets/palette.png` a partir de `src/assets/palette.json`   |
| `npm run tiles`         | Regenera o tileset placeholder `public/assets/tiles/base_tiles.png`          |
| `npm run sprites`       | Regenera sprites (recursos, obstáculos, baú) e ícones de itens               |
| `npm run map:base`      | Gera o mapa inicial da base (não substitui um existente sem `-- --force`)    |

## Debug

- **F3** mostra/esconde o overlay de debug (FPS, tick, posição, cena, escala).
- `?debug` na URL mostra o overlay logo ao arrancar (útil no telemóvel, sem teclado).
- `?lang=en` força a língua inglesa.

## Controlos (Fase 1)

- **PC:** WASD ou setas para andar (8 direções).
- **Telemóvel:** joystick virtual — tocar e arrastar na metade esquerda do ecrã. Funciona na
  horizontal e na vertical.
- **Zoom:** Ctrl + roda do rato ou teclas +/− no PC; pinça com dois dedos no telemóvel (até metade).
- **Ação** (cortar, apanhar, abrir o baú, beber no poço): Espaço ou clique no PC; botão "Ação" no
  telemóvel. A seta indica o alvo. Manter premido repete golpes.
- **Mochila:** I ou Tab (ou o botão "Mochila"); arrastar para mover, tocar para selecionar.
  Hotbar: teclas 1–4 ou tocar para comer/beber.
- **Velocidade do jogo:** botão x1/x2/x3 por baixo do relógio.

## Gravação

O jogo grava sozinho (de 15 em 15 s de jogo, ao morrer e ao esconder/fechar a página) no
IndexedDB do browser, com duas cópias rotativas e uma cópia de emergência no localStorage. No menu
inicial: **Continuar**, **Exportar** (descarrega um `.json`), **Importar** e **Apagar**.

## Mapas (Tiled)

Os mapas estão em `public/assets/maps/` no formato JSON do [Tiled](https://www.mapeditor.org/).
Para editar a base, abrir `public/assets/maps/base.json` no Tiled e gravar (JSON, tileset embebido).
Camadas e nomes dos objetos: ver CLAUDE.md §8.4. Depois de gravar, correr `npm run validate-data`.

## Assets

Todos os assets estão registados em `public/assets/manifest.json`. Sem ficheiro (ou se o ficheiro
falhar), o jogo gera um placeholder colorido com uma letra, usando só cores da paleta. Trocar a arte
é pôr o ficheiro em `public/assets/…` e indicar o caminho no manifest. Licenças em
`public/assets/LICENSES.md`.

## Deploy de preview (GitHub Pages)

O workflow `.github/workflows/deploy.yml` corre lint, testes e build em cada push/PR e publica o
`dist/` no GitHub Pages a cada push para `main`. Para ativar:

Preview: https://phreezi.github.io/refugio/ (ativo; configurado em **Settings → Pages → Source:
GitHub Actions** do repositório).

No plano gratuito do GitHub, o Pages só funciona em repositórios públicos.
