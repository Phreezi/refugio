import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { secondsToTicks, TICKS_PER_SECOND } from '../core/Clock';
import { stationType } from '../core/Crafting';
import { eventBus } from '../core/EventBus';
import { gameState, stationState } from '../core/GameState';
import type { SlotRef } from '../core/PlayerActions';
import type { Simulation } from '../core/Simulation';
import { HANDS, RECIPE_CATEGORIES, type Recipe, type RecipeCategory } from '../data/types';
import { getView } from '../display/view';
import { itemName, t, tKey } from '../i18n';
import { describeItem } from './itemInfo';
import { missingInputs, outputCount } from '../systems/crafting/crafting';
import { countItem } from '../systems/inventory/inventory';
import { content } from '../world/content';
import { Button, CLOSE_ICON } from './Button';
import { Label } from './text';
import { REOPEN_GUARD_MS, uiState } from './uiState';

const DEPTH = { dim: 50, panel: 60, content: 62 } as const;
const PAD = 8;
const ROW_H = 30;
const TAB_H = 16;
/** Altura da linha de páginas (‹ 1/2 ›) quando a lista não cabe. */
const PAGER_H = 18;
const BAR_W = 70;
const MAX_WIDTH = 320;

type Tab = RecipeCategory | 'repair';

interface Destroyable {
  destroy(): void;
}

/** Barra de progresso de um trabalho na fila (atualizada em todos os frames). */
interface JobBar {
  index: number;
  fill: Phaser.GameObjects.Rectangle;
  time: Label;
}

/**
 * Painel de crafting (CLAUDE.md §7.5, Fase 4): mãos (C / botão) ou estação (ação junto dela).
 * Separadores por categoria, ingredientes em falta a vermelho, fila com barras de progresso,
 * recolher o que está pronto e, na bancada, reparar ferramentas.
 */
export class CraftingUI {
  private readonly scene: Phaser.Scene;
  private readonly sim: Simulation;
  private objects: Destroyable[] = [];
  /** Quando o painel fechou (ms): ver `REOPEN_GUARD_MS`. */
  private closedAt = -Infinity;
  private bars: JobBar[] = [];
  private rect: { x: number; y: number; w: number; h: number } | null = null;
  /** Estação aberta (`null` = mãos). */
  private station: string | null = null;
  private tab: Tab = 'tools';
  /** Filtro "Posso fazer": só as receitas desbloqueadas com todos os ingredientes. */
  private canMakeOnly = false;
  /** Página da lista (quando as receitas não cabem no ecrã) e quantas cabem por página. */
  private page = 0;
  private perPage = Number.POSITIVE_INFINITY;
  private readonly unsubscribe: (() => void)[];

  constructor(scene: Phaser.Scene, sim: Simulation) {
    this.scene = scene;
    this.sim = sim;
    this.unsubscribe = [
      eventBus.on('station:open', ({ stationKey }) => {
        this.open(stationKey);
      }),
      eventBus.on('container:open', () => {
        if (this.isOpen) this.close();
      }),
      eventBus.on('inventory:changed', () => {
        if (this.isOpen) this.rebuildSoon();
      }),
      eventBus.on('craft:finished', ({ stationKey, item }) => {
        if (stationKey !== HANDS) scene.events.emit('ui:message', t('craft.done', { item: itemName(item) }));
        if (this.isOpen) this.rebuildSoon();
      }),
    ];
  }

  get isOpen(): boolean {
    return this.rect !== null;
  }

  /** Abre as mãos (`null`) ou uma estação; ao abrir uma estação recolhe logo o que estiver pronto. */
  open(station: string | null): void {
    this.station = station;
    this.page = 0;
    const tabs = this.tabs();
    if (!tabs.includes(this.tab)) this.tab = tabs[0] ?? 'tools';
    if (station) this.sim.crafting.collect(station);
    uiState.modalOpen = true;
    this.build();
  }

  toggleHands(): void {
    if (this.isOpen) this.close();
    // O toque no botão que fecha o painel (toque "fora") não o volta a abrir.
    else if (performance.now() - this.closedAt > REOPEN_GUARD_MS) this.open(null);
  }

  close(): void {
    if (this.rect) this.closedAt = performance.now();
    this.clear();
    this.rect = null;
    uiState.modalOpen = false;
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    this.close();
  }

  /** @returns true se o toque ficou no painel (tocar fora fecha-o). */
  pointerDown(x: number, y: number): boolean {
    const r = this.rect;
    if (!r) return false;
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) this.close();
    return true;
  }

  /** Barras de progresso da fila (chamar em todos os frames). */
  update(): void {
    if (!this.station || this.bars.length === 0 || !gameState.hasGame) return;
    const queue = stationState(gameState.data, this.station).queue;
    for (const bar of this.bars) {
      const job = queue[bar.index];
      const recipe = job ? content.recipes.find((r) => r.id === job[0]) : undefined;
      if (!job || !recipe) continue;
      const total = secondsToTicks(recipe.timeSec);
      bar.fill.width = Math.max(1, Math.round((BAR_W * (total - job[1])) / total));
      bar.time.setText(t('craft.seconds', { s: Math.ceil(job[1] / TICKS_PER_SECOND) }));
    }
  }

  private tabs(): Tab[] {
    const type = this.station ? stationType(this.station) : HANDS;
    const recipes = this.sim.crafting.recipesFor(type);
    const tabs: Tab[] = RECIPE_CATEGORIES.filter((c) => recipes.some((r) => r.category === c));
    if (this.station && content.stations[type]?.repair) tabs.push('repair');
    return tabs;
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.bars = [];
  }

  /** Os botões chamam isto a partir do próprio clique: refazer só no frame seguinte. */
  private rebuildSoon(): void {
    this.scene.time.delayedCall(0, () => {
      if (this.isOpen) this.build();
    });
  }

  private add<T extends Destroyable>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private label(
    x: number,
    y: number,
    text: string,
    style: ConstructorParameters<typeof Label>[4],
    origin?: [number, number],
  ) {
    return this.add(new Label(this.scene, x, y, text, style, origin)).setDepth(DEPTH.content);
  }

  private button(x: number, y: number, text: string, width: number, onClick: () => void, primary = false) {
    const style = primary ? 'primary' : 'secondary';
    return this.add(
      new Button(this.scene, x, y, text, { width, height: 16, fontSize: 8, style }, () => {
        this.scene.time.delayedCall(0, onClick);
      }),
    ).setDepth(DEPTH.content);
  }

  private build(): void {
    this.clear();
    const scene = this.scene;
    const { width, height } = getView();
    const hotbarTop = height - 22 - 6;
    const type = this.station ? stationType(this.station) : HANDS;
    const w = Math.min(MAX_WIDTH, width - 8);
    const rows = this.tab === 'repair' ? this.repairables().length : this.recipes().length;
    const queueH = this.hasQueue() ? 22 + 3 * 18 + 22 : 0;
    const h = Math.min(hotbarTop - 8, PAD * 2 + 14 + TAB_H + 6 + Math.max(1, rows) * ROW_H + queueH);
    const x = Math.round((width - w) / 2);
    const y = Math.max(4, Math.round((hotbarTop - 4 - h) / 2));
    this.rect = { x, y, w, h };
    // Se não couberem todas, a lista divide-se em páginas (com ‹ › por baixo).
    const listSpace = h - (PAD * 2 + 14 + TAB_H + 6) - queueH;
    const fits = Math.max(1, Math.floor(listSpace / ROW_H));
    this.perPage = rows > fits ? Math.max(1, Math.floor((listSpace - PAGER_H) / ROW_H)) : fits;
    const pages = Math.max(1, Math.ceil(rows / this.perPage));
    this.page = Math.min(this.page, pages - 1);

    this.add(
      scene.add.rectangle(0, 0, width, height, paletteNumber('ink'), 0.6).setOrigin(0).setDepth(DEPTH.dim),
    );
    this.add(scene.add.rectangle(x, y, w, h, paletteNumber('bark_dark')).setOrigin(0).setDepth(DEPTH.panel));
    this.add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(DEPTH.panel),
    );

    const title = type === HANDS ? t('craft.hands') : tKey(`station.${type}`);
    this.label(x + PAD, y + PAD, title, { size: 9, bold: true, color: 'wheat' });
    this.button(x + w - 10, y + 9, CLOSE_ICON, 12, () => {
      this.close();
    });
    if (this.tab !== 'repair') {
      const filter = t('craft.filter');
      const fw = Math.max(52, filter.length * 5 + 12);
      this.button(
        x + w - 10 - 10 - fw / 2,
        y + 9,
        filter,
        fw,
        () => {
          this.canMakeOnly = !this.canMakeOnly;
          this.page = 0;
          this.build();
        },
        this.canMakeOnly,
      );
    }

    // Separadores.
    let tx = x + PAD;
    const ty = y + PAD + 14;
    for (const tab of this.tabs()) {
      const text = t(tab === 'repair' ? 'craft.cat.repair' : `craft.cat.${tab}`);
      const tw = Math.max(40, text.length * 5 + 10);
      this.button(
        tx + tw / 2,
        ty + TAB_H / 2,
        text,
        tw,
        () => {
          this.tab = tab;
          this.page = 0;
          this.build();
        },
        tab === this.tab,
      );
      tx += tw + 4;
    }

    const listY = ty + TAB_H + 6;
    if (this.tab === 'repair') this.buildRepair(x, listY, w);
    else this.buildRecipes(x, listY, w);
    if (pages > 1 && this.tab !== 'repair') {
      const py = listY + this.perPage * ROW_H + PAGER_H / 2;
      const cx = x + Math.round(w / 2);
      this.button(cx - 30, py, '‹', 20, () => {
        this.page = (this.page + pages - 1) % pages;
        this.build();
      });
      this.label(cx - 8, py - 5, `${String(this.page + 1)}/${String(pages)}`, { size: 8, color: 'cream' });
      this.button(cx + 30, py, '›', 20, () => {
        this.page = (this.page + 1) % pages;
        this.build();
      });
    }
    if (this.hasQueue()) this.buildQueue(x, y + h - queueH, w);
  }

  /** A estação tem fila (o comerciante não: as trocas são logo). */
  private hasQueue(): boolean {
    if (!this.station || this.tab === 'repair') return false;
    return content.stations[stationType(this.station)]?.trade !== true;
  }

  private recipes(): Recipe[] {
    const type = this.station ? stationType(this.station) : HANDS;
    const containers = this.sim.actions.pickupContainers();
    return this.sim.crafting
      .recipesFor(type)
      .filter((r) => r.category === this.tab)
      .filter(
        (r) =>
          !this.canMakeOnly ||
          (this.sim.progression.isRecipeUnlocked(r) && missingInputs(containers, r).length === 0),
      );
  }

  private buildRecipes(x: number, y: number, w: number): void {
    const containers = this.sim.actions.pickupContainers();
    if (this.canMakeOnly && this.recipes().length === 0)
      this.label(x + PAD, y + 4, t('craft.nothing_to_make'), { size: 8, color: 'stone_light' });
    const start = this.page * this.perPage;
    this.recipes()
      .slice(start, start + this.perPage)
      .forEach((recipe, i) => {
        const ry = y + i * ROW_H;
        const def = content.items[recipe.output];
        if (def)
          this.add(
            this.scene.add
              .image(x + PAD, ry + 2, def.icon)
              .setOrigin(0)
              .setDepth(DEPTH.content),
          );
        // Tocar no desenho ou no nome diz o que o item faz.
        const info = this.add(
          this.scene.add
            .rectangle(x + PAD, ry, w - PAD * 2 - 50, 11, 0x000000, 0.001)
            .setOrigin(0)
            .setDepth(DEPTH.content)
            .setInteractive({ useHandCursor: true }),
        );
        info.on('pointerup', () => {
          this.message([itemName(recipe.output), ...describeItem(recipe.output, def)].join('\n'));
        });
        const qty = recipe.qty > 1 ? ` ×${String(recipe.qty)}` : '';
        const time = recipe.timeSec > 0 ? ` · ${t('craft.seconds', { s: recipe.timeSec })}` : '';
        this.label(x + PAD + 20, ry + 1, `${itemName(recipe.output)}${qty}${time}`, {
          size: 8,
          bold: true,
          color: 'cream',
        });
        // Ingredientes: "tem/precisa nome", a vermelho se faltar.
        let ix = x + PAD + 20;
        for (const { item, qty: need } of recipe.inputs) {
          const have = countItem(containers, item);
          const text = `${String(Math.min(have, need))}/${String(need)} ${itemName(item)}`;
          const lbl = this.label(ix, ry + 12, text, { size: 7, color: have >= need ? 'lime' : 'red' });
          ix += lbl.text.width + 8;
        }
        const unlocked = this.sim.progression.isRecipeUnlocked(recipe);
        const ok = unlocked && missingInputs(containers, recipe).length === 0;
        this.button(
          x + w - PAD - 22,
          ry + 9,
          !unlocked
            ? t('craft.locked', { level: recipe.unlockLevel })
            : recipe.category === 'trade'
              ? t('craft.trade')
              : t('craft.make'),
          44,
          () => {
            const result = this.sim.crafting.craft(recipe.id, this.station);
            if (result === 'locked') this.message(t('craft.locked_msg', { level: recipe.unlockLevel }));
            else if (result === 'missing') this.message(t('craft.missing'));
            else if (result === 'no_space') this.message(t('msg.inventory_full'));
            else if (result === 'queue_full') {
              const max = content.stations[recipe.station]?.queue ?? 1;
              this.message(t('craft.queue_full', { max }));
            } else if (recipe.category === 'trade')
              this.message(t('craft.traded', { item: itemName(recipe.output) }));
            else if (recipe.station === HANDS)
              this.message(t('craft.crafted', { item: itemName(recipe.output) }));
            this.build();
          },
          ok,
        );
      });
  }

  private buildQueue(x: number, y: number, w: number): void {
    const key = this.station;
    if (!key) return;
    const station = stationState(gameState.data, key);
    this.add(
      this.scene.add
        .rectangle(x + PAD, y, w - PAD * 2, 1, paletteNumber('shadow'))
        .setOrigin(0)
        .setDepth(DEPTH.content),
    );
    this.label(x + PAD, y + 4, t('craft.queue'), { size: 8, bold: true, color: 'wheat' });
    const max = content.stations[stationType(key)]?.queue ?? 1;
    for (let i = 0; i < max; i++) {
      const jy = y + 20 + i * 18;
      const job = station.queue[i];
      if (!job) {
        this.add(
          this.scene.add
            .rectangle(x + PAD, jy + 7, 12, 2, paletteNumber('shadow'))
            .setOrigin(0)
            .setDepth(DEPTH.content),
        );
        continue;
      }
      const recipe = content.recipes.find((r) => r.id === job[0]);
      const def = recipe ? content.items[recipe.output] : undefined;
      if (def)
        this.add(
          this.scene.add
            .image(x + PAD, jy, def.icon)
            .setOrigin(0)
            .setDepth(DEPTH.content),
        );
      this.label(x + PAD + 20, jy + 3, recipe ? itemName(recipe.output) : job[0], {
        size: 7,
        color: 'cream',
      });
      const bx = x + w - PAD - 30 - BAR_W - 30;
      this.add(
        this.scene.add
          .rectangle(bx, jy + 6, BAR_W, 4, paletteNumber('ink'))
          .setOrigin(0)
          .setDepth(DEPTH.content),
      );
      const fill = this.add(
        this.scene.add
          .rectangle(bx, jy + 6, 1, 4, paletteNumber('amber'))
          .setOrigin(0)
          .setDepth(DEPTH.content),
      );
      const time = this.label(bx + BAR_W + 4, jy + 3, '', { size: 7, color: 'stone_light' });
      this.bars.push({ index: i, fill, time });
      this.button(x + w - PAD - 8, jy + 8, CLOSE_ICON, 14, () => {
        if (!this.sim.crafting.cancel(key, i)) this.message(t('msg.inventory_full'));
        this.build();
      });
    }
    const ready = outputCount(station);
    if (ready > 0) {
      this.button(
        x + w / 2,
        y + 20 + max * 18 + 6,
        t('craft.collect', { qty: ready }),
        90,
        () => {
          if (this.sim.crafting.collect(key) === 0) this.message(t('msg.inventory_full'));
          this.build();
        },
        true,
      );
    }
    this.update();
  }

  /** Ferramentas/armas com desgaste, na hotbar e na mochila. */
  private repairables(): SlotRef[] {
    const refs: SlotRef[] = [];
    for (const container of ['hotbar', 'inventory'] as const) {
      this.sim.actions.container(container).forEach((_slot, index) => {
        const ref = { container, index };
        if (this.sim.crafting.repairCostOf(ref)) refs.push(ref);
      });
    }
    return refs;
  }

  private buildRepair(x: number, y: number, w: number): void {
    const refs = this.repairables();
    if (refs.length === 0) {
      this.label(x + PAD, y + 4, t('craft.nothing_to_repair'), { size: 8, color: 'stone_light' });
      return;
    }
    const containers = this.sim.actions.pickupContainers();
    refs.forEach((ref, i) => {
      const ry = y + i * ROW_H;
      const slot = this.sim.actions.container(ref.container)[ref.index];
      const def = slot ? content.items[slot[0]] : undefined;
      const cost = this.sim.crafting.repairCostOf(ref) ?? [];
      if (!slot || !def) return;
      this.add(
        this.scene.add
          .image(x + PAD, ry + 2, def.icon)
          .setOrigin(0)
          .setDepth(DEPTH.content),
      );
      const pct = Math.round((100 * (slot[2] ?? 0)) / (def.durability ?? 1));
      this.label(x + PAD + 20, ry + 1, `${itemName(slot[0])} · ${String(pct)}%`, {
        size: 8,
        bold: true,
        color: 'cream',
      });
      let ix = x + PAD + 20;
      let ok = true;
      for (const { item, qty } of cost) {
        const have = countItem(containers, item);
        ok &&= have >= qty;
        const lbl = this.label(
          ix,
          ry + 12,
          `${String(Math.min(have, qty))}/${String(qty)} ${itemName(item)}`,
          {
            size: 7,
            color: have >= qty ? 'lime' : 'red',
          },
        );
        ix += lbl.text.width + 8;
      }
      this.button(
        x + w - PAD - 22,
        ry + 9,
        t('craft.repair'),
        44,
        () => {
          if (!this.sim.crafting.repair(ref)) this.message(t('craft.missing'));
          this.build();
        },
        ok,
      );
    });
  }

  private message(text: string): void {
    this.scene.events.emit('ui:message', text);
  }
}
