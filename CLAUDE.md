# CLAUDE.md — Projeto "Refúgio" (nome de código)

> Jogo de sobrevivência top-down em pixel art, inspirado na jogabilidade de *Last Day on Earth: Survival* (LDoE), com estética próxima de *Stardew Valley*, dificuldade mais baixa, **single player** e, no fim (Fase 15), **co-op online a 2** com um código de 5 caracteres.
> Corre em HTML5 no browser, com saves locais constantes. Futuro: APK (Android) e YouTube Playables.

Este ficheiro é a referência principal para qualquer trabalho no projeto. Lê-o sempre antes de alterar código. Se uma decisão aqui estiver desatualizada, atualiza este ficheiro na mesma tarefa.

---

## 0. Nota legal importante

- Inspiramo-nos nas **mecânicas** (recolha, crafting, construção, mapa-mundo com zonas, raids). Mecânicas não são protegidas, mas **nomes, marcas, arte, sons, textos, ícones e nomes de locais específicos** do LDoE (Kefir) **não podem ser usados**.
- Nunca usar: o nome "Last Day on Earth", nomes de zonas, personagens, itens ou logótipos do original, nem assets extraídos do jogo.
- Todos os assets placeholder devem ser **gerados por nós** ou de packs com licença **CC0 / uso comercial livre** (registar a licença em `assets/LICENSES.md`).
- "Refúgio" é um nome provisório; confirmar disponibilidade da marca antes de publicar.

---

## 1. Visão geral

| Campo | Definição |
|---|---|
| Género | Sobrevivência / crafting / construção de base, top-down |
| Perspetiva | Top-down 3/4 (estilo Stardew Valley) |
| Modo | Single player, offline; co-op online a 2 jogadores na Fase 15 |
| Plataforma inicial | Browser desktop + mobile (HTML5) |
| Plataformas futuras | Android (APK/AAB via Capacitor), YouTube Playables |
| Sessão típica | 5–20 minutos (ir a uma zona, lootear, voltar, craftar) |
| Tom | Pós-apocalíptico mas acolhedor: cores quentes, sem gore excessivo |
| Público | Jogadores casuais de sobrevivência que acham o LDoE punitivo |

### 1.1 Ciclo de jogo principal (core loop)

```
Base (casa) → escolher zona no mapa-mundo → viajar (custa um pouco de comida/água)
   → recolher recursos / lootear contentores / combater zombies
   → voltar à base → guardar no baú → craftar / construir / melhorar
   → desbloquear novas receitas e zonas → repetir
```

### 1.2 Pilares de design

1. **Progressão sempre visível** — cada saída deve render algo útil, mesmo curta.
2. **Justo, não punitivo** — morrer custa pouco; nada se perde para sempre.
3. **Sem pay-to-win nem timers abusivos** — tempos de craft curtos, sem energia "paga".
4. **Sessões curtas** — pode-se sair a qualquer momento sem perder progresso (save constante).
5. **Data-driven** — itens, receitas, inimigos e zonas vivem em JSON, não no código.

---

## 2. O que "copiamos" do LDoE e o que simplificamos

| Mecânica LDoE | No Refúgio | Diferença (mais fácil) |
|---|---|---|
| Fome e sede | Sim | Descem ~50% mais devagar; ícone de aviso aos 30% |
| Vida | Sim | Regenera lentamente se fome e sede > 50% |
| Inventário por slots + mochila | Sim | 20 slots base (+10/+20 com mochilas), stacks maiores |
| Recolha (árvores, pedras, plantas) | Sim | Menos golpes por recurso |
| Crafting por bancadas | Sim | Tempos de 5–60 s (não horas); podem acelerar-se de graça ao ver a barra |
| Construção de base (fundações, paredes, portas) | Sim | Grelha simples; sem decaimento de estruturas |
| Mapa-mundo com zonas e custo de viagem | Sim | Viagem custa pouca comida/água; primeira zona grátis |
| Zonas com níveis de perigo | Sim | 4 níveis (T1–T4) em vez de muitos |
| Zombies de vários tipos | Sim | Mais lentos, avisos visuais de ataque (telegraph) |
| Durabilidade de armas/ferramentas | Sim | Durabilidade ~2× maior; reparação barata na bancada |
| Raids à base | Sim, **opcionais** | Só acontecem se o jogador ativar "Hordas" nas definições; senão, desligado |
| Morte perde todo o inventário | **Não** | Deixa uma mochila no local com o conteúdo da mochila; itens equipados mantêm-se; mochila fica 48 h reais (ou até ser recuperada) |
| Bunker / dungeon com pisos | Sim (fase posterior) | Checkpoint por piso |
| Eventos temporários (quedas de avião, comboio) | Sim (fase posterior) | Recompensa garantida, sem limite de tempo apertado |
| Veículo (moto/chopper) | Sim (fase tardia) | Reduz custo de viagem |
| Moeda premium / anúncios agressivos | **Não** | — |
| Multijogador / clãs | **Só co-op a 2** (Fase 15) | Sem clãs, PvP nem trocas entre jogadores; entra-se com um código de 5 caracteres |

---

## 3. Stack técnica

| Área | Escolha | Motivo |
|---|---|---|
| Linguagem | **TypeScript 6.0** (strict) | Menos bugs num projeto grande. Não subir para o TS 7 enquanto o typescript-eslint não o suportar (peer `<6.1`) |
| Motor | **Phaser 4** (4.2.x; decidido em 2026-09-24, ver §15) | Tilemaps, câmara, física arcade, pixel-perfect, funciona em Capacitor e browser |
| Ferramentas | **Node ≥ 22.18** (recomendado 24) | `scripts/*.ts` correm com o type stripping nativo do Node, sem dependências extra |
| Build | **Vite** | Rápido, bundle pequeno (importante para YouTube Playables) |
| Mapas | **Tiled** (exportação JSON) | Editor de mapas gratuito, suportado nativamente pelo Phaser |
| Testes | **Vitest** para lógica pura (inventário, crafting, save, balanceamento) | |
| Lint/format | ESLint + Prettier | |
| Saves (web) | **IndexedDB** (via wrapper simples) com fallback para `localStorage` | Mais espaço e fiável |
| Android (futuro) | **Capacitor** | Reaproveita o build web sem reescrever |
| YouTube (futuro) | **YouTube Playables SDK** | Tem requisitos próprios de tamanho, save e ciclo de vida — confirmar sempre na documentação oficial atual antes da Fase 14 |

### 3.1 Parâmetros de renderização

- Tamanho de tile: **16×16 px**.
- Personagens: **16×32 px** (estilo Stardew).
- Resolução **adaptável ao ecrã** com escala inteira (×2, ×3, ×4…) e `pixelArt: true`: escolhe-se o zoom inteiro (píxeis do dispositivo por píxel de jogo) cujo **lado curto** do jogo fica mais perto de **270 px** (≈ 17 tiles, o "zoom" estilo Stardew), e o outro lado enche o ecrã (proporção entre 9:21 e 21:9; fora disso, barras). Funciona **ao alto e ao baixo**: com o telemóvel na vertical vê-se uma área mais alta do que larga (ex.: 270×550). A vista tem sempre dimensões **pares**. Ex.: 1920×1080 → 480×270 ×4; janela 1530×790 → 510×262 ×3. Mínimo 216 px (abaixo disso, zoom fracionário). Valores em `DISPLAY` (`src/config.ts`).
  - O **canvas tem a resolução do dispositivo** e cada câmara amplia o mundo pelo zoom inteiro (`src/display/view.ts`: `getView()`, `setupFixedCamera()`). Assim a pixel art fica exata e o **texto é desenhado à resolução real** (nítido; usar sempre `Label` de `src/ui/text.ts`).
  - Implementação (`src/display/`): `Scale.NONE` + `scale.resize(canvas)` + `scale.setZoom(1 / dpr)`, com a posição do canvas alinhada a píxeis físicos (também com DPR 1,25 ou 2,625).
  - Com zoom na câmara o Phaser **não arredonda** posições: tudo o que se desenha tem de estar em coordenadas **inteiras** de jogo (o jogador e os inimigos interpolados são arredondados em `ZoneScene`).
  - **Nenhuma cena pode assumir um tamanho fixo**: usar `getView()` (não `this.scale.width`, que está em píxeis do dispositivo) e reagir a `Phaser.Scale.Events.RESIZE` (removendo o listener no SHUTDOWN). Ponteiros: converter com `camera.getWorldPoint`.
- **Zoom do jogador** (`src/display/worldZoom.ts`): o zoom da vista é o máximo; pode afastar-se até metade, em níveis inteiros (×4 → ×3 → ×2; ×3 → ×2) para a pixel art continuar exata. **Ctrl + roda** (ou pinça no touchpad) ou +/− no PC — a roda sozinha não faz zoom; pinça com 2 dedos no telemóvel (UIScene).
- **Velocidade do jogo** (`src/ui/gameSpeed.ts`, botão x1/x2/x3 no HUD): multiplica o tempo real que entra na `Simulation`, por isso acelera tudo o que corre no passo fixo (relógio, fome/sede, movimento, golpes, respawn) e as animações do jogador. Guardada no localStorage (`refugio.speed`). Guardado no localStorage (`refugio.zoomOut`). Só a câmara do mundo muda; o HUD mantém o tamanho. Se se vê mais do que o mapa, este fica centrado.
- 60 FPS alvo; lógica de jogo com passo fixo (ver 5.2).

---

## 4. Estrutura de pastas

```
refugio/
├── CLAUDE.md
├── index.html
├── package.json
├── vite.config.ts            # inclui a config do Vitest; appType 'mpa' (404 reais em dev)
├── tsconfig.json
├── eslint.config.js          # flat config + regras de arquitetura (core/ sem Phaser, src/ sem Node)
├── .github/workflows/deploy.yml  # lint + testes + build; publica no GitHub Pages (push para main)
├── scripts/                  # TypeScript corrido pelo Node: validate-data, generate-palette/tiles/base-map, png.ts
├── public/
│   └── assets/
│       ├── manifest.json     # chave → ficheiro + especificação do placeholder
│       ├── palette.png       # gerado de src/assets/palette.json (npm run palette)
│       ├── sprites/          # recursos e obstáculos (PNG gerados por `npm run sprites`)
│       ├── tiles/            # tilesets (base_tiles.png gerado por `npm run tiles`)
│       ├── maps/             # mapas Tiled (.json, tileset embebido; fora do Prettier)
│       ├── ui/
│       ├── audio/
│       └── LICENSES.md
├── src/
│   ├── main.ts               # arranque do Phaser
│   ├── config.ts             # constantes globais (tamanhos, debug flags)
│   ├── env.d.ts              # __APP_VERSION__, __BUILD_ID__ (define do Vite)
│   ├── assets/
│   │   ├── manifest.ts       # tipos + validação do manifest (puro; também usado por scripts/)
│   │   ├── palette.json/.ts  # paleta de 32 cores (fonte de verdade)
│   │   ├── characterSheet.ts # layout das spritesheets de personagem + desenho do placeholder
│   │   └── placeholders.ts   # texturas placeholder geradas por código
│   ├── display/              # escala inteira + vista (view.ts) + zoom do jogador (worldZoom.ts)
│   ├── world/                # mapas: tileset.ts, zoneMap.ts (validação Tiled, puro), content.ts
│   ├── debug/                # overlay F3 (DOM)
│   ├── scenes/
│   │   ├── keys.ts           # chaves das cenas
│   │   ├── BootScene.ts      # carrega manifest
│   │   ├── PreloadScene.ts
│   │   ├── MainMenuScene.ts
│   │   ├── ZoneScene.ts      # qualquer zona, incluindo a base (recebe { zoneId }); fade entre zonas
│   │   ├── WorldMapScene.ts  # mapa-mundo
│   │   └── UIScene.ts        # HUD por cima (corre em paralelo)
│   ├── core/
│   │   ├── GameState.ts      # estado global serializável (fonte de verdade)
│   │   ├── EventBus.ts
│   │   ├── FixedStep.ts      # acumulador de passo fixo (50 ms)
│   │   ├── Simulation.ts     # corre os ticks de lógica (sistemas entram aqui)
│   │   ├── Interaction.ts    # ação contextual, recolha, respawn de recursos (ZoneContext)
│   │   ├── PlayerActions.ts  # usar/mover/dividir/guardar semelhantes/beber
│   │   ├── Crafting.ts       # craft nas mãos/estações, fila, recolher, reparar
│   │   ├── Building.ts       # construção: colocar, desfazer, demolir, portas (§7.7)
│   │   ├── Combat.ts         # inimigos da zona, golpes, dano/armadura, mochilas no chão (§7.8–§7.12)
│   │   ├── Fishing.ts        # pesca (mini-jogo de 1 botão) e encher garrafas no lago
│   │   ├── Homestead.ts      # horta (plantar/regar/colher) e peças que produzem (coletor, armadilha)
│   │   ├── Horde.ts          # hordas opcionais: calendário, chegada, prémio (§7.13)
│   │   ├── Progression.ts    # XP (ouve os eventos), níveis, desbloqueios, notas de receitas
│   │   ├── DayNight.ts       # hora do dia, escuridão, é noite?
│   │   ├── offline.ts        # tempo offline (§7.6)
│   │   ├── Clock.ts          # tempo de jogo, dia/noite
│   │   └── Rng.ts            # RNG com seed
│   ├── systems/              # lógica pura, SEM dependências do Phaser sempre que possível
│   │   ├── movement/         # CollisionWorld, movimento com deslize, direção do sprite
│   │   ├── gathering/        # ferramenta automática, força do golpe, drops, desgaste
│   │   ├── interaction/      # escolha do alvo em frente (prioridade zombie > contentor > recurso)
│   │   ├── survival/         # fome, sede, vida
│   │   ├── inventory/
│   │   ├── crafting/
│   │   ├── building/         # grelha de peças, regras de colocação, colisão, reembolso
│   │   ├── combat/           # arma/punhos, armadura, desgaste, drops de inimigos
│   │   ├── loot/             # sorteio do loot (pesos, quantidades, "pity")
│   │   ├── ai/               # IA dos inimigos (idle/wander/chase/windup/recover/return; flee)
│   │   ├── progression/      # curva de XP, subir de nível
│   │   └── travel/           # ponto de chegada a uma zona, custo da viagem
│   ├── entities/             # Player, Zombie, ResourceNode, Container, Structure
│   ├── ui/                   # Label, Button, SlotView, InventoryUI, CraftingUI, BuildUI (+ buildMode), FishingUI, LevelUpUI, gameSpeed, uiState, fileTransfer, fatalError
│   ├── input/                # joystick.ts (matemática pura), moveInput.ts (teclado + joystick)
│   ├── save/
│   │   ├── index.ts          # instâncias (saves, autosave) + gravar ao esconder a página
│   │   ├── Autosave.ts       # quando gravar (15 s, eventos, flush/flushSync)
│   │   ├── SaveManager.ts    # slots A/B + cópia de emergência síncrona
│   │   ├── schema.ts         # tipos + versão do save
│   │   ├── migrations.ts
│   │   └── adapters/
│   │       ├── IndexedDbAdapter.ts
│   │       ├── LocalStorageAdapter.ts
│   │       ├── FallbackAdapter.ts        # IndexedDB → localStorage → memória
│   │       ├── MemoryAdapter.ts
│   │       ├── CapacitorAdapter.ts      # Fase 13
│   │       └── YouTubePlayablesAdapter.ts # Fase 14
│   ├── data/                 # JSON data-driven
│   │   ├── types.ts          # tipos + validação (puro; também usado por scripts/)
│   │   ├── resources.json    # nós de recurso (vida, ferramenta, drops, respawn)
│   │   ├── stations.json     # estações de crafting (sprite, footprint, fila, reparação)
│   │   ├── props.json        # obstáculos/decoração livres no mapa (sprite + footprint)
│   │   ├── items.json
│   │   ├── recipes.json
│   │   ├── structures.json   # peças de construção (camada, tamanho, custo, colisão, porta, estação, baú)
│   │   ├── enemies.json      # inimigos/animais (vida, dano, velocidade, deteção, leash, drops)
│   │   ├── enemyGroups.json  # grupos dos pontos enemy_spawn:<grupo>
│   │   ├── zones.json        # zonas (nome, mapa, perigo)
│   │   ├── lootTables.json   # contentores com loot (sprite, footprint, tiragens, entradas, pity)
│   │   └── balance.json
│   └── i18n/
│       ├── pt-PT.json
│       └── en.json
└── tests/
```

---

## 5. Arquitetura e regras de código

### 5.1 Princípios

- **`GameState` é a única fonte de verdade.** As cenas Phaser leem dele e enviam ações; não guardam estado próprio que precise de persistir.
- **Sistemas são lógica pura** (funções/classes sem Phaser) → testáveis com Vitest.
- **Comunicação por eventos** (`EventBus`): `item:added`, `player:damaged`, `zone:entered`, `craft:finished`, etc.
- **Tudo o que é conteúdo vem de `src/data/*.json`**, validado no arranque (lançar erro claro se faltar um id referenciado).
- **Nada de números mágicos** de balanceamento no código: vão para `balance.json`.
- Texto visível ao jogador passa sempre por `i18n` (pt-PT por defeito, en como segunda língua).

### 5.2 Tempo

- Lógica com passo fixo de 50 ms (20 ticks/s); render interpolado.
  - `core/Simulation.ts` recebe `game.loop.rawDelta` (e não o `delta` suavizado do Phaser, que fica limitado a 16,7 ms com a janela sem foco). No máximo 5 ticks por frame; o atraso acima disso é descartado.
- **Tempo de jogo**: 1 dia de jogo = 20 minutos reais (configurável).
- Timers de crafting usam **tempo de jogo**, mas também avançam offline com limite (ver 7.6).

### 5.3 Convenções

- Ficheiros `PascalCase.ts` para classes, `camelCase.ts` para utilitários.
- IDs de conteúdo em `snake_case` (`wood_plank`, `zombie_walker`, `zone_pine_forest`).
- Sem `any`. Tipos de dados JSON definidos em `src/data/types.ts`.
- Commits pequenos, uma funcionalidade de cada vez.

### 5.4 Regras para o Claude (agente)

1. Antes de começar uma tarefa, identificar a **fase** e a tarefa correspondente na secção 11.
2. Correr `npm run lint`, `npm run test` e `npm run build` antes de dar uma tarefa por terminada.
3. Não adicionar dependências novas sem justificar e perguntar.
4. Qualquer alteração ao formato do save → incrementar `SAVE_VERSION` e escrever migração + teste.
5. Não usar assets, nomes ou textos do LDoE (ver secção 0).
6. Manter o jogo jogável no fim de cada tarefa (nada de ramos partidos).
7. Quando uma decisão de design mudar, atualizar este CLAUDE.md.

### 5.5 Scripts npm esperados

```
npm run dev        # servidor Vite
npm run dev:host   # idem, acessível na rede local (testar no telemóvel)
npm run build      # typecheck + validate-data + build de produção
npm run preview
npm run test
npm run lint       # ESLint + prettier --check
npm run format     # prettier --write
npm run typecheck
npm run validate-data   # valida referências cruzadas entre JSONs (paleta, manifest, i18n; depois items/recipes/…)
npm run palette    # regenera public/assets/palette.png
npm run tiles      # regenera public/assets/tiles/base_tiles.png (ordem = src/world/tileset.ts)
npm run sprites    # regenera public/assets/sprites/*.png (pixel art de recursos e obstáculos; `-- --preview f.png`)
npm run map:base   # gera maps/base.json (recusa substituir sem `-- --force`: o mapa edita-se no Tiled)
npm run map:pine   # gera maps/pine_forest.json (idem)
npm run map:farm   # gera maps/farm.json (idem; usa scripts/mapgen.ts)
npm run map:lake   # gera maps/lake.json (idem)
npm run map:t2     # gera maps/road.json, village.json, deep_forest.json (idem)
npm run map:t3     # gera maps/industrial.json, hospital.json (idem)
```

Debug: **F3** mostra/esconde o overlay (FPS, tick, posição, cenas, escala); `?debug` na URL mostra-o ao arrancar; `?lang=en` força inglês.

### 5.6 Armadilhas do Phaser 4 (verificadas na 4.2.1)

- `camera.startFollow(alvo, true)`: o 2.º argumento **tem** de ser `true`, senão sobrepõe `camera.roundPixels` com `false`.
- Com zoom na câmara (usamos sempre zoom inteiro, ver 3.1), escala ou rotação, o Phaser não arredonda os vértices ao píxel (`vertexRoundMode` 'safeAuto' só arredonda objetos apenas transladados): posições inteiras de jogo são obrigatórias.
- Shapes, Graphics e BitmapText **não** são arredondados: usar posições inteiras e tamanhos pares (ou origem 0). Evitar `setStrokeStyle` de 1 px; usar dois retângulos.
- Texto: `Text.setText`/`setColor` redesenham a textura; não chamar em todos os frames sem verificar se mudou (o `Label` já o faz). Origem 0,5 com largura ímpar deixa o texto a meio píxel (esbatido): o `Label` alinha o canto a píxeis inteiros.
- `init`/`preload`/`create` **sem** `override`; `update` **com** `override` (o `noImplicitOverride` está ligado).
- `scene.start(key)` sem dados reutiliza os dados da execução anterior: passar sempre um objeto (`{}` se não houver dados).
- Listeners em `this.events`, `game.events`, no `EventBus` ou em `window` sobrevivem ao shutdown da cena: removê-los em `this.events.once(Phaser.Scenes.Events.SHUTDOWN, …)`.
- `input.keyboard.addKey(k)` captura a tecla **globalmente** (faz `preventDefault` mesmo noutras cenas e em `<input>` do DOM). Preferir eventos `keydown-X` ou `addKey(k, false)`. O `keydown-ENTER` repete com a tecla presa.
- `setTintFill` é um no-op (usar `setTint(c).setTintMode(Phaser.TintModes.FILL)`); `Geom.Point` e `Struct.Set` já não existem.
- O Phaser não pode ser importado em Node (usa `window`): `core/` e `systems/` não o importam (o ESLint impõe esta regra).
- `load.image` com uma chave que já existe é ignorado em silêncio: fazer `textures.remove(key)` antes, para trocar arte em runtime.
- Os eventos do Phaser são tipados como `Function`: anotar sempre os parâmetros dos listeners.

---

## 6. Assets placeholder (fase de preview)

Objetivo: **só o necessário para testar**. A arte final vem depois (Fase 12+).

### 6.1 Estratégia

1. **Gerados por código** no `PreloadScene` quando o ficheiro não existir: retângulos coloridos 16×16 com uma letra (ex.: "Á" para árvore, "Z" para zombie). Assim nunca há ecrã preto por falta de asset.
2. Opcionalmente, packs **CC0** (ex.: Kenney) para tiles de chão, apenas enquanto não houver arte própria.
3. Todos os assets registados num **`assets/manifest.json`** com chave → caminho. Trocar arte = trocar ficheiro, sem mexer no código.

### 6.2 Lista mínima de placeholders

| Categoria | Itens | Tamanho |
|---|---|---|
| Tiles chão | relva, terra, areia, água, estrada, chão madeira, chão betão | 16×16 |
| Tiles obstáculo | muro, vedação, rocha grande | 16×16 |
| Jogador | 4 direções × (parado, andar 4 frames, atacar 2 frames, agachado parado + andar 2 frames) = 10 colunas | 16×32 |
| Zombies | walker, runner, tank (cor diferente cada) | 16×32 (tank 24×32) |
| Recursos | árvore (2 tamanhos), pedra, arbusto de bagas, erva/fibra, minério | 16×16 a 32×32 |
| Contentores | caixa, armário, carro abandonado, mochila caída | 16×16 a 32×16 |
| Estruturas | fundação, parede, porta, baú, fogueira, bancada madeira | 16×16 |
| Ícones de itens | ~40 ícones (um por item inicial) | 16×16 |
| UI | slot inventário, barras (vida/fome/sede), botões, joystick | variável |
| FX | número de dano, flash de hit, partícula de recolha | — |

### 6.3 Paleta

Usar uma paleta limitada (32 cores, quente, estilo Stardew). Guardar em `assets/palette.png`. Mesmo os placeholders devem usar esta paleta para a transição ser suave.

---

## 7. Sistemas de jogo (especificação)

### 7.1 Jogador

- Stats: **Vida** (100), **Fome** (100), **Sede** (100). Sem stamina na v1 (simplifica).
- Fome desce 1 ponto a cada 18 s de jogo; sede 1 ponto a cada 12 s (valores em `balance.json`).
- Fome ou sede a 0 → perde 1 de vida a cada 3 s (nunca instantâneo).
- Regeneração: +1 vida a cada 5 s se fome e sede > 50%.
- Nível do jogador (XP por recolher, craftar, matar, construir, abrir contentores, pescar) → desbloqueia receitas, peças de construção e zonas (`unlockLevel` em recipes/structures/zones). Nível máximo v1: 30. XP para passar do nível n: `xpCurve.base × growth^(n−1)` (50, 63, 78…; ~1300 XP até ao nível 10). Valores: `xp` em resources/enemies/recipes (omisso: `xpGather`; receitas pelo tempo) e `xpBuild`, `xpLoot`, `xpFish` em `balance.json`.
- **Notas** (itens `type: "note"`, campo `teaches`) encontradas em contentores ensinam uma receita antes do nível ("Ler" na mochila); ficam em `unlocks.recipes`.
- Ao subir de nível aparece "Subiste de nível!" no topo, com o que ficou desbloqueado (não pausa o jogo). O HUD mostra o nível e uma barra de XP.
- Movimento 8 direções. Velocidade base 80 px/s; mais lento com inventário > 90% cheio (opcional).

### 7.2 Controlos

| Ação | Teclado/rato | Touch |
|---|---|---|
| Mover | WASD / setas | Joystick virtual flutuante (aparece onde o dedo tocar, fora dos botões) |
| Andar agachado (metade da velocidade) | Shift ou Ctrl | Joystick pouco empurrado (até 55% do raio) |
| Zoom (até metade) | Ctrl + roda do rato, +/− | Pinça com 2 dedos |
| Velocidade do jogo x1/x2/x3 | Botão por baixo do relógio | Idem |
| Ação contextual (bater, recolher, abrir, atacar) | Espaço / clique (manter premido repete golpes ao ritmo da arma) | Botão grande (lado direito) |
| Inventário | I / Tab | Botão mochila |
| Equipar arma/roupa | Na mochila: selecionar → "Equipar", ou arrastar para a coluna Arma/Cabeça/Corpo | Idem |
| Craft | C | Botão "Fabricar" (à esquerda da hotbar) |
| Modo construção | B (dentro: clique/Espaço coloca, R roda, Z desfaz, X demolir, B/Esc sai) | Botão "Construir" (por cima do "Fabricar"); toque curto no mundo escolhe o tile, botões Colocar/Rodar/Desfazer/Demolir/Sair |
| Comer/beber rápido | 1–4 (hotbar) | Hotbar de 4 slots |

Com Ctrl/Cmd premido, os atalhos do browser nas teclas do jogo (Ctrl+S, Ctrl+D, Ctrl+A, Ctrl+F…) são anulados (`src/input/browserShortcuts.ts`); Ctrl+W/T/N não se podem anular, por isso fechar a página com o Ctrl premido pede confirmação.

A **ação contextual** escolhe automaticamente o alvo mais próximo em frente (como no original): zombie > contentor > recurso.

### 7.3 Inventário

- Grelha de slots. Base 20; mochila pequena +10; mochila grande +20.
- Stacks: recursos 50, consumíveis 10, munições 100, ferramentas/armas 1.
- Slots de equipamento: arma, cabeça, corpo, pernas, pés, mochila.
- Baús na base: 24 slots cada, sem limite de baús (limitado por recursos).
- Ações: mover, dividir stack, largar, usar, "guardar tudo semelhante" no baú e **ordenar** (mochila e baú: junta os itens iguais em stacks cheios e agrupa por categoria — ferramentas, armas, armadura, mochilas, consumíveis, recursos, chaves) (qualidade de vida).

### 7.4 Recolha

| Recurso | Ferramenta | Golpes (mão / ferramenta) | Drop |
|---|---|---|---|
| Árvore pequena | mão ou machado | 6 / 3 | 2–3 madeira |
| Árvore grande | machado | — / 5 | 4–6 madeira |
| Pedra | mão ou picareta | 6 / 3 | 2–3 pedra |
| Arbusto de bagas | mão | 1 | 2–4 bagas |
| Erva alta | mão | 1 | 1–2 fibra |
| Filão de ferro | picareta | — / 5 | 2–3 minério de ferro |
| Água (lago) | garrafa vazia (num cais, sem cana) | 1 | água suja |
| Argila (lago) | mão ou picareta | 4 / 2 | 2–3 argila |

Os nós de recurso reaparecem (ver zonas).

### 7.5 Crafting

- Receitas em `recipes.json`: `{ id, station, inputs[], output, qty, timeSec, unlockLevel }`.
- Estações: **Mãos** (inventário), **Bancada de madeira**, **Fogueira**, **Bancada de trabalho**, **Fornalha**, **Bancada de armas** (tardia), **Bancada química/medicina** (tardia).
- Tempos curtos: 0 s (mãos) a 60 s (itens avançados). Craft continua em segundo plano enquanto o jogador sai.
- Fila de craft por estação (máx. 3).

### 7.6 Tempo offline

- Ao carregar o save, calcular tempo real decorrido.
- Timers de craft e respawn avançam com o tempo offline, **limitado a 8 h**.
- Fome/sede **não** descem offline (mais simpático).

### 7.7 Construção da base

- A base é um mapa fixo; constrói-se em qualquer tile livre da grelha de 16×16 (não em tiles de colisão, obstáculos sólidos, baús do mapa, nem recursos por apanhar — corta-se a árvore para abrir espaço; um recurso apanhado só reaparece quando não houver peças por cima).
- Peças (`structures.json`): fundação (madeira, pedra; metal mais tarde), parede (madeira, pedra), porta, janela, vedação, fogueira, bancada, baú. Duas camadas por tile: `floor` (fundação) e `top` (o resto).
- Paredes, janelas, vedações e portas fechadas bloqueiam o tile inteiro; estações e baús bloqueiam com o `footprint`. Peças sólidas não se põem em cima do jogador, no ponto onde ele aparece nem nas saídas.
- Colocação: pré-visualização verde/vermelha (com o motivo), rodar (portas, janelas, vedações: horizontal/vertical), desfazer nos últimos 10 s (de jogo) com reembolso total. A peça vai para o tile à frente do jogador, ou para o tile do rato/toque.
- Demolir devolve 50% dos materiais (arredondado para baixo); só demole se o reembolso couber na mochila. Não se demole uma fundação com estação/baú por cima, uma estação com trabalhos/itens nem um baú com itens.
- Portas abrem/fecham com a ação contextual (não fecham com o jogador lá dentro).
- Estruturas **não decaem** (só as hordas as danificam, §7.13).
- Estações e baús só podem ser colocados sobre fundação (o chão da casa em ruínas do mapa também conta).
- Save: `base.structures = [[uid, id, tx, ty, rot, estado]]` (estado 1 = porta aberta) e `base.nextStructureId`. Estações construídas: `stations["<tipo>_s<uid>"]`; baús: `base.chests["s<uid>"]`.

### 7.8 Combate

- **Corpo a corpo**: cada arma tem dano, velocidade (`attackSec`), alcance (`reach`), durabilidade (gasta 1 por golpe). Sem arma, punhos (`fistDamage`). Qualquer item com `damage` se equipa como arma (um machado equipado também serve para cortar).
- Golpe: dano, número a subir, empurrão e 0,3 s de atordoamento — exceto durante o aviso de ataque (o ataque do inimigo já está comprometido). Mantendo a ação premida repete ao ritmo da arma.
- Ao levar dano: 0,6 s de invulnerabilidade (o boneco pisca) e um pequeno empurrão.
- **Distância** (Fase 10): pistola/besta com munição; mira automática ao inimigo mais próximo.
- Inimigos **telegrafam** ataques (0,4 s de aviso com piscar) — dá para recuar.
- **Sangrar** (Fase 10): alguns inimigos (`bleedPct` em `enemies.json`: corredor, lobo, brutamontes) podem pôr o jogador a sangrar — perde 1 de vida a cada `bleedEverySec` durante `bleedSec` (nunca instantâneo); itens com `stopsBleeding` (ligadura, kit médico) estancam. Morrer também. Save: `player.bleed` (ticks).
- Furtividade simples: andar devagar (segurar Shift/Ctrl / joystick parcial) reduz raio de deteção para metade (`sneakDetectMultiplier`).
- Armadura reduz dano em percentagem (máx. 60%; soma das peças equipadas; cada golpe recebido gasta 1 de durabilidade a cada peça). Um golpe que acerta tira sempre pelo menos 1.
- Os inimigos não se gravam: nascem nos pontos `enemy_spawn:<grupo>` ao entrar na zona (os grupos estão em `enemyGroups.json`).

### 7.9 Inimigos

| ID | Nome (provisório) | Vida | Dano | Velocidade | Notas |
|---|---|---|---|---|---|
| zombie_walker | Arrastado | 40 | 6 | 40 px/s | Básico, em grupos de 1–3 |
| zombie_runner | Corredor | 30 | 5 | 90 px/s | Aparece a partir de T2 |
| zombie_bloated | Inchado | 60 | 12 (área) | 30 px/s | Explode ao morrer (0,9 s a piscar a vermelho, raio 30 px); aviso claro |
| zombie_tank | Brutamontes | 250 | 20 | 35 px/s | T3+, aviso de 0,9 s (`windupSec`); pode fazer sangrar |
| zombie_screamer | Gritador | 35 | 0 | 50 px/s | T3+; fica a ~56 px e grita a cada 8 s: quem estiver a 160 px vem à procura do jogador durante 12 s (sem leash) |
| wolf | Lobo | 45 | 8 | 100 px/s | Animal, T2 florestas |
| boar | Javali | 70 | 10 | carga | Aviso 2× mais longo, depois carga em linha reta (150 px/s, 0,7 s); dá carne e couro |
| deer | Veado | 30 | 0 | foge | Presa pacífica |
| boss_* | Chefes de bunker | — | — | — | Fase 10 |

IA: estados `idle → wander → chase → attack → return`. Perdem o interesse fora de um raio (leash) para não perseguirem pelo mapa todo.

### 7.10 Loot

- Contentores com tabela de loot (`lootTables.json`): pesos, quantidades min/max, raridade.
- Raridades: comum, incomum, raro, épico (cores standard).
- Respawn de contentores e recursos por zona (tempo de jogo): um contentor sorteia o loot quando se abre e só volta a encher ao fim de `respawnDays` dias de jogo da zona (save: `zones.<zona>.loot[id] = [tick em que volta a encher, conteúdo]`; o tempo offline também conta). Contentores vazios aparecem escurecidos.
- Os contentores abrem-se ao lado da mochila, com "Apanhar tudo".
- "Pity" simples: um contentor raro garante pelo menos 1 item incomum.

### 7.11 Dia e noite

- Ciclo de 20 min reais. Noite = 25% do ciclo, centrada na meia-noite (21h–3h), com 1 h de crepúsculo e de madrugada (`core/DayNight.ts`). Escuridão máxima `nightDarkness`.
- À noite: mais zombies nas zonas (`nightEnemyMultiplier` da zona; grupos `{ "night": true }` só aparecem de noite, ex.: lobos no lago), avaliado ao entrar na zona; visão reduzida (véu escuro numa RenderTexture com círculos de luz em degraus à volta do jogador — `playerLightPx` — e das peças com `light`).
- Na base: fogueiras e tochas (peça `torch`, sem fundação) iluminam; sem ataques à noite a menos que "Hordas" esteja ativo.

### 7.12 Morte

- Reaparece na base com vida 50%, fome/sede 50%.
- Conteúdo da **mochila** fica numa mochila caída no local da morte (marcada no mapa-mundo, Fase 7), durante `deathBagHoursReal` horas reais; morrer de novo na mesma zona junta tudo na mesma mochila. Apanha-se com a ação contextual (o que não couber fica lá).
- Itens **equipados** e hotbar mantêm-se.
- Os drops de inimigos que não cabem na mochila também ficam numa mochila no chão.
- Nunca se perde nada guardado na base.

### 7.13 Hordas (raids opcionais, Fase 9)

- Desligado por defeito; liga-se no menu inicial ("Hordas: ligadas"), gravado no save (`settings.hordes`). Se ligado: a cada `hordeEveryDays` (3) dias de jogo, às `hordeHour` (22 h), uma horda (grupo `horde` de `enemyGroups.json`: 6 walkers + 2 runners; cada horda vencida +25%, até ×2) chega pelas saídas da base (`core/Horde.ts`).
- Só ataca com o jogador na base: se estiver fora, espera por ele ("Horda à espera na base").
- Aviso no HUD nas últimas 24 h ("Horda em N h") e, durante a horda, quantos faltam.
- Os zombies da horda veem sempre o jogador e não desistem; quando ficam presos (`hordeStuckSec`) contra uma peça sólida construída, atacam-na (com o aviso normal). Peças sólidas têm `hp` (`structures.json`); a 0 desaparecem sem reembolso. Portas abertas deixam passar.
- **Armadilha de estacas** (`spike_trap`, `trap`): fere quem a pisa (`damage` a cada `everySec`) e gasta-se ao fim de `uses` golpes.
- Peças danificadas (e armadilhas gastas) ficam avermelhadas e reparam-se com a ação contextual por `structureRepairPct`% (25%) do custo.
- Vencer: mochila no chão com o prémio (`horde_reward` de `lootTables.json`). Morrer: a horda vai-se embora sem prémio (a seguinte não cresce).
- Save: `horde = { at, count, active }` (a meio de uma horda, recarregar fá-la voltar inteira) e `base.damage[uid]`.

### 7.14 Horta e produção na base (Fase 9)

- **Canteiro** (`garden_bed`, `farm: true`): com a ação contextual planta-se a primeira semente da mochila (itens com `plant`), rega-se com água (itens com `waters`; primeiro a suja, a garrafa volta) e, passadas `growHours` horas de jogo, colhe-se o fruto e 0–2 sementes (só se couber tudo). Por regar não cresce. Um canteiro com planta não se demole.
- **Peças que produzem** (`produce: { everyHours, max, drops, needs? }`): uma unidade a cada `everyHours` horas de jogo, até `max`; recolhe-se com a ação (o coletor de água gasta uma garrafa vazia por unidade). Sprite `_full` quando há algo.
- O tempo offline também conta (§7.6). Save: `base.crops[uid] = [semente, tick em que amadurece | null]`, `base.produce[uid] = tick de início da contagem`.

---

## 8. Mapas e zonas

### 8.1 Mapa-mundo

- Ecrã próprio (`WorldMapScene`) com a base ao centro e zonas à volta. Abre-se ao pisar uma saída `exit` (sem destino); o tempo de jogo fica parado enquanto está aberto; "Voltar" regressa pela mesma saída.
- Viajar custa comida e água (`zones.json` → `travelCost`, valores baixos; o Pinhal é gratuito). Não se viaja se isso deixasse a fome ou a sede a 0.
- Zonas bloqueadas (nível abaixo de `unlockLevel`) aparecem a cinzento com o nível pedido e não se pode viajar para lá (a zona onde se está fica sempre acessível).
- Ícones de estado: zona segura/perigosa, recursos disponíveis, mochila caída, evento ativo.
- Cada zona tem **nível de perigo** T1–T4 (cor verde, amarelo, laranja, vermelho).

### 8.2 Lista de zonas

| # | Zona | Perigo | Tamanho (tiles) | Desbloqueio | Recursos principais | Inimigos | Respawn |
|---|---|---|---|---|---|---|---|
| 0 | **Casa (Base)** | Seguro | 48×48 | Início | Pouca madeira/pedra à volta, poço (água) | Nenhum | — |
| 1 | **Pinhal** | T1 | 64×64 | Início | Madeira, pedra, bagas, fibra | 3–6 walkers, veados | 1 dia |
| 2 | **Quinta Abandonada** | T1 | 64×48 | Nível 2 | Sementes, comida enlatada, trapos, pregos | walkers | 1 dia |
| 3 | **Margem do Lago** | T1 | 64×64 | Nível 3 | Água, peixe (pesca simples), argila, fibra | walkers, lobos à noite | 1 dia |
| 4 | **Estrada e Bomba de Gasolina** | T2 | 80×40 | Nível 6 | Sucata, gasolina, peças de carro, mapas | walkers, runners, bloated | 2 dias |
| 5 | **Aldeia Deserta** | T2 | 80×80 | Nível 8 | Tecido, medicamentos básicos, ferramentas, receitas (notas) | walkers, runners, lobos | 2 dias |
| 6 | **Floresta Profunda** | T2 | 96×96 | Nível 10 | Madeira de carvalho, minério de ferro, couro | lobos, javalis, runners | 2 dias |
| 7 | **Zona Industrial** | T3 | 96×64 | Nível 14 | Aço, componentes elétricos, químicos | runners, bloated, tanks, screamers | 3 dias |
| 8 | **Hospital de Campanha** | T3 | 64×64 | Nível 16 | Medicamentos avançados, ligaduras, kits | runners, screamers | 3 dias |
| 9 | **Base Militar** | T4 | 96×96 | Nível 20 + cartão de acesso | Armas, munição, armadura, componentes raros | tanks, runners, screamers, grupos | 4 dias |
| 10 | **Bunker (dungeon)** | T3→T4 | 4 pisos de ~40×40 | Nível 18 + chave do bunker | Loot épico, receitas raras | Crescente por piso + chefe | Semanal (jogo) |
| 11 | **Cidade em Ruínas** (endgame) | T4 | 128×96 | Nível 25 | Tudo, com raridade alta | Tudo, em maior número | 4 dias |

### 8.3 Zonas-evento (temporárias, Fase 10)

| Evento | Duração | Frequência | Conteúdo |
|---|---|---|---|
| Queda de avião de carga | 1 dia de jogo | a cada ~5 dias | 3 caixas com loot garantido raro, alguns zombies |
| Comboio parado | 1 dia | a cada ~7 dias | Vagões com loot por categoria (comida, armas, materiais) |
| Acampamento de sobreviventes | 2 dias | aleatório | Comerciante: troca itens (sem moeda) |
| Nevoeiro tóxico | — | raro | Zona temporária, precisa de máscara, loot químico |

### 8.4 Regras de desenho de mapas (Tiled)

- Camadas: `ground`, `decor_low`, `collision`, `decor_high` (por cima do jogador), `objects`.
- Camada `objects` contém pontos de spawn: `player_spawn`, `exit` / `exit:<zona>` (sem zona = mapa-mundo, Fase 7; com zona = vai direto para ela; chega-se junto à saída que leva de volta), `resource:<id>`, `prop:<id>`, `chest:<id>`, `station:<tipo>`, `container:<lootTableId>`, `enemy_spawn:<groupId>`.
- Estado de uma estação no save: `stations["<tipo>_<id do objeto>"] = { queue: [[receita, ticks que faltam]], output: Slot[] }` (estações construídas: `<tipo>_s<uid>`).
- O chão da camada `ground` com os tiles `floor_wood`/`floor_concrete` conta como fundação (`BASE_FLOOR_TILES`).
- O **id do objeto no Tiled** identifica cada recurso no save (`zones.<zona>.depleted`): não reutilizar ids (o Tiled nunca o faz).
- **Obstáculos livres** (`prop:<id>`, definidos em `props.json`): troncos, cepos, caixotes, barris, vedação partida, carros abandonados, poço, pedrinhas… Colocam-se em **qualquer posição** (fora da grelha) e bloqueiam com o seu `footprint` (ou são decoração atravessável sem ele). É assim que se dá realismo ao mapa sem mudar a escala.
- Cada zona tem **pelo menos 2 saídas** para o mapa-mundo e uma área segura perto da entrada.
- Nomes dos objetos (campo *Name* no Tiled) com esse formato; o ponto de um `resource:<id>`/`prop:<id>` são os **pés** do objeto (meio da base do sprite). Posições fracionárias são arredondadas ao desenhar.
- A camada `collision` é desenhada (paredes, vedações, água, rochedos) e qualquer tile nela bloqueia. Os recursos bloqueiam com o `footprint` de `resources.json`.
- Tilesets **embebidos** no mapa (o Phaser não lê `.tsx` externos); o tileset `base_tiles` aponta para `../tiles/base_tiles.png`. Acrescentar tiles só no fim, para não baralhar os gids.
- O `validate-data` e o arranque do jogo validam o mapa (camadas, gids, spawn único fora das colisões, ≥ 2 saídas, ids de recursos).
- Mapas desenhados à mão; a **variação** vem da posição aleatória (com seed) de parte dos recursos e contentores entre os pontos candidatos.
- Distância média entrada → ponto mais valioso: 30–60 s a andar.

---

## 9. Conteúdo inicial (dados de exemplo)

### 9.1 Itens (excerto para arranque)

```
Recursos: wood, stone, fiber, berries, clay, iron_ore, scrap_metal, nails, cloth, leather, raw_meat, fish
Processados: wood_plank, rope, iron_ingot, leather_strip
Consumíveis: berries, cooked_meat, cooked_fish, canned_food, water_dirty, water_clean, bandage, medkit
Ferramentas: stone_axe, stone_pickaxe, iron_axe, iron_pickaxe, fishing_rod, empty_bottle
Armas: wooden_club, spiked_club, machete, fire_axe, crossbow (tardia), pistol (tardia)
Armadura: cloth_hat, cloth_shirt, leather_jacket, leather_pants, military_helmet (tardia)
Mochilas: small_backpack, large_backpack
Chaves: road_map, bunker_key, military_keycard
```

### 9.2 Exemplo de `items.json`

```json
{
  "stone_axe": {
    "name": "item.stone_axe",
    "icon": "icon_stone_axe",
    "type": "tool",
    "toolKind": "axe",
    "damage": 8,
    "gatherPower": 2,
    "durability": 120,
    "stack": 1,
    "rarity": "common"
  },
  "berries": {
    "name": "item.berries",
    "icon": "icon_berries",
    "type": "consumable",
    "effects": { "hunger": 8, "thirst": 2 },
    "stack": 20,
    "rarity": "common"
  }
}
```

### 9.3 Exemplo de `recipes.json`

```json
[
  { "id": "r_stone_axe", "station": "hands", "inputs": [["wood", 3], ["stone", 3]], "output": "stone_axe", "qty": 1, "timeSec": 0, "unlockLevel": 1 },
  { "id": "r_wood_plank", "station": "wood_bench", "inputs": [["wood", 2]], "output": "wood_plank", "qty": 1, "timeSec": 5, "unlockLevel": 2 },
  { "id": "r_cooked_meat", "station": "campfire", "inputs": [["raw_meat", 1]], "output": "cooked_meat", "qty": 1, "timeSec": 10, "unlockLevel": 1 }
]
```

### 9.4 Exemplo de `zones.json`

```json
{
  "zone_pine_forest": {
    "name": "zone.pine_forest",
    "map": "maps/pine_forest.json",
    "danger": 1,
    "unlock": { "level": 1 },
    "travelCost": { "hunger": 0, "thirst": 0 },
    "respawnDays": 1,
    "nightEnemyMultiplier": 1.5,
    "worldMapPos": [120, 80]
  }
}
```

### 9.5 Curva de progressão alvo

| Nível | Tempo de jogo aprox. | Marco |
|---|---|---|
| 1–3 | 0–30 min | Ferramentas de pedra, fogueira, primeiras paredes |
| 4–8 | 30 min–2 h | Bancada, casa de madeira fechada, Quinta e Lago |
| 9–14 | 2–5 h | Ferro, fornalha, Aldeia e Floresta Profunda |
| 15–20 | 5–10 h | Zona Industrial, Hospital, bunker |
| 21–30 | 10–20 h | Base Militar, Cidade, armas de fogo |

(O LDoE é consideravelmente mais lento; estes tempos refletem a dificuldade menor.)

---

## 10. Sistema de save

### 10.1 Requisitos

- **Save constante**: o jogador nunca deve perder mais de ~15 segundos de progresso.
- Um único slot de jogo na v1 (preparar estrutura para 3 slots).
- Resistente a corrupção e a fechar o separador a meio.

### 10.2 Quando guardar

- Autosave a cada **15 s** de jogo (só se houver alterações — flag `dirty`).
- Imediatamente em: mudança de zona, fim de craft, colocação/demolição de estrutura, morte, nível subido.
- Em `visibilitychange` (separador escondido) e `pagehide`.
- Guardar de forma **não bloqueante** (debounce de 500 ms para não gravar várias vezes seguidas).

### 10.3 Robustez

- **Dois slots rotativos** (A/B): grava no mais antigo; ao carregar escolhe o mais recente válido (entre A, B e a cópia de emergência síncrona feita ao esconder/fechar a página).
- Chaves: `refugio.save.<slot>.a`, `.b` (IndexedDB, base `refugio`, store `saves`) e `.x` (emergência, localStorage).
- Cada save inclui `version`, `timestamp` e `checksum` (hash simples do JSON).
- Se o checksum falhar, usar o outro slot e avisar discretamente.
- Botões nas definições: **Exportar save** (download JSON) e **Importar save**. Útil para testes e para migrar para o APK.

### 10.4 Interface de adaptadores

```ts
interface StorageAdapter {
  load(key: string): Promise<string | null>;
  save(key: string, data: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

- Web: `IndexedDbAdapter` (fallback `LocalStorageAdapter`).
- Android: `CapacitorAdapter` (Fase 13).
- YouTube: `YouTubePlayablesAdapter` (Fase 14) — o SDK tem limite de tamanho de save; o formato deve ser **compacto** desde o início (ver 10.5).

### 10.5 Formato (resumo)

```ts
type SaveData = {
  version: number;
  timestamp: number;         // ms reais
  checksum: string;
  player: { pos, zoneId, hp, hunger, thirst, xp, level, equipment, inventory };
  base: { structures: [id, x, y, rot, hp][], chests: Record<string, Slot[]> };
  stations: Record<string, { queue: CraftJob[] }>;
  zones: Record<string, { lastVisit, depleted: string[], respawnAt, deathBag?: Slot[] }>;
  world: { gameTime, day, events: ActiveEvent[] };
  unlocks: { recipes: string[], zones: string[] };
  settings: { volume, language, hordes: boolean, controls };
  stats: { kills, deaths, crafted, playTimeSec };
};
```

- Guardar **só o que muda** (ex.: nas zonas, guardar os IDs de recursos já apanhados, não o mapa inteiro).
- Inventário como arrays compactos `[itemId, qty, durability]`.
- Alvo: save < 100 KB mesmo no endgame.

---

## 11. Plano de desenvolvimento por fases

Cada fase termina com uma **build jogável** e critérios de aceitação verificáveis. Estimativas assumem uma pessoa em part-time com ajuda do Claude; ajustar à realidade.

### Fase 0 — Fundação do projeto (≈ 1 semana)

**Objetivo:** projeto a correr com ecrã inicial.

- [x] Criar projeto Vite + TypeScript + Phaser; ESLint, Prettier, Vitest.
- [x] Configurar pixel-perfect (480×270, escala inteira, `pixelArt: true`).
- [x] Cenas vazias: Boot, Preload, MainMenu, Base, UI.
- [x] `assets/manifest.json` + gerador de placeholders por código.
- [x] `EventBus`, `GameState` vazio, `config.ts`.
- [x] Overlay de debug (FPS, posição, tick) com tecla F3.
- [x] Deploy automático de preview no GitHub Pages para testar no telemóvel (`.github/workflows/deploy.yml`: lint + testes + build; publica a cada push para `main`). Preview: https://phreezi.github.io/refugio/ (repositório `Phreezi/refugio`).

**Aceitação:** `npm run dev` abre um menu "Novo jogo" que leva a um ecrã verde com um quadrado; build de produção funciona no browser do telemóvel.

---

### Fase 1 — Movimento e mundo (≈ 1–2 semanas)

**Objetivo:** andar num mapa real com colisões.

- [x] Primeiro mapa Tiled da **Base** (48×48) com tileset placeholder (`public/assets/maps/base.json`, gerado uma vez por `npm run map:base`; daí em diante edita-se no Tiled).
- [x] Jogador com movimento 8 direções, animação placeholder, colisão com a camada `collision` (e com a caixa dos recursos).
- [x] Câmara a seguir o jogador, limitada aos bordos do mapa.
- [x] Ordenação por profundidade (Y-sort) para o jogador passar atrás de árvores.
- [x] Input: teclado + **joystick virtual** touch.
- [x] Ecrã "roda o dispositivo" em retrato. *(Substituído: o jogo passou a funcionar também na vertical.)*

**Aceitação:** anda-se pela base no PC e no telemóvel a 60 FPS, sem atravessar paredes, com o jogador corretamente por trás/à frente dos objetos.

---

### Fase 2 — Save system e stats de sobrevivência (≈ 1–2 semanas)

**Objetivo:** o jogo lembra-se de tudo desde cedo (fazer isto cedo evita dor depois).

- [x] `SaveManager` com adaptadores IndexedDB/localStorage, slots A/B, checksum, versão, migrações.
- [x] Autosave (15 s + eventos + `visibilitychange`/`pagehide`). Ao esconder/fechar a página grava uma **cópia de emergência síncrona** no localStorage (o browser corta escritas assíncronas ao recarregar).
- [x] Vida, fome, sede com decaimento a partir de `balance.json` (ritmos como múltiplos do tick; morte → reaparece na base a 50%).
- [x] HUD: três barras + relógio do dia (barras piscam abaixo de 30%).
- [x] Botões Exportar/Importar save e "Apagar save" (com confirmação), no menu inicial.
- [x] Testes: gravar → carregar → estado idêntico; save corrompido → recupera do outro slot.

**Aceitação:** fechar o separador a meio e reabrir coloca o jogador na mesma posição com os mesmos stats (±15 s).

---

### Fase 3 — Inventário e recolha (≈ 2 semanas)

**Objetivo:** apanhar coisas do mundo.

- [x] `items.json` com 25 itens iniciais e validação no arranque (ícones em pixel art para os que já se apanham).
- [x] Sistema de inventário puro (adicionar, remover, stack, dividir, mover, guardar semelhantes) com testes.
- [x] UI de inventário e hotbar de 4 slots: tocar seleciona (Usar/Dividir), arrastar move (rato e toque) entre mochila, hotbar e baú. *(Sem "largar no chão" ainda: não há itens no chão.)*
- [x] Nós de recurso (árvore, pedra, arbusto, erva) com vida, feedback de golpe (abanão/clarão, "+2 Madeira") e drops; reaparecem após `respawnSec` de jogo.
- [x] Ação contextual automática sobre o alvo mais próximo em frente (seta por cima do alvo; Espaço/clique/botão "Ação"; manter premido repete golpes).
- [x] Consumir itens (comer bagas, beber água; garrafa vazia volta) e beber no **poço** da base.
- [x] Baú na base (`chest:base_1` no mapa, dentro da casa).

**Aceitação:** o jogador corta árvores, apanha bagas, come, e guarda coisas num baú; tudo sobrevive a um reload.

---

### Fase 4 — Crafting (≈ 2 semanas)

**Objetivo:** transformar recursos em ferramentas e comida.

- [x] `recipes.json` e sistema de crafting puro (verificar ingredientes, consumir, produzir) com testes.
- [x] Craft nas mãos (instantâneo) e em estações (com tempo de jogo e fila de 3; o resultado espera na estação até ser recolhido — ao abrir a estação é recolhido logo).
- [x] Estações iniciais: fogueira e bancada de madeira (`stations.json`). Na Fase 4 estavam no mapa (`station:<tipo>`); desde a Fase 5 são construídas.
- [x] Ferramentas com durabilidade e bónus de recolha; reparação na bancada (`repairCostPct`% dos ingredientes, proporcional ao desgaste).
- [x] UI de crafting (C / botão "Fabricar"; ação junto da estação): separadores por categoria, ingredientes em falta a vermelho, fila com barra de progresso, cancelar, recolher.
- [x] Timers de craft (e respawn de recursos) a avançar offline (máx. 8 h) ao carregar "Continuar".

**Aceitação:** cadeia completa madeira → machado de pedra → cortar mais rápido → tábuas na bancada → carne cozinhada na fogueira.

---

### Fase 5 — Construção da base (≈ 2–3 semanas)

**Objetivo:** construir a casa.

- [x] `structures.json` (fundação, parede, porta, janela, vedação; tiers madeira/pedra nas fundações e paredes; fogueira, bancada e baú).
- [x] Modo construção: grelha, pré-visualização verde/vermelha (com o motivo), rotação, custo visível (e quanto se tem).
- [x] Regras: estações e baús só em fundação; portas abrem/fecham; colisão atualizada.
- [x] Desfazer (10 s, reembolso total) e demolir (50%).
- [x] Estações de crafting passam a ser estruturas construídas (as do mapa passam a peças por migração).
- [x] Guardar estruturas no save de forma compacta (save v4).

**Aceitação:** constrói-se uma casa 6×6 fechada com porta, baús, fogueira e bancada, e tudo reaparece após reload.

---

### Fase 6 — Combate e inimigos (≈ 2–3 semanas)

**Objetivo:** perigo real mas justo.

- [x] `enemies.json`; entidades zombie_walker e zombie_runner, animais (veado, lobo). Sprites em pixel art por script.
- [x] IA com máquina de estados (idle, wander, chase, attack, return) e leash (quem desiste volta a casa e recupera a vida). Presas fogem.
- [x] Combate corpo a corpo: dano, knockback, i-frames curtos, números de dano, barra de vida dos inimigos.
- [x] Ataques inimigos telegrafados (0,4 s a piscar; recuar evita o golpe).
- [x] Armas: moca, moca com pregos, machete (bancada).
- [x] Armadura básica de tecido (camisa, chapéu); equipamento arma/cabeça/corpo no painel da mochila.
- [x] Morte → mochila caída + respawn na base (ver 7.12).
- [x] Drops de inimigos (carne, couro, trapos, pregos, sucata).

**Aceitação:** um jogador equipado com moca vence 3 walkers sem morrer se recuar entre ataques; ao morrer, recupera a mochila.

---

### Fase 7 — Mapa-mundo e primeiras zonas (≈ 3 semanas)

**Objetivo:** o core loop completo.

- [x] `WorldMapScene` com base, zonas, estado de cada uma (perigo, mochila caída) e custo de viagem.
- [x] `ZoneScene` genérica que carrega qualquer zona a partir de `zones.json` (Fase 6: a base e o Pinhal).
- [x] Zonas: **Pinhal**, **Quinta Abandonada**, **Margem do Lago** (mapas gerados por script; editam-se no Tiled).
- [x] Contentores com tabelas de loot e raridade (caixote, barril, armário com "pity", caixa do pescador).
- [x] Respawn de recursos/contentores por zona (tempo de jogo).
- [x] Transição suave entre zonas (fade) com save automático.
- [x] Pesca simples no lago (mini-jogo de 1 botão, nos cais; cana de pesca; peixe → fogueira → peixe assado).
- [x] Água suja → ferver na fogueira → água limpa (garrafa vazia enche-se num cais do lago).

**Aceitação:** sair da base, ir ao Pinhal, lootear, voltar, craftar algo novo com o que se trouxe — tudo em menos de 10 minutos, com save em todas as transições.

---

### Fase 8 — Dia/noite, progressão e desbloqueios (≈ 2 semanas)

**Objetivo:** razão para continuar a jogar.

- [x] Ciclo dia/noite com iluminação (overlay + luzes).
- [x] Mais inimigos à noite; tochas e fogueiras iluminam.
- [x] XP e níveis; receitas, peças e zonas desbloqueadas por nível.
- [x] Ecrã "Subiste de nível!" com lista do que desbloqueou.
- [x] Notas/receitas encontradas em loot (desbloqueio alternativo).
- [x] Zonas T2: **Estrada e Bomba de Gasolina**, **Aldeia Deserta**, **Floresta Profunda** (mapas gerados por `npm run map:t2`; editam-se no Tiled).
- [x] Novos inimigos: bloated (explode ao morrer, com aviso), lobos, javalis (carga anunciada).
- [x] Fornalha, ferro, ferramentas de ferro, tier de pedra nas estruturas (este já vinha da Fase 5).

**Aceitação:** um jogador novo atinge o nível 10 em ~3 h de jogo, com sensação de progresso constante (testar com 2–3 pessoas).

---

### Fase 9 — Base avançada e Hordas opcionais (≈ 2 semanas)

**Objetivo:** dar valor à base.

- [x] Horta: plantar sementes da Quinta (sacos de sementes no celeiro), regar com água, colher (ver §7.14).
- [x] Coletor de água da chuva.
- [x] Armadilhas de caça simples.
- [x] Hordas opcionais (desligadas por defeito; botão no menu inicial) com aviso e recompensa (ver §7.13).
- [x] Durabilidade de estruturas **apenas** em hordas; reparação barata (ação contextual, 25% do custo). Armadilha de estacas.
- [x] Qualidade de vida: filtro "Posso fazer" no fabrico. *("Guardar semelhantes" e "Ordenar" já existem desde a Fase 3/4.)*

**Aceitação:** com hordas ligadas, uma base de pedra com 2 armadilhas aguenta uma horda de 8 zombies sem intervenção perfeita do jogador. *(Simulado em `tests/core/Horde.test.ts`: um jogador que nunca recua, com machete, vence em ~35 s; caem 2 das 16 paredes.)*

---

### Fase 10 — Conteúdo intermédio e endgame (≈ 4–6 semanas)

**Objetivo:** objetivos de longo prazo.

- [x] Zonas T3: **Zona Industrial**, **Hospital de Campanha** (mapas gerados por `npm run map:t3`; armários industriais e de medicamentos).
- [x] Inimigos: tank (aviso mais longo, `windupSec`), screamer (grita e alerta os outros, `scream`).
- [ ] Armas à distância (besta, pistola) e munição craftável.
- [ ] **Bunker**: 4 pisos, checkpoint por piso, chefe final, chave obtida em quest simples.
- [ ] Zona T4: **Base Militar** (cartão de acesso), depois **Cidade em Ruínas**.
- [ ] Zonas-evento: queda de avião, comboio, acampamento com comerciante (troca).
- [ ] Veículo (moto): craft em várias peças, reduz custo de viagem.
- [x] Medicina: ligaduras (craft nas mãos), kits médicos, estado "sangrar" (`bleedPct` dos inimigos; uma ligadura estanca). *(Infeção fica de fora: era opcional.)* Casaco e calças de couro.

**Aceitação:** é possível "acabar" o conteúdo (chefe do bunker + Cidade) em ~15–20 h.

---

### Fase 11 — UX, mobile e acessibilidade (≈ 2 semanas)

**Objetivo:** ser agradável em telemóvel.

- [ ] Revisão completa dos controlos touch (tamanho de botões, zonas mortas do joystick).
- [ ] Tutorial curto e contextual (primeira árvore, primeiro craft, primeira zona).
- [ ] Definições: volume, idioma, tamanho da UI, vibração, hordas, mostrar números de dano.
- [ ] Modo daltónico para raridades (ícone além da cor).
- [ ] Menu de pausa, estatísticas do jogador.
- [ ] Testes em 3+ telemóveis Android de gamas diferentes.
- [ ] Otimização: object pooling de inimigos/partículas, culling, atlas de texturas.

**Aceitação:** 60 FPS num Android de gama média; tutorial concluído por quem nunca jogou sem ajuda.

---

### Fase 12 — Arte final e áudio (≈ contínua / 6+ semanas)

**Objetivo:** substituir placeholders pelo estilo Stardew-like.

- [ ] Definir guia de estilo (paleta final, contornos, luz de cima-esquerda, proporções).
- [ ] Tilesets finais por bioma (base, floresta, quinta, lago, estrada, aldeia, industrial, militar, cidade).
- [ ] Personagem com mais frames e peças de equipamento visíveis (camadas de sprite).
- [ ] Inimigos, recursos, estruturas, ícones finais.
- [ ] UI final (moldura de madeira/tecido, fonte pixel legível com acentos portugueses).
- [ ] Música por zona (loops curtos) e efeitos sonoros; tudo com licença registada.
- [ ] Partículas: folhas, pó, chuva; clima simples.

**Aceitação:** nenhum placeholder no jogo; todos os assets com licença documentada em `LICENSES.md`.

---

### Fase 13 — Port para Android (APK/AAB) (≈ 2 semanas)

**Objetivo:** versão instalável.

- [ ] Integrar **Capacitor**; build Android a partir do `dist/`.
- [ ] `CapacitorAdapter` para saves (Preferences/Filesystem) + migração de save web via Exportar/Importar.
- [ ] Botão "voltar" do Android (abre pausa em vez de fechar).
- [ ] Pausar e gravar em `appStateChange` (app em segundo plano).
- [ ] Ecrã completo, orientação landscape bloqueada, ícone e splash.
- [ ] Assinatura e build de release; testar APK em aparelhos reais.
- [ ] (Opcional) Publicação na Play Store: política de privacidade, classificação etária, AAB.

**Aceitação:** APK instala, corre a 60 FPS e nunca perde progresso ao ser morto pelo sistema.

---

### Fase 14 — YouTube Playables (≈ 2–3 semanas)

**Objetivo:** versão jogável no YouTube.

- [ ] Ler a documentação **atual** do YouTube Playables (requisitos mudam): tamanho máximo do bundle, limites de save, ciclo de vida, pausa/áudio, certificação.
- [ ] Integrar o SDK; implementar `YouTubePlayablesAdapter` para saves na cloud do SDK.
- [ ] Reduzir bundle: compressão de áudio, atlas, lazy loading de zonas tardias.
- [ ] Respeitar pausas e mute impostos pela plataforma.
- [ ] Remover qualquer link externo ou funcionalidade não permitida (ex.: exportar save por download, se não for permitido).
- [ ] Submeter para revisão.

**Aceitação:** passa as verificações do SDK e o save persiste entre sessões no YouTube.

---

### Fase 15 — Co-op online a 2 (≈ 4–6 semanas)

**Objetivo:** jogar com um amigo pela internet, no mundo de um dos dois.

- [ ] **Código de sessão**: quem cria o jogo ("Jogar com um amigo") recebe um código de **5 caracteres** (letras e números sem os que se confundem — sem `0/O`, `1/I/L` —, ex.: `K7Q2M`; 31 símbolos → ~28 milhões de códigos). O código é **sempre único**: é o servidor que o gera e o reserva enquanto a sessão existir (nunca há duas sessões ativas com o mesmo código) e só o liberta algum tempo depois de a sessão acabar. O parceiro escreve o código e entra.
- [ ] **Servidor pequeno** (sinalização + códigos): cria/valida códigos e liga os dois browsers; o jogo em si passa por **WebRTC** (DataChannel), com **TURN** para redes difíceis. Precisa de alojamento próprio (ou serviço gerido) e de dependências novas → decidir e pedir aprovação antes de começar (§5.4, regra 3).
- [ ] **Anfitrião autoritativo**: a `Simulation` corre no anfitrião (o mundo e o save são dele); o convidado envia só input (movimento, ação, UI) e recebe o estado. A lógica já é pura e em passo fixo (§5.1, §5.2), por isso encaixa.
- [ ] Segundo jogador no `GameState` (posição, vida, fome/sede, inventário, equipamento, nível); o convidado leva a sua personagem (guardada no save dele) — confirmar a regra antes de implementar.
- [ ] Sincronizar jogadores, inimigos, recursos, contentores, estruturas, estações e mochilas no chão; os dois na mesma zona (a viagem é decidida pelo anfitrião).
- [ ] Ligação perdida: o convidado volta a entrar com o mesmo código; se o anfitrião sair, a sessão acaba e o convidado fica com o progresso da personagem.
- [ ] Verificar se Android (Fase 13) e YouTube Playables (Fase 14) permitem multijogador; se não, o co-op fica só na versão web/APK.

**Aceitação:** dois jogadores em redes diferentes entram com o código, recolhem, constroem e combatem juntos durante 30 min sem dessincronizar; nunca aparecem duas sessões ativas com o mesmo código (teste no servidor).

---

## 12. Balanceamento: `balance.json` inicial

```json
{
  "dayLengthSec": 1200,
  "nightFraction": 0.25,
  "hungerDecaySec": 18,
  "thirstDecaySec": 12,
  "starvationDamageEverySec": 3,
  "regenEverySec": 5,
  "regenThreshold": 50,
  "playerSpeed": 80,
  "sneakMultiplier": 0.5,
  "autosaveSec": 15,
  "offlineCapHours": 8,
  "deathBagHoursReal": 48,
  "respawnHpPct": 50,
  "demolishRefundPct": 50,
  "hordeEveryDays": 3,
  "maxArmorReductionPct": 60,
  "xpCurve": { "base": 50, "growth": 1.25 }
}
```

Regra: qualquer ajuste de dificuldade faz-se aqui primeiro. Criar um modo **"Relaxado"** (multiplicadores 0,5× em decaimento e dano recebido) e **"Normal"**; ainda assim ambos mais fáceis que o LDoE.

---

## 13. Qualidade e testes

- Testes unitários obrigatórios: inventário, crafting, loot (com seed), save/migrações, cálculo de XP, custo de viagem.
- `validate-data`: verifica que todos os IDs referenciados em receitas, loot e zonas existem.
- Checklist manual por fase (ver critérios de aceitação).
- Modo debug (só em dev): dar itens, teleportar para zona, avançar tempo, invencibilidade, mostrar colisões.

---

## 14. Fora do âmbito (por agora)

- Multijogador com mais de 2 jogadores, clãs, PvP, trocas entre jogadores (o co-op a 2 é a Fase 15).
- Microtransações e moeda premium.
- Geração procedimental completa de mapas.
- Histórias/NPCs com diálogo extenso (talvez no futuro).
- iOS (possível mais tarde com o mesmo Capacitor).

---

## 15. Registo de decisões

| Data | Decisão | Motivo |
|---|---|---|
| (início) | Phaser + TS + Vite | Web-first, fácil port para Capacitor e Playables |
| (início) | Tiles 16 px, 480×270 | Aspeto Stardew, escala limpa (a resolução fixa foi substituída em 2026-09-24, ver abaixo) |
| (início) | Hordas desligadas por defeito | Dificuldade menor que o original |
| (início) | Save desde a Fase 2 | Evitar reescrever sistemas mais tarde |
| 2026-09-24 | **Phaser 4.2** em vez do 3 | O 4.0 saiu estável em 04/2026 e o 3.90 (05/2025) já não recebe desenvolvimento. API quase igual; ver armadilhas em §5.6 |
| 2026-09-24 | TypeScript 6.0 (não 7) | O typescript-eslint 8.x só suporta TS < 6.1 |
| 2026-09-24 | Escala inteira em píxeis do **dispositivo** (não CSS), com a posição alinhada | Píxeis exatos também com DPR fracionário (portáteis a 125%, Android 2,625) |
| 2026-09-24 | Overlay de debug em DOM, não no Phaser | Texto nítido a qualquer escala; funciona em todas as cenas; `?debug` para telemóveis |
| 2026-09-24 | Manifest com especificação do placeholder por chave; `file` opcional | Trocar arte = pôr ficheiro + `file` no manifest. Sem ficheiro (ou 404), usa-se o placeholder; o `validate-data` falha se um `file` não existir (distingue maiúsculas, como o GitHub Pages) |
| 2026-09-24 | Paleta própria de 32 cores em `src/assets/palette.json` (+ `palette.png` gerado) | Placeholders só com cores da paleta (letras binarizadas, sem antialias). Sem licenças de terceiros |
| 2026-09-24 | Scripts de dados em TypeScript corridos pelo Node (type stripping) | Sem `tsx`/`ts-node`; os módulos partilhados com `scripts/` não podem importar outros `.ts` em runtime |
| 2026-09-24 | Colisões próprias (`systems/movement`) em vez da física Arcade do Phaser | O movimento corre no passo fixo de 50 ms, sem Phaser, testável em Vitest e determinista. Caixa dos pés (10×6 px) contra tiles `collision` + footprints; eixo X depois Y (desliza nas paredes); o render interpola entre ticks |
| 2026-09-24 | Mapa da base gerado por script uma vez, depois editado no Tiled | Não há Tiled no ambiente do agente; o script descreve o layout em código e produz JSON do Tiled válido. Não reescreve sem `--force` |
| 2026-09-24 | Jogador como spritesheet 7×4 (parado, andar ×4, atacar ×2 por direção) com placeholder desenhado por código (`style: "character"`) | Animação visível desde já; trocar pela arte final = pôr o PNG com o mesmo layout e `file` no manifest |
| 2026-09-24 | Resolução interna adaptável (largura enche o ecrã, sem barras) com alvo de **270 px** de altura | O jogador experimentou 400 px (mais tiles, tudo mais pequeno) e preferiu o "zoom" de ~30×17 tiles. O alvo pode vir a ser uma definição ("tamanho", Fase 11) |
| 2026-09-24 | Canvas à resolução do dispositivo + zoom inteiro nas câmaras (em vez de canvas pequeno ampliado por CSS) | O texto ficava esbatido (desenhado a 8 px e ampliado). Agora é desenhado à resolução real; a pixel art continua exata porque tudo fica em posições inteiras |
| 2026-09-24 | Realismo com obstáculos livres (objetos de qualquer tamanho, fora da grelha) em vez de tiles mais pequenos | Uma grelha 2× mais fina obrigava a arte com o dobro dos píxeis (≈ 4× trabalho) ou deixava o boneco minúsculo |
| 2026-09-24 | Sprites de recursos/obstáculos em pixel art gerada por script (`npm run sprites`) | Os retângulos com letra não davam para avaliar o aspeto; continuam a ser placeholders (Fase 12), mas já com sombra, luz e contorno |
| 2026-09-24 | Zoom do jogador até metade, em níveis inteiros | Pedido do jogador (roda/pinça). Zoom fracionário deixaria píxeis irregulares; num ecrã ×3 o mínimo é ×2 |
| 2026-09-24 | Jogo também na vertical (alvo no lado curto) em vez do aviso "roda o ecrã" | Pedido do jogador: prefere jogar ao alto, mesmo vendo uma área diferente |
| 2026-09-24 | Ferramenta de recolha escolhida automaticamente (a melhor do tipo certo na mochila/hotbar) | Menos gestão de equipamento, mais simpático; o equipamento (arma/armadura) chega na Fase 6 |
| 2026-09-24 | Recursos só se partem se os drops couberem na mochila | "Nada se perde": com a mochila cheia aparece o aviso e o último golpe não acontece |
| 2026-09-24 | Poço da base dá de beber diretamente (`props.json` → `action: "drink"`) | Sem água potável até à Fase 7 (ferver), a sede seria uma armadilha logo no início |
| 2026-09-24 | Save v2: inventário, hotbar, baús, recursos apanhados por zona (id do objeto → tick de respawn), `world.rng` | Formato compacto (§10.5); migração v1 → v2 com teste |
| 2026-09-24 | Zoom no PC só com Ctrl + roda (preventDefault para o browser não ampliar a página) | Pedido do jogador; a roda sozinha fica livre |
| 2026-09-24 | Botão de velocidade x1/x2/x3 | Pedido do jogador: acelera todo o tempo de jogo (útil para testar e para esperas) |
| 2026-09-24 | Andar agachado com Shift / joystick pouco empurrado (pedido do jogador) | Antecipa a furtividade da Fase 6; spritesheet da personagem passa a 10 colunas (frames agachados) |
| 2026-09-24 | Estações da Fase 4 colocadas no mapa (acrescentadas ao `base.json` como edição, com ids novos) | Os ids dos objetos existentes não mudam, por isso os saves com recursos apanhados continuam certos |
| 2026-09-24 | O resultado dos crafts em estação fica na estação até ser recolhido | Como no original; o craft continua enquanto o jogador está fora e nada se perde se a mochila estiver cheia |
| 2026-09-24 | Save v3: `stations`; baú inicial de jogos novos com carne crua, água suja e trapos | Migração v2 → v3 com teste; os mantimentos permitem testar a fogueira antes de haver animais (Fase 6) |
| 2026-09-24 | Cópia de emergência síncrona (localStorage) ao esconder/fechar a página | Testado: ao recarregar, o Chrome corta a escrita assíncrona no IndexedDB e perdiam-se os últimos segundos |
| 2026-09-24 | Joystick virtual flutuante (só toque), 8 direções, zona morta 25% | Primeiro só na metade esquerda; o jogador preferiu poder tocar em qualquer lado (fora dos botões/hotbar), sem joystick parado no canto. O teclado tem prioridade |
| 2026-09-24 | Ficheiros de `public/` pedidos com `?v=<build>` (`versioned()` em config.ts) | O browser juntou JS novo com um manifest antigo em cache (GitHub Pages: 10 min) e o arranque falhou |
| 2026-09-24 | Slots ×2 (ícones 32 px) no painel da mochila/baú em ecrãs táteis, quando cabe | Pedido do jogador: no telemóvel ao alto os slots eram pequenos para os dedos |
| 2026-09-24 | Botão "Ordenar" na mochila e no baú; "×" de fechar desenhado em píxeis | Pedido do jogador. O glifo "×" da fonte não ficava centrado no botão |
| 2026-09-24 | Fase 5: peças numa grelha de 2 camadas (fundação + peça de cima), paredes de 1 tile inteiro com 8 px de altura desenhada (16×24) | Simples de colocar e de colidir; a vista 3/4 vem do sprite. Portas, janelas e vedações têm variante vertical (`_v`) |
| 2026-09-24 | Save v4: `base.structures` + `nextStructureId`; a fogueira e a bancada do mapa passam a peças por migração (com as filas) | Os jogadores antigos mantêm as estações; os jogos novos constroem-nas |
| 2026-09-24 | Pode-se construir onde um recurso foi apanhado (só reaparece com o sítio livre) | A base tem muitas árvores: sem isto não havia espaço para uma casa 6×6 |
| 2026-09-24 | Desfazer guardado só em memória (não no save) | A janela é de 10 s; perder o Desfazer ao recarregar não custa nada (continua a dar para demolir a 50%) |
| 2026-09-24 | Ctrl também agacha; atalhos do browser com Ctrl anulados no jogo; fechar com Ctrl premido pede confirmação | Pedido do jogador: Ctrl+WASD disparava atalhos do browser (guardar página, marcador, fechar separador) |
| 2026-09-24 | Fase 6: primeira zona (Pinhal) já agora, ligada à base pelas saídas `exit:<zona>` | A base é segura (sem inimigos): sem outra zona não havia onde combater. O mapa-mundo (Fase 7) fica entre as duas |
| 2026-09-24 | `BaseScene` → `ZoneScene` genérica ({ zoneId }); mapas de todas as zonas carregados no arranque | São pequenos (JSON); a mesma cena desenha qualquer zona e a construção só está disponível na base |
| 2026-09-24 | Inimigos não se gravam (nascem ao entrar na zona) | Save pequeno; recarregar a meio de um combate repõe os inimigos (sem vantagem real) |
| 2026-09-24 | Save v5: `player.equipment` (6 slots, ordem de `EQUIP_SLOTS`) e `zones.<zona>.bags` (mochilas no chão com hora de expirar) | Morte sem perder nada (§7.12); o equipamento fica ao morrer |
| 2026-09-24 | O ataque anunciado (windup) não é interrompido por golpes | Senão bastava bater sem parar; assim recuar no aviso é a jogada certa (como pede a aceitação) |
| 2026-09-24 | Fase 7: saídas `exit` abrem o mapa-mundo; viajar paga fome/sede à partida; voltar à zona de onde se saiu é grátis | Como no original; o tempo não corre no mapa-mundo |
| 2026-09-24 | Loot sorteado quando se abre o contentor (não ao entrar na zona) e guardado até voltar a encher | Save pequeno (só os contentores abertos) e o mesmo contentor não muda de conteúdo ao sair e voltar |
| 2026-09-24 | Save v6: `zones.<zona>.loot` | Migração v5 → v6 com teste |
| 2026-09-24 | Pesca: mini-jogo de 1 botão (marcador que vai e volta, zona verde aleatória); o botão de ação normal "puxa" | Funciona igual com teclado, rato e toque; sem cana, o cais serve para encher garrafas |
| 2026-09-24 | Desbloqueio das zonas por nível adiado para a Fase 8 | Ainda não há níveis: bloquear a Quinta (nível 2) e o Lago (nível 3) deixava-os inacessíveis |
| 2026-09-24 | Save v7: `player.level`, `player.xp`, `unlocks.recipes`; saves antigos começam no nível 3 | A Quinta (nível 2) e o Lago (nível 3), que já se podiam visitar, continuam abertos |
| 2026-09-24 | XP atribuída pela `Progression` a ouvir os eventos (recurso apanhado, inimigo derrotado, craft acabado, peça colocada, loot sorteado, peixe) | Os sistemas não precisam de saber da progressão; os valores vêm dos JSON e do balance |
| 2026-09-24 | "Subiste de nível!" não pausa o jogo e fecha sozinho | O jogo nunca pausa (inimigos continuam); um painel modal podia custar vidas |
| 2026-09-24 | Noite como RenderTexture escura com luzes "apagadas" (stamp com blend ERASE), em degraus | Pixel art (sem gradientes suaves), barato, e funciona com qualquer zoom |
| 2026-09-24 | Inchado explode ao fim de um atraso depois de morrer (`explode` em `enemies.json`) | O aviso a piscar dá tempo para fugir; a explosão só magoa o jogador (mais simples e previsível) |
| 2026-09-24 | Javali com carga (`charge`): aviso longo, corrida em linha reta na direção do jogador | Desviar-se para o lado é a jogada certa; sem perseguição teleguiada |
| 2026-09-24 | Fornalha (nível 9) funde minério em lingotes; ferramentas de ferro na bancada (nível 10) | Minério só na Floresta Profunda (nível 10), por isso o ferro marca a entrada no meio do jogo |
| 2026-09-24 | Fase 9 dividida em 9A (horta, coletor, armadilha de caça, filtro) e 9B (hordas) | Entregas mais pequenas, cada uma jogável |
| 2026-09-24 | Horta: 1 rega por plantação (não todos os dias) | Simples e sem castigo por não aparecer; a água continua a ser um custo |
| 2026-09-24 | Save v8: `base.crops` e `base.produce` (pelo uid da peça) | Migração v7 → v8 com teste; o início da produção pode ser negativo (o tempo offline recua-o) |
| 2026-09-24 | Sementes vêm de sacos na Quinta (e raramente do armário da aldeia) | Dá razão para voltar à Quinta; a colheita devolve sementes, por isso a horta sustenta-se |
| 2026-09-24 | Hordas só atacam com o jogador na base (esperam por ele) | "Justo, não punitivo": nunca se volta para uma base destruída sem ter tido hipótese de a defender |
| 2026-09-24 | Morrer durante a horda faz a horda ir-se embora (sem prémio) | Evita um ciclo de mortes ao reaparecer na base cercada |
| 2026-09-24 | Sem pathfinding: a horda vai a direito para o jogador e parte o que a bloqueia | Simples, previsível e dá sentido às paredes e às armadilhas no caminho |
| 2026-09-24 | Reparar com a ação contextual (a peça danificada passa a ser alvo) | Sem modo novo nem botões; custo de 25% como pede §7.13 |
| 2026-09-24 | Save v9: `settings.hordes`, `horde`, `base.damage`; interruptor das hordas no menu inicial | A definição vive no save (vai com o Exportar/Importar); ainda não há menu de pausa (Fase 11) |
| 2026-09-24 | Nova Fase 15: co-op online a 2 com código de 5 caracteres, único entre as sessões ativas | Pedido do jogador. Anfitrião autoritativo por WebRTC; os códigos são gerados e reservados pelo servidor de sinalização (única forma de garantir que não se repetem) |
| 2026-09-24 | Fase 10 dividida em partes (A: T3 + medicina; B: armas à distância; C: bunker; D: T4; E: eventos e moto) | É a maior fase; cada parte é jogável e publicada à parte |
| 2026-09-24 | Save v10: `player.bleed`; sem infeção | O sangramento dá uso às ligaduras e aos kits; a infeção era opcional e acrescentava gestão sem ganho |
