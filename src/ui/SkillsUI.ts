import type Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import { TALENTS, talentOf } from '../data/talents';
import { SKILLS, type SkillId } from '../data/types';
import { getView } from '../display/view';
import { t, tKey } from '../i18n';
import { coop } from '../net/coop';
import { totalXpForLevel } from '../systems/progression/progression';
import {
  canLearn,
  TALENT_BRANCHES,
  talentPoints,
  type TalentBranch,
  type TalentDef,
} from '../systems/progression/talents';
import { gatherExtraPct, gatherPowerBonus, missPct, skillLevel } from '../systems/combat/skills';
import { Button, CLOSE_ICON } from './Button';
import { Label } from './text';
import { panelTop, uiState } from './uiState';

const DEPTH = { dim: 80, panel: 82, content: 84 } as const;
const MAX_W = 300;
const HEADER_H = 40;
const ROW_H = 30;
const PAD = 8;

type Tab = 'use' | TalentBranch;
const TABS: readonly Tab[] = ['use', ...TALENT_BRANCHES];

interface Destroyable {
  destroy(): void;
}

/** Texto do que a perícia faz agora (falhas, ou recursos extra na recolha). */
export function skillEffectText(skill: SkillId, level: number): string {
  if (skill === 'gathering')
    return t('skills.gather_value', {
      level,
      extra: gatherExtraPct(level, BALANCE.gatherExtraPctPerLevel),
      power: gatherPowerBonus(level, BALANCE.gatherPowerEveryLevels),
    });
  const ranged = skill === 'archery' || skill === 'firearms';
  const talent = gameState.hasGame ? talentOf(gameState.data.player, 'missPts') : 0;
  const miss = Math.max(BALANCE.missPctMin, missPct(level, ranged, BALANCE) - talent);
  return t('pause.skill_value', { level, miss: Math.round(miss) });
}

/** O que um ponto do talento faz. */
function talentEffectText(def: TalentDef): string {
  const text = tKey(`talent_effect.${def.effect}`, {
    v: def.perRank,
    s: BALANCE.sprintSec,
    c: BALANCE.sprintCooldownSec,
  });
  return def.maxRank > 1 ? `${text} ${t('skills.per_point')}` : text;
}

/**
 * Painel de perícias (tecla K ou menu de pausa, CLAUDE.md §7.15): as perícias que sobem com o
 * uso (armas e recolha) e a árvore de talentos, em 3 ramos, onde se gastam os pontos ganhos a
 * subir de nível.
 */
export class SkillsUI {
  private readonly scene: Phaser.Scene;
  private objects: Destroyable[] = [];
  private tab: Tab = 'use';
  private open_ = false;
  /** Mensagem de baixo (porque não se pode aprender, ou o que se aprendeu). */
  private message = '';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (!gameState.hasGame) return;
    this.open_ = true;
    this.message = '';
    uiState.paused = true;
    uiState.modalOpen = true;
    coop.setAway(true);
    this.build();
  }

  close(): void {
    this.clear();
    if (this.open_) coop.setAway(false);
    this.open_ = false;
    uiState.paused = false;
    uiState.modalOpen = false;
  }

  toggle(): void {
    if (this.open_) this.close();
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

  /** Os botões chamam isto a partir do próprio clique: refazer só no frame seguinte. */
  private rebuildSoon(): void {
    this.scene.time.delayedCall(0, () => {
      if (this.open_) this.build();
    });
  }

  private build(): void {
    this.clear();
    if (!gameState.hasGame) return;
    const scene = this.scene;
    const { width, height } = getView();
    const player = gameState.data.player;
    const w = Math.min(MAX_W, width - 8);
    // Altura igual em todos os separadores (o painel não salta ao mudar), fixo perto do topo.
    const rows = Math.max(SKILLS.length, ...TALENT_BRANCHES.map((b) => this.branchTalents(b).length));
    const h = Math.min(height - 8, HEADER_H + rows * ROW_H + 26);
    const x = Math.round((width - w) / 2);
    const y = Math.max(4, Math.min(panelTop(height), height - 4 - h));
    this.add(
      scene.add
        .rectangle(0, 0, width, height, paletteNumber('ink'), 0.7)
        .setOrigin(0)
        .setDepth(DEPTH.dim)
        .setInteractive(), // tapa os toques no jogo por baixo
    );
    this.add(scene.add.rectangle(x, y, w, h, paletteNumber('bark_dark')).setOrigin(0).setDepth(DEPTH.panel));
    this.add(
      scene.add
        .rectangle(x + 1, y + 1, w - 2, h - 2, paletteNumber('night'))
        .setOrigin(0)
        .setDepth(DEPTH.panel),
    );
    this.label(x + PAD, y + 5, t('skills.title'), { size: 10, bold: true, color: 'wheat' });
    const points = talentPoints(player.level, player.talents);
    this.label(
      x + w - 24,
      y + 7,
      t('skills.points', { n: points }),
      { size: 8, bold: true, color: points > 0 ? 'gold' : 'stone_light' },
      [1, 0],
    );
    this.add(
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
      ).setDepth(DEPTH.content),
    );

    // Separadores.
    const tabW = Math.floor((w - PAD * 2 - (TABS.length - 1) * 2) / TABS.length / 2) * 2;
    TABS.forEach((tab, i) => {
      const cx = x + PAD + i * (tabW + 2) + tabW / 2;
      this.add(
        new Button(
          scene,
          cx,
          y + 26,
          t(`skills.tab.${tab}`),
          { width: tabW, height: 12, fontSize: 7, style: tab === this.tab ? 'primary' : 'secondary' },
          () => {
            this.tab = tab;
            this.message = '';
            this.rebuildSoon();
          },
        ).setDepth(DEPTH.content),
      );
    });

    const top = y + HEADER_H;
    if (this.tab === 'use') this.buildUse(x, top, w);
    else this.buildBranch(this.tab, x, top, w);

    const footer = this.message || t(this.tab === 'use' ? 'skills.use_hint' : 'skills.talent_hint');
    this.label(x + PAD, y + h - 14, footer, {
      size: 7,
      color: this.message ? 'amber' : 'stone_light',
      wrap: w - PAD * 2,
    });
  }

  /** Perícias que sobem com o uso: nível, barra até ao próximo e o que dão. */
  private buildUse(x: number, top: number, w: number): void {
    const skills = gameState.data.player.skills;
    SKILLS.forEach((skill, i) => {
      const y = top + i * ROW_H;
      const xp = skills[skill] ?? 0;
      const level = skillLevel(xp, BALANCE);
      this.label(x + PAD, y, tKey(`skill.${skill}`), { size: 8, bold: true, color: 'cream' });
      this.label(x + w - PAD, y, skillEffectText(skill, level), { size: 7, color: 'gold' }, [1, 0]);
      // Barra de experiência até ao próximo nível.
      const barW = w - PAD * 2;
      const from = totalXpForLevel(level, BALANCE.skillCurve);
      const to = totalXpForLevel(level + 1, BALANCE.skillCurve);
      const full = level >= BALANCE.skillMaxLevel;
      const fill = full ? barW : Math.round((barW * (xp - from)) / Math.max(1, to - from));
      this.add(
        this.scene.add
          .rectangle(x + PAD, y + 13, barW, 4, paletteNumber('shadow'))
          .setOrigin(0)
          .setDepth(DEPTH.content),
      );
      if (fill > 0)
        this.add(
          this.scene.add
            .rectangle(x + PAD, y + 13, fill, 4, paletteNumber(skill === 'gathering' ? 'grass' : 'amber'))
            .setOrigin(0)
            .setDepth(DEPTH.content),
        );
    });
  }

  private branchTalents(branch: TalentBranch): [string, TalentDef][] {
    return Object.entries(TALENTS).filter(([, def]) => def.branch === branch);
  }

  /** Um ramo da árvore: cada talento com os pontos, o efeito, o requisito e "Aprender". */
  private buildBranch(branch: TalentBranch, x: number, top: number, w: number): void {
    const player = gameState.data.player;
    this.branchTalents(branch).forEach(([id, def], i) => {
      const y = top + i * ROW_H;
      const rank = player.talents[id] ?? 0;
      const check = canLearn(id, player.level, player.talents, TALENTS);
      // Ligação ao talento de cima (é uma árvore: cada um pede o anterior).
      if (def.requires)
        this.add(
          this.scene.add
            .rectangle(
              x + PAD + 2,
              y - ROW_H + 20,
              2,
              ROW_H - 10,
              paletteNumber(rank > 0 ? 'gold' : 'stone_dark'),
            )
            .setOrigin(0)
            .setDepth(DEPTH.content),
        );
      const indent = def.requires ? 8 : 0;
      const locked = check === 'level' || check === 'requires';
      this.label(x + PAD + indent, y, `${tKey(`talent.${id}`)}  ${String(rank)}/${String(def.maxRank)}`, {
        size: 8,
        bold: true,
        color: rank > 0 ? 'gold' : locked ? 'stone' : 'cream',
      });
      const requirement =
        check === 'level'
          ? t('skills.req_level', { n: def.level })
          : check === 'requires' && def.requires
            ? t('skills.req_talent', { talent: tKey(`talent.${def.requires[0]}`), n: def.requires[1] })
            : '';
      this.label(
        x + PAD + indent,
        y + 11,
        requirement ? `${talentEffectText(def)} · ${requirement}` : talentEffectText(def),
        { size: 7, color: requirement ? 'red' : 'stone_light', wrap: w - PAD * 2 - indent - 56 },
      );
      const bw = 50;
      this.add(
        new Button(
          this.scene,
          x + w - PAD - bw / 2,
          y + 8,
          check === 'max' ? t('skills.max') : t('skills.learn'),
          { width: bw, height: 14, fontSize: 8, style: check === 'ok' ? 'primary' : 'secondary' },
          () => {
            this.learn(id);
          },
        ).setDepth(DEPTH.content),
      );
    });
  }

  private learn(id: string): void {
    const result = simulation.progression.learnTalent(id);
    this.message =
      result === 'ok'
        ? t('skills.learned', { talent: tKey(`talent.${id}`) })
        : result === 'no_points'
          ? t('skills.no_points')
          : result === 'max'
            ? t('skills.at_max')
            : t('skills.locked');
    this.rebuildSoon();
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
}
