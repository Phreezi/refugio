# CLAUDE.md — Projeto "Refúgio" (nome de código)

> Jogo de sobrevivência top-down em pixel art, inspirado na jogabilidade de *Last Day on Earth: Survival* (LDoE), com estética próxima de *Stardew Valley*, dificuldade mais baixa e **apenas single player**.
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
| Modo | Single player, offline |
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
| Multijogador / clãs | **Não** (fora do âmbito) | — |

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
  - Com zoom na câmara o Phaser **não arredonda** posições: tudo o que se desenha tem de estar em coordenadas **inteiras** de jogo (o jogador interpolado é arredondado em `BaseScene`).
  - **Nenhuma cena pode assumir um tamanho fixo**: usar `getView()` (não `this.scale.width`, que está em píxeis do dispositivo) e reagir a `Phaser.Scale.Events.RESIZE` (removendo o listener no SHUTDOWN). Ponteiros: converter com `camera.getWorldPoint`.
- **Zoom do jogador** (`src/display/worldZoom.ts`): o zoom da vista é o máximo; pode afastar-se até metade, em níveis inteiros (×4 → ×3 → ×2; ×3 → ×2) para a pixel art continuar exata. Roda do rato ou +/− no PC, pinça com 2 dedos no telemóvel (UIScene). Guardado no localStorage (`refugio.zoomOut`). Só a câmara do mundo muda; o HUD mantém o tamanho. Se se vê mais do que o mapa, este fica centrado.
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
│   │   ├── BaseScene.ts      # a base do jogador
│   │   ├── ZoneScene.ts      # qualquer zona explorável (recebe zoneId)
│   │   ├── WorldMapScene.ts  # mapa-mundo
│   │   └── UIScene.ts        # HUD por cima (corre em paralelo)
│   ├── core/
│   │   ├── GameState.ts      # estado global serializável (fonte de verdade)
│   │   ├── EventBus.ts
│   │   ├── FixedStep.ts      # acumulador de passo fixo (50 ms)
│   │   ├── Simulation.ts     # corre os ticks de lógica (sistemas entram aqui)
│   │   ├── Clock.ts          # tempo de jogo, dia/noite
│   │   └── Rng.ts            # RNG com seed
│   ├── systems/              # lógica pura, SEM dependências do Phaser sempre que possível
│   │   ├── movement/         # CollisionWorld, movimento com deslize, direção do sprite
│   │   ├── survival/         # fome, sede, vida
│   │   ├── inventory/
│   │   ├── crafting/
│   │   ├── building/
│   │   ├── combat/
│   │   ├── loot/
│   │   ├── ai/
│   │   ├── progression/
│   │   └── travel/
│   ├── entities/             # Player, Zombie, ResourceNode, Container, Structure
│   ├── ui/                   # Label (texto nítido), Button, fileTransfer (exportar/importar), fatalError
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
│   │   ├── resources.json    # nós de recurso (Fase 1: sprite + footprint)
│   │   ├── props.json        # obstáculos/decoração livres no mapa (sprite + footprint)
│   │   ├── items.json
│   │   ├── recipes.json
│   │   ├── structures.json
│   │   ├── enemies.json
│   │   ├── zones.json
│   │   ├── lootTables.json
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
| Jogador | 4 direções × (parado, andar 4 frames, atacar 2 frames) | 16×32 |
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
- Nível do jogador (XP por recolher, craftar, matar) → desbloqueia receitas. Nível máximo v1: 30.
- Movimento 8 direções. Velocidade base 80 px/s; mais lento com inventário > 90% cheio (opcional).

### 7.2 Controlos

| Ação | Teclado/rato | Touch |
|---|---|---|
| Mover | WASD / setas | Joystick virtual (lado esquerdo) |
| Ação contextual (bater, recolher, abrir, atacar) | Espaço / clique | Botão grande (lado direito) |
| Inventário | I / Tab | Botão mochila |
| Craft | C | Botão martelo |
| Modo construção | B | Botão planta (só na base) |
| Comer/beber rápido | 1–4 (hotbar) | Hotbar de 4 slots |

A **ação contextual** escolhe automaticamente o alvo mais próximo em frente (como no original): zombie > contentor > recurso.

### 7.3 Inventário

- Grelha de slots. Base 20; mochila pequena +10; mochila grande +20.
- Stacks: recursos 50, consumíveis 10, munições 100, ferramentas/armas 1.
- Slots de equipamento: arma, cabeça, corpo, pernas, pés, mochila.
- Baús na base: 24 slots cada, sem limite de baús (limitado por recursos).
- Ações: mover, dividir stack, largar, usar, "guardar tudo semelhante" no baú (qualidade de vida).

### 7.4 Recolha

| Recurso | Ferramenta | Golpes (mão / ferramenta) | Drop |
|---|---|---|---|
| Árvore pequena | mão ou machado | 6 / 3 | 2–3 madeira |
| Árvore grande | machado | — / 5 | 4–6 madeira |
| Pedra | mão ou picareta | 6 / 3 | 2–3 pedra |
| Arbusto de bagas | mão | 1 | 2–4 bagas |
| Erva alta | mão | 1 | 1–2 fibra |
| Filão de ferro | picareta | — / 5 | 2–3 minério de ferro |
| Água (lago) | garrafa vazia | 1 | água suja |

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

- A base é um mapa fixo com uma área construível em grelha de 16×16.
- Peças: fundação (madeira → pedra → metal), parede, porta, janela, vedação.
- Colocação: pré-visualização verde/vermelha, rodar, desfazer nos últimos 10 s com reembolso total.
- Demolir devolve 50% dos materiais.
- Estruturas **não decaem**.
- Estações e baús só podem ser colocados sobre fundação.

### 7.8 Combate

- **Corpo a corpo**: cada arma tem dano, velocidade, alcance, durabilidade.
- **Distância** (Fase 10): pistola/besta com munição; mira automática ao inimigo mais próximo.
- Inimigos **telegrafam** ataques (0,4 s de aviso com piscar) — dá para recuar.
- Furtividade simples: andar devagar (segurar Shift / joystick parcial) reduz raio de deteção para metade.
- Armadura reduz dano em percentagem (máx. 60%).

### 7.9 Inimigos

| ID | Nome (provisório) | Vida | Dano | Velocidade | Notas |
|---|---|---|---|---|---|
| zombie_walker | Arrastado | 40 | 6 | 40 px/s | Básico, em grupos de 1–3 |
| zombie_runner | Corredor | 30 | 5 | 90 px/s | Aparece a partir de T2 |
| zombie_bloated | Inchado | 60 | 12 (área) | 30 px/s | Explode ao morrer; aviso claro |
| zombie_tank | Brutamontes | 250 | 20 | 35 px/s | T3+, ataque lento e telegrafado |
| zombie_screamer | Gritador | 35 | 0 | 50 px/s | Chama outros zombies; T3+ |
| wolf | Lobo | 45 | 8 | 100 px/s | Animal, T2 florestas |
| boar | Javali | 70 | 10 | carga | Dá carne e couro |
| deer | Veado | 30 | 0 | foge | Presa pacífica |
| boss_* | Chefes de bunker | — | — | — | Fase 10 |

IA: estados `idle → wander → chase → attack → return`. Perdem o interesse fora de um raio (leash) para não perseguirem pelo mapa todo.

### 7.10 Loot

- Contentores com tabela de loot (`lootTables.json`): pesos, quantidades min/max, raridade.
- Raridades: comum, incomum, raro, épico (cores standard).
- Respawn de contentores e recursos por zona (tempo de jogo).
- "Pity" simples: um contentor raro garante pelo menos 1 item incomum.

### 7.11 Dia e noite

- Ciclo de 20 min reais. Noite = 25% do ciclo.
- À noite: mais zombies nas zonas, visão reduzida (overlay escuro + luz à volta do jogador/tochas).
- Na base: fogueiras e tochas iluminam; sem ataques à noite a menos que "Hordas" esteja ativo.

### 7.12 Morte

- Reaparece na base com vida 50%, fome/sede 50%.
- Conteúdo da **mochila** fica numa mochila caída no local da morte (marcada no mapa-mundo).
- Itens **equipados** e hotbar mantêm-se.
- Nunca se perde nada guardado na base.

### 7.13 Hordas (raids opcionais, Fase 9)

- Desligado por defeito. Se ligado: a cada 3 dias de jogo, uma horda ataca a base.
- Aviso com 1 dia de antecedência.
- Recompensa: caixa de horda com loot raro. Paredes danificadas reparam-se com 25% do custo.

---

## 8. Mapas e zonas

### 8.1 Mapa-mundo

- Ecrã próprio (`WorldMapScene`) com a base ao centro e zonas à volta.
- Viajar custa comida e água proporcional à distância (valores baixos). A zona mais próxima é gratuita.
- Zonas bloqueadas mostram cadeado + requisito (nível do jogador ou item, ex.: "precisa de mapa da estrada").
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
- Camada `objects` contém pontos de spawn: `player_spawn`, `exit`, `resource:<id>`, `prop:<id>`, `container:<lootTableId>`, `enemy_spawn:<groupId>`.
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

- [ ] `items.json` com ~25 itens iniciais e validação no arranque.
- [ ] Sistema de inventário puro (adicionar, remover, stack, dividir, mover) com testes.
- [ ] UI de inventário (arrastar e largar; toque longo em mobile) e hotbar de 4 slots.
- [ ] Nós de recurso (árvore, pedra, arbusto, erva) com vida, feedback de golpe e drops.
- [ ] Ação contextual automática sobre o alvo mais próximo.
- [ ] Consumir itens (comer bagas, beber água).
- [ ] Baú na base (colocado manualmente no mapa por agora).

**Aceitação:** o jogador corta árvores, apanha bagas, come, e guarda coisas num baú; tudo sobrevive a um reload.

---

### Fase 4 — Crafting (≈ 2 semanas)

**Objetivo:** transformar recursos em ferramentas e comida.

- [ ] `recipes.json` e sistema de crafting puro (verificar ingredientes, consumir, produzir) com testes.
- [ ] Craft nas mãos (instantâneo) e em estações (com tempo e fila).
- [ ] Estações iniciais: fogueira, bancada de madeira.
- [ ] Ferramentas com durabilidade e bónus de recolha; reparação na bancada.
- [ ] UI de crafting: separadores por categoria, ingredientes em falta a vermelho, barra de progresso.
- [ ] Timers de craft a avançar offline (máx. 8 h).

**Aceitação:** cadeia completa madeira → machado de pedra → cortar mais rápido → tábuas na bancada → carne cozinhada na fogueira.

---

### Fase 5 — Construção da base (≈ 2–3 semanas)

**Objetivo:** construir a casa.

- [ ] `structures.json` (fundação, parede, porta, janela, vedação; tiers madeira/pedra).
- [ ] Modo construção: grelha, pré-visualização verde/vermelha, rotação, custo visível.
- [ ] Regras: estações e baús só em fundação; portas abrem/fecham; colisão atualizada.
- [ ] Desfazer (10 s, reembolso total) e demolir (50%).
- [ ] Estações de crafting passam a ser estruturas construídas.
- [ ] Guardar estruturas no save de forma compacta.

**Aceitação:** constrói-se uma casa 6×6 fechada com porta, baús, fogueira e bancada, e tudo reaparece após reload.

---

### Fase 6 — Combate e inimigos (≈ 2–3 semanas)

**Objetivo:** perigo real mas justo.

- [ ] `enemies.json`; entidades zombie_walker e zombie_runner, animais (veado, lobo).
- [ ] IA com máquina de estados (idle, wander, chase, attack, return) e leash.
- [ ] Combate corpo a corpo: dano, knockback, i-frames curtos, números de dano.
- [ ] Ataques inimigos telegrafados.
- [ ] Armas: moca, moca com pregos, machete.
- [ ] Armadura básica de tecido.
- [ ] Morte → mochila caída + respawn na base (ver 7.12).
- [ ] Drops de inimigos (carne, couro, trapos).

**Aceitação:** um jogador equipado com moca vence 3 walkers sem morrer se recuar entre ataques; ao morrer, recupera a mochila.

---

### Fase 7 — Mapa-mundo e primeiras zonas (≈ 3 semanas)

**Objetivo:** o core loop completo.

- [ ] `WorldMapScene` com base, zonas, estado de cada uma e custo de viagem.
- [ ] `ZoneScene` genérica que carrega qualquer zona a partir de `zones.json`.
- [ ] Zonas: **Pinhal**, **Quinta Abandonada**, **Margem do Lago**.
- [ ] Contentores com tabelas de loot e raridade.
- [ ] Respawn de recursos/contentores por zona (tempo de jogo).
- [ ] Transição suave entre zonas (fade) com save automático.
- [ ] Pesca simples no lago (mini-jogo de 1 botão).
- [ ] Água suja → ferver na fogueira → água limpa.

**Aceitação:** sair da base, ir ao Pinhal, lootear, voltar, craftar algo novo com o que se trouxe — tudo em menos de 10 minutos, com save em todas as transições.

---

### Fase 8 — Dia/noite, progressão e desbloqueios (≈ 2 semanas)

**Objetivo:** razão para continuar a jogar.

- [ ] Ciclo dia/noite com iluminação (overlay + luzes).
- [ ] Mais inimigos à noite; tochas e fogueiras iluminam.
- [ ] XP e níveis; receitas e zonas desbloqueadas por nível.
- [ ] Ecrã "Subiste de nível!" com lista do que desbloqueou.
- [ ] Notas/receitas encontradas em loot (desbloqueio alternativo).
- [ ] Zonas T2: **Estrada e Bomba de Gasolina**, **Aldeia Deserta**, **Floresta Profunda**.
- [ ] Novos inimigos: bloated, lobos, javalis.
- [ ] Fornalha, ferro, ferramentas de ferro, tier de pedra nas estruturas.

**Aceitação:** um jogador novo atinge o nível 10 em ~3 h de jogo, com sensação de progresso constante (testar com 2–3 pessoas).

---

### Fase 9 — Base avançada e Hordas opcionais (≈ 2 semanas)

**Objetivo:** dar valor à base.

- [ ] Horta: plantar sementes da Quinta, regar com água, colher (ciclos em dias de jogo).
- [ ] Coletor de água da chuva.
- [ ] Armadilhas de caça simples.
- [ ] Hordas opcionais (desligadas por defeito) com aviso e recompensa.
- [ ] Durabilidade de estruturas **apenas** em hordas; reparação barata.
- [ ] Qualidade de vida: "guardar tudo semelhante", ordenar baús, filtros.

**Aceitação:** com hordas ligadas, uma base de pedra com 2 armadilhas aguenta uma horda de 8 zombies sem intervenção perfeita do jogador.

---

### Fase 10 — Conteúdo intermédio e endgame (≈ 4–6 semanas)

**Objetivo:** objetivos de longo prazo.

- [ ] Zonas T3: **Zona Industrial**, **Hospital de Campanha**.
- [ ] Inimigos: tank, screamer.
- [ ] Armas à distância (besta, pistola) e munição craftável.
- [ ] **Bunker**: 4 pisos, checkpoint por piso, chefe final, chave obtida em quest simples.
- [ ] Zona T4: **Base Militar** (cartão de acesso), depois **Cidade em Ruínas**.
- [ ] Zonas-evento: queda de avião, comboio, acampamento com comerciante (troca).
- [ ] Veículo (moto): craft em várias peças, reduz custo de viagem.
- [ ] Medicina: ligaduras, kits, estado "sangrar"/"infeção" leve (opcional, com cura fácil).

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

- Multijogador, clãs, trocas entre jogadores.
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
| 2026-09-24 | Cópia de emergência síncrona (localStorage) ao esconder/fechar a página | Testado: ao recarregar, o Chrome corta a escrita assíncrona no IndexedDB e perdiam-se os últimos segundos |
| 2026-09-24 | Joystick virtual flutuante na metade esquerda (só toque), 8 direções, zona morta 25% | Metade direita fica livre para o botão de ação (Fase 3). O teclado tem prioridade sobre o joystick |
