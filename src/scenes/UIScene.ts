import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { clockAt } from '../core/Clock';
import { eventBus } from '../core/EventBus';
import { gameState, type PlayerState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import { getView, setupFixedCamera } from '../display/view';
import { pinchStep, stepWorldZoom } from '../display/worldZoom';
import { itemName, t, type MessageKey } from '../i18n';
import { readJoystick } from '../input/joystick';
import { moveInput } from '../input/moveInput';
import { Button } from '../ui/Button';
import { BuildUI } from '../ui/BuildUI';
import { buildMode, pickTile, type Tile } from '../ui/buildMode';
import { gameSpeed, nextGameSpeed } from '../ui/gameSpeed';
import { CraftingUI } from '../ui/CraftingUI';
import { InventoryUI } from '../ui/InventoryUI';
import { Label } from '../ui/text';
import { uiState } from '../ui/uiState';
import { SceneKey } from './keys';

/** Raio do joystick virtual e do manípulo, em píxeis de jogo. */
const JOYSTICK_RADIUS = 24;
const KNOB_RADIUS = 10;
/** Fração do raio sem movimento (evita andar com um toque acidental). */
const JOYSTICK_DEAD_ZONE = 0.25;
/** Até esta fração do raio anda-se agachado (devagar); acima, a correr normal. */
const JOYSTICK_SNEAK_ZONE = 0.55;
const ACTIVE_ALPHA = 0.7;
/** Ponteiros em simultâneo: rato + 2 dedos (joystick + botão de ação, ou pinça). */
const TOUCH_POINTERS = 2;
/** Botão de ação (toque), no canto inferior direito, acima da mochila. */
const ACTION_RADIUS = 20;

/** Barras do HUD (px de jogo; pares, porque as Shapes não são arredondadas). */
const HUD_MARGIN = 6;
const BAR_X = 34;
const BAR_WIDTH = 60;
const BAR_HEIGHT = 6;
const BAR_SPACING = 11;
/** Piscar das barras abaixo de BALANCE.lowStatPct (CLAUDE.md §2: aviso aos 30%). */
const BLINK_MS = 400;
const NOTICE_MS = 2500;
/** Um toque curto e quase parado no mundo, no modo construção, escolhe o tile. */
const TAP_MS = 300;
const TAP_SLOP = 6;

interface StatBar {
  key: keyof Pick<PlayerState, 'hp' | 'hunger' | 'thirst'>;
  label: Label;
  fill: Phaser.GameObjects.Rectangle;
}

const STATS: readonly { key: StatBar['key']; label: MessageKey; color: PaletteColor }[] = [
  { key: 'hp', label: 'hud.hp', color: 'red' },
  { key: 'hunger', label: 'hud.hunger', color: 'amber' },
  { key: 'thirst', label: 'hud.thirst', color: 'sky' },
];

/**
 * HUD por cima da cena de jogo (corre em paralelo com Base/Zona): vida, fome, sede, relógio,
 * hotbar e mochila, mensagens, joystick e botão de ação (toque). Recebe TODOS os toques e
 * cliques e decide para onde vão: UI → joystick/pinça → ação no mundo.
 */
export class UIScene extends Phaser.Scene {
  private joystickPointer: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private joystickBase: Phaser.GameObjects.Arc | null = null;
  private joystickKnob: Phaser.GameObjects.Arc | null = null;
  private bars: StatBar[] = [];
  private clock: Label | null = null;
  private notice: Label | null = null;
  private noticeTimer: Phaser.Time.TimerEvent | null = null;
  private inventory: InventoryUI | null = null;
  private crafting: CraftingUI | null = null;
  private build: BuildUI | null = null;
  /** Botão de ação (toque): escondido no modo construção. */
  private actionButton: { setVisible(visible: boolean): unknown }[] = [];
  /** Botão "Construir": escondido no modo construção (a paleta ocupa o sítio; há o Sair). */
  private buildButton: Button | null = null;
  /** Ponteiro que está a segurar a ação (botão de toque ou clique no mundo). */
  private actionPointer: number | null = null;

  constructor() {
    super(SceneKey.UI);
  }

  create(): void {
    this.joystickPointer = null;
    this.actionPointer = null;
    uiState.actionHeld = false;
    setupFixedCamera(this.cameras.main);
    this.createBars();
    const { width, height } = getView();
    this.clock = new Label(
      this,
      width - HUD_MARGIN,
      HUD_MARGIN,
      '',
      { size: 8, color: 'cream', bold: true },
      [1, 0],
    );
    this.notice = new Label(
      this,
      Math.round(width / 2),
      Math.round(height * 0.28),
      '',
      { size: 9, color: 'wheat', bold: true, stroke: true, align: 'center', wrap: width - 32 },
      [0.5, 0.5],
    ).setDepth(90);

    this.inventory = new InventoryUI(this, simulation.actions);
    this.crafting = new CraftingUI(this, simulation);
    this.build = new BuildUI(this, simulation, this.inventory.hotbarRect().y);
    this.build.onToggle = (open) => {
      for (const obj of this.actionButton) obj.setVisible(!open);
      this.buildButton?.setVisible(!open);
    };
    this.createButtons();
    this.createSpeedButton();
    this.createJoystick();
    this.createKeys();
    const offEvents = this.listenForMessages();
    if (uiState.pendingNotice) {
      this.showNotice(uiState.pendingNotice);
      uiState.pendingNotice = null;
    }

    // Mudou a resolução ou o zoom: refazer o HUD com a vista nova.
    const onResize = (): void => {
      this.scene.restart({});
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offEvents();
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      moveInput.joystick = { x: 0, y: 0 };
      uiState.actionHeld = false;
      this.inventory?.destroy();
      this.inventory = null;
      this.crafting?.destroy();
      this.crafting = null;
      this.build?.destroy();
      this.build = null;
      this.actionButton = [];
      this.buildButton = null;
      this.joystickBase = null;
      this.joystickKnob = null;
      this.bars = [];
      this.clock = null;
      this.notice = null;
    });
  }

  override update(time: number): void {
    if (!gameState.hasGame) return;
    this.crafting?.update();
    this.build?.update();
    const { player, world } = gameState.data;
    const low = (BALANCE.statMax * BALANCE.lowStatPct) / 100;
    const blinkOff = Math.floor(time / BLINK_MS) % 2 === 1;
    for (const bar of this.bars) {
      const value = player[bar.key];
      bar.fill.width = Math.round((BAR_WIDTH * value) / BALANCE.statMax);
      const warn = value <= low;
      bar.fill.setAlpha(warn && blinkOff ? 0.35 : 1);
      bar.label.setColor(warn ? 'gold' : 'cream');
    }
    const clock = clockAt(world.tick, BALANCE.dayLengthSec, BALANCE.dayStartHour);
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.clock?.setText(t('hud.clock', { day: clock.day, time: `${pad(clock.hour)}:${pad(clock.minute)}` }));
  }

  /** Mensagem curta no centro-alto do ecrã (substitui a anterior). */
  private showNotice(text: string): void {
    this.notice?.setText(text).setVisible(true);
    this.noticeTimer?.remove();
    this.noticeTimer = this.time.delayedCall(NOTICE_MS, () => this.notice?.setVisible(false));
  }

  private listenForMessages(): () => void {
    const offs = [
      eventBus.on('player:died', () => {
        this.showNotice(t('hud.died'));
      }),
      eventBus.on('action:blocked', ({ reason, tool }) => {
        if (reason === 'inventory_full') this.showNotice(t('msg.inventory_full'));
        else if (reason === 'door_blocked') this.showNotice(t('build.problem.door_blocked'));
        else this.showNotice(t(tool === 'pickaxe' ? 'msg.needs_pickaxe' : 'msg.needs_axe'));
      }),
      eventBus.on('item:broken', ({ item }) => {
        this.showNotice(t('msg.tool_broken', { item: itemName(item) }));
      }),
      eventBus.on('player:action', ({ kind }) => {
        if (kind === 'use') this.showNotice(t('msg.drank'));
      }),
    ];
    const onMessage = (text: string): void => {
      this.showNotice(text);
    };
    this.events.on('ui:message', onMessage);
    return () => {
      for (const off of offs) off();
      this.events.off('ui:message', onMessage);
    };
  }

  private createBars(): void {
    this.bars = STATS.map((stat, i) => {
      const y = HUD_MARGIN + i * BAR_SPACING;
      const label = new Label(this, HUD_MARGIN, y - 1, t(stat.label), {
        size: 7,
        color: 'cream',
        bold: true,
      });
      // Contorno (retângulo maior por trás), fundo e enchimento; origem 0 e posições inteiras.
      this.add.rectangle(BAR_X - 1, y - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2, paletteNumber('ink')).setOrigin(0);
      this.add.rectangle(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber('shadow')).setOrigin(0);
      const fill = this.add
        .rectangle(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber(stat.color))
        .setOrigin(0);
      return { key: stat.key, label, fill };
    });
  }

  /** Botão de velocidade (x1 → x2 → x3 → x1), por baixo do relógio. */
  private createSpeedButton(): void {
    const { width } = getView();
    const button = new Button(
      this,
      width - HUD_MARGIN - 12,
      HUD_MARGIN + 20,
      `x${String(gameSpeed())}`,
      { width: 24, height: 12, fontSize: 8, style: 'secondary' },
      () => {
        const speed = nextGameSpeed();
        button.setText(`x${String(speed)}`).setStyle(speed === 1 ? 'secondary' : 'primary');
      },
    ).setDepth(70);
    if (gameSpeed() !== 1) button.setStyle('primary');
  }

  /** Botão da mochila (junto à hotbar) e, com toque, o botão grande de ação (CLAUDE.md §7.2). */
  private createButtons(): void {
    const { width } = getView();
    const hotbar = this.inventory?.hotbarRect();
    if (!hotbar) return;
    const bagWidth = 44;
    // Crafting nas mãos: à esquerda da hotbar (a mochila fica à direita).
    new Button(
      this,
      Math.max(bagWidth / 2 + 4, hotbar.x - 6 - bagWidth / 2),
      hotbar.y + hotbar.h / 2,
      t('craft.title'),
      { width: bagWidth, height: hotbar.h, fontSize: 8, style: 'secondary' },
      () => {
        this.toggleCrafting();
      },
    ).setDepth(70);
    // Construir (só na base): por cima do Fabricar.
    if (this.build?.available) {
      this.buildButton = new Button(
        this,
        Math.max(bagWidth / 2 + 4, hotbar.x - 6 - bagWidth / 2),
        hotbar.y - 12,
        t('build.button'),
        { width: bagWidth, height: 14, fontSize: 8, style: 'secondary' },
        () => {
          this.toggleBuild();
        },
      ).setDepth(70);
      this.buildButton.setVisible(!buildMode.active);
    }
    const bagX = Math.min(width - bagWidth / 2 - 4, hotbar.x + hotbar.w + 6 + bagWidth / 2);
    new Button(
      this,
      Math.round(bagX),
      hotbar.y + hotbar.h / 2,
      t('hud.bag'),
      { width: bagWidth, height: hotbar.h, fontSize: 8, style: 'secondary' },
      () => {
        this.toggleInventory();
      },
    ).setDepth(70);

    if (!this.sys.game.device.input.touch) return;
    const cx = width - ACTION_RADIUS - 10;
    const cy = hotbar.y - ACTION_RADIUS - 12;
    const ring = this.add.circle(cx, cy, ACTION_RADIUS + 1, paletteNumber('ink'), 0.5).setDepth(5);
    const button = this.add.circle(cx, cy, ACTION_RADIUS, paletteNumber('wood'), 0.8).setDepth(6);
    const label = new Label(
      this,
      cx,
      cy,
      t('hud.action'),
      { size: 8, bold: true, color: 'cream' },
      [0.5, 0.5],
    );
    label.setDepth(7);
    this.actionButton = [ring, button, label];
    if (buildMode.active) for (const obj of this.actionButton) obj.setVisible(false);
    button
      .setInteractive()
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
        if (uiState.modalOpen || buildMode.active) return;
        this.actionPointer = pointer.id;
        uiState.actionHeld = true;
        button.setFillStyle(paletteNumber('wood_light'), 0.9);
      });
    this.events.on('ui:action-released', () => button.setFillStyle(paletteNumber('wood'), 0.8));
  }

  /** Teclas: I/Tab mochila, Esc fecha, 1–4 hotbar. (Espaço/WASD estão na cena de jogo.) */
  private createKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    const toggle = (event: KeyboardEvent): void => {
      event.preventDefault(); // Tab mudaria o foco do browser
      this.toggleInventory();
    };
    keyboard.on('keydown-I', toggle);
    keyboard.on('keydown-TAB', toggle);
    keyboard.on('keydown-C', () => {
      this.toggleCrafting();
    });
    keyboard.on('keydown-ESC', () => {
      if (this.inventory?.isOpen) this.inventory.close();
      if (this.crafting?.isOpen) this.crafting.close();
      this.build?.close();
    });
    // Modo construção (CLAUDE.md §7.2): B entra/sai; Espaço coloca; R roda; Z desfaz; X demolir.
    keyboard.on('keydown-B', () => {
      this.toggleBuild();
    });
    const whenBuilding = (action: (build: BuildUI) => void) => (event: KeyboardEvent) => {
      if (!this.build?.isOpen || uiState.modalOpen || event.repeat) return;
      action(this.build);
    };
    keyboard.on(
      'keydown-SPACE',
      whenBuilding((build) => {
        build.confirm();
      }),
    );
    keyboard.on(
      'keydown-R',
      whenBuilding((build) => {
        build.rotate();
      }),
    );
    keyboard.on(
      'keydown-Z',
      whenBuilding((build) => {
        build.undo();
      }),
    );
    keyboard.on(
      'keydown-X',
      whenBuilding((build) => {
        build.toggleDemolish();
      }),
    );
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((key, index) => {
      keyboard.on(`keydown-${key}`, () => {
        if (!uiState.modalOpen) this.inventory?.useHotbar(index);
      });
    });
  }

  /** Só um painel aberto de cada vez (mochila/baú, crafting ou construção). */
  private toggleInventory(): void {
    if (this.crafting?.isOpen) this.crafting.close();
    this.build?.close();
    this.inventory?.toggle();
  }

  private toggleCrafting(): void {
    if (this.inventory?.isOpen) this.inventory.close();
    this.build?.close();
    this.crafting?.toggleHands();
  }

  private toggleBuild(): void {
    if (this.inventory?.isOpen) this.inventory.close();
    if (this.crafting?.isOpen) this.crafting.close();
    this.build?.toggle();
  }

  /** Tile do mundo por baixo do ponteiro (a câmara da cena de jogo tem outro zoom e posição). */
  private worldTile(pointer: Phaser.Input.Pointer): Tile | null {
    const game = this.scene.get(SceneKey.Base);
    if (!this.scene.isActive(SceneKey.Base)) return null;
    const point = game.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const size = simulation.building.tileSize;
    return { tx: Math.floor(point.x / size), ty: Math.floor(point.y / size) };
  }

  private releaseAction(pointerId: number): void {
    if (this.actionPointer !== pointerId) return;
    this.actionPointer = null;
    uiState.actionHeld = false;
    this.events.emit('ui:action-released');
  }

  /**
   * Joystick flutuante: aparece onde o dedo toca, em qualquer ponto do ecrã que não seja um
   * botão/hotbar, e desaparece ao levantar o dedo.
   */
  private createJoystick(): void {
    if (this.input.manager.pointersTotal < TOUCH_POINTERS + 1) this.input.addPointer(TOUCH_POINTERS);

    this.joystickBase = this.add.circle(0, 0, JOYSTICK_RADIUS, paletteNumber('ink'));
    this.joystickKnob = this.add.circle(0, 0, KNOB_RADIUS, paletteNumber('cream'));
    this.setJoystickVisible(false, ACTIVE_ALPHA);

    // Dedos no ecrã (px do dispositivo), para a pinça: com 2 dedos o joystick larga e faz-se zoom.
    const touches = new Map<number, { x: number; y: number }>();
    let pinching = false;
    let pinchDistance = 0;
    const taps = new Map<number, { x: number; y: number; time: number }>();
    const distance = (): number => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const p = this.toGame(pointer);
      // 1) Interface: painéis, hotbar, botões.
      if (this.crafting?.pointerDown(p.x, p.y)) return;
      if (this.inventory?.pointerDown(p.x, p.y, pointer.id)) return;
      if (this.input.hitTestPointer(pointer).length > 0 || uiState.modalOpen) return;

      if (!pointer.wasTouch) {
        // 2) Rato: clique no mundo = ação contextual (§7.2), ou colocar no modo construção.
        if (buildMode.active) {
          const tile = this.worldTile(pointer);
          if (tile && pointer.leftButtonDown()) {
            pickTile(tile, 'mouse');
            this.build?.confirm(tile);
          }
          return;
        }
        if (pointer.leftButtonDown()) {
          this.actionPointer = pointer.id;
          uiState.actionHeld = true;
        }
        return;
      }
      // 3) Toque: pinça com 2 dedos, ou joystick onde o dedo tocar (no modo construção, um
      // toque curto escolhe o tile).
      touches.set(pointer.id, { x: pointer.x, y: pointer.y });
      taps.set(pointer.id, { x: pointer.x, y: pointer.y, time: this.time.now });
      if (touches.size >= 2) {
        pinching = true;
        pinchDistance = distance();
        this.releaseJoystick();
        return;
      }
      if (pinching || this.joystickPointer !== null) return;
      this.joystickPointer = pointer.id;
      this.placeJoystick(this.clampToScreen(p.x, p.y));
      this.setJoystickVisible(true, ACTIVE_ALPHA);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      const p = this.toGame(pointer);
      this.inventory?.pointerMove(p.x, p.y, pointer.id);
      if (buildMode.active && !pointer.wasTouch && !uiState.modalOpen) {
        // Rato: a peça segue o cursor (fora da interface).
        const overUi = this.input.hitTestPointer(pointer).length > 0;
        if (!overUi) pickTile(this.worldTile(pointer), 'mouse');
      }
      if (touches.has(pointer.id)) touches.set(pointer.id, { x: pointer.x, y: pointer.y });
      if (pinching && touches.size >= 2) {
        const now = distance();
        const step = pinchStep(pinchDistance, now);
        if (step !== 0) {
          stepWorldZoom(step, getView().zoom);
          pinchDistance = now;
        }
        return;
      }
      if (pointer.id !== this.joystickPointer) return;
      const center = this.joystickCenter;
      const reading = readJoystick(
        p.x - center.x,
        p.y - center.y,
        JOYSTICK_RADIUS,
        JOYSTICK_DEAD_ZONE,
        JOYSTICK_SNEAK_ZONE,
      );
      this.joystickKnob?.setPosition(center.x + reading.knob.x, center.y + reading.knob.y);
      moveInput.joystick = reading.direction;
      moveInput.joystickSneak = reading.sneak;
    });
    const release = (pointer: Phaser.Input.Pointer): void => {
      const p = this.toGame(pointer);
      this.inventory?.pointerUp(p.x, p.y, pointer.id);
      this.releaseAction(pointer.id);
      const tap = taps.get(pointer.id);
      taps.delete(pointer.id);
      if (
        tap &&
        buildMode.active &&
        !pinching &&
        this.time.now - tap.time < TAP_MS &&
        Math.hypot(pointer.x - tap.x, pointer.y - tap.y) < TAP_SLOP * getView().zoom
      ) {
        pickTile(this.worldTile(pointer), 'touch');
      }
      touches.delete(pointer.id);
      if (touches.size === 0) pinching = false;
      if (pointer.id === this.joystickPointer) this.releaseJoystick();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
  }

  private releaseJoystick(): void {
    if (this.joystickPointer === null) return;
    this.joystickPointer = null;
    moveInput.joystick = { x: 0, y: 0 };
    moveInput.joystickSneak = false;
    this.setJoystickVisible(false, ACTIVE_ALPHA);
  }

  /** Coordenadas do ponteiro em píxeis de jogo (o canvas está em píxeis do dispositivo). */
  private toGame(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  /** O joystick nunca fica cortado pelos bordos do ecrã. */
  private clampToScreen(x: number, y: number): { x: number; y: number } {
    const r = JOYSTICK_RADIUS;
    const { width, height } = getView();
    return {
      x: Phaser.Math.Clamp(Math.round(x), r, width - r),
      y: Phaser.Math.Clamp(Math.round(y), r, height - r),
    };
  }

  private placeJoystick(center: { x: number; y: number }): void {
    this.joystickCenter = center;
    this.joystickBase?.setPosition(center.x, center.y);
    this.joystickKnob?.setPosition(center.x, center.y);
  }

  private setJoystickVisible(visible: boolean, alpha: number): void {
    this.joystickBase?.setVisible(visible).setAlpha(alpha);
    this.joystickKnob?.setVisible(visible).setAlpha(alpha);
  }
}
