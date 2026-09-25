import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { clockAt } from '../core/Clock';
import { eventBus } from '../core/EventBus';
import { BASE_ZONE_ID, gameState, type PlayerState } from '../core/GameState';
import { hoursToTicks } from '../core/Homestead';
import { simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import type { SkillId } from '../data/types';
import { getView, setupFixedCamera } from '../display/view';
import { pinchStep, stepWorldZoom } from '../display/worldZoom';
import { itemName, t, tKey, type MessageKey } from '../i18n';
import { coop } from '../net/coop';
import { content } from '../world/content';
import { readJoystick } from '../input/joystick';
import { moveInput } from '../input/moveInput';
import { Button, CLOSE_ICON } from '../ui/Button';
import { BuildUI } from '../ui/BuildUI';
import { buildMode, pickTile, type Tile } from '../ui/buildMode';
import { gameSpeed, nextGameSpeed } from '../ui/gameSpeed';
import { CraftingUI } from '../ui/CraftingUI';
import { FishingUI } from '../ui/FishingUI';
import { LevelUpUI } from '../ui/LevelUpUI';
import { PauseUI } from '../ui/PauseUI';
import { DialogUI, goalText } from '../ui/DialogUI';
import { MapUI } from '../ui/MapUI';
import { SkillsUI, skillEffectText } from '../ui/SkillsUI';
import { preferences, setPreference } from '../ui/preferences';
import { autosave } from '../save';
import { InventoryUI } from '../ui/InventoryUI';
import { Label, measureTextWidth } from '../ui/text';
import { SLOT_SIZE } from '../ui/SlotView';
import { uiState } from '../ui/uiState';
import { xpToNext } from '../systems/progression/progression';
import { countItem } from '../systems/inventory/inventory';
import { missingInputs } from '../systems/crafting/crafting';
import { SceneKey, ZONE_CROSSED_EVENT } from './keys';

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
/** Abaixo desta largura (ecrã ao alto), a dica do tutorial vai para baixo das barras. */
const NARROW_HUD_WIDTH = 420;
const HINT_Y_NARROW = 60;
const BAR_WIDTH = 60;
const BAR_HEIGHT = 6;
const BAR_SPACING = 11;
/** Moldura de dano: faixas de 4 px, da borda para dentro, cada vez mais transparentes. */
const HURT_BAND = 4;
const HURT_BANDS = [0.5, 0.32, 0.18, 0.08] as const;
const HURT_FADE_MS = 450;
/** Largura da barra do chefe (px de jogo). */
const BOSS_BAR = 120;
/** Piscar das barras abaixo de BALANCE.lowStatPct (CLAUDE.md §2: aviso aos 30%). */
const BLINK_MS = 400;
const NOTICE_MS = 5000;
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
  /** O que o aviso atual faz se se tocar nele (ou Enter). */
  private noticeAction: (() => void) | null = null;
  private noticeTimer: Phaser.Time.TimerEvent | null = null;
  private inventory: InventoryUI | null = null;
  private crafting: CraftingUI | null = null;
  private build: BuildUI | null = null;
  private fishing: FishingUI | null = null;
  private levelUp: LevelUpUI | null = null;
  private levelLabel: Label | null = null;
  private coinLabel: Label | null = null;
  /** Barra do chefe (em cima, ao centro), só com um chefe na zona. */
  private bossBar: {
    label: Label;
    back: Phaser.GameObjects.Rectangle;
    fill: Phaser.GameObjects.Rectangle;
  } | null = null;
  private pause: PauseUI | null = null;
  /** Bordas do ecrã avermelhadas ao levar dano (em vez de abanar a câmara). */
  private hurtEdges: Phaser.GameObjects.Container | null = null;
  /** Dica do tutorial (em cima, ao centro) e o × que a desliga. */
  private hint: { label: Label; close: Button | null; step: string | null; x: number; y: number } | null =
    null;
  /** "A sangrar" (por baixo da barra de XP), a piscar. */
  private bleedLabel: Label | null = null;
  /** Proteção de principiante (armas sem desgaste até ao dia 4). */
  private beginnerLabel: Label | null = null;
  /** Missão em curso (§7.18): título e o que falta, por baixo das barras. */
  private questLabel: Label | null = null;
  private dialog: DialogUI | null = null;
  private worldMap: MapUI | null = null;
  private seedHintShown = false;
  /** Aviso da horda (por baixo da velocidade): quanto falta, ou quantos restam. */
  private hordeLabel: Label | null = null;
  /** Estado do co-op (código / ligado / convidado). */
  private coopLabel: Label | null = null;
  private coopWasConnected = coop.connected;
  private xpFill: Phaser.GameObjects.Rectangle | null = null;
  /** Botão de ação (toque): escondido no modo construção. */
  private actionButton: { setVisible(visible: boolean): unknown }[] = [];
  /** Botão "Construir": escondido no modo construção (a paleta ocupa o sítio; há o Sair). */
  private buildButton: Button | null = null;
  private autoButton: Button | null = null;
  /** Talento ativo "Correr" (só aparece depois de o aprender). */
  private sprintButton: Button | null = null;
  private sprintVisible = true;
  /** O botão "Correr" está aceso (a correr). */
  private sprintReady = false;
  private skills: SkillsUI | null = null;
  /** Arma equipada e munição (junto à hotbar): ícone e contagem (até `quiverDisplayMax`). */
  private weaponView: {
    ammo: Phaser.GameObjects.Image;
    count: Label;
    ammoItem: string | null;
  } | null = null;
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
    this.createHurtEdges();
    const { width, height } = getView();
    this.clock = new Label(
      this,
      width - HUD_MARGIN,
      HUD_MARGIN,
      '',
      { size: 8, color: 'cream', bold: true },
      [1, 0],
    );
    const bossX = Math.round(width / 2);
    const cx = Math.round(width / 2);
    // Num ecrã estreito (ao alto) a dica não cabe entre as barras e o relógio: vai por baixo.
    const hintY = width < NARROW_HUD_WIDTH ? HINT_Y_NARROW : HUD_MARGIN + 24;
    this.hint = {
      y: hintY,
      label: new Label(
        this,
        cx,
        hintY,
        '',
        {
          size: 8,
          bold: true,
          color: 'wheat',
          stroke: true,
          align: 'center',
          wrap: Math.min(260, width - 60),
        },
        [0.5, 0],
      ).setDepth(40),
      close: null,
      step: null,
      x: cx,
    };
    this.bossBar = {
      label: new Label(
        this,
        bossX,
        HUD_MARGIN,
        '',
        { size: 8, bold: true, color: 'red', stroke: true },
        [0.5, 0],
      ),
      back: this.add
        .rectangle(bossX - BOSS_BAR / 2 - 1, HUD_MARGIN + 12, BOSS_BAR + 2, 6, paletteNumber('ink'))
        .setOrigin(0),
      fill: this.add
        .rectangle(bossX - BOSS_BAR / 2, HUD_MARGIN + 13, BOSS_BAR, 4, paletteNumber('red'))
        .setOrigin(0),
    };
    this.coopLabel = new Label(
      this,
      width - HUD_MARGIN,
      HUD_MARGIN + 40,
      '',
      { size: 7, color: 'wheat', bold: true, stroke: true },
      [1, 0],
    ).setDepth(70);
    this.updateCoopLabel();
    this.hordeLabel = new Label(
      this,
      width - HUD_MARGIN,
      HUD_MARGIN + 30,
      '',
      { size: 7, color: 'amber', bold: true, stroke: true },
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
    // Tocar no aviso faz o que ele propõe (ex.: fazer o machado que falta).
    this.notice.text.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.runNoticeAction();
    });

    this.inventory = new InventoryUI(this, simulation.actions);
    this.crafting = new CraftingUI(this, simulation);
    this.build = new BuildUI(this, simulation, this.inventory.hotbarRect().y);
    this.fishing = new FishingUI(this, simulation);
    this.levelUp = new LevelUpUI(this);
    this.pause = new PauseUI(this);
    this.pause.onQuit = () => {
      this.quitToMenu();
    };
    this.skills = new SkillsUI(this);
    this.dialog = new DialogUI(this);
    this.worldMap = new MapUI(this);
    this.pause.onSkills = () => {
      this.skills?.open();
    };
    this.build.onToggle = (open) => {
      for (const obj of this.actionButton) obj.setVisible(!open);
      this.buildButton?.setVisible(!open && this.build?.available === true);
      // No modo construção, o Auto não fica por cima dos botões Colocar/Sair.
      this.autoButton?.setVisible(!open);
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
    if (uiState.reopenPause) {
      this.pause.open(uiState.reopenPause);
      uiState.reopenPause = null;
    }
    const onLanguage = (): void => {
      this.scene.restart({});
    };
    this.events.on('ui:language-changed', onLanguage);
    // Mundo contínuo: passou a andar para outra zona (o HUD continua, só muda o que depende dela).
    const onZoneCrossed = (zoneId: string): void => {
      if (this.build?.isOpen) this.build.close();
      this.buildButton?.setVisible(this.build?.available === true && !buildMode.active);
      this.showNotice(tKey(content.zones[zoneId]?.name ?? zoneId));
    };
    this.events.on(ZONE_CROSSED_EVENT, onZoneCrossed);

    // Mudou a resolução ou o zoom: refazer o HUD com a vista nova.
    const onResize = (): void => {
      this.scene.restart({});
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offEvents();
      this.events.off('ui:language-changed', onLanguage);
      this.events.off(ZONE_CROSSED_EVENT, onZoneCrossed);
      this.pause?.destroy();
      this.pause = null;
      this.skills?.destroy();
      this.skills = null;
      this.dialog?.destroy();
      this.dialog = null;
      this.worldMap?.destroy();
      this.worldMap = null;
      this.questLabel = null;
      this.sprintButton = null;
      this.sprintVisible = true;
      this.sprintReady = false;
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      moveInput.joystick = { x: 0, y: 0 };
      uiState.actionHeld = false;
      this.inventory?.destroy();
      this.inventory = null;
      this.crafting?.destroy();
      this.crafting = null;
      this.build?.destroy();
      this.build = null;
      this.fishing?.destroy();
      this.fishing = null;
      this.levelUp?.destroy();
      this.levelUp = null;
      this.levelLabel = null;
      this.coinLabel = null;
      this.hordeLabel = null;
      this.coopLabel = null;
      this.bleedLabel = null;
      this.beginnerLabel = null;
      this.bossBar = null;
      this.hint = null;
      this.hurtEdges = null;
      this.xpFill = null;
      this.actionButton = [];
      this.buildButton = null;
      this.autoButton = null;
      this.weaponView = null;
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
    this.fishing?.update();
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
    // Nível e XP (barra fina por baixo das outras).
    this.levelLabel?.setText(t('level.short', { level: player.level }));
    this.coinLabel?.setText(String(player.coins));
    if (this.xpFill) {
      const need = xpToNext(player.level, BALANCE.xpCurve);
      const full = player.level >= BALANCE.maxLevel;
      this.xpFill.width = full ? BAR_WIDTH : Math.round((BAR_WIDTH * player.xp) / need);
    }
    const clock = clockAt(world.tick, BALANCE.dayLengthSec, BALANCE.dayStartHour);
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.clock?.setText(t('hud.clock', { day: clock.day, time: `${pad(clock.hour)}:${pad(clock.minute)}` }));
    this.hordeLabel?.setText(this.hordeStatus());
    if (this.sprintButton) {
      const visible = !uiState.modalOpen && !buildMode.active;
      const running = moveInput.run;
      if (visible !== this.sprintVisible) {
        this.sprintVisible = visible;
        this.sprintButton.setVisible(visible);
      }
      if (running !== this.sprintReady) {
        this.sprintReady = running;
        this.sprintButton.setStyle(running ? 'primary' : 'secondary');
      }
    }
    this.bleedLabel?.setVisible(player.bleed > 0 && !blinkOff);
    this.beginnerLabel?.setVisible(simulation.combat.beginner && !uiState.modalOpen);
    this.renderQuest();
    this.renderBossBar();
    this.renderHint();
    this.renderWeapon();
  }

  /** Arma equipada (ícone) e, se for à distância, quantas munições tem (no máximo mostra 999). */
  private renderWeapon(): void {
    const view = this.weaponView;
    if (!view) return;
    const slot = gameState.data.player.equipment[0];
    const def = slot ? content.items[slot[0]] : undefined;
    const visible = def?.ranged !== undefined && !uiState.modalOpen && !buildMode.active;
    // A munição em uso (ícone e quantas há dessa); a vermelho se acabou.
    const active = visible ? simulation.combat.activeAmmo() : null;
    const ammoDef = active ? content.items[active.item] : undefined;
    view.count.setVisible(visible);
    view.ammo.setVisible(visible && ammoDef !== undefined);
    if (ammoDef && active && active.item !== view.ammoItem) view.ammo.setTexture(ammoDef.icon);
    view.ammoItem = active?.item ?? null;
    if (visible) {
      const qty = active?.qty ?? 0;
      view.count.setText(String(Math.min(qty, BALANCE.quiverDisplayMax))).setColor(qty > 0 ? 'cream' : 'red');
    }
  }

  /** Dica do tutorial do passo atual (texto de teclado ou de toque); escondida sem passo. */
  private renderHint(): void {
    const hint = this.hint;
    if (!hint) return;
    const step = simulation.tutorial.current();
    if (step === hint.step) return;
    hint.step = step;
    hint.label.setVisible(step !== null);
    hint.close?.destroy();
    hint.close = null;
    if (!step) return;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    hint.label.setText(tKey(`tut.${step}.${touch ? 'touch' : 'keys'}`));
    // O × (desligar as dicas) fica à direita do texto.
    hint.close = new Button(
      this,
      Math.round(hint.x + hint.label.text.width / 2 + 10),
      hint.y + 6,
      CLOSE_ICON,
      { width: 12, height: 12, fontSize: 8, style: 'secondary' },
      () => {
        simulation.tutorial.dismiss();
      },
    ).setDepth(40);
  }

  /**
   * Moldura vermelha nas 4 bordas do ecrã, em faixas cada vez mais transparentes para dentro
   * (degraus, estilo pixel art). Fica invisível até o jogador levar dano.
   */
  private createHurtEdges(): void {
    const { width, height } = getView();
    const edges = this.add.container(0, 0).setDepth(35).setAlpha(0);
    const color = paletteNumber('red');
    HURT_BANDS.forEach((alpha, i) => {
      const o = i * HURT_BAND;
      edges.add([
        this.add.rectangle(o, o, width - 2 * o, HURT_BAND, color, alpha).setOrigin(0),
        this.add.rectangle(o, height - o - HURT_BAND, width - 2 * o, HURT_BAND, color, alpha).setOrigin(0),
        this.add
          .rectangle(o, o + HURT_BAND, HURT_BAND, height - 2 * o - 2 * HURT_BAND, color, alpha)
          .setOrigin(0),
        this.add
          .rectangle(
            width - o - HURT_BAND,
            o + HURT_BAND,
            HURT_BAND,
            height - 2 * o - 2 * HURT_BAND,
            color,
            alpha,
          )
          .setOrigin(0),
      ]);
    });
    this.hurtEdges = edges;
  }

  /** Acende a moldura vermelha e apaga-a depressa. */
  private flashHurtEdges(): void {
    const edges = this.hurtEdges;
    if (!edges) return;
    this.tweens.killTweensOf(edges);
    edges.setAlpha(1);
    this.tweens.add({ targets: edges, alpha: 0, duration: HURT_FADE_MS, ease: 'Quad.easeIn' });
  }

  /** Barra de vida do chefe da zona (escondida sem chefe). */
  private renderBossBar(): void {
    const bar = this.bossBar;
    if (!bar) return;
    const boss = simulation.combat.list.find((e) => content.enemies[e.id]?.boss === true);
    const def = boss ? content.enemies[boss.id] : undefined;
    const visible = boss !== undefined && def !== undefined;
    bar.label.setVisible(visible);
    bar.back.setVisible(visible);
    bar.fill.setVisible(visible);
    if (!boss || !def) return;
    bar.label.setText(tKey(`enemy.${boss.id}`));
    bar.fill.width = Math.max(0, Math.round((BOSS_BAR * boss.hp) / boss.maxHp));
  }

  /** Texto do aviso da horda (vazio se as hordas estiverem desligadas ou ainda longe). */
  private hordeStatus(): string {
    const { settings, horde, world, player } = gameState.data;
    if (!settings.hordes || horde.at === 0) return '';
    if (horde.active && player.zoneId === BASE_ZONE_ID)
      return t('horde.active', { n: simulation.combat.hordeLeft });
    if (horde.active || world.tick >= horde.at) return t('horde.waiting');
    const hours = Math.ceil((horde.at - world.tick) / hoursToTicks(1));
    return hours <= 24 ? t('horde.soon', { hours }) : '';
  }

  /** Mensagem curta no centro-alto do ecrã (substitui a anterior). */
  private showNotice(text: string, action: (() => void) | null = null): void {
    this.noticeAction = action;
    this.notice?.setText(text).setVisible(true);
    this.noticeTimer?.remove();
    this.noticeTimer = this.time.delayedCall(NOTICE_MS, () => {
      this.notice?.setVisible(false);
      this.noticeAction = null;
    });
  }

  /** Faz a ação do aviso que está no ecrã (toque no aviso ou Enter). */
  private runNoticeAction(): void {
    const action = this.noticeAction;
    if (!action || !this.notice?.text.visible) return;
    this.noticeAction = null;
    this.notice.setVisible(false);
    action();
  }

  /**
   * Falta a ferramenta para recolher: se der para a fazer nas mãos, o aviso propõe fazê-la
   * (toque no aviso ou Enter); senão diz o que é preciso.
   */
  private needsTool(tool: 'axe' | 'pickaxe'): void {
    const base = t(tool === 'pickaxe' ? 'msg.needs_pickaxe' : 'msg.needs_axe');
    const player = gameState.data.player;
    const containers = [player.inventory, player.hotbar];
    const recipes = content.recipes
      .filter((r) => r.station === 'hands' && content.items[r.output]?.toolKind === tool)
      .filter((r) => simulation.progression.isRecipeUnlocked(r))
      .sort(
        (a, b) => (content.items[b.output]?.gatherPower ?? 0) - (content.items[a.output]?.gatherPower ?? 0),
      );
    const recipe = recipes.find((r) => missingInputs(containers, r).length === 0);
    if (recipe) {
      const key = this.sys.game.device.input.touch ? 'msg.make_tool_touch' : 'msg.make_tool_keys';
      this.showNotice(`${base}\n${t(key, { item: itemName(recipe.output) })}`, () => {
        const result = simulation.crafting.craft(recipe.id, null);
        this.showNotice(
          result === 'ok'
            ? t('craft.crafted', {
                qty: recipe.qty,
                item: itemName(recipe.output),
                total: countItem(containers, recipe.output),
              })
            : t(result === 'no_space' ? 'msg.inventory_full' : 'craft.missing'),
        );
      });
      return;
    }
    const cheapest = recipes[recipes.length - 1];
    const needs = cheapest?.inputs.map(({ item, qty }) => `${String(qty)} ${itemName(item)}`).join(' + ');
    this.showNotice(needs ? `${base}\n${t('msg.tool_needs', { needs })}` : base);
  }

  private listenForMessages(): () => void {
    const offs = [
      eventBus.on('coop:changed', () => {
        this.updateCoopLabel();
        // Anfitrião: o parceiro entrou ou saiu.
        if (coop.isHost && coop.connected !== this.coopWasConnected)
          this.showNotice(
            coop.connected
              ? t('coop.partner_joined_name', { name: coop.partnerName ?? '?' })
              : t('coop.partner_left'),
          );
        this.coopWasConnected = coop.connected;
      }),
      eventBus.on('player:died', ({ zoneId, bag }) => {
        const zone = tKey(content.zones[zoneId]?.name ?? zoneId);
        // A cena de jogo pode mudar (morreu noutra zona): a mensagem fica para o HUD novo.
        uiState.pendingNotice = bag ? `${t('hud.died')}\n${t('msg.bag_dropped', { zone })}` : t('hud.died');
        this.showNotice(uiState.pendingNotice);
        if (zoneId === gameState.data.player.zoneId) uiState.pendingNotice = null;
      }),
      eventBus.on('item:enchanted', ({ item, level }) => {
        this.showNotice(t('msg.enchanted', { item: itemName(item), level }));
      }),
      eventBus.on('talents:reset', () => {
        this.showNotice(t('skills.reset_done'));
      }),
      // NPCs e missões (§7.18).
      eventBus.on('npc:talk', ({ npc }) => {
        this.closePanels();
        this.dialog?.open(npc);
      }),
      eventBus.on('quest:accepted', ({ quest }) => {
        this.showNotice(t('quest.accepted', { title: tKey(`quest.${quest}`) }));
      }),
      eventBus.on('quest:done', ({ quest }) => {
        this.showNotice(t('quest.completed', { title: tKey(`quest.${quest}`) }));
      }),
      eventBus.on('waystone:activated', () => {
        this.showNotice(t('msg.waystone_on'));
      }),
      // Take-away (§7.17): a encomenda chegou à porta; comida com efeito temporário.
      eventBus.on('order:arrived', ({ item, qty }) => {
        this.showNotice(t('msg.order_arrived', { qty, item: itemName(item) }));
      }),
      eventBus.on('buff:started', ({ effect, value, hours }) => {
        this.showNotice(t('msg.buff', { effect: tKey(`talent_effect.${effect}`, { v: value }), h: hours }));
      }),
      eventBus.on('action:blocked', ({ reason, tool, item, hours, level }) => {
        if (reason === 'inventory_full') this.showNotice(t('msg.inventory_full'));
        else if (reason === 'door_blocked') this.showNotice(t('build.problem.door_blocked'));
        else if (reason === 'needs_rod') this.showNotice(t('fish.needs'));
        else if (reason === 'needs_seeds') this.showNotice(t('farm.needs_seeds'));
        else if (reason === 'needs_water') this.showNotice(t('farm.needs_water'));
        else if (reason === 'crop_growing')
          this.showNotice(t('farm.growing', { hours: Math.max(1, hours ?? 1) }));
        else if (reason === 'nothing_yet') this.showNotice(t('farm.nothing_yet'));
        else if (reason === 'needs_level') this.showNotice(t('msg.needs_level', { level: level ?? 1 }));
        else if (reason === 'zone_level') this.showNotice(t('msg.zone_level', { level: level ?? 1 }));
        else if (reason === 'post_broken') this.showNotice(t('msg.post_broken'));
        else if (reason === 'food_only') this.showNotice(t('msg.food_only'));
        else if (reason === 'no_ammo') this.showNotice(t('msg.no_ammo', { item: itemName(item ?? '') }));
        else if (reason === 'needs_item')
          this.showNotice(t('msg.needs_item', { item: itemName(item ?? '') }));
        else this.needsTool(tool === 'pickaxe' ? 'pickaxe' : 'axe');
      }),
      eventBus.on('dungeon:checkpoint', ({ floor }) => {
        this.showNotice(t('msg.checkpoint', { floor }));
      }),
      eventBus.on('boss:defeated', () => {
        this.showNotice(t('msg.boss_defeated'));
      }),
      eventBus.on('player:damaged', () => {
        this.flashHurtEdges();
        // Vibrar ao levar dano (telemóvel), se o jogador não o desligou.
        if (preferences().vibration && 'vibrate' in navigator) navigator.vibrate(40);
      }),
      eventBus.on('player:bleeding', () => {
        this.showNotice(t('msg.bleeding'));
      }),
      // Sementes: como se planta (uma vez por sessão).
      eventBus.on('item:gained', ({ item }) => {
        if (this.seedHintShown || !content.items[item]?.plant) return;
        this.seedHintShown = true;
        this.showNotice(t('msg.seeds_hint'));
      }),
      eventBus.on('skill:levelUp', ({ skill, level }) => {
        this.showNotice(`${tKey(`skill.${skill}`)}: ${skillEffectText(skill as SkillId, level)}`);
      }),
      eventBus.on('horde:started', ({ size }) => {
        this.showNotice(t('horde.started', { n: size }));
      }),
      eventBus.on('horde:ended', ({ won }) => {
        this.showNotice(t(won ? 'horde.won' : 'horde.lost'));
      }),
      eventBus.on('structure:destroyed', () => {
        this.showNotice(t('horde.destroyed'));
      }),
      eventBus.on('structure:repaired', () => {
        this.showNotice(t('horde.repaired'));
      }),
      eventBus.on('recipe:learned', ({ recipe }) => {
        const output = content.recipes.find((r) => r.id === recipe)?.output ?? recipe;
        this.showNotice(t('msg.learned', { item: itemName(output) }));
      }),
      eventBus.on('note:known', () => {
        this.showNotice(t('msg.note_known'));
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
      // Centrada na barra (a letra é mais alta do que a barra) e com sombra por cima do mundo.
      const label = new Label(
        this,
        HUD_MARGIN,
        y + BAR_HEIGHT / 2,
        t(stat.label),
        { size: 7, color: 'cream', bold: true, stroke: true },
        [0, 0.5],
      );
      // Contorno (retângulo maior por trás), fundo e enchimento; origem 0 e posições inteiras.
      this.add.rectangle(BAR_X - 1, y - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2, paletteNumber('ink')).setOrigin(0);
      this.add.rectangle(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber('shadow')).setOrigin(0);
      const fill = this.add
        .rectangle(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber(stat.color))
        .setOrigin(0);
      return { key: stat.key, label, fill };
    });
    const y = HUD_MARGIN + STATS.length * BAR_SPACING;
    this.levelLabel = new Label(
      this,
      HUD_MARGIN,
      y + 2,
      '',
      { size: 7, color: 'gold', bold: true, stroke: true },
      [0, 0.5],
    );
    // Moedas (§7.16): à direita da barra de XP.
    this.add
      .image(BAR_X + BAR_WIDTH + 5, y + 2, 'icon_coin')
      .setOrigin(0, 0.5)
      .setScale(0.5);
    this.coinLabel = new Label(
      this,
      BAR_X + BAR_WIDTH + 15,
      y + 2,
      '',
      { size: 7, color: 'gold', bold: true, stroke: true },
      [0, 0.5],
    );
    this.add.rectangle(BAR_X - 1, y, BAR_WIDTH + 2, 4, paletteNumber('ink')).setOrigin(0);
    this.xpFill = this.add.rectangle(BAR_X, y + 1, 0, 2, paletteNumber('gold')).setOrigin(0);
    this.bleedLabel = new Label(this, HUD_MARGIN, y + 6, t('hud.bleeding'), {
      size: 7,
      color: 'red',
      bold: true,
      stroke: true,
    }).setVisible(false);
    this.beginnerLabel = new Label(this, HUD_MARGIN, y + 15, t('hud.beginner'), {
      size: 7,
      color: 'lime',
      stroke: true,
    }).setVisible(false);
    this.questLabel = new Label(this, HUD_MARGIN, y + 26, '', {
      size: 7,
      color: 'wheat',
      stroke: true,
    });
  }

  /** Registo da missão em curso (a primeira ativa): título e objetivos com progresso. */
  private renderQuest(): void {
    const label = this.questLabel;
    if (!label) return;
    const quest = simulation.quests.active()[0];
    if (!quest || uiState.modalOpen) {
      label.setVisible(false);
      return;
    }
    const progress = simulation.quests.progress(quest.id);
    const goals = quest.goals.map((goal, i) => {
      const [done, total] = progress[i] ?? [0, 1];
      return `${done >= total ? '✓' : '·'} ${goalText(goal)} ${String(done)}/${String(total)}`;
    });
    const lines = [tKey(`quest.${quest.id}`), ...goals];
    if (simulation.quests.ready(quest.id))
      lines.push(t('quest.ready_hint', { npc: tKey(`npc.${quest.turnIn}`) }));
    label.setText(lines.join('\n')).setVisible(true);
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
    // Pausa ("II"), à esquerda da velocidade.
    new Button(
      this,
      width - HUD_MARGIN - 12 - 28,
      HUD_MARGIN + 20,
      'II',
      { width: 24, height: 12, fontSize: 8, style: 'secondary' },
      () => {
        this.pause?.toggle();
      },
    ).setDepth(86); // por cima do menu de pausa: carregar outra vez fecha-o
    // Mapa (M), à esquerda da pausa: no telemóvel é a forma de saber onde se está.
    new Button(
      this,
      width - HUD_MARGIN - 12 - 28 - 12 - 4 - 18,
      HUD_MARGIN + 20,
      t('hud.map'),
      { width: 36, height: 12, fontSize: 8, style: 'secondary' },
      () => {
        this.toggleMap();
      },
    ).setDepth(70);
  }

  private updateCoopLabel(): void {
    const text = coop.isGuest
      ? t('coop.hud_guest')
      : coop.isHost && coop.code
        ? t(coop.connected ? 'coop.hud_connected' : 'coop.hud_waiting', { code: coop.code })
        : '';
    this.coopLabel?.setText(text);
  }

  /** Grava e volta ao menu inicial (a cena de jogo, ao parar, também pára o HUD). */
  private quitToMenu(): void {
    // Co-op: o convidado sai (não tem nada a gravar); o anfitrião fecha a sessão.
    if (coop.isGuest) {
      coop.leave();
      gameState.clear();
      this.game.scene.stop(SceneKey.Zone);
      this.game.scene.start(SceneKey.MainMenu, {});
      return;
    }
    coop.leave();
    void autosave.flush().then(() => {
      this.game.scene.stop(SceneKey.Zone);
      this.game.scene.start(SceneKey.MainMenu, {});
    });
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
    // Construir (só na base): por cima do Fabricar. Existe sempre (o mundo contínuo muda de
    // zona sem refazer o HUD); só se vê na base.
    if (this.build) {
      // Um pouco mais largo se o texto não couber (a letra só encolhe em píxeis inteiros).
      const buildWidth = Math.max(bagWidth, Math.ceil(measureTextWidth(t('build.button'), 8)) + 6);
      this.buildButton = new Button(
        this,
        Math.max(buildWidth / 2 + 4, hotbar.x - 6 - bagWidth + buildWidth / 2),
        hotbar.y - 12,
        t('build.button'),
        { width: buildWidth, height: 14, fontSize: 8, style: 'secondary' },
        () => {
          this.toggleBuild();
        },
      ).setDepth(70);
      this.buildButton.setVisible(!buildMode.active && this.build.available);
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

    // Munição em uso: por cima do slot da arma (o último, à direita da hotbar); tocar no slot
    // passa à seguinte.
    const slotCx = hotbar.x + hotbar.w - SLOT_SIZE / 2;
    const ammo = this.add.image(slotCx - 6, hotbar.y - 8, 'icon_arrow').setDepth(71);
    const count = new Label(
      this,
      slotCx + 3,
      hotbar.y - 8,
      '',
      { size: 8, bold: true, color: 'cream', stroke: true },
      [0, 0.5],
    ).setDepth(71);
    this.weaponView = { ammo, count, ammoItem: null };

    // Ataque automático (canto inferior direito; com toque, por cima do botão de ação).
    const touch = this.sys.game.device.input.touch;
    const cx = width - ACTION_RADIUS - 10;
    const cy = hotbar.y - ACTION_RADIUS - 12;
    // Na linha da hotbar, no canto; se não couber ao lado da Mochila, por cima dela.
    const autoW = 40;
    const fitsRow = width - 4 - autoW >= bagX + bagWidth / 2 + 6;
    this.autoButton = new Button(
      this,
      touch && !fitsRow ? cx : width - 4 - autoW / 2,
      fitsRow ? hotbar.y + hotbar.h / 2 : touch ? cy - ACTION_RADIUS - 16 : hotbar.y - 12,
      t('hud.auto'),
      {
        width: autoW,
        height: fitsRow ? hotbar.h : 16,
        fontSize: 8,
        style: preferences().autoAttack ? 'primary' : 'secondary',
      },
      () => {
        this.toggleAutoAttack();
      },
    ).setDepth(70);
    // Correr (por cima do "Auto"): um toque liga/desliga; segurar corre enquanto se segura.
    const autoY = fitsRow ? hotbar.y + hotbar.h / 2 : touch ? cy - ACTION_RADIUS - 16 : hotbar.y - 12;
    const autoH = fitsRow ? hotbar.h : 16;
    this.sprintButton = new Button(
      this,
      touch && !fitsRow ? cx : width - 4 - autoW / 2,
      Math.round(autoY - autoH / 2 - 11),
      t('hud.sprint'),
      { width: autoW, height: 16, fontSize: 8, style: 'secondary' },
      () => undefined,
    )
      .onPress(
        () => {
          moveInput.runDown(performance.now());
        },
        () => {
          moveInput.runUp(performance.now());
        },
      )
      .setDepth(70);

    if (!touch) return;
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

  /** Liga/desliga o ataque automático (botão "Auto" ou tecla F). */
  private toggleAutoAttack(): void {
    const on = !preferences().autoAttack;
    setPreference('autoAttack', on);
    this.autoButton?.setStyle(on ? 'primary' : 'secondary');
    this.showNotice(t(on ? 'hud.auto_on' : 'hud.auto_off'));
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
    keyboard.on('keydown-F', () => {
      this.toggleAutoAttack();
    });
    keyboard.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (!event.repeat) this.runNoticeAction();
    });
    // M: mapa do mundo (onde estou?).
    keyboard.on('keydown-M', () => {
      this.toggleMap();
    });
    keyboard.on('keydown-K', () => {
      if (this.pause?.isOpen) return;
      if (!this.skills?.isOpen) this.closePanels();
      this.skills?.toggle();
    });
    // Shift: correr (toque liga/desliga; segurar corre enquanto se segura).
    keyboard.on('keydown-SHIFT', (event: KeyboardEvent) => {
      if (!event.repeat) moveInput.runDown(performance.now());
    });
    keyboard.on('keyup-SHIFT', () => {
      moveInput.runUp(performance.now());
    });
    keyboard.on('keydown-ESC', () => {
      // Esc fecha o que estiver aberto; sem nada aberto, abre (ou fecha) o menu de pausa.
      if (this.pause?.isOpen) this.pause.close();
      else if (this.skills?.isOpen) this.skills.close();
      else if (this.worldMap?.isOpen) this.worldMap.close();
      else if (this.dialog?.isOpen) this.dialog.close();
      else if (this.inventory?.isOpen) this.inventory.close();
      else if (this.crafting?.isOpen) this.crafting.close();
      else if (this.build?.isOpen) this.build.close();
      else this.pause?.open();
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

  /** Fecha a mochila, o fabrico e a construção (antes de abrir as perícias). */
  /** Mapa do mundo: fecha os outros painéis (não abre por cima da pausa nem de uma conversa). */
  private toggleMap(): void {
    if (this.pause?.isOpen || this.dialog?.isOpen || this.skills?.isOpen) return;
    if (!this.worldMap?.isOpen) this.closePanels();
    this.worldMap?.toggle();
  }

  private closePanels(): void {
    if (this.inventory?.isOpen) this.inventory.close();
    if (this.crafting?.isOpen) this.crafting.close();
    this.build?.close();
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
    const game = this.scene.get(SceneKey.Zone);
    if (!this.scene.isActive(SceneKey.Zone)) return null;
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
      if (this.pause?.isOpen || this.skills?.isOpen) return; // o menu de pausa tapa tudo
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
