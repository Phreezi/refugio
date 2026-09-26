import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { TICKS_PER_SECOND } from '../core/Clock';
import { eventBus } from '../core/EventBus';
import { DIFFICULTIES, gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView } from '../display/view';
import { coop } from '../net/coop';
import { getLanguage, LANGUAGES, setLanguage, t, tKey, type MessageKey } from '../i18n';
import { BALANCE } from '../data/balance';
import { WEAPON_SKILLS } from '../data/types';
import { missPct, skillLevel } from '../systems/combat/skills';
import { Button } from './Button';
import { preferences, setPreference } from './preferences';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { Label } from './text';
import { uiState } from './uiState';

const DEPTH = { dim: 80, panel: 82, content: 84 } as const;
const W = 200;
const ROW = 20;

type View = 'main' | 'settings' | 'stats' | 'coop';

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
  /** Erro ao abrir a sessão de co-op (mostra-se na vista do co-op). */
  private coopError = false;
  /** Sair para o menu inicial (a UIScene trata de gravar e mudar de cena). */
  onQuit: () => void = () => undefined;
  /** Abrir o painel de perícias (UIScene). */
  onSkills: () => void = () => undefined;

  private readonly offCoop: () => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // O parceiro ligou-se ou saiu: a vista do co-op mostra o estado novo.
    this.offCoop = eventBus.on('coop:changed', () => {
      if (this.view === 'coop') this.go('coop');
    });
  }

  get isOpen(): boolean {
    return this.view !== null;
  }

  open(view: View = 'main'): void {
    this.view = view;
    uiState.paused = true;
    uiState.modalOpen = true;
    coop.setAway(true); // co-op: o tempo não pára, mas os inimigos ignoram quem está em pausa
    this.build();
  }

  close(): void {
    this.clear();
    if (this.view !== null) coop.setAway(false);
    this.view = null;
    uiState.paused = false;
    uiState.modalOpen = false;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  destroy(): void {
    this.offCoop();
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
    const lines =
      this.view === 'main'
        ? 6
        : this.view === 'stats'
          ? 8 + this.skillRows().length
          : this.view === 'coop'
            ? 5
            : // Definições: 6 linhas + hordas e dificuldade (as do jogo) + "Voltar".
              gameState.hasGame && !coop.isGuest
              ? 9
              : 7;
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
      this.view === 'settings'
        ? 'pause.settings'
        : this.view === 'stats'
          ? 'pause.stats'
          : this.view === 'coop'
            ? 'coop.title'
            : 'pause.title';
    this.label(Math.round(width / 2), y + 8, t(title), { size: 10, bold: true, color: 'wheat' }, [0.5, 0]);
    const top = y + 34;
    const cx = Math.round(width / 2);
    if (this.view === 'main') this.buildMain(cx, top);
    else if (this.view === 'settings') this.buildSettings(x, top);
    else if (this.view === 'coop') this.buildCoop(cx, top);
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
        'pause.skills',
        () => {
          this.close();
          this.onSkills();
        },
      ],
      [
        'pause.stats',
        () => {
          this.go('stats');
        },
      ],
      // Co-op: o anfitrião convida (mostra o código); o convidado só pode sair.
      [
        coop.isGuest ? 'coop.leave' : 'coop.invite',
        () => {
          if (coop.isGuest) {
            this.close();
            this.onQuit();
          } else this.openCoop();
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

  /** Volume: barra deslizante (tocar ou arrastar); ouve-se um som ao largar. */
  /**
   * Barra deslizante (0–1). Arrasta-se livremente: depois de carregar na barra, segue o
   * ponteiro por todo o ecrã até se largar (mesmo que saia da barra).
   */
  private slider(
    x: number,
    y: number,
    title: string,
    key: 'volume' | 'musicVolume',
    onRelease: () => void,
  ): void {
    this.label(x + 10, y + 1, title, { size: 8, color: 'cream' });
    const width = 96;
    const left = x + W - 10 - width;
    const top = y + 5;
    const track = this.add(
      this.scene.add
        .rectangle(left - 6, top - 6, width + 12, 14, paletteNumber('night'), 0.001)
        .setOrigin(0)
        .setDepth(DEPTH.content)
        .setInteractive({ useHandCursor: true }),
    );
    this.add(
      this.scene.add
        .rectangle(left, top, width, 2, paletteNumber('shadow'))
        .setOrigin(0)
        .setDepth(DEPTH.content),
    );
    const fill = this.add(
      this.scene.add.rectangle(left, top, 0, 2, paletteNumber('gold')).setOrigin(0).setDepth(DEPTH.content),
    );
    const knob = this.add(
      this.scene.add
        .rectangle(left, top - 3, 4, 8, paletteNumber('cream'))
        .setOrigin(0)
        .setDepth(DEPTH.content),
    );
    const show = (value: number): void => {
      const px = Math.round(value * width);
      fill.width = px;
      knob.setX(Math.max(left, Math.min(left + width - 4, left + px - 2)));
    };
    const pick = (pointer: Phaser.Input.Pointer): void => {
      const px = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y).x;
      const value = Math.max(0, Math.min(1, Math.round(((px - left) / width) * 100) / 100));
      setPreference(key, value);
      show(value);
    };
    show(preferences()[key]);
    const input = this.scene.input;
    const move = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.isDown) pick(pointer);
    };
    const release = (): void => {
      input.off('pointermove', move);
      input.off('pointerup', release);
      input.off('pointerupoutside', release);
      onRelease();
    };
    track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pick(pointer);
      input.on('pointermove', move);
      input.on('pointerup', release);
      input.on('pointerupoutside', release);
    });
    // Se o painel fechar a meio de um arrasto, não fica nada à escuta.
    track.once('destroy', () => {
      input.off('pointermove', move);
      input.off('pointerup', release);
      input.off('pointerupoutside', release);
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
    this.slider(x, next(), t('pause.volume'), 'volume', () => {
      sfx.play('pickup'); // ouve-se o volume novo
    });
    this.slider(x, next(), t('pause.music'), 'musicVolume', () => {
      music.refresh();
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
    if (gameState.hasGame && !coop.isGuest) {
      const data = gameState.data;
      this.setting(x, next(), t('pause.hordes'), onOff(data.settings.hordes), () => {
        data.settings.hordes = !data.settings.hordes;
        if (data.settings.hordes && !data.horde.active) data.horde.at = 0; // marca-se a partir de agora
        gameState.markDirty();
      });
      // Dificuldade (§12): Relaxado → Normal → Difícil → Pesadelo; os inimigos ajustam-se logo.
      this.setting(x, next(), t('pause.difficulty'), tKey(`difficulty.${data.settings.difficulty}`), () => {
        const i = DIFFICULTIES.indexOf(data.settings.difficulty);
        data.settings.difficulty = DIFFICULTIES[(i + 1) % DIFFICULTIES.length] ?? 'normal';
        simulation.refreshDifficulty();
        gameState.markDirty();
      });
    }
    this.button(Math.round(x + W / 2), next() + 6, t('pause.back'), 80, () => {
      this.go('main');
    });
  }

  /** Abre a sessão (se ainda não houver) e mostra o código a partilhar. */
  private openCoop(): void {
    this.coopError = false;
    this.go('coop');
    if (coop.isHost) return;
    coop.host().then(
      () => {
        if (this.view === 'coop') this.go('coop');
      },
      (error: unknown) => {
        console.warn('[coop] não foi possível abrir a sessão:', error);
        this.coopError = true;
        if (this.view === 'coop') this.go('coop');
      },
    );
  }

  private buildCoop(cx: number, top: number): void {
    const code = coop.isHost ? coop.code : null;
    const status: MessageKey = this.coopError
      ? 'coop.error'
      : !code
        ? 'coop.creating'
        : coop.connected
          ? 'coop.connected'
          : 'coop.waiting';
    if (code) this.label(cx, top, code, { size: 20, bold: true, color: 'gold' }, [0.5, 0]);
    this.label(
      cx,
      top + ROW + 10,
      t(status),
      { size: 8, color: 'cream', wrap: W - 20, align: 'center' },
      [0.5, 0],
    );
    if (code) {
      this.button(cx, top + ROW * 3, t('coop.stop'), 120, () => {
        coop.leave();
        this.go('main');
      });
    }
    this.button(cx, top + ROW * 4, t('pause.back'), 80, () => {
      this.go('main');
    });
  }

  /** Perícias de combate já usadas: nível e % de falhar (§7.8). */
  private skillRows(): [MessageKey, string][] {
    if (!gameState.hasGame) return [];
    const skills = gameState.data.player.skills;
    return WEAPON_SKILLS.filter((skill) => (skills[skill] ?? 0) > 0).map((skill) => {
      const level = skillLevel(skills[skill] ?? 0, BALANCE);
      const ranged = skill === 'archery' || skill === 'firearms';
      return [
        `skill.${skill}`,
        t('pause.skill_value', { level, miss: Math.round(missPct(level, ranged, BALANCE)) }),
      ];
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
      ...this.skillRows(),
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
