import { gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import type { StructureCategory } from '../data/types';
import { tileInFront } from '../systems/building/building';

export interface Tile {
  tx: number;
  ty: number;
}

/**
 * Estado do modo construção (CLAUDE.md §7.7), partilhado entre a UIScene (paleta, botões,
 * toques) e a cena de jogo (pré-visualização). Não é estado do jogo: não se grava.
 */
export const buildMode = {
  active: false,
  /** Peça escolhida na paleta (id de structures.json). */
  selected: 'foundation_wood',
  /** Separador da paleta e primeira peça visível (scroll). */
  category: 'floors' as StructureCategory,
  scroll: 0,
  /** Rotação (0 = horizontal, 1 = vertical) das peças rodáveis. */
  rot: 0,
  /** A demolir em vez de construir. */
  demolish: false,
  /** Tile escolhido com o rato ou com um toque (null = à frente do jogador). */
  picked: null as Tile | null,
  /** Quem escolheu o tile: com toque, andar volta a pôr a peça à frente do jogador. */
  pickedBy: null as 'mouse' | 'touch' | null,
};

export function pickTile(tile: Tile | null, by: 'mouse' | 'touch'): void {
  buildMode.picked = tile;
  buildMode.pickedBy = tile ? by : null;
}

/** Tile onde a peça escolhida (ou a demolição) se aplica agora. */
export function buildTargetTile(): Tile {
  if (buildMode.picked) return buildMode.picked;
  const player = gameState.data.player;
  const def = simulation.building.def(buildMode.selected);
  const size = buildMode.demolish || !def ? { width: 1, height: 1 } : def.size;
  return tileInFront(player, player.facing, size, simulation.building.tileSize);
}
