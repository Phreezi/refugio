import Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { clockAt } from '../core/Clock';
import { FIXED_STEP_MS } from '../config';
import { eventBus } from '../core/EventBus';
import { advanceRespawns, offlineTicks } from '../core/offline';
import { simulation } from '../core/Simulation';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { BALANCE } from '../data/balance';
import { getView, setupFixedCamera } from '../display/view';
import { t, type MessageKey } from '../i18n';
import { autosave, saves } from '../save';
import type { LoadedSave, LoadResult } from '../save/SaveManager';
import { SaveError } from '../save/schema';
import { Button } from '../ui/Button';
import { downloadText, pickTextFile, saveFileName } from '../ui/fileTransfer';
import { Label } from '../ui/text';
import { uiState } from '../ui/uiState';
import { content } from '../world/content';
import { SceneKey } from './keys';
import type { ZoneSceneData } from './ZoneScene';

export interface MainMenuData {
  /** Mensagem a mostrar ao abrir (ex.: depois de importar ou apagar um save). */
  message?: MessageKey;
}

const MAIN_BUTTON = { width: 136, height: 22 } as const;
const SMALL_BUTTON = { width: 64, height: 14, fontSize: 8, style: 'secondary' } as const;
/** Tempo para confirmar uma ação destrutiva (segundo toque no mesmo botão). */
const CONFIRM_MS = 3000;

/**
 * Menu inicial: Continuar (se houver save), Novo jogo, e gestão do save
 * (Exportar/Importar/Apagar, CLAUDE.md §10.3). Rato, toque, Enter ou Espaço.
 */
export class MainMenuScene extends Phaser.Scene {
  private busy = false;
  private status: Label | null = null;
  private primaryAction: (() => void) | null = null;

  constructor() {
    super(SceneKey.MainMenu);
  }

  create(data: MainMenuData): void {
    this.busy = false;
    this.primaryAction = null;
    const { width, height } = getView();
    const cx = Math.round(width / 2);
    setupFixedCamera(this.cameras.main);
    this.cameras.main.setBackgroundColor(PALETTE.night);

    // Posições proporcionais à altura: a resolução do jogo depende do ecrã.
    new Label(
      this,
      cx,
      Math.round(height * 0.2),
      t('game.title'),
      { size: 32, color: 'wheat', bold: true },
      [0.5, 0],
    );
    this.status = new Label(
      this,
      cx,
      height - 30,
      data.message ? t(data.message) : t('menu.hint'),
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
    saves.load().then(
      (result) => {
        if (!alive) return;
        loading.destroy();
        this.buildButtons(result, data.message !== undefined);
      },
      (error: unknown) => {
        if (!alive) return;
        console.error('[save] não foi possível ler o save:', error);
        loading.destroy();
        this.buildButtons({ save: null, corrupted: false }, false);
        this.setStatus('save.read_failed');
      },
    );

    // Mudou a resolução (janela redimensionada, telemóvel rodado): refazer o menu.
    const onResize = (): void => {
      this.scene.restart({});
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      alive = false;
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });

    // Eventos nomeados (sem addKey) não capturam as teclas globalmente.
    const onKey = (): void => {
      this.primaryAction?.();
    };
    this.input.keyboard?.on('keydown-ENTER', onKey);
    this.input.keyboard?.on('keydown-SPACE', onKey);
  }

  private buildButtons(result: LoadResult, keepMessage: boolean): void {
    const { width, height } = getView();
    const cx = Math.round(width / 2);
    const y = Math.round(height * 0.5);
    const save = result.save;

    if (save) {
      const time = clockAt(save.state.world.tick, BALANCE.dayLengthSec, BALANCE.dayStartHour);
      this.primaryAction = () => {
        this.continueGame(save);
      };
      new Button(this, cx, y, t('menu.continue', { day: time.day }), MAIN_BUTTON, this.primaryAction);
      this.confirmButton(
        cx,
        y + 30,
        'menu.new_game',
        'menu.confirm_new',
        { ...MAIN_BUTTON, style: 'secondary' },
        () => {
          this.startNewGame();
        },
      );
    } else {
      this.primaryAction = () => {
        this.startNewGame();
      };
      new Button(this, cx, y, t('menu.new_game'), MAIN_BUTTON, this.primaryAction);
    }

    // Gestão do save: linha de botões pequenos.
    const rowY = height - 50;
    const actions: [MessageKey, (x: number) => void][] = [];
    if (save) {
      actions.push([
        'save.export',
        (x) =>
          new Button(this, x, rowY, t('save.export'), SMALL_BUTTON, () => {
            downloadText(saveFileName(new Date()), save.text);
            this.setStatus('save.exported');
          }),
      ]);
    }
    actions.push([
      'save.import',
      (x) =>
        new Button(this, x, rowY, t('save.import'), SMALL_BUTTON, () => {
          void this.importSave();
        }),
    ]);
    if (save) {
      actions.push([
        'save.delete',
        (x) => {
          this.confirmButton(x, rowY, 'save.delete', 'save.confirm_delete', SMALL_BUTTON, () => {
            void this.deleteSave();
          });
        },
      ]);
    }
    const spacing = SMALL_BUTTON.width + 8;
    const firstX = cx - Math.round(((actions.length - 1) * spacing) / 2);
    actions.forEach(([, make], i) => {
      make(firstX + i * spacing);
    });

    if (result.corrupted && !keepMessage) this.setStatus(save ? 'save.recovered' : 'save.corrupt_lost');
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

  private setStatus(key: MessageKey): void {
    this.status?.setText(t(key));
  }

  private continueGame(save: LoadedSave): void {
    if (this.busy) return; // Enter com a tecla presa repete o evento
    this.busy = true;
    const state = gameState.load(save.state);
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

  private startNewGame(): void {
    if (this.busy) return;
    this.busy = true;
    const state = gameState.newGame(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    eventBus.emit('game:started', { zoneId: state.player.zoneId });
    void autosave.flush(); // o jogo novo substitui já o antigo
    this.scene.start(SceneKey.Zone, { zoneId: BASE_ZONE_ID } satisfies ZoneSceneData);
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
