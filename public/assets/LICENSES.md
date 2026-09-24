# Licenças dos assets

Todos os assets do jogo têm de estar registados aqui (CLAUDE.md §0 e §6). Só se aceitam
assets **criados por nós** ou com licença **CC0 / uso comercial livre**. Nunca usar assets,
nomes ou textos de _Last Day on Earth_ (Kefir).

| Asset / pasta                  | Origem                                                        | Autor           | Licença |
| ------------------------------ | ------------------------------------------------------------- | --------------- | ------- |
| Placeholders (todas as chaves) | Gerados por código no arranque (`src/assets/placeholders.ts`) | Projeto Refúgio | Própria |
| `palette.png` / `palette.json` | Paleta de 32 cores criada para o projeto                      | Projeto Refúgio | Própria |
| `tiles/base_tiles.png`         | Gerado por `scripts/generate-tiles.ts` (só cores da paleta)   | Projeto Refúgio | Própria |
| `maps/base.json`               | Gerado por `scripts/generate-base-map.ts` / editado no Tiled  | Projeto Refúgio | Própria |

## Como registar um asset novo

1. Colocar o ficheiro em `public/assets/<pasta>/` (nome em minúsculas, `.png` ou `.webp`).
2. Acrescentar `"file": "<pasta>/<nome>.png"` à entrada correspondente em `manifest.json`.
3. Acrescentar uma linha a esta tabela com origem, autor e licença (com link, se for externo).
4. Correr `npm run validate-data`.
