import Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import type { Simulation } from '../core/Simulation';
import { STRUCTURE_CATEGORIES, structureSprite, type StructureCategory } from '../data/types';
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
  /** "Nv X" por cima das peças ainda bloqueadas. */
  lock: Label;
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
      const unlocked = this.simulation.progression.isStructureUnlocked(cell.id);
      cell.sprite.setAlpha(affordable && unlocked ? 1 : 0.4);
      if (unlocked) cell.sprite.clearTint();
      else cell.sprite.setTint(0x555555);
      cell.lock.setVisible(!unlocked);
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

    // Paleta: separadores por tipo e uma linha de peças desse tipo (com setas/roda se não
    // couberem todas).
    const categories = STRUCTURE_CATEGORIES.filter((cat) =>
      Object.values(content.structures).some((def) => def.category === cat),
    );
    if (!categories.includes(buildMode.category)) buildMode.category = categories[0] ?? 'floors';
    const ids = Object.keys(content.structures).filter(
      (id) => content.structures[id]?.category === buildMode.category,
    );
    const arrowW = 12;
    const fit = Math.max(
      1,
      Math.floor((width - 8 - 2 * (arrowW + CELL_GAP) + CELL_GAP) / (CELL_W + CELL_GAP)),
    );
    const scrolls = ids.length > fit;
    const maxScroll = Math.max(0, ids.length - fit);
    buildMode.scroll = Math.min(Math.max(0, buildMode.scroll), maxScroll);
    const shown = ids.slice(buildMode.scroll, buildMode.scroll + fit);
    const top = this.hotbarTop - 6 - (CELL_H + CELL_GAP);
    const rowW = shown.length * (CELL_W + CELL_GAP) - CELL_GAP;
    const left = Math.round((width - rowW) / 2);
    shown.forEach((id, i) => {
      const x = left + i * (CELL_W + CELL_GAP);
      const y = top;
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
      // Roda do rato por cima da paleta: passa às peças seguintes.
      back.on(Phaser.Input.Events.GAMEOBJECT_WHEEL, (_p: unknown, _dx: number, dy: number) => {
        this.scrollBy(dy > 0 ? 1 : -1);
      });
      const lock = add(
        new Label(
          scene,
          x + CELL_W / 2,
          y + CELL_H / 2,
          t('level.short', { level: def?.unlockLevel ?? 1 }),
          { size: 7, bold: true, color: 'cream', stroke: true },
          [0.5, 0.5],
        ),
      ).setDepth(DEPTH + 1);
      this.cells.push({ id, border, sprite, lock });
    });
    if (scrolls) {
      for (const [dir, x] of [
        [-1, left - CELL_GAP - arrowW / 2],
        [1, left + rowW + CELL_GAP + arrowW / 2],
      ] as const) {
        const enabled = dir < 0 ? buildMode.scroll > 0 : buildMode.scroll < maxScroll;
        add(
          new Button(
            scene,
            Math.round(x),
            top + CELL_H / 2,
            dir < 0 ? '<' : '>',
            { width: arrowW, height: CELL_H, fontSize: 9, style: enabled ? 'primary' : 'secondary' },
            () => {
              this.scrollBy(dir * Math.max(1, fit - 1));
            },
          ),
        ).setDepth(DEPTH);
      }
    }
    // Separadores (tipos de peça), por cima das peças.
    const tabGap = 2;
    const tabW =
      Math.min(52, Math.floor((width - 8 - (categories.length - 1) * tabGap) / categories.length)) & ~1;
    const tabsW = categories.length * tabW + (categories.length - 1) * tabGap;
    const tabY = top - 4 - BUTTON_H / 2;
    categories.forEach((cat, i) => {
      add(
        new Button(
          scene,
          Math.round((width - tabsW) / 2) + i * (tabW + tabGap) + tabW / 2,
          tabY,
          t(`build.cat.${cat}`),
          {
            width: tabW,
            height: BUTTON_H,
            fontSize: 7,
            style: cat === buildMode.category ? 'primary' : 'secondary',
          },
          () => {
            this.showCategory(cat);
          },
        ),
      ).setDepth(DEPTH);
    });
    const actionsTop = tabY - BUTTON_H / 2 - 2;

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
    const actionsW = actions.length * buttonW + (actions.length - 1) * gap;
    const buttonY = actionsTop - 4 - BUTTON_H / 2;
    actions.forEach(([key, onClick, style], i) => {
      const x = Math.round((width - actionsW) / 2) + i * (buttonW + gap) + buttonW / 2;
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

  /** Mostra outro tipo de peças (escolhe a primeira, se a escolhida não for desse tipo). */
  private showCategory(category: StructureCategory): void {
    this.scene.time.delayedCall(0, () => {
      buildMode.category = category;
      buildMode.scroll = 0;
      if (content.structures[buildMode.selected]?.category !== category) {
        const first = Object.keys(content.structures).find(
          (id) => content.structures[id]?.category === category,
        );
        if (first) this.select(first);
      }
      if (this.isOpen) this.build();
    });
  }

  private scrollBy(delta: number): void {
    this.scene.time.delayedCall(0, () => {
      buildMode.scroll += delta;
      if (this.isOpen) this.build();
    });
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
