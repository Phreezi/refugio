import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { TICKS_PER_SECOND } from '../core/Clock';
import { gameState } from '../core/GameState';
import { getView } from '../display/view';
import { getLanguage, LANGUAGES, setLanguage, t, type MessageKey } from '../i18n';
import { Button } from './Button';
import { preferences, setPreference, UI_SIZES } from './preferences';
import { Label } from './text';
import { uiState } from './uiState';

const DEPTH = { dim: 80, panel: 82, content: 84 } as const;
const W = 200;
const ROW = 20;

type View = 'main' | 'settings' | 'stats';

interface Destroyable {
  destroy(): void;
}

/**
 * Menu de pausa (CLAUDE.md §11, Fase 11): Esc ou o botão "II". O jogo pára enquanto está aberto.
 * Tem as definições (língua, tamanho da interface, números de dano, vibração, modo daltónico,
 * hordas) e as estatísticas do jogador.
 */
export class PauseUI {
  private readonly scene: Phaser.Scene;
  private objects: Destroyable[] = [];
  private view: View | null = null;
  /** Sair para o menu inicial (a UIScene trata de gravar e mudar de cena). */
  onQuit: () => void = () => undefined;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isOpen(): boolean {
    return this.view !== null;
  }

  open(view: View = 'main'): void {
    this.view = view;
    uiState.paused = true;
    uiState.modalOpen = true;
    this.build();
  }

  close(): void {
    this.clear();
    this.view = null;
    uiState.paused = false;
    uiState.modalOpen = false;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  destroy(): void {
    this.close();
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }

  private add<T extends Destroyable>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  /** Os botões chamam isto a partir do próprio clique: mudar de vista só no frame seguinte. */
  private go(view: View | null): void {
    this.scene.time.delayedCall(0, () => {
      if (view === null) this.close();
      else {
        this.view = view;
        this.build();
      }
    });
  }

  private build(): void {
    this.clear();
    const { width, height } = getView();
    const lines = this.view === 'main' ? 4 : this.view === 'stats' ? 8 : 7;
    const h = Math.min(height - 8, 34 + lines * ROW + 10);
    const x = Math.round((width - W) / 2);
    const y = Math.max(4, Math.round((height - h) / 2));
    this.add(
      this.scene.add
        .rectangle(0, 0, width, height, paletteNumber('ink'), 0.7)
        .setOrigin(0)
        .setDepth(DEPTH.dim)
        .setInteractive(), // tapa os toques no jogo por baixo
    );
    this.add(
      this.scene.add.rectangle(x, y, W, h, paletteNumber('bark_dark')).setOrigin(0).setDepth(DEPTH.panel),
    );
    this.add(
      this.scene.add
        .rectangle(x + 1, y + 1, W - 2, h - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(DEPTH.panel),
    );
    const title: MessageKey =
      this.view === 'settings' ? 'pause.settings' : this.view === 'stats' ? 'pause.stats' : 'pause.title';
    this.label(Math.round(width / 2), y + 8, t(title), { size: 10, bold: true, color: 'wheat' }, [0.5, 0]);
    const top = y + 34;
    const cx = Math.round(width / 2);
    if (this.view === 'main') this.buildMain(cx, top);
    else if (this.view === 'settings') this.buildSettings(x, top);
    else this.buildStats(x, top);
  }

  private buildMain(cx: number, top: number): void {
    const entries: [MessageKey, () => void][] = [
      [
        'pause.resume',
        () => {
          this.go(null);
        },
      ],
      [
        'pause.settings',
        () => {
          this.go('settings');
        },
      ],
      [
        'pause.stats',
        () => {
          this.go('stats');
        },
      ],
      [
        'pause.quit',
        () => {
          this.close();
          this.onQuit();
        },
      ],
    ];
    entries.forEach(([key, action], i) => {
      this.button(cx, top + i * ROW + 6, t(key), 120, action, i === 0);
    });
  }

  /** Uma linha de definição: nome à esquerda, valor num botão à direita (tocar muda). */
  private setting(x: number, y: number, label: string, value: string, onClick: () => void): void {
    this.label(x + 10, y + 1, label, { size: 8, color: 'cream' });
    this.button(x + W - 10 - 36, y + 6, value, 72, () => {
      onClick();
      this.go('settings');
    });
  }

  private buildSettings(x: number, top: number): void {
    const prefs = preferences();
    const onOff = (on: boolean): string => t(on ? 'pause.on' : 'pause.off');
    let row = 0;
    const next = (): number => top + row++ * ROW;
    this.setting(x, next(), t('pause.language'), t(`lang.${getLanguage()}`), () => {
      const i = LANGUAGES.indexOf(getLanguage());
      const language = LANGUAGES[(i + 1) % LANGUAGES.length] ?? 'pt-PT';
      setPreference('language', language);
      setLanguage(language);
      document.documentElement.lang = language;
      // O HUD e a cena de jogo refazem-se com os textos novos.
      uiState.reopenPause = 'settings';
      this.scene.events.emit('ui:language-changed');
    });
    this.setting(x, next(), t('pause.ui_size'), t(`pause.size.${prefs.uiSize}`), () => {
      const i = UI_SIZES.indexOf(prefs.uiSize);
      setPreference('uiSize', UI_SIZES[(i + 1) % UI_SIZES.length] ?? 'normal');
      uiState.reopenPause = 'settings';
      window.dispatchEvent(new Event('resize')); // a escala recalcula-se com o alvo novo
    });
    this.setting(x, next(), t('pause.damage_numbers'), onOff(prefs.damageNumbers), () => {
      setPreference('damageNumbers', !prefs.damageNumbers);
    });
    this.setting(x, next(), t('pause.vibration'), onOff(prefs.vibration), () => {
      setPreference('vibration', !prefs.vibration);
    });
    this.setting(x, next(), t('pause.colorblind'), onOff(prefs.colorblind), () => {
      setPreference('colorblind', !prefs.colorblind);
    });
    if (gameState.hasGame) {
      const data = gameState.data;
      this.setting(x, next(), t('pause.hordes'), onOff(data.settings.hordes), () => {
        data.settings.hordes = !data.settings.hordes;
        if (data.settings.hordes && !data.horde.active) data.horde.at = 0; // marca-se a partir de agora
        gameState.markDirty();
      });
    }
    this.button(Math.round(x + W / 2), next() + 6, t('pause.back'), 80, () => {
      this.go('main');
    });
  }

  private buildStats(x: number, top: number): void {
    if (!gameState.hasGame) return;
    const { stats, player } = gameState.data;
    const minutes = Math.floor(stats.playTicks / TICKS_PER_SECOND / 60);
    const rows: [MessageKey, string][] = [
      ['stats.level', String(player.level)],
      ['stats.time', t('stats.minutes', { h: Math.floor(minutes / 60), m: minutes % 60 })],
      ['stats.kills', String(stats.kills)],
      ['stats.deaths', String(stats.deaths)],
      ['stats.crafted', String(stats.crafted)],
      ['stats.gathered', String(stats.gathered)],
      ['stats.looted', String(stats.looted)],
    ];
    rows.forEach(([key, value], i) => {
      const y = top + i * ROW;
      this.label(x + 10, y, t(key), { size: 8, color: 'cream' });
      this.label(x + W - 10, y, value, { size: 8, bold: true, color: 'gold' }, [1, 0]);
    });
    this.button(Math.round(x + W / 2), top + rows.length * ROW + 6, t('pause.back'), 80, () => {
      this.go('main');
    });
  }

  private label(
    x: number,
    y: number,
    text: string,
    style: ConstructorParameters<typeof Label>[4],
    origin?: [number, number],
  ): Label {
    return this.add(new Label(this.scene, x, y, text, style, origin).setDepth(DEPTH.content));
  }

  private button(x: number, y: number, text: string, width: number, onClick: () => void, primary = false) {
    return this.add(
      new Button(
        this.scene,
        x,
        y,
        text,
        { width, height: 16, fontSize: 8, style: primary ? 'primary' : 'secondary' },
        onClick,
      ).setDepth(DEPTH.content),
    );
  }
}
