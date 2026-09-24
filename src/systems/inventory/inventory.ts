import type { ItemDefs } from '../../data/types';

// Inventário (CLAUDE.md §7.3), lógica pura. Um contentor é uma lista de slots; cada slot é
// null ou um array compacto [itemId, quantidade] / [itemId, 1, durabilidade] (§10.5).
// Funções mutáveis: alteram os contentores recebidos (que são parte do GameState).

export type Slot = [itemId: string, qty: number] | [itemId: string, qty: number, durability: number];
export type Container = (Slot | null)[];

export function createContainer(size: number): Container {
  return new Array<Slot | null>(size).fill(null);
}

function stackOf(defs: ItemDefs, id: string): number {
  const def = defs[id];
  if (!def) throw new Error(`Inventário: item desconhecido "${id}"`);
  return def.stack;
}

/** Itens com durabilidade não se juntam (cada um tem o seu desgaste). */
function stackable(defs: ItemDefs, id: string): boolean {
  return defs[id]?.durability === undefined && stackOf(defs, id) > 1;
}

function newSlot(defs: ItemDefs, id: string, qty: number): Slot {
  const durability = defs[id]?.durability;
  return durability === undefined ? [id, qty] : [id, qty, durability];
}

/** Quantidade total de um item nos contentores. */
export function countItem(containers: readonly Container[], id: string): number {
  let total = 0;
  for (const container of containers) for (const slot of container) if (slot?.[0] === id) total += slot[1];
  return total;
}

/** Quanto de `id` ainda cabe nos contentores (sem alterar nada). */
export function spaceFor(containers: readonly Container[], id: string, defs: ItemDefs): number {
  const stack = stackOf(defs, id);
  const merge = stackable(defs, id);
  let space = 0;
  for (const container of containers) {
    for (const slot of container) {
      if (slot === null) space += stack;
      else if (merge && slot[0] === id) space += stack - slot[1];
    }
  }
  return space;
}

/**
 * Adiciona `qty` de `id`: primeiro completa stacks existentes, depois ocupa slots vazios,
 * pela ordem dos contentores (ex.: hotbar antes da mochila).
 * @returns a quantidade que NÃO coube.
 */
export function addItem(containers: readonly Container[], id: string, qty: number, defs: ItemDefs): number {
  const stack = stackOf(defs, id);
  let left = qty;
  if (stackable(defs, id)) {
    for (const container of containers) {
      for (const slot of container) {
        if (left === 0) return 0;
        if (slot?.[0] !== id || slot[1] >= stack) continue;
        const moved = Math.min(left, stack - slot[1]);
        slot[1] += moved;
        left -= moved;
      }
    }
  }
  for (const container of containers) {
    for (let i = 0; i < container.length && left > 0; i++) {
      if (container[i] !== null) continue;
      const moved = Math.min(left, stack);
      container[i] = newSlot(defs, id, moved);
      left -= moved;
    }
  }
  return left;
}

/**
 * Remove `qty` de `id` (tudo ou nada), a começar pelo fim da mochila.
 * @returns false se não houver quantidade suficiente (e nada é removido).
 */
export function removeItem(containers: readonly Container[], id: string, qty: number): boolean {
  if (countItem(containers, id) < qty) return false;
  let left = qty;
  for (const container of [...containers].reverse()) {
    for (let i = container.length - 1; i >= 0 && left > 0; i--) {
      const slot = container[i];
      if (slot?.[0] !== id) continue;
      const taken = Math.min(left, slot[1]);
      slot[1] -= taken;
      left -= taken;
      if (slot[1] === 0) container[i] = null;
    }
  }
  return true;
}

/**
 * Arrastar um slot para outro: junta se for o mesmo item empilhável (o que não couber fica na
 * origem), senão troca. Funciona entre contentores diferentes (mochila ↔ baú ↔ hotbar).
 * @returns true se algo mudou.
 */
export function moveSlot(
  from: Container,
  fromIndex: number,
  to: Container,
  toIndex: number,
  defs: ItemDefs,
): boolean {
  if (from === to && fromIndex === toIndex) return false;
  const source = from[fromIndex];
  if (source === undefined || source === null || toIndex < 0 || toIndex >= to.length) return false;
  const target = to[toIndex] ?? null;
  if (target !== null && target[0] === source[0] && stackable(defs, source[0])) {
    const moved = Math.min(source[1], stackOf(defs, source[0]) - target[1]);
    if (moved <= 0) return false;
    target[1] += moved;
    source[1] -= moved;
    if (source[1] === 0) from[fromIndex] = null;
    return true;
  }
  from[fromIndex] = target;
  to[toIndex] = source;
  return true;
}

/**
 * Divide um stack ao meio (a metade maior fica): a outra metade vai para o primeiro slot vazio
 * do mesmo contentor.
 * @returns false se não der (stack de 1 ou sem slot vazio).
 */
export function splitSlot(container: Container, index: number): boolean {
  const slot = container[index];
  if (!slot || slot[1] < 2) return false;
  const empty = container.indexOf(null);
  if (empty < 0) return false;
  const half = Math.floor(slot[1] / 2);
  slot[1] -= half;
  container[empty] = [slot[0], half];
  return true;
}

/**
 * "Guardar tudo semelhante" (§7.3): passa de `from` para `to` tudo o que já exista em `to`.
 * @returns quantidade total movida.
 */
export function storeSimilar(from: Container, to: Container, defs: ItemDefs): number {
  const present = new Set(to.filter((slot) => slot !== null).map((slot) => slot[0]));
  let moved = 0;
  for (let i = 0; i < from.length; i++) {
    const slot = from[i];
    if (!slot || !present.has(slot[0])) continue;
    if (!stackable(defs, slot[0])) {
      const empty = to.indexOf(null);
      if (empty < 0) continue;
      to[empty] = slot;
      from[i] = null;
      moved += slot[1];
      continue;
    }
    const left = addItem([to], slot[0], slot[1], defs);
    moved += slot[1] - left;
    if (left === 0) from[i] = null;
    else slot[1] = left;
  }
  return moved;
}
