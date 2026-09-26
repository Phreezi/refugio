import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { eventBus, type OtherContainerRef } from '../core/EventBus';
import { gameState } from '../core/GameState';
import type { ContainerRef, PlayerActions, SlotRef } from '../core/PlayerActions';
import { simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import { EQUIP_SLOTS, equipSlotOf } from '../data/types';
import { getView } from '../display/view';
import { itemName, t } from '../i18n';
import { content } from '../world/content';
import { Button, CLOSE_ICON, type ButtonStyle } from './Button';
import { SLOT_GAP, SLOT_SIZE, SlotView, slotSize } from './SlotView';
import { describeItem } from './itemInfo';
import { enchantOf } from '../systems/inventory/inventory';
import { Label, measureTextWidth } from './text';
import { panelTop, REOPEN_GUARD_MS, uiState } from './uiState';

const DEPTH = { hud: 10, dim: 50, panel: 60, slots: 62, hotbar: 70, ghost: 100 } as const;
const PAD = 8;
const TITLE_H = 14;
const INFO_H = 64;
/** Tempo para confirmar "Destruir" (segundo toque). */
const DESTROY_CONFIRM_MS = 3000;
/** Botões da barra de baixo, abaixo do nome e da descrição. */
const INFO_BUTTONS_DY = 38;
const INVENTORY_COLS = 5;
const CHEST_COLS = 6;
/** Distância (px de jogo) a partir da qual premir um slot passa a ser arrastar. */
const DRAG_THRESHOLD = 4;
/** Margem entre a hotbar e o fundo do ecrã. */
const HOTBAR_MARGIN = 6;
/** Espaço entre a hotbar e o slot da arma. */
const WEAPON_SLOT_GAP = 4;
/** Espaço livre entre o painel e a hotbar (o botão Construir fica por cima dela). */
const PANEL_ABOVE_HOTBAR = 28;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Slots de equipamento mostrados (arma, cabeça, corpo, mochila), ao lado da mochila. */
const EQUIP_SHOWN = [
  { index: EQUIP_SLOTS.indexOf('weapon'), label: 'inv.slot.weapon_short' },
  { index: EQUIP_SLOTS.indexOf('head'), label: 'inv.slot.head_short' },
  { index: EQUIP_SLOTS.indexOf('body'), label: 'inv.slot.body_short' },
  { index: EQUIP_SLOTS.indexOf('backpack'), label: 'inv.slot.backpack_short' },
] as const;
/** Linhas da coluna do equipamento. */
const EQUIP_ROWS = EQUIP_SHOWN.length;
const WEAPON_INDEX = EQUIP_SLOTS.indexOf('weapon');
/** Com uma mochila grande, a grelha pode alargar até estas colunas para caber no ecrã. */
const INVENTORY_MAX_COLS = 10;

/** Grelha da mochila (`cols` colunas) + coluna do equipamento à direita. */
function bagSize(slots: number, cols: number, scale: number): { w: number; h: number } {
  const grid = gridSize(slots, cols, scale);
  const size = slotSize(scale);
  const equip = EQUIP_ROWS * size + (EQUIP_ROWS - 1) * SLOT_GAP;
  return { w: grid.w + PAD + size, h: Math.max(grid.h, equip) };
}

function gridSize(slots: number, cols: number, scale: number): { w: number; h: number } {
  const rows = Math.ceil(slots / cols);
  const size = slotSize(scale);
  return { w: cols * size + (cols - 1) * SLOT_GAP, h: rows * size + (rows - 1) * SLOT_GAP };
}

interface PanelLayout {
  scale: number;
  /** Colunas da grelha da mochila. */
  cols: number;
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
  /** Quando o painel fechou (ms): ver `REOPEN_GUARD_MS`. */
  private closedAt = -Infinity;
  private panelSlots: SlotView[] = [];
  private panelObjects: { destroy(): void }[] = [];
  private panelRect: Rect | null = null;
  /** Espaços da mochila quando o painel foi desenhado. */
  private builtSlots = 0;
  /** Baú ou contentor com loot aberto ao lado da mochila. */
  private other: OtherContainerRef | null = null;
  /** Destruir pede um segundo toque: o slot à espera de confirmação e até quando (ms). */
  private confirmDestroy: { ref: SlotRef; until: number } | null = null;
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
    // 5.º slot, só para a arma (o slot "Arma" do equipamento), com outra cor.
    this.hotbar.push(
      new SlotView(
        scene,
        rect.x + rect.w - SLOT_SIZE,
        rect.y,
        { container: 'equipment', index: EQUIP_SLOTS.indexOf('weapon') },
        null,
      )
        .setAccent('bark_dark')
        .setDepth(DEPTH.hotbar),
    );
    this.unsubscribe = [
      eventBus.on('inventory:changed', () => {
        // A mochila mudou de tamanho (equipou ou tirou uma mochila): refaz o painel.
        if (this.isOpen && this.inventorySlots !== this.builtSlots) this.rebuildSoon();
        else this.refresh();
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

  /** Espaços da mochila agora (base + mochila equipada). */
  private get inventorySlots(): number {
    return gameState.data.player.inventory.length;
  }

  get isOpen(): boolean {
    return this.panelRect !== null;
  }

  /** Até onde pode descer o painel: acima da hotbar e dos botões Fabricar/Construir. */
  private panelBottom(): number {
    return this.hotbarRect().y - PANEL_ABOVE_HOTBAR;
  }

  /** Retângulo da hotbar (centrada em baixo), para a UIScene posicionar o resto à volta. */
  hotbarRect(): Rect {
    const { width, height } = getView();
    // Os slots da hotbar e, depois de um espaço, o slot da arma.
    const w = (BALANCE.hotbarSlots + 1) * SLOT_SIZE + BALANCE.hotbarSlots * SLOT_GAP + WEAPON_SLOT_GAP;
    return { x: Math.round((width - w) / 2), y: height - SLOT_SIZE - HOTBAR_MARGIN, w, h: SLOT_SIZE };
  }

  toggle(): void {
    if (this.isOpen) this.close();
    // O toque no botão que fecha o painel (toque "fora") não o volta a abrir.
    else if (performance.now() - this.closedAt > REOPEN_GUARD_MS) this.open(null);
  }

  open(other: OtherContainerRef | null): void {
    this.other = other;
    this.selected = null;
    uiState.modalOpen = true;
    this.buildPanel();
  }

  close(): void {
    if (this.panelRect) this.closedAt = performance.now();
    this.clearPanel();
    this.panelRect = null;
    this.other = null;
    this.selected = null;
    uiState.modalOpen = false;
    this.refresh();
  }

  /**
   * "Apanhar tudo" do contentor/pilha aberto (botão, ou Espaço outra vez: abrir e apanhar).
   * @returns false se não houver nada aberto de onde apanhar (baús não contam).
   */
  takeAll(): boolean {
    const other = this.other;
    if (!this.isOpen || !other || other.startsWith('chest:')) return false;
    if (!this.actions.takeAll(other)) this.scene.events.emit('ui:message', t('msg.inventory_full'));
    this.selected = null;
    this.rebuildSoon();
    return true;
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
      const rect = this.panelRect;
      const outside =
        rect !== null && (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h);
      // Arrastar para fora do painel larga o item no chão.
      if (!target && outside && ['inventory', 'hotbar', 'equipment'].includes(press.view.ref.container)) {
        this.actions.drop(press.view.ref);
        this.selected = null;
        if (this.isOpen) this.buildPanel();
        return true;
      }
      if (target && target !== press.view) {
        const source = this.actions.container(press.view.ref.container)[press.view.ref.index];
        // Nível a menos: a mensagem vem do próprio aviso (action:blocked).
        const levelProblem = this.actions.levelNeeded(source?.[0]) !== null;
        if (
          !this.actions.move(press.view.ref, target.ref) &&
          target.ref.container === 'equipment' &&
          !levelProblem
        )
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
    // Slot da arma (painel fechado): passa à munição seguinte da aljava.
    if (!this.isOpen && view.ref.container === 'equipment') {
      simulation.combat.cycleAmmo();
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
    // Aljava (§7.8): a munição da arma à distância vê-se como um número no canto do slot da
    // arma, no painel (a hotbar já a mostra por cima do slot da arma).
    const ranged = items[gameState.data.player.equipment[WEAPON_INDEX]?.[0] ?? '']?.ranged;
    const ammo = ranged ? simulation.combat.ammoCount() : null;
    for (const view of this.panelSlots) {
      if (view.ref.container === 'equipment' && view.ref.index === WEAPON_INDEX) view.setAmmo(ammo);
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
    // Com muitos espaços (mochila grande), mais colunas até caber em altura.
    for (let cols = INVENTORY_COLS; cols <= INVENTORY_MAX_COLS; cols++) {
      const layout = this.layoutWith(scale, cols);
      if (layout) return layout;
      if (Math.ceil(this.inventorySlots / cols) <= EQUIP_ROWS) break; // mais colunas não ajudam
    }
    return null;
  }

  private layoutWith(scale: number, cols: number): PanelLayout | null {
    const { width } = getView();
    const bag = bagSize(this.inventorySlots, cols, scale);
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
    if (w > width - 4 || h > this.panelBottom()) return null;
    return { scale, cols, bag, chest, sideBySide, w, h };
  }

  /** (Re)constrói o painel: fundo escurecido, grelhas, título e barra de informação. */
  private buildPanel(): void {
    this.clearPanel();
    const scene = this.scene;
    const { width, height } = getView();
    // Nos ecrãs táteis, slots ×2 (mais fáceis de tocar) se couberem.
    const touch = scene.sys.game.device.input.touch;
    const layout = (touch ? this.layout(2) : null) ?? this.layout(1) ?? this.layoutFallback();
    const { scale, cols, bag, chest, sideBySide, w, h } = layout;
    const size = slotSize(scale);
    const x = Math.round((width - w) / 2);
    // Fixo perto do topo, como o fabrico.
    const y = Math.max(4, Math.min(panelTop(height), this.panelBottom() - h));
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
    const slots = this.inventorySlots;
    this.builtSlots = slots;
    grid('inventory', slots, cols, gx, gy, t('hud.bag'));
    // Equipamento: coluna à direita da mochila (arma, cabeça, corpo, mochila).
    EQUIP_SHOWN.forEach(({ index, label }, row) => {
      this.panelSlots.push(
        new SlotView(
          scene,
          gx + bag.w - size,
          gy + TITLE_H + row * (size + SLOT_GAP),
          { container: 'equipment', index },
          t(label),
          scale,
        ).setDepth(DEPTH.slots),
      );
    });
    const other = this.other;
    if (chest && other) {
      const cx = sideBySide ? gx + bag.w + PAD : gx;
      const cy = sideBySide ? gy : gy + TITLE_H + bag.h + PAD;
      const slots = this.actions.container(other).length;
      const title = t(
        other.startsWith('loot:') ? 'inv.container' : other.startsWith('bag:') ? 'inv.ground' : 'inv.chest',
      );
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
    const { width } = getView();
    // As colunas que couberem na largura (o que não couber em altura fica cortado).
    let cols = INVENTORY_COLS;
    while (cols < INVENTORY_MAX_COLS && bagSize(this.inventorySlots, cols + 1, 1).w + PAD * 2 <= width - 4)
      cols++;
    const bag = bagSize(this.inventorySlots, cols, 1);
    const chest = this.otherGrid(1);
    const h = TITLE_H + bag.h + (chest ? TITLE_H + chest.h + PAD : 0) + INFO_H + PAD * 2;
    return { scale: 1, cols, bag, chest, sideBySide: false, w: Math.max(bag.w, chest?.w ?? 0) + PAD * 2, h };
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
      const enchant = enchantOf(slot);
      const title = enchant > 0 ? `${itemName(slot[0])} +${String(enchant)}` : itemName(slot[0]);
      const name = add(
        new Label(scene, x, y, title, { size: 8, bold: true, color: enchant > 0 ? 'gold' : 'cream' }),
      );
      name.setDepth(DEPTH.slots);
      // O que o item faz (dano, defesa, efeitos…), curto, por baixo do nome (até 2 linhas).
      add(
        new Label(scene, x, y + 11, describeItem(slot[0], def, enchant).join(' · '), {
          size: 7,
          color: 'stone_light',
          wrap: w,
        }),
      ).setDepth(DEPTH.slots);
      // Botões da largura do texto, lado a lado.
      let left = x;
      let by = y + INFO_BUTTONS_DY;
      const action = (label: string, onClick: () => void, style: ButtonStyle = 'secondary'): void => {
        const bw = Math.max(40, Math.ceil(measureTextWidth(label, 8) / 2) * 2 + 12);
        // Sem espaço na linha, passa para a de baixo.
        if (left > x && left + bw > x + w) {
          left = x;
          by += 17;
        }
        add(new Button(scene, left + bw / 2, by, label, { ...small, width: bw, style }, onClick)).setDepth(
          DEPTH.slots,
        );
        left += bw + 4;
      };
      if (def.type === 'consumable' || def.type === 'note' || def.type === 'scroll') {
        action(t(def.type === 'note' ? 'inv.read' : 'inv.use'), () => {
          // O pergaminho abre o teletransporte (a mochila fecha-se).
          if (def.type === 'scroll') this.close();
          this.actions.use(selected);
          this.rebuildSoon();
        });
      }
      if (selected.container === 'equipment') {
        action(t('inv.unequip'), () => {
          if (!this.actions.unequip(selected.index)) scene.events.emit('ui:message', t('msg.inventory_full'));
          this.selected = null;
          this.rebuildSoon();
        });
      } else if (equipSlotOf(def)) {
        action(t('inv.equip'), () => {
          this.actions.equip(selected);
          this.selected = null;
          this.rebuildSoon();
        });
      }
      if (slot[1] > 1) {
        action(t('inv.split'), () => {
          this.actions.split(selected);
          this.rebuildSoon();
        });
      }
      // Largar no chão (volta-se a apanhar com a ação) e destruir (2 toques), só do que é nosso.
      const mine = ['inventory', 'hotbar', 'equipment'].includes(selected.container);
      // Encantar (armas e roupa): paga-se em moedas; cada nível custa o dobro.
      const cost = mine ? this.actions.enchantCost(selected) : null;
      if (cost !== null) {
        action(t('inv.enchant', { cost }), () => {
          const result = this.actions.enchant(selected);
          if (result === 'no_coins') scene.events.emit('ui:message', t('msg.no_coins', { cost }));
          this.rebuildSoon();
        });
      }
      if (mine && !this.other) {
        action(t('inv.drop'), () => {
          this.actions.drop(selected);
          this.selected = null;
          this.rebuildSoon();
        });
      }
      if (mine) {
        const confirming =
          this.confirmDestroy !== null &&
          this.confirmDestroy.ref.container === selected.container &&
          this.confirmDestroy.ref.index === selected.index &&
          performance.now() < this.confirmDestroy.until;
        action(
          t(confirming ? 'inv.destroy_confirm' : 'inv.destroy'),
          () => {
            if (confirming) {
              this.actions.destroy(selected);
              this.selected = null;
              this.confirmDestroy = null;
            } else this.confirmDestroy = { ref: selected, until: performance.now() + DESTROY_CONFIRM_MS };
            this.rebuildSoon();
          },
          'danger',
        );
      }
    } else {
      add(new Label(scene, x, y + 2, t('inv.hint'), { size: 7, color: 'stone_light', wrap: w })).setDepth(
        DEPTH.slots,
      );
    }

    const other = this.other;
    // Frigorífico (§7.17): "Encomendar" abre o take-away (receitas pagas em moedas).
    const orders = other?.startsWith('chest:')
      ? this.actions.chestRules(other.slice('chest:'.length))?.orders
      : undefined;
    if (orders) {
      const ow = 72;
      add(
        new Button(
          scene,
          x + w - 96 - 4 - ow / 2,
          y + INFO_BUTTONS_DY,
          t('fridge.order'),
          { ...small, width: ow, style: 'primary' },
          () => {
            this.close();
            eventBus.emit('station:open', { stationKey: orders });
          },
        ),
      ).setDepth(DEPTH.slots);
    }
    if (other?.startsWith('chest:')) {
      const bw = 96;
      add(
        new Button(
          scene,
          x + w - bw / 2,
          y + INFO_BUTTONS_DY,
          t('inv.store_similar'),
          { ...small, width: bw },
          () => {
            const moved = this.actions.storeSimilar(other);
            if (moved > 0) scene.events.emit('ui:message', t('msg.stored', { qty: moved }));
            this.rebuildSoon();
          },
        ),
      ).setDepth(DEPTH.slots);
    } else if (other) {
      const bw = 80;
      add(
        new Button(
          scene,
          x + w - bw / 2,
          y + INFO_BUTTONS_DY,
          t('inv.take_all'),
          { ...small, width: bw, style: 'primary' },
          () => {
            this.takeAll();
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
