import type Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { eventBus } from '../core/EventBus';
import { gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView } from '../display/view';
import { itemName, t, tKey } from '../i18n';
import type { QuestDef } from '../systems/quests/quests';
import { countItem } from '../systems/inventory/inventory';
import { content } from '../world/content';
import { Button, CLOSE_ICON } from './Button';
import { Label } from './text';
import { splitSpeech } from './speech';
import { panelTop, uiState } from './uiState';

const DEPTH = { dim: 80, panel: 82, content: 84 } as const;
const MAX_W = 280;
const PAD = 8;

interface Destroyable {
  destroy(): void;
}

/**
 * Conversa com um NPC (CLAUDE.md §7.18): o que ele diz, a missão (aceitar, progresso, entregar),
 * a loja do mercador e, com o técnico, reparar o poste da zona ou usá-lo.
 */
export class DialogUI {
  private readonly scene: Phaser.Scene;
  private objects: Destroyable[] = [];
  private npc: string | null = null;
  private message = '';
  /** Fala dividida em páginas (frases): tocar/Espaço/OK passa à seguinte; o resto vem no fim. */
  private page = 0;
  private pages = 1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isOpen(): boolean {
    return this.npc !== null;
  }

  open(npc: string): void {
    if (!gameState.hasGame) return;
    // Mercador sem missão para dar ou entregar: vai direto à loja (sem a fala inicial).
    const def = content.npcs[npc];
    const focus = this.focus(npc);
    if (def?.role === 'shop' && def.shop && (focus === null || focus.state === 'progress')) {
      eventBus.emit('station:open', { stationKey: `${def.shop}_npc` });
      return;
    }
    this.npc = npc;
    this.message = '';
    this.page = 0;
    uiState.modalOpen = true;
    this.build();
  }

  close(): void {
    // A tecla/toque que fechou ainda está premido: não voltar logo a falar com o NPC.
    if (this.npc !== null) uiState.actionLocked = true;
    this.clear();
    if (this.npc !== null) uiState.modalOpen = false;
    this.npc = null;
  }

  destroy(): void {
    this.close();
  }

  /**
   * Toque fora do painel, OK, Espaço ou Enter: passa à fala seguinte; na última (com as opções),
   * fecha a conversa.
   */
  advance(): void {
    if (this.npc === null) return;
    if (this.page < this.pages - 1) {
      this.page++;
      this.rebuildSoon();
    } else this.close();
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }

  private add<T extends Destroyable>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private rebuildSoon(): void {
    this.scene.time.delayedCall(0, () => {
      if (this.npc !== null) this.build();
    });
  }

  private label(x: number, y: number, text: string, size: number, color: PaletteColor, wrap?: number): Label {
    return this.add(
      new Label(this.scene, x, y, text, { size, color, ...(wrap ? { wrap } : {}) }).setDepth(DEPTH.content),
    );
  }

  /** A missão de que se fala agora: primeiro a pronta a entregar, depois uma nova, depois uma a meio. */
  private focus(npc: string): { quest: QuestDef; state: 'ready' | 'offer' | 'progress' } | null {
    const quests = simulation.quests;
    const handIns = quests.handIns(npc);
    const ready = handIns.find((q) => quests.ready(q.id));
    if (ready) return { quest: ready, state: 'ready' };
    const offer = quests.offers(npc)[0];
    if (offer) return { quest: offer, state: 'offer' };
    const doing = handIns[0] ?? quests.active().find((q) => q.giver === npc);
    return doing ? { quest: doing, state: 'progress' } : null;
  }

  private build(): void {
    this.clear();
    const npc = this.npc;
    const def = npc ? content.npcs[npc] : undefined;
    if (!npc || !def) return;
    const scene = this.scene;
    const { width, height } = getView();
    const w = Math.min(MAX_W, width - 8);
    const lines: { text: string; color: PaletteColor }[] = [];
    const buttons: { label: string; onClick: () => void; primary?: boolean }[] = [];
    const quests = simulation.quests;
    const focus = this.focus(npc);
    let text = tKey(`npc.${npc}.hello`);

    if (focus) {
      const { quest, state } = focus;
      const title = tKey(`quest.${quest.id}`);
      text = state === 'ready' ? tKey(`quest.${quest.id}.done`) : tKey(`quest.${quest.id}.text`);
      lines.push({
        text: `${t(state === 'offer' ? 'quest.new' : 'quest.current')}: ${title}`,
        color: 'gold',
      });
      const progress = quests.progress(quest.id);
      quest.goals.forEach((goal, i) => {
        const [done, total] =
          state === 'offer'
            ? [0, goal.type === 'collect' || goal.type === 'kill' ? goal.qty : 1]
            : (progress[i] ?? [0, 1]);
        lines.push({
          text: `${goalText(goal)} ${String(done)}/${String(total)}`,
          color: done >= total ? 'lime' : 'parchment',
        });
      });
      const reward = rewardText(quest);
      if (reward) lines.push({ text: `${t('quest.reward')}: ${reward}`, color: 'stone_light' });
      if (state === 'offer')
        buttons.push({
          label: t('quest.accept'),
          primary: true,
          onClick: () => {
            quests.accept(quest.id);
            this.rebuildSoon();
          },
        });
      if (state === 'ready')
        buttons.push({
          label: t('quest.turn_in'),
          primary: true,
          onClick: () => {
            quests.turnIn(quest.id);
            this.message = t('quest.thanks', { reward });
            this.rebuildSoon();
          },
        });
    }

    // Mercador: a loja.
    if (def.role === 'shop' && def.shop) {
      const shop = def.shop;
      buttons.push({
        label: t('npc.shop'),
        onClick: () => {
          this.close();
          eventBus.emit('station:open', { stationKey: `${shop}_npc` });
        },
      });
    }

    // Técnico: reparar o poste desta zona (itens + moedas) ou usá-lo.
    if (def.role === 'waystone') {
      const zoneId = gameState.data.player.zoneId;
      const cost = quests.waystoneCost(zoneId);
      if (quests.waystoneActive(zoneId)) {
        text = t('npc.technician.working');
        buttons.push({
          label: t('npc.teleport'),
          primary: true,
          onClick: () => {
            this.close();
            eventBus.emit('waystone:use', { zoneId });
          },
        });
      } else if (cost) {
        lines.push({ text: t('npc.technician.needs'), color: 'gold' });
        const { inventory, hotbar } = gameState.data.player;
        for (const [item, qty] of cost.items) {
          const have = countItem([inventory, hotbar], item);
          lines.push({
            text: `${itemName(item)} ${String(Math.min(have, qty))}/${String(qty)}`,
            color: have >= qty ? 'lime' : 'red',
          });
        }
        const coins = gameState.data.player.coins;
        lines.push({
          text: t('npc.coins', { have: Math.min(coins, cost.coins), need: cost.coins }),
          color: coins >= cost.coins ? 'lime' : 'red',
        });
        buttons.push({
          label: t('npc.repair'),
          primary: true,
          onClick: () => {
            const result = quests.repairWaystone(zoneId);
            this.message = t(
              result === 'ok' ? 'msg.waystone_on' : result === 'no_coins' ? 'npc.no_coins' : 'npc.missing',
            );
            this.rebuildSoon();
          },
        });
      }
    }

    // Falas longas em páginas: só a última mostra a missão, a mensagem e as opções.
    const pages = splitSpeech(text);
    this.pages = pages.length;
    this.page = Math.min(this.page, pages.length - 1);
    const last = this.page === pages.length - 1;
    text = pages[this.page] ?? text;
    if (!last) {
      lines.length = 0;
      buttons.length = 0;
      buttons.push({
        label: t('npc.next'),
        primary: true,
        onClick: () => {
          this.advance();
        },
      });
    }

    // Layout: título, fala, linhas, mensagem, botões.
    const textLabel = new Label(scene, 0, 0, text, { size: 8, color: 'cream', wrap: w - PAD * 2 });
    const textH = textLabel.text.height;
    textLabel.destroy();
    const buttonRows = Math.ceil(buttons.length / 2);
    const message = last ? this.message : '';
    const h = 24 + textH + 6 + lines.length * 11 + (message ? 14 : 0) + buttonRows * 20 + 8 + 10;
    const x = Math.round((width - w) / 2);
    const y = Math.max(4, Math.min(panelTop(height), height - 4 - h));
    this.add(
      scene.add
        .rectangle(0, 0, width, height, paletteNumber('ink'), 0.55)
        .setOrigin(0)
        .setDepth(DEPTH.dim)
        .setInteractive()
        // Tocar fora do painel: fala seguinte, ou sair no fim da conversa.
        .on('pointerdown', () => {
          this.advance();
        }),
    );
    // O painel apanha os toques (tocar lá dentro não fecha); nas falas a meio, avança.
    this.add(
      scene.add
        .rectangle(x, y, w, h, paletteNumber('bark_dark'))
        .setOrigin(0)
        .setDepth(DEPTH.panel)
        .setInteractive()
        .on('pointerdown', () => {
          if (!last) this.advance();
        }),
    );
    this.add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(DEPTH.panel),
    );
    this.label(x + PAD, y + 6, tKey(`npc.${npc}`), 10, 'wheat');
    this.add(
      new Button(scene, x + w - 10, y + 10, CLOSE_ICON, { width: 14, height: 14, style: 'secondary' }, () => {
        this.close();
      }).setDepth(DEPTH.content),
    );
    let cy = y + 22;
    cy += this.label(x + PAD, cy, text, 8, 'cream', w - PAD * 2).text.height + 6;
    for (const line of lines) {
      this.label(x + PAD, cy, line.text, 7, line.color);
      cy += 11;
    }
    if (message) {
      this.label(x + PAD, cy + 2, message, 7, 'lime', w - PAD * 2);
      cy += 14;
    }
    const bw = Math.floor((w - PAD * 3) / 2);
    buttons.forEach((b, i) => {
      const bx = x + PAD + bw / 2 + (i % 2) * (bw + PAD);
      const by = cy + 10 + Math.floor(i / 2) * 20;
      this.add(
        new Button(
          scene,
          Math.round(bx),
          by,
          b.label,
          { width: bw, height: 16, fontSize: 8, style: b.primary ? 'primary' : 'secondary' },
          b.onClick,
        ).setDepth(DEPTH.content),
      );
    });
    // Como sair/avançar (e em que página se está).
    const hint = last
      ? t('npc.hint_close')
      : `${t('npc.hint_next')}  ${String(this.page + 1)}/${String(pages.length)}`;
    const hintLabel = this.label(x + PAD, y + h - 11, hint, 6, 'stone_light');
    hintLabel.setPosition(x + w - PAD - Math.ceil(hintLabel.text.width), y + h - 11);
  }
}

/** "Recolher 3 Madeira", "Ir a Pinhal", "Falar com Rui", "Derrotar Lobo". */
export function goalText(goal: QuestDef['goals'][number]): string {
  if (goal.type === 'collect') return t('quest.goal.collect', { item: itemName(goal.item) });
  if (goal.type === 'reach')
    return t('quest.goal.reach', { zone: tKey(content.zones[goal.zone]?.name ?? goal.zone) });
  if (goal.type === 'talk') return t('quest.goal.talk', { npc: tKey(`npc.${goal.npc}`) });
  return t('quest.goal.kill', {
    enemy: goal.enemy === 'any' ? t('quest.any_enemy') : tKey(`enemy.${goal.enemy}`),
  });
}

function rewardText(quest: QuestDef): string {
  const parts: string[] = [];
  if (quest.reward.xp > 0) parts.push(t('quest.reward_xp', { n: quest.reward.xp }));
  if (quest.reward.coins > 0) parts.push(t('quest.reward_coins', { n: quest.reward.coins }));
  for (const [item, qty] of quest.reward.items) parts.push(`${String(qty)} ${itemName(item)}`);
  return parts.join(', ');
}
