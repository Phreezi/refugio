import { randomInt, type RngState } from '../../core/Rng';
import type { ItemDefs, ResourceDef, ToolKind } from '../../data/types';
import type { Container } from '../inventory/inventory';

// Recolha (CLAUDE.md §7.4), lógica pura. A ferramenta é escolhida automaticamente entre as que
// o jogador traz (a mais forte do tipo certo): menos gestão de equipamento, mais simpático.

export interface ToolRef {
  container: Container;
  index: number;
  power: number;
}

/** A ferramenta mais forte do tipo `kind` nos contentores (com durabilidade > 0). */
export function bestTool(containers: readonly Container[], kind: ToolKind, defs: ItemDefs): ToolRef | null {
  let best: ToolRef | null = null;
  for (const container of containers) {
    container.forEach((slot, index) => {
      if (!slot) return;
      const def = defs[slot[0]];
      if (def?.toolKind !== kind || def.gatherPower === undefined) return;
      if (slot[2] !== undefined && slot[2] <= 0) return;
      if (def.gatherPower > (best?.power ?? 0)) best = { container, index, power: def.gatherPower };
    });
  }
  return best;
}

/** Vida que um golpe tira: poder da ferramenta, 1 à mão, ou 0 se a ferramenta for obrigatória. */
export function hitPower(resource: ResourceDef, tool: ToolRef | null): number {
  if (tool) return tool.power;
  return resource.toolRequired ? 0 : 1;
}

export interface ItemStack {
  item: string;
  qty: number;
}

export function rollDrops(resource: ResourceDef, rng: RngState): ItemStack[] {
  return resource.drops.map((drop) => ({ item: drop.item, qty: randomInt(rng, drop.min, drop.max) }));
}

/** Máximo que um recurso pode dar (para confirmar espaço antes do último golpe). */
export function maxDrops(resource: ResourceDef): ItemStack[] {
  return resource.drops.map((drop) => ({ item: drop.item, qty: drop.max }));
}

/** Gasta 1 de durabilidade; a ferramenta parte-se (desaparece) a 0. @returns true se partiu. */
export function wearTool(tool: ToolRef): boolean {
  const slot = tool.container[tool.index];
  if (slot?.[2] === undefined) return false;
  slot[2] -= 1;
  if (slot[2] > 0) return false;
  tool.container[tool.index] = null;
  return true;
}
