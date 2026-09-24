import Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import type { Simulation } from '../core/Simulation';
import { structureSprite } from '../data/types';
import { itemName, t, tKey, type MessageKey } from '../i18n';
import type { BuildProblem } from '../systems/building/building';
import { countItem } from '../systems/inventory/inventory';
import { content } from '../world/content';
import { Button, type ButtonStyle } from './Button';
import { buildMode, buildTargetTile, pickTile, type Tile } from './buildMode';
import { Label } from './text';
import { getView } from '../display/view';

const CELL_W = 34;
const CELL_H = 30;
const CELL_GAP = 2;
const BUTTON_H = 14;
const DEPTH = 60;

interface Cell {
  id: string;
  border: Phaser.GameObjects.Rectangle;
  sprite: Phaser.GameObjects.Image;
}

/**
 * Modo construção (CLAUDE.md §7.7): paleta de peças por cima da hotbar, botões (Rodar,
 * Desfazer, Demolir, Sair, Colocar) e uma linha com o custo ou o motivo de não dar.
 * A pré-visualização no mundo é desenhada pela cena de jogo (ver buildMode.ts).
 */
export class BuildUI {
  private readonly scene: Phaser.Scene;
  private readonly simulation: Simulation;
  private readonly hotbarTop: number;
  private objects: { destroy(): void }[] = [];
  private cells: Cell[] = [];
  private info: Label | null = null;
  private undoButton: Button | null = null;
  private demolishButton: Button | null = null;
  /** Chamado ao abrir/fechar (a UIScene esconde o botão de ação). */
  onToggle: (open: boolean) => void = () => undefined;

  constructor(scene: Phaser.Scene, simulation: Simulation, hotbarTop: number) {
    this.scene = scene;
    this.simulation = simulation;
    this.hotbarTop = hotbarTop;
    if (buildMode.active) this.build(); // a UIScene reiniciou (ex.: ecrã rodado) a meio
  }

  get isOpen(): boolean {
    return buildMode.active;
  }

  /** Só se constrói na base. */
  get available(): boolean {
    return this.simulation.building.available;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (!this.available || this.isOpen) return;
    buildMode.active = true;
    buildMode.demolish = false;
    pickTile(null, 'mouse');
    this.build();
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    buildMode.active = false;
    buildMode.demolish = false;
    pickTile(null, 'mouse');
    this.clear();
    this.onToggle(false);
  }

  destroy(): void {
    this.clear();
  }

  /** Coloca (ou demole) no tile dado, ou no tile alvo atual. */
  confirm(tile?: Tile): void {
    if (!this.isOpen) return;
    const { tx, ty } = tile ?? buildTargetTile();
    const building = this.simulation.building;
    if (buildMode.demolish) {
      if (!building.demolishTarget(tx, ty)) {
        this.message(t('build.nothing_here'));
        return;
      }
      this.report(building.demolish(tx, ty));
      return;
    }
    this.report(building.place(buildMode.selected, tx, ty, buildMode.rot));
  }

  rotate(): void {
    buildMode.rot = buildMode.rot === 0 ? 1 : 0;
  }

  undo(): void {
    if (this.simulation.building.undo() === null) this.message(t('build.undone'));
  }

  toggleDemolish(): void {
    buildMode.demolish = !buildMode.demolish;
    this.demolishButton?.setStyle(buildMode.demolish ? 'danger' : 'secondary');
  }

  select(id: string): void {
    buildMode.selected = id;
    if (buildMode.demolish) this.toggleDemolish();
  }

  /** Atualiza o texto de custo/motivo, as peças que se podem pagar e o Desfazer. */
  update(): void {
    if (!this.isOpen || !this.info) return;
    const building = this.simulation.building;
    const containers = this.simulation.actions.pickupContainers();
    for (const cell of this.cells) {
      const def = content.structures[cell.id];
      const affordable = def?.cost.every(({ item, qty }) => countItem(containers, item) >= qty) ?? false;
      cell.sprite.setAlpha(affordable ? 1 : 0.4);
      const selected = !buildMode.demolish && cell.id === buildMode.selected;
      cell.border.setFillStyle(paletteNumber(selected ? 'gold' : 'bark_dark'));
    }
    this.undoButton?.setStyle(building.undoable() ? 'primary' : 'secondary');

    const { tx, ty } = buildTargetTile();
    if (buildMode.demolish) {
      const record = building.demolishTarget(tx, ty);
      if (!record) {
        this.info.setText(t('build.demolish_hint')).setColor('parchment');
        return;
      }
      const problem = building.demolishProblem(record);
      if (problem) {
        this.info.setText(problemText(problem)).setColor('red');
        return;
      }
      const refund = building
        .demolishRefund(record)
        .map(({ item, qty }) => `${String(qty)} ${itemName(item)}`);
      this.info
        .setText(
          t('build.demolish_target', {
            name: tKey(`structure.${record[1]}`),
            refund: refund.join(', ') || t('build.nothing'),
          }),
        )
        .setColor('wheat');
      return;
    }
    const def = content.structures[buildMode.selected];
    if (!def) return;
    const cost = def.cost
      .map(({ item, qty }) => `${String(qty)} ${itemName(item)} (${String(countItem(containers, item))})`)
      .join(', ');
    const problem = building.check(buildMode.selected, tx, ty);
    const line = t('build.cost', { name: tKey(`structure.${buildMode.selected}`), cost });
    this.info
      .setText(problem && problem !== 'no_materials' ? `${line}\n${problemText(problem)}` : line)
      .setColor(problem === 'no_materials' ? 'red' : problem ? 'peach' : 'cream');
  }

  private report(problem: BuildProblem | null): void {
    if (problem) this.message(problemText(problem));
  }

  private message(text: string): void {
    this.scene.events.emit('ui:message', text);
  }

  private build(): void {
    this.clear();
    const scene = this.scene;
    const { width } = getView();
    const add = <T extends { destroy(): void }>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    // Paleta: uma ou mais linhas de peças por cima da hotbar.
    const ids = Object.keys(content.structures);
    const cols = Math.max(1, Math.min(ids.length, Math.floor((width - 8 + CELL_GAP) / (CELL_W + CELL_GAP))));
    const rows = Math.ceil(ids.length / cols);
    const top = this.hotbarTop - 6 - rows * (CELL_H + CELL_GAP);
    ids.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, ids.length - row * cols);
      const left = Math.round((width - inRow * (CELL_W + CELL_GAP) + CELL_GAP) / 2);
      const x = left + (i % cols) * (CELL_W + CELL_GAP);
      const y = top + row * (CELL_H + CELL_GAP);
      const border = add(scene.add.rectangle(x, y, CELL_W, CELL_H, paletteNumber('bark_dark')).setOrigin(0));
      const back = add(
        scene.add
          .rectangle(x + 1, y + 1, CELL_W - 2, CELL_H - 2, paletteNumber('night'), 0.9)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true }),
      );
      const def = content.structures[id];
      const texture = def ? structureSprite(def, 0, false) : '__DEFAULT';
      const sprite = add(scene.add.image(x + CELL_W / 2, y + CELL_H - 3, texture).setOrigin(0.5, 1));
      border.setDepth(DEPTH);
      back.setDepth(DEPTH);
      sprite.setDepth(DEPTH);
      back.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        this.select(id);
      });
      this.cells.push({ id, border, sprite });
    });

    // Botões por cima da paleta.
    const actions: [MessageKey, () => void, ButtonStyle][] = [
      [
        'build.rotate',
        () => {
          this.rotate();
        },
        'secondary',
      ],
      [
        'build.undo',
        () => {
          this.undo();
        },
        'secondary',
      ],
      [
        'build.demolish',
        () => {
          this.toggleDemolish();
        },
        buildMode.demolish ? 'danger' : 'secondary',
      ],
      [
        'build.exit',
        () => {
          this.scene.time.delayedCall(0, () => {
            this.close();
          });
        },
        'secondary',
      ],
      [
        'build.place',
        () => {
          this.confirm();
        },
        'primary',
      ],
    ];
    const gap = 4;
    const buttonW = Math.min(46, Math.floor((width - 8 - gap * (actions.length - 1)) / actions.length)) & ~1;
    const rowW = actions.length * buttonW + (actions.length - 1) * gap;
    const buttonY = top - 4 - BUTTON_H / 2;
    actions.forEach(([key, onClick, style], i) => {
      const x = Math.round((width - rowW) / 2) + i * (buttonW + gap) + buttonW / 2;
      const button = add(
        new Button(
          scene,
          x,
          buttonY,
          t(key),
          { width: buttonW, height: BUTTON_H, fontSize: 7, style },
          onClick,
        ),
      ).setDepth(DEPTH);
      if (key === 'build.undo') this.undoButton = button;
      if (key === 'build.demolish') this.demolishButton = button;
    });

    this.info = add(
      new Label(
        scene,
        Math.round(width / 2),
        buttonY - BUTTON_H / 2 - 3,
        '',
        { size: 8, bold: true, color: 'cream', stroke: true, align: 'center', wrap: width - 16 },
        [0.5, 1],
      ),
    ).setDepth(DEPTH);
    if (!scene.sys.game.device.input.touch) {
      add(
        new Label(
          scene,
          Math.round(width / 2),
          4,
          t('build.keys'),
          { size: 7, color: 'parchment', stroke: true, align: 'center', wrap: width - 140 },
          [0.5, 0],
        ),
      ).setDepth(DEPTH);
    }
    this.update();
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.cells = [];
    this.info = null;
    this.undoButton = null;
    this.demolishButton = null;
  }
}

function problemText(problem: BuildProblem): string {
  return t(`build.problem.${problem}` as MessageKey);
}
