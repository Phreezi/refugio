import { consumeResume } from '../display/contextLoss';
import { tInput } from '../ui/touch';
import Phaser from 'phaser';
import { PALETTE, paletteNumber } from '../assets/palette';
import { clockAt } from '../core/Clock';
import { FIXED_STEP_MS } from '../config';
import { eventBus } from '../core/EventBus';
import { advanceRespawns, offlineTicks } from '../core/offline';
import { simulation } from '../core/Simulation';
import {
  BASE_ZONE_ID,
  CHARACTER_LOOKS,
  createNewGameState,
  type GameStateData,
  DEFAULT_PLAYER_NAME,
  gameState,
  PLAYER_NAME_MAX,
  type CharacterLook,
} from '../core/GameState';
import { BALANCE } from '../data/balance';
import { getView, setupFixedCamera } from '../display/view';
import { t, type MessageKey } from '../i18n';
import { coop } from '../net/coop';
import { normalizeCode, randomCode } from '../net/protocol';
import { presence } from '../net/presence';
import { autosave, loadSlotSummaries, saves, selectSlot } from '../save';
import type { LoadedSave, LoadResult } from '../save/SaveManager';
import { SaveError } from '../save/schema';
import { AboutUI } from '../ui/AboutUI';
import { Button } from '../ui/Button';
import { applyUpdate, onUpdateReady, updateReady } from '../pwa/serviceWorker';
import { downloadText, pickTextFile, saveFileName } from '../ui/fileTransfer';
import { Label } from '../ui/text';
import { createTextInput, type TextInput } from '../ui/textInput';
import { uiState } from '../ui/uiState';
import { content } from '../world/content';
import { SceneKey } from './keys';
import type { ZoneSceneData } from './ZoneScene';

export interface MainMenuData {
  /** Mensagem a mostrar ao abrir (ex.: depois de importar ou apagar um save). */
  message?: MessageKey;
  /** Abrir logo o jogo co-op com este código (aceitou-se o convite do parceiro). */
  resume?: string;
}

/** De quanto em quanto tempo o convidado tenta de novo entrar e convida o anfitrião (ms). */
const COOP_RETRY_MS = 4000;
const COOP_INVITE_MS = 15000;

const MAIN_BUTTON = { width: 136, height: 22 } as const;
const SMALL_BUTTON = { width: 64, height: 14, fontSize: 8, style: 'secondary' } as const;
/** A partir desta largura, a lista de jogos fica à direita dos botões. */
const WIDE_MENU = 420;
/** Abaixo desta altura, o menu aperta-se (título mais pequeno, botões mais acima). */
const SHORT_MENU = 250;
const SLOT_BUTTON_WIDTH = 132;
const ABOUT_BUTTON = { width: 44, height: 12, fontSize: 7, style: 'secondary' } as const;
const UPDATE_BUTTON = { width: 136, height: 14, fontSize: 8, style: 'primary' } as const;
const OVERLAY_DEPTH = 100;
/** Tempo para confirmar uma ação destrutiva (segundo toque no mesmo botão). */
const CONFIRM_MS = 3000;

/**
 * Menu inicial: Continuar (se houver save), Novo jogo, e gestão do save
 * (Exportar/Importar/Apagar, CLAUDE.md §10.3). Rato, toque, Enter ou Espaço.
 */
export class MainMenuScene extends Phaser.Scene {
  private busy = false;
  private resizePending = false;
  private status: Label | null = null;
  private primaryAction: (() => void) | null = null;
  /** Hordas ligadas (§7.13): vem do save e aplica-se ao continuar ou ao começar um jogo novo. */
  private hordes = false;
  /** Um painel (novo jogo, código) está aberto por cima do menu. */
  private overlayOpen = false;
  /** Campos de texto do DOM abertos (fecham-se com o painel ou ao sair da cena). */
  private inputs: TextInput[] = [];
  /** Os 3 jogos (para o co-op: o lugar da personagem de um jogo de um amigo). */
  private slots: (LoadResult | null)[] = [];
  /** À espera do anfitrião (convidado): fecha o ecrã de espera e pára as tentativas. */
  private stopWaiting: (() => void) | null = null;

  constructor() {
    super(SceneKey.MainMenu);
  }

  create(data: MainMenuData): void {
    // Marca de desempenho (medir o arranque: performance.getEntriesByName).
    performance.mark('refugio:menu');
    this.busy = false;
    this.overlayOpen = false;
    this.resizePending = false;
    this.primaryAction = null;
    const { width, height } = getView();
    const cx = Math.round(width / 2);
    setupFixedCamera(this.cameras.main);
    this.cameras.main.setBackgroundColor(PALETTE.night);

    // Posições proporcionais à altura: a resolução do jogo depende do ecrã.
    // Em ecrãs baixos (ex.: o browser de um carro) o título fica mais pequeno e mais acima.
    const short = height < SHORT_MENU;
    // Centrado pelas maiúsculas, por cima do primeiro botão (que fica em `menuTop`).
    const menuTop = short ? 46 : Math.round(height * 0.4);
    new Label(
      this,
      cx,
      Math.max(short ? 14 : 20, menuTop - (short ? 26 : 34)),
      // Em maiúsculas: na fonte pixel, as minúsculas em ponto grande perdem a forma.
      t('game.title').toUpperCase(),
      { size: short ? 20 : 28, color: 'wheat', bold: true },
      [0.5, 0.5],
    );
    this.status = new Label(
      this,
      cx,
      height - 30,
      data.message ? t(data.message) : tInput('menu.hint.touch', 'menu.hint.keys'),
      { size: 8, color: 'stone_light', wrap: width - 16, align: 'center' },
      [0.5, 0],
    );
    new Label(
      this,
      width - 4,
      height - 4,
      `v${__APP_VERSION__} · ${__BUILD_ID__}`,
      { size: 7, color: 'stone' },
      [1, 1],
    );
    // "Sobre" (créditos, licenças, privacidade): discreto, no canto oposto ao da versão.
    new Button(
      this,
      4 + ABOUT_BUTTON.width / 2 + 1,
      height - 4 - ABOUT_BUTTON.height / 2 - 1,
      t('menu.about'),
      ABOUT_BUTTON,
      () => {
        this.openAbout();
      },
    );
    // Versão nova do jogo já descarregada (service worker): recarregar ativa-a.
    let updateButton: Button | null = null;
    const showUpdate = (): void => {
      if (updateButton) return;
      const w = UPDATE_BUTTON.width;
      updateButton = new Button(this, short ? 4 + w / 2 + 1 : cx, 11, t('menu.update'), UPDATE_BUTTON, () => {
        if (this.busy) return;
        this.busy = true;
        applyUpdate();
      });
    };
    if (updateReady()) showUpdate();
    const offUpdate = onUpdateReady(showUpdate);
    const loading = new Label(
      this,
      cx,
      Math.round(height * 0.5),
      t('boot.loading'),
      { size: 8, color: 'stone_light' },
      [0.5, 0.5],
    );

    // O save lê-se de forma assíncrona; se o menu entretanto reiniciar, ignora-se o resultado.
    let alive = true;
    Promise.all([saves.load(), loadSlotSummaries()]).then(
      ([result, slots]) => {
        if (!alive) return;
        loading.destroy();
        this.slots = slots;
        this.buildButtons(result, data.message !== undefined, slots);
        // Aceitou-se o convite do parceiro: abre-se logo esse jogo co-op.
        if (data.resume) this.resumeCoop(data.resume);
      },
      (error: unknown) => {
        if (!alive) return;
        console.error('[save] não foi possível ler o save:', error);
        loading.destroy();
        this.buildButtons({ save: null, corrupted: false }, false, []);
        this.setStatus('save.read_failed');
      },
    );

    // Mudou a resolução (janela redimensionada, telemóvel rodado): refazer o menu.
    const onResize = (): void => {
      // Com uma janela aberta (nome, código) o teclado do telemóvel muda o tamanho: refazer o
      // menu fechava-a. Refaz-se quando fechar.
      if (this.overlayOpen) {
        this.resizePending = true;
        return;
      }
      this.scene.restart({});
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      alive = false;
      this.stopWaiting?.();
      for (const input of this.inputs) input.destroy();
      this.inputs = [];
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      offUpdate();
    });

    // Eventos nomeados (sem addKey) não capturam as teclas globalmente.
    const onKey = (): void => {
      this.primaryAction?.();
    };
    this.input.keyboard?.on('keydown-ENTER', onKey);
    this.input.keyboard?.on('keydown-SPACE', onKey);
  }

  private buildButtons(result: LoadResult, keepMessage: boolean, slots: (LoadResult | null)[]): void {
    const { width, height } = getView();
    // Os botões principais ficam sempre ao centro da página; a lista de jogos à direita se
    // couber no espaço livre, senão numa linha por baixo.
    const cx = Math.round(width / 2);
    const rightStart = cx + MAIN_BUTTON.width / 2 + 10;
    const listSide = Math.round((rightStart + width - 4) / 2);
    const wide =
      width >= WIDE_MENU &&
      listSide - SLOT_BUTTON_WIDTH / 2 >= rightStart &&
      listSide + SLOT_BUTTON_WIDTH / 2 <= width - 4;
    const short = height < SHORT_MENU;
    const y = short ? 46 : Math.round(height * 0.4);
    const spacing = short ? 24 : 26;
    const save = result.save;
    this.hordes = save?.state.settings.hordes ?? false;

    if (save) {
      const time = clockAt(save.state.world.tick, BALANCE.dayLengthSec, BALANCE.dayStartHour);
      this.primaryAction = () => {
        this.continueGame(save);
      };
      new Button(this, cx, y, t('menu.continue', { day: time.day }), MAIN_BUTTON, this.primaryAction);
      // A página recarregou por o telemóvel ter perdido o contexto gráfico: volta logo ao jogo.
      if (consumeResume()) this.time.delayedCall(0, this.primaryAction);
      this.confirmButton(
        cx,
        y + spacing,
        'menu.new_game',
        'menu.confirm_new',
        { ...MAIN_BUTTON, style: 'secondary' },
        () => {
          this.openNewGame();
        },
      );
    } else {
      this.primaryAction = () => {
        this.openNewGame();
      };
      new Button(this, cx, y, t('menu.new_game'), MAIN_BUTTON, this.primaryAction);
    }

    // Co-op (Fase 15): um jogo co-op começa sempre novo e fica só dos dois que o jogam.
    const coopY = y + (save ? spacing * 2 : spacing);
    new Button(this, cx, coopY, t('menu.new_coop'), { ...SMALL_BUTTON, width: MAIN_BUTTON.width }, () => {
      this.openNewGame(true);
    });
    // Hordas (desligadas por defeito): definição do jogo, gravada no save.
    const hordeY = coopY + (short ? 20 : 22);
    const hordeButton = new Button(
      this,
      cx,
      hordeY,
      t(this.hordes ? 'horde.menu_on' : 'horde.menu_off'),
      { ...SMALL_BUTTON, width: MAIN_BUTTON.width },
      () => {
        this.hordes = !this.hordes;
        hordeButton.setText(t(this.hordes ? 'horde.menu_on' : 'horde.menu_off'));
      },
    );

    // Co-op (Fase 15): entrar no jogo de um amigo com o código dele (na coluna dos botões
    // principais: no canto sobrepunha-se à lista de jogos).
    const joinY = hordeY + (short ? 20 : 22);
    new Button(this, cx, joinY, t('coop.join'), { ...SMALL_BUTTON, width: MAIN_BUTTON.width }, () => {
      this.openJoin();
    });

    // Os meus jogos: à direita (lista) ou, sem espaço, numa linha de 3 por baixo. Tocar escolhe.
    const rowY = height - 50;
    const inRow = !wide;
    const rowSlotW = Math.min(SLOT_BUTTON_WIDTH, Math.floor((width - 16 - 2 * 4) / 3)) & ~1;
    const listX = wide ? listSide : cx;
    let listY = wide ? y - 14 : Math.max(joinY + 30, rowY - 26);
    new Label(this, listX, listY - 16, t('menu.games'), { size: 8, bold: true, color: 'wheat' }, [0.5, 0.5]);
    slots.forEach((slot, i) => {
      const summary = slot?.save;
      const vars = summary
        ? {
            name: summary.state.player.name,
            level: summary.state.player.level,
            day: clockAt(summary.state.world.tick, BALANCE.dayLengthSec, BALANCE.dayStartHour).day,
          }
        : null;
      const base = vars ? t(inRow ? 'menu.slot_short' : 'menu.slot', vars) : t('menu.slot_empty');
      const label = summary?.state.coop ? t('menu.coop_tag', { label: base }) : base;
      const x = inRow ? cx + (i - 1) * (rowSlotW + 4) : listX;
      new Button(
        this,
        x,
        listY,
        label,
        {
          width: inRow ? rowSlotW : SLOT_BUTTON_WIDTH,
          height: 18,
          fontSize: inRow ? 7 : 8,
          style: i === saves.slot ? 'primary' : 'secondary',
        },
        () => {
          if (this.busy || i === saves.slot) return;
          selectSlot(i);
          this.scene.restart({});
        },
      );
      if (!inRow) listY += 21;
    });

    // Gestão do save: linha de botões pequenos (por baixo da lista, se estiver numa linha).
    const actionsY = inRow ? Math.max(rowY, listY + 20) : rowY;
    const actions: [MessageKey, (x: number) => void][] = [];
    if (save) {
      actions.push([
        'save.export',
        (x) =>
          new Button(this, x, actionsY, t('save.export'), SMALL_BUTTON, () => {
            downloadText(saveFileName(new Date()), save.text);
            this.setStatus('save.exported');
          }),
      ]);
    }
    actions.push([
      'save.import',
      (x) =>
        new Button(this, x, actionsY, t('save.import'), SMALL_BUTTON, () => {
          void this.importSave();
        }),
    ]);
    if (save) {
      actions.push([
        'save.delete',
        (x) => {
          this.confirmButton(x, actionsY, 'save.delete', 'save.confirm_delete', SMALL_BUTTON, () => {
            void this.deleteSave();
          });
        },
      ]);
    }
    const rowSpacing = SMALL_BUTTON.width + 8;
    const rowCx = Math.round(width / 2);
    const firstX = rowCx - Math.round(((actions.length - 1) * rowSpacing) / 2);
    actions.forEach(([, make], i) => {
      make(firstX + i * rowSpacing);
    });

    if (result.corrupted && !keepMessage) this.setStatus(save ? 'save.recovered' : 'save.corrupt_lost');
  }

  /**
   * Painel por cima do menu (novo jogo, entrar com código): fundo escuro, caixa ao centro.
   * @returns a função que o fecha (e os campos de texto que tiver).
   */
  private overlay(title: string, height: number): { x: number; y: number; w: number; close: () => void } {
    const view = getView();
    const w = Math.min(220, view.width - 16);
    const x = Math.round((view.width - w) / 2);
    const y = Math.round((view.height - height) / 2);
    const objects: { destroy(): void }[] = [];
    // O fundo bloqueia os cliques no menu por baixo.
    objects.push(
      this.add
        .rectangle(0, 0, view.width, view.height, paletteNumber('ink'), 0.75)
        .setOrigin(0)
        .setDepth(OVERLAY_DEPTH)
        .setInteractive(),
      this.add.rectangle(x, y, w, height, paletteNumber('bark_dark')).setOrigin(0).setDepth(OVERLAY_DEPTH),
      this.add
        .rectangle(x + 1, y + 1, w - 2, height - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(OVERLAY_DEPTH),
    );
    objects.push(
      new Label(this, x + w / 2, y + 12, title, { size: 9, bold: true, color: 'wheat' }, [0.5, 0.5]).setDepth(
        OVERLAY_DEPTH + 1,
      ),
    );
    this.overlayOpen = true;
    const previous = this.primaryAction;
    this.primaryAction = null;
    return {
      x,
      y,
      w,
      close: () => {
        for (const object of objects) object.destroy();
        for (const input of this.inputs) input.destroy();
        this.inputs = [];
        this.overlayOpen = false;
        this.primaryAction = previous;
        if (this.resizePending) {
          this.resizePending = false;
          this.time.delayedCall(50, () => {
            if (!this.busy) this.scene.restart({});
          });
        }
      },
    };
  }

  /** "Sobre / Créditos" por cima do menu (fechar devolve o menu como estava). */
  private openAbout(): void {
    if (this.busy || this.overlayOpen) return;
    this.overlayOpen = true;
    const previous = this.primaryAction;
    this.primaryAction = null;
    new AboutUI(this, OVERLAY_DEPTH, () => {
      this.overlayOpen = false;
      this.primaryAction = previous;
      if (this.resizePending) {
        this.resizePending = false;
        this.scene.restart({});
      }
    });
  }

  /** Novo jogo: nome da personagem e rapaz/rapariga (o nome aparece no co-op e na lista). */
  private openNewGame(coopGame = false, onStart?: (name: string, look: CharacterLook) => void): void {
    if (this.busy || this.overlayOpen) return;
    const panel = this.overlay(t(coopGame ? 'coop.new_title' : 'menu.new_game'), 112);
    const { x, y, w } = panel;
    const add = <T extends { destroy(): void }>(object: T): T => {
      const close = panel.close;
      panel.close = () => {
        object.destroy();
        close();
      };
      return object;
    };
    add(
      new Label(this, x + 10, y + 28, t('menu.name'), { size: 8, color: 'cream' }, [0, 0.5]).setDepth(
        OVERLAY_DEPTH + 1,
      ),
    );
    const start = (): void => {
      const name = nameInput.value.trim().slice(0, PLAYER_NAME_MAX) || DEFAULT_PLAYER_NAME;
      panel.close();
      if (onStart) onStart(name, look);
      else this.startNewGame(name, look, coopGame);
    };
    const nameInput = createTextInput(this.game.canvas, {
      x: x + 10,
      y: y + 36,
      w: w - 20,
      h: 18,
      maxLength: PLAYER_NAME_MAX,
      placeholder: t('menu.name_placeholder'),
      onEnter: start,
    });
    this.inputs.push(nameInput);
    let look: CharacterLook = 'boy';
    const lookButtons = CHARACTER_LOOKS.map((option, i) =>
      add(
        new Button(
          this,
          x + 10 + (w - 20) / 4 + i * ((w - 20) / 2),
          y + 68,
          t(`look.${option}`),
          {
            width: (w - 20) / 2 - 4,
            height: 16,
            fontSize: 8,
            style: option === look ? 'primary' : 'secondary',
          },
          () => {
            look = option;
            lookButtons.forEach((button, j) =>
              button.setStyle(CHARACTER_LOOKS[j] === look ? 'primary' : 'secondary'),
            );
          },
        ).setDepth(OVERLAY_DEPTH + 1),
      ),
    );
    add(
      new Button(this, x + w / 2 - 44, y + 94, t('menu.cancel'), { ...SMALL_BUTTON, width: 76 }, () => {
        panel.close();
      }).setDepth(OVERLAY_DEPTH + 1),
    );
    add(
      new Button(
        this,
        x + w / 2 + 44,
        y + 94,
        t('menu.start'),
        { width: 76, height: 16, fontSize: 8 },
        start,
      ).setDepth(OVERLAY_DEPTH + 1),
    );
    nameInput.focus();
  }

  /** Entrar no jogo de um amigo: o código escreve-se num campo com o aspeto do jogo. */
  private openJoin(): void {
    if (this.busy || this.overlayOpen) return;
    const panel = this.overlay(t('coop.join'), 86);
    const { x, y, w } = panel;
    const objects: { destroy(): void }[] = [];
    const close = (): void => {
      for (const object of objects) object.destroy();
      panel.close();
    };
    objects.push(
      new Label(this, x + 10, y + 28, t('coop.enter_code'), { size: 8, color: 'cream' }, [0, 0.5]).setDepth(
        OVERLAY_DEPTH + 1,
      ),
    );
    const join = (): void => {
      const value = codeInput.value;
      close();
      this.joinCoop(value);
    };
    const codeInput = createTextInput(this.game.canvas, {
      x: x + 10,
      y: y + 36,
      w: w - 20,
      h: 18,
      maxLength: 5,
      uppercase: true,
      onEnter: join,
    });
    this.inputs.push(codeInput);
    objects.push(
      new Button(
        this,
        x + w / 2 - 44,
        y + 70,
        t('menu.cancel'),
        { ...SMALL_BUTTON, width: 76 },
        close,
      ).setDepth(OVERLAY_DEPTH + 1),
      new Button(
        this,
        x + w / 2 + 44,
        y + 70,
        t('coop.enter'),
        { width: 76, height: 16, fontSize: 8 },
        join,
      ).setDepth(OVERLAY_DEPTH + 1),
    );
    codeInput.focus();
  }

  /** Botão de ação destrutiva: o 1.º toque pede confirmação, o 2.º (em 3 s) executa. */
  private confirmButton(
    x: number,
    y: number,
    label: MessageKey,
    confirmLabel: MessageKey,
    options: ConstructorParameters<typeof Button>[4],
    onConfirm: () => void,
  ): void {
    let armed = false;
    const button = new Button(this, x, y, t(label), options, () => {
      if (armed) {
        onConfirm();
        return;
      }
      armed = true;
      button.setText(t(confirmLabel)).setStyle('danger');
      this.time.delayedCall(CONFIRM_MS, () => {
        armed = false;
        button.setText(t(label)).setStyle(options.style ?? 'primary');
      });
    });
  }

  /** Grava a escolha das hordas no jogo; ao ligá-las, a primeira vem daqui a uns dias. */
  private applyHordes(): void {
    const data = gameState.data;
    if (data.settings.hordes === this.hordes) return;
    data.settings.hordes = this.hordes;
    if (this.hordes && !data.horde.active) data.horde.at = 0; // marca-se de novo a partir de agora
    gameState.markDirty();
  }

  private setStatus(key: MessageKey): void {
    this.status?.setText(t(key));
  }

  private continueGame(save: LoadedSave): void {
    if (this.busy) return; // Enter com a tecla presa repete o evento
    // A personagem de um jogo co-op de um amigo: continua-se entrando no jogo dele.
    if (save.state.coop?.role === 'guest') {
      this.resumeGuest(save.state);
      return;
    }
    this.busy = true;
    const state = gameState.load(save.state);
    this.applyHordes();
    // Tempo em que o jogo esteve fechado: crafts e reaparecimento de recursos avançam (§7.6).
    const ticks = offlineTicks(save.timestamp, Date.now(), BALANCE.offlineCapHours, FIXED_STEP_MS);
    if (ticks > 0) {
      advanceRespawns(state, ticks);
      const finished = simulation.crafting.advance(ticks);
      if (finished > 0) uiState.pendingNotice = t('craft.offline', { n: finished });
    }
    eventBus.emit('game:started', { zoneId: state.player.zoneId });
    this.scene.start(SceneKey.Zone, { zoneId: state.player.zoneId } satisfies ZoneSceneData);
  }

  private startNewGame(name: string, look: CharacterLook, coopGame = false): void {
    if (this.busy) return;
    this.busy = true;
    const state = gameState.newGame(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    state.player.name = name;
    state.player.look = look;
    // Jogo co-op: o código fica fixo e o primeiro amigo que entrar fica ligado a este jogo.
    if (coopGame) state.coop = { role: 'host', code: randomCode(), partner: null, partnerName: null };
    this.applyHordes();
    eventBus.emit('game:started', { zoneId: state.player.zoneId });
    void autosave.flush(); // o jogo novo substitui já o antigo
    this.scene.start(SceneKey.Zone, { zoneId: BASE_ZONE_ID } satisfies ZoneSceneData);
  }

  /**
   * Entrar com código: num jogo co-op de um amigo, a personagem fica num dos 3 lugares (o que já
   * tiver esse código, ou um vazio, com nome e aparência novos). Depois espera-se pelo anfitrião.
   */
  private joinCoop(input: string): void {
    if (this.busy) return;
    const code = normalizeCode(input);
    if (!code) {
      this.setStatus('coop.bad_code');
      return;
    }
    const existing = this.slots.findIndex((slot) => slot?.save?.state.coop?.code === code);
    const existingState = existing >= 0 ? this.slots[existing]?.save?.state : undefined;
    if (existingState) {
      selectSlot(existing);
      this.resumeGuest(existingState);
      return;
    }
    const empty =
      this.slots.length === 0 || this.slots[saves.slot] === null
        ? saves.slot
        : this.slots.findIndex((slot) => slot === null);
    if (empty < 0) {
      this.setStatus('coop.no_slot');
      return;
    }
    this.openNewGame(true, (name, look) => {
      const state = createNewGameState(content.zoneMap(BASE_ZONE_ID).playerSpawn);
      state.player.name = name;
      state.player.look = look;
      state.coop = { role: 'guest', code, partner: null, partnerName: null };
      selectSlot(empty);
      this.resumeGuest(state);
    });
  }

  /** Abre o jogo co-op com este código (convite aceite): o do anfitrião ou a personagem. */
  private resumeCoop(code: string): void {
    const i = this.slots.findIndex((slot) => slot?.save?.state.coop?.code === code);
    const save = i >= 0 ? this.slots[i]?.save : undefined;
    if (!save) return;
    selectSlot(i);
    this.continueGame(save);
  }

  /**
   * Convidado: entra no jogo do anfitrião com a personagem `own`. Se ele ainda não estiver lá,
   * espera (tenta de novo de vez em quando e manda-lhe um convite), até se cancelar.
   */
  private resumeGuest(own: GameStateData): void {
    const link = own.coop;
    if (this.busy || !link) return;
    this.busy = true;
    const panel = this.overlay(t('coop.title'), 70);
    const text = new Label(
      this,
      panel.x + panel.w / 2,
      panel.y + 32,
      link.partnerName ? t('coop.wait_partner', { name: link.partnerName }) : t('coop.joining'),
      { size: 8, color: 'cream', align: 'center', wrap: panel.w - 16 },
      [0.5, 0.5],
    ).setDepth(OVERLAY_DEPTH + 1);
    let stopped = false;
    let timer: Phaser.Time.TimerEvent | null = null;
    let lastInvite = -Infinity;
    uiState.coopWaitingCode = link.code;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      timer?.remove();
      uiState.coopWaitingCode = null;
      text.destroy();
      cancel.destroy();
      panel.close();
      this.stopWaiting = null;
      this.busy = false;
    };
    this.stopWaiting = stop;
    const cancel = new Button(
      this,
      panel.x + panel.w / 2,
      panel.y + 54,
      t('menu.cancel'),
      { ...SMALL_BUTTON, width: 76 },
      () => {
        coop.leave();
        stop();
      },
    ).setDepth(OVERLAY_DEPTH + 1);
    const attempt = (): void => {
      if (stopped) return;
      // Convida o anfitrião (se ele estiver noutro jogo, aparece-lhe um aviso).
      const now = this.time.now;
      if (link.partner && now - lastInvite >= COOP_INVITE_MS) {
        lastInvite = now;
        void presence.invite(link.partner, { code: link.code, name: own.player.name });
      }
      coop.join(link.code, own).then(
        (state) => {
          if (stopped) {
            coop.leave();
            return;
          }
          stop();
          this.busy = true;
          gameState.load(state, true);
          simulation.reset();
          uiState.pendingNotice = t('coop.joined', { name: coop.partnerName ?? '?' });
          this.scene.start(SceneKey.Zone, { zoneId: state.player.zoneId } satisfies ZoneSceneData);
        },
        (error: unknown) => {
          if (stopped) return;
          const reason = error instanceof Error ? error.message : '';
          if (reason === 'taken') {
            stop();
            this.setStatus('coop.taken');
            return;
          }
          // O anfitrião ainda não abriu o jogo (ou a rede falhou): espera e tenta de novo.
          text.setText(
            link.partnerName ? t('coop.wait_partner', { name: link.partnerName }) : t('coop.wait_friend'),
          );
          timer = this.time.delayedCall(COOP_RETRY_MS, attempt);
        },
      );
    };
    attempt();
  }

  private async importSave(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const text = await pickTextFile();
      if (text === null) return;
      const parsed = saves.parseImport(text);
      gameState.load(parsed.state);
      gameState.markDirty();
      await autosave.flush();
      this.scene.restart({ message: 'save.imported' } satisfies MainMenuData);
    } catch (error) {
      console.warn('[save] importação recusada:', error);
      this.setStatus(error instanceof SaveError ? 'save.import_invalid' : 'save.import_failed');
    } finally {
      this.busy = false;
    }
  }

  private async deleteSave(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await saves.remove();
      gameState.clear();
      this.scene.restart({ message: 'save.deleted' } satisfies MainMenuData);
    } catch (error) {
      console.error('[save] não foi possível apagar:', error);
      this.setStatus('save.delete_failed');
      this.busy = false;
    }
  }
}
