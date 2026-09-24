import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { eventBus } from '../core/EventBus';
import { gameState } from '../core/GameState';
import type { ContainerRef, PlayerActions, SlotRef } from '../core/PlayerActions';
import { BALANCE } from '../data/balance';
import { equipSlotOf } from '../data/types';
import { getView } from '../display/view';
import { itemName, t } from '../i18n';
import { content } from '../world/content';
import { Button, CLOSE_ICON } from './Button';
import { SLOT_GAP, SLOT_SIZE, SlotView, slotSize } from './SlotView';
import { Label } from './text';
import { uiState } from './uiState';

const DEPTH = { hud: 10, dim: 50, panel: 60, slots: 62, hotbar: 70, ghost: 100 } as const;
const PAD = 8;
const TITLE_H = 14;
const INFO_H = 34;
const INVENTORY_COLS = 5;
const CHEST_COLS = 6;
/** Distância (px de jogo) a partir da qual premir um slot passa a ser arrastar. */
const DRAG_THRESHOLD = 4;
/** Margem entre a hotbar e o fundo do ecrã. */
const HOTBAR_MARGIN = 6;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Slots de equipamento mostrados (arma, cabeça, corpo), ao lado da mochila. */
const EQUIP_SHOWN = 3;
const EQUIP_LABELS = ['inv.slot.weapon_short', 'inv.slot.head_short', 'inv.slot.body_short'] as const;

/** Grelha da mochila + coluna do equipamento à direita. */
function bagSize(scale: number): { w: number; h: number } {
  const grid = gridSize(BALANCE.inventorySlots, INVENTORY_COLS, scale);
  const size = slotSize(scale);
  const equip = EQUIP_SHOWN * size + (EQUIP_SHOWN - 1) * SLOT_GAP;
  return { w: grid.w + PAD + size, h: Math.max(grid.h, equip) };
}

function gridSize(slots: number, cols: number, scale: number): { w: number; h: number } {
  const rows = Math.ceil(slots / cols);
  const size = slotSize(scale);
  return { w: cols * size + (cols - 1) * SLOT_GAP, h: rows * size + (rows - 1) * SLOT_GAP };
}

interface PanelLayout {
  scale: number;
  bag: { w: number; h: number };
  chest: { w: number; h: number } | null;
  sideBySide: boolean;
  w: number;
  h: number;
}

/**
 * Hotbar (sempre visível) e painel da mochila/baú (CLAUDE.md §7.3). Tocar num slot seleciona-o
 * (Usar/Dividir); arrastar move entre mochila, hotbar e baú. Com o painel fechado, tocar na
 * hotbar (ou teclas 1–4) usa o item. Os toques chegam da UIScene (`pointerDown/Move/Up`).
 */
export class InventoryUI {
  private readonly scene: Phaser.Scene;
  private readonly actions: PlayerActions;
  private readonly hotbar: SlotView[] = [];
  private panelSlots: SlotView[] = [];
  private panelObjects: { destroy(): void }[] = [];
  private panelRect: Rect | null = null;
  /** Baú ou contentor com loot aberto ao lado da mochila. */
  private other: `chest:${string}` | `loot:${string}` | null = null;
  private selected: SlotRef | null = null;
  private press: { view: SlotView; x: number; y: number; pointerId: number; dragging: boolean } | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private readonly unsubscribe: (() => void)[];

  constructor(scene: Phaser.Scene, actions: PlayerActions) {
    this.scene = scene;
    this.actions = actions;
    const rect = this.hotbarRect();
    for (let i = 0; i < BALANCE.hotbarSlots; i++) {
      const touch = scene.sys.game.device.input.touch;
      this.hotbar.push(
        new SlotView(
          scene,
          rect.x + i * (SLOT_SIZE + SLOT_GAP),
          rect.y,
          { container: 'hotbar', index: i },
          touch ? null : String(i + 1),
        ).setDepth(DEPTH.hotbar),
      );
    }
    this.unsubscribe = [
      eventBus.on('inventory:changed', () => {
        this.refresh();
      }),
      eventBus.on('container:open', ({ container }) => {
        this.open(container);
      }),
      // Abrir uma estação fecha a mochila (só um painel de cada vez).
      eventBus.on('station:open', () => {
        if (this.isOpen) this.close();
      }),
    ];
    this.refresh();
  }

  get isOpen(): boolean {
    return this.panelRect !== null;
  }

  /** Retângulo da hotbar (centrada em baixo), para a UIScene posicionar o resto à volta. */
  hotbarRect(): Rect {
    const { width, height } = getView();
    const w = BALANCE.hotbarSlots * SLOT_SIZE + (BALANCE.hotbarSlots - 1) * SLOT_GAP;
    return { x: Math.round((width - w) / 2), y: height - SLOT_SIZE - HOTBAR_MARGIN, w, h: SLOT_SIZE };
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open(null);
  }

  open(other: `chest:${string}` | `loot:${string}` | null): void {
    this.other = other;
    this.selected = null;
    uiState.modalOpen = true;
    this.buildPanel();
  }

  close(): void {
    this.clearPanel();
    this.panelRect = null;
    this.other = null;
    this.selected = null;
    uiState.modalOpen = false;
    this.refresh();
  }

  /** Usa o item da hotbar `index` (teclas 1–4). */
  useHotbar(index: number): void {
    this.actions.use({ container: 'hotbar', index });
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    this.clearPanel();
    for (const view of this.hotbar) view.destroy();
    this.ghost?.destroy();
    uiState.modalOpen = false;
  }

  /** @returns true se o toque foi para a hotbar ou para o painel (não chega ao joystick/mundo). */
  pointerDown(x: number, y: number, pointerId: number): boolean {
    const view = this.slotAt(x, y);
    if (view) {
      this.press = { view, x, y, pointerId, dragging: false };
      return true;
    }
    const panel = this.panelRect;
    if (!panel) return false;
    // Com o painel aberto, tocar fora dele fecha-o.
    if (x < panel.x || y < panel.y || x >= panel.x + panel.w || y >= panel.y + panel.h) this.close();
    return true;
  }

  pointerMove(x: number, y: number, pointerId: number): void {
    const press = this.press;
    if (press?.pointerId !== pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD) return;
      const slot = this.actions.container(press.view.ref.container)[press.view.ref.index];
      const def = slot ? content.items[slot[0]] : undefined;
      if (!def) return;
      press.dragging = true;
      this.ghost = this.scene.add.image(0, 0, def.icon).setOrigin(0.5).setDepth(DEPTH.ghost).setAlpha(0.85);
    }
    this.ghost?.setPosition(Math.round(x), Math.round(y));
  }

  pointerUp(x: number, y: number, pointerId: number): boolean {
    const press = this.press;
    if (press?.pointerId !== pointerId) return false;
    this.press = null;
    if (press.dragging) {
      this.ghost?.destroy();
      this.ghost = null;
      const target = this.slotAt(x, y);
      if (target && target !== press.view) {
        if (!this.actions.move(press.view.ref, target.ref) && target.ref.container === 'equipment')
          this.scene.events.emit('ui:message', t('msg.equip_wrong'));
        this.selected = null;
        if (this.isOpen) this.buildPanel();
      }
      return true;
    }
    this.tap(press.view);
    return true;
  }

  private tap(view: SlotView): void {
    if (!this.isOpen && view.ref.container === 'hotbar') {
      this.actions.use(view.ref);
      return;
    }
    const same = this.selected?.container === view.ref.container && this.selected.index === view.ref.index;
    this.selected = same ? null : view.ref;
    if (this.isOpen) this.buildPanel();
    else this.refresh();
  }

  private slotAt(x: number, y: number): SlotView | null {
    return [...this.panelSlots, ...this.hotbar].find((view) => view.contains(x, y)) ?? null;
  }

  /** Atualiza o conteúdo dos slots desenhados (sem refazer o painel). */
  refresh(): void {
    if (!gameState.hasGame) return;
    const items = content.items;
    // Seleção de um slot que ficou vazio deixa de fazer sentido.
    if (this.selected && !this.actions.container(this.selected.container)[this.selected.index])
      this.selected = null;
    for (const view of [...this.hotbar, ...this.panelSlots]) {
      const slot = this.actions.container(view.ref.container)[view.ref.index] ?? null;
      const selected =
        this.selected?.container === view.ref.container && this.selected.index === view.ref.index;
      view.update(slot, items, selected);
    }
  }

  private clearPanel(): void {
    for (const obj of this.panelObjects) obj.destroy();
    for (const view of this.panelSlots) view.destroy();
    this.panelObjects = [];
    this.panelSlots = [];
  }

  /**
   * Tamanho do painel com os slots à escala `scale`: lado a lado se couber, senão (telemóvel ao
   * alto) um por cima do outro. null se não couber no espaço acima da hotbar.
   */
  private layout(scale: number): PanelLayout | null {
    const { width } = getView();
    const bag = bagSize(scale);
    const chest = this.otherGrid(scale);
    const sideBySide = chest !== null && bag.w + chest.w + PAD * 3 <= width - 8;
    const block = (g: { w: number; h: number }): { w: number; h: number } => ({ w: g.w, h: TITLE_H + g.h });
    const blocks = [block(bag), ...(chest ? [block(chest)] : [])];
    const contentW = sideBySide
      ? blocks.reduce((sum, b) => sum + b.w, 0) + PAD
      : Math.max(...blocks.map((b) => b.w));
    const contentH = sideBySide
      ? Math.max(...blocks.map((b) => b.h))
      : blocks.reduce((sum, b) => sum + b.h, 0) + PAD;
    const w = contentW + PAD * 2;
    const h = contentH + INFO_H + PAD * 2;
    if (w > width - 4 || h > this.hotbarRect().y - 8) return null;
    return { scale, bag, chest, sideBySide, w, h };
  }

  /** (Re)constrói o painel: fundo escurecido, grelhas, título e barra de informação. */
  private buildPanel(): void {
    this.clearPanel();
    const scene = this.scene;
    const { width, height } = getView();
    const hotbarTop = this.hotbarRect().y;
    // Nos ecrãs táteis, slots ×2 (mais fáceis de tocar) se couberem.
    const touch = scene.sys.game.device.input.touch;
    const layout = (touch ? this.layout(2) : null) ?? this.layout(1) ?? this.layoutFallback();
    const { scale, bag, chest, sideBySide, w, h } = layout;
    const size = slotSize(scale);
    const x = Math.round((width - w) / 2);
    const y = Math.max(4, Math.round((hotbarTop - 4 - h) / 2));
    this.panelRect = { x, y, w, h };

    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.panelObjects.push(obj);
      return obj;
    };
    add(scene.add.rectangle(0, 0, width, height, paletteNumber('ink'), 0.6).setOrigin(0).setDepth(DEPTH.dim));
    add(scene.add.rectangle(x, y, w, h, paletteNumber('bark_dark')).setOrigin(0).setDepth(DEPTH.panel));
    add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(DEPTH.panel),
    );

    const grid = (
      ref: ContainerRef,
      slots: number,
      cols: number,
      gx: number,
      gy: number,
      title: string,
    ): void => {
      const label = add(new Label(scene, gx, gy, title, { size: 8, bold: true, color: 'wheat' })).setDepth(
        DEPTH.slots,
      );
      // Ordenar: junta os itens iguais e agrupa por categoria.
      const sortWidth = 40;
      add(
        new Button(
          scene,
          gx + Math.ceil(label.text.width) + 6 + sortWidth / 2,
          gy + 5,
          t('inv.sort'),
          { width: sortWidth, height: 12, fontSize: 7, style: 'secondary' },
          () => {
            this.scene.time.delayedCall(0, () => {
              if (this.actions.sort(ref)) this.selected = null;
              if (this.isOpen) this.buildPanel();
            });
          },
        ),
      ).setDepth(DEPTH.slots);
      for (let i = 0; i < slots; i++) {
        const sx = gx + (i % cols) * (size + SLOT_GAP);
        const sy = gy + TITLE_H + Math.floor(i / cols) * (size + SLOT_GAP);
        this.panelSlots.push(
          new SlotView(scene, sx, sy, { container: ref, index: i }, null, scale).setDepth(DEPTH.slots),
        );
      }
    };
    const gx = x + PAD;
    const gy = y + PAD;
    grid('inventory', BALANCE.inventorySlots, INVENTORY_COLS, gx, gy, t('hud.bag'));
    // Equipamento: coluna à direita da mochila (arma, cabeça, corpo).
    for (let i = 0; i < EQUIP_SHOWN; i++) {
      this.panelSlots.push(
        new SlotView(
          scene,
          gx + bag.w - size,
          gy + TITLE_H + i * (size + SLOT_GAP),
          { container: 'equipment', index: i },
          t(EQUIP_LABELS[i] ?? 'inv.slot.weapon_short'),
          scale,
        ).setDepth(DEPTH.slots),
      );
    }
    const other = this.other;
    if (chest && other) {
      const cx = sideBySide ? gx + bag.w + PAD : gx;
      const cy = sideBySide ? gy : gy + TITLE_H + bag.h + PAD;
      const slots = this.actions.container(other).length;
      const title = t(other.startsWith('loot:') ? 'inv.container' : 'inv.chest');
      grid(other, slots, Math.min(CHEST_COLS, slots), cx, cy, title);
    }

    // Fechar (canto superior direito).
    add(
      new Button(
        scene,
        x + w - 10,
        y + 9,
        CLOSE_ICON,
        { width: 12, height: 12, fontSize: 9, style: 'secondary' },
        () => {
          this.scene.time.delayedCall(0, () => {
            this.close();
          });
        },
      ),
    ).setDepth(DEPTH.slots);

    this.buildInfo(x + PAD, y + h - PAD - INFO_H + 4, w - PAD * 2, add);
    this.refresh();
  }

  /** Ecrã demasiado pequeno para qualquer escala: usa ×1 mesmo que fique cortado. */
  private layoutFallback(): PanelLayout {
    const bag = bagSize(1);
    const chest = this.otherGrid(1);
    const h = TITLE_H + bag.h + (chest ? TITLE_H + chest.h + PAD : 0) + INFO_H + PAD * 2;
    return { scale: 1, bag, chest, sideBySide: false, w: Math.max(bag.w, chest?.w ?? 0) + PAD * 2, h };
  }

  /**
   * Refaz o painel no frame seguinte: os botões chamam isto a partir do próprio clique, e
   * destruí-los a meio do evento do Phaser não é seguro.
   */
  private rebuildSoon(): void {
    this.scene.time.delayedCall(0, () => {
      if (this.isOpen) this.buildPanel();
    });
  }

  /** Barra de baixo: item selecionado e ações (Usar, Dividir, Guardar semelhantes). */
  private buildInfo(
    x: number,
    y: number,
    w: number,
    add: <T extends { destroy(): void }>(obj: T) => T,
  ): void {
    const scene = this.scene;
    const small = { width: 60, height: 14, fontSize: 8, style: 'secondary' as const };
    const selected = this.selected;
    const slot = selected ? this.actions.container(selected.container)[selected.index] : null;
    const def = slot ? content.items[slot[0]] : undefined;

    if (slot && def && selected) {
      add(new Label(scene, x, y, itemName(slot[0]), { size: 8, bold: true, color: 'cream' })).setDepth(
        DEPTH.slots,
      );
      let bx = x + small.width / 2;
      const by = y + 20;
      if (def.type === 'consumable') {
        add(
          new Button(scene, bx, by, t('inv.use'), small, () => {
            this.actions.use(selected);
            this.rebuildSoon();
          }),
        ).setDepth(DEPTH.slots);
        bx += small.width + 4;
      }
      if (selected.container === 'equipment') {
        add(
          new Button(scene, bx, by, t('inv.unequip'), small, () => {
            if (!this.actions.unequip(selected.index))
              scene.events.emit('ui:message', t('msg.inventory_full'));
            this.selected = null;
            this.rebuildSoon();
          }),
        ).setDepth(DEPTH.slots);
        bx += small.width + 4;
      } else if (equipSlotOf(def)) {
        add(
          new Button(scene, bx, by, t('inv.equip'), small, () => {
            this.actions.equip(selected);
            this.selected = null;
            this.rebuildSoon();
          }),
        ).setDepth(DEPTH.slots);
        bx += small.width + 4;
      }
      if (slot[1] > 1) {
        add(
          new Button(scene, bx, by, t('inv.split'), small, () => {
            this.actions.split(selected);
            this.rebuildSoon();
          }),
        ).setDepth(DEPTH.slots);
      }
    } else {
      add(new Label(scene, x, y + 2, t('inv.hint'), { size: 7, color: 'stone_light', wrap: w })).setDepth(
        DEPTH.slots,
      );
    }

    const other = this.other;
    if (other?.startsWith('chest:')) {
      const bw = 96;
      add(
        new Button(scene, x + w - bw / 2, y + 20, t('inv.store_similar'), { ...small, width: bw }, () => {
          const moved = this.actions.storeSimilar(other);
          if (moved > 0) scene.events.emit('ui:message', t('msg.stored', { qty: moved }));
          this.rebuildSoon();
        }),
      ).setDepth(DEPTH.slots);
    } else if (other) {
      const bw = 80;
      add(
        new Button(
          scene,
          x + w - bw / 2,
          y + 20,
          t('inv.take_all'),
          { ...small, width: bw, style: 'primary' },
          () => {
            if (!this.actions.takeAll(other)) scene.events.emit('ui:message', t('msg.inventory_full'));
            this.selected = null;
            this.rebuildSoon();
          },
        ),
      ).setDepth(DEPTH.slots);
    }
  }

  /** Tamanho da grelha do baú/contentor aberto (null se não houver). */
  private otherGrid(scale: number): { w: number; h: number } | null {
    if (!this.other) return null;
    const slots = this.actions.container(this.other).length;
    return gridSize(slots, Math.min(CHEST_COLS, slots), scale);
  }
}
