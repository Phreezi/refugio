import { EQUIP_SLOTS, equipSlotOf, type ItemDefs } from '../data/types';
import { BALANCE } from '../data/balance';
import {
  addItem,
  moveSlot,
  sortContainer,
  splitSlot,
  storeSimilar,
  type Container,
} from '../systems/inventory/inventory';
import type { EventBus, GameEvents } from './EventBus';
import { chestContents, type GameState } from './GameState';

/** Onde está um slot: mochila, hotbar ou um baú (`chest:<id>`). */
export type ContainerRef = 'inventory' | 'hotbar' | 'equipment' | `chest:${string}`;

export interface SlotRef {
  container: ContainerRef;
  index: number;
}

/**
 * Ações do jogador sobre o inventário (CLAUDE.md §7.3): usar, mover, dividir, guardar
 * semelhantes, beber no poço. Lógica pura: altera o GameState e emite eventos.
 */
export class PlayerActions {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly items: () => ItemDefs;

  constructor(state: GameState, bus: EventBus<GameEvents>, items: () => ItemDefs) {
    this.state = state;
    this.bus = bus;
    this.items = items;
  }

  container(ref: ContainerRef): Container {
    const data = this.state.data;
    if (ref === 'inventory') return data.player.inventory;
    if (ref === 'hotbar') return data.player.hotbar;
    if (ref === 'equipment') return data.player.equipment;
    return chestContents(data, ref.slice('chest:'.length));
  }

  /** Onde vão parar os itens apanhados: primeiro a mochila, depois a hotbar. */
  pickupContainers(): Container[] {
    const { inventory, hotbar } = this.state.data.player;
    return [inventory, hotbar];
  }

  /**
   * Usar o item de um slot: consumíveis comem-se/bebem-se (efeitos limitados a 0…máx.).
   * @returns true se o item foi usado.
   */
  use(ref: SlotRef): boolean {
    const container = this.container(ref.container);
    const slot = container[ref.index];
    const def = slot ? this.items()[slot[0]] : undefined;
    if (!slot || def?.type !== 'consumable' || !def.effects) return false;

    const player = this.state.data.player;
    const clamp = (value: number): number => Math.max(0, Math.min(BALANCE.statMax, value));
    player.hunger = clamp(player.hunger + (def.effects.hunger ?? 0));
    player.thirst = clamp(player.thirst + (def.effects.thirst ?? 0));
    // Nunca mata: comida estragada tira vida, mas deixa pelo menos 1.
    player.hp = Math.max(Math.min(player.hp, 1), clamp(player.hp + (def.effects.hp ?? 0)));

    slot[1] -= 1;
    if (slot[1] === 0) container[ref.index] = null;
    if (def.returns) {
      // A garrafa vazia volta para o mesmo slot se ele ficou livre; senão, para onde couber.
      if (container[ref.index] === null) container[ref.index] = [def.returns, 1];
      else addItem(this.pickupContainers(), def.returns, 1, this.items());
    }
    this.changed();
    this.bus.emit('player:consumed', { item: slot[0] });
    return true;
  }

  /** O item deste slot pode ficar no slot de equipamento `index`? (vazio pode sempre) */
  fitsEquipment(item: string | undefined, index: number): boolean {
    return item === undefined || equipSlotOf(this.items()[item]) === EQUIP_SLOTS[index];
  }

  move(from: SlotRef, to: SlotRef): boolean {
    // No equipamento só entra o que é desse slot (nos dois sentidos, se for uma troca).
    const source = this.container(from.container)[from.index];
    const target = this.container(to.container)[to.index];
    if (to.container === 'equipment' && !this.fitsEquipment(source?.[0], to.index)) return false;
    if (from.container === 'equipment' && !this.fitsEquipment(target?.[0], from.index)) return false;
    const moved = moveSlot(
      this.container(from.container),
      from.index,
      this.container(to.container),
      to.index,
      this.items(),
    );
    if (moved) this.changed();
    return moved;
  }

  /** Equipa o item do slot (troca com o que estava equipado). @returns false se não se equipa. */
  equip(ref: SlotRef): boolean {
    const slot = this.container(ref.container)[ref.index];
    const kind = equipSlotOf(slot ? this.items()[slot[0]] : undefined);
    if (!slot || !kind || ref.container === 'equipment') return false;
    return this.move(ref, { container: 'equipment', index: EQUIP_SLOTS.indexOf(kind) });
  }

  /** Tira o item equipado para o primeiro slot vazio da mochila ou da hotbar. */
  unequip(index: number): boolean {
    const equipment = this.state.data.player.equipment;
    const slot = equipment[index];
    if (!slot) return false;
    for (const container of this.pickupContainers()) {
      const free = container.indexOf(null);
      if (free >= 0) {
        container[free] = slot;
        equipment[index] = null;
        this.changed();
        return true;
      }
    }
    return false;
  }

  split(ref: SlotRef): boolean {
    const done = splitSlot(this.container(ref.container), ref.index);
    if (done) this.changed();
    return done;
  }

  /** Ordenar a mochila ou um baú: junta itens iguais e arruma por categoria. */
  sort(ref: ContainerRef): boolean {
    const changed = sortContainer(this.container(ref), this.items());
    if (changed) this.changed();
    return changed;
  }

  /** "Guardar tudo semelhante" da mochila para o baú. @returns quantidade movida. */
  storeSimilar(chestId: string): number {
    const moved = storeSimilar(
      this.state.data.player.inventory,
      this.container(`chest:${chestId}`),
      this.items(),
    );
    if (moved > 0) this.changed();
    return moved;
  }

  /** Beber água diretamente de uma fonte (poço da base). */
  drink(): void {
    const player = this.state.data.player;
    player.thirst = Math.min(BALANCE.statMax, player.thirst + BALANCE.wellThirst);
    this.state.markDirty();
    this.bus.emit('player:consumed', { item: 'water_clean' });
  }

  private changed(): void {
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
  }
}
