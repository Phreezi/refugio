import { EQUIP_SLOTS, equipSlotOf, type ItemDefs } from '../data/types';
import { BALANCE } from '../data/balance';

import {
  COIN,
  addItem,
  enchantOf,
  moveSlot,
  sortContainer,
  splitSlot,
  storeSimilar,
  type Container,
} from '../systems/inventory/inventory';
import type { EventBus, GameEvents, OtherContainerRef } from './EventBus';
import { chestContents, zoneState, type GameState } from './GameState';
import { gameHoursToTicks } from './Clock';

/** Moeda (§7.16): paga encantamentos, trocas e repor talentos; é um contador, não um item. */
export { COIN };

/** Onde está um slot: mochila, hotbar ou um baú (`chest:<id>`). */
export type ContainerRef = 'inventory' | 'hotbar' | 'equipment' | OtherContainerRef;

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
  /** Largar itens no chão onde está o jogador (ligado ao combate pela Simulation). */
  dropItems: (items: Container) => boolean = () => false;
  /** Ler uma nota: aprende a receita (ligado à progressão pela Simulation). */
  readNote: (recipe: string) => 'learned' | 'known' | 'unknown' = () => 'unknown';
  /** Regras de um baú construído (frigorífico: mais espaços, só comida). null = baú normal. */
  chestRules: (chestId: string) => { slots?: number; foodOnly: boolean; orders?: string } | null = () => null;

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
    if (ref.startsWith('bag:')) {
      // bag:<zona>:<índice> — mochila ou pilha de itens no chão.
      const [, zoneId = '', index = ''] = ref.split(':');
      return zoneState(data, zoneId).bags[Number(index)]?.items ?? [];
    }
    if (ref.startsWith('loot:')) {
      // loot:<zona>:<id do objeto>
      const [, zoneId = '', objectId = ''] = ref.split(':');
      return zoneState(data, zoneId).loot[objectId]?.[1] ?? [];
    }
    const chestId = ref.slice('chest:'.length);
    return chestContents(data, chestId, this.chestRules(chestId)?.slots);
  }

  /** O contentor aceita este item? (o frigorífico só guarda comida e bebida, §7.17) */
  accepts(ref: ContainerRef, item: string | undefined): boolean {
    if (item === undefined || !ref.startsWith('chest:')) return true;
    if (!this.chestRules(ref.slice('chest:'.length))?.foodOnly) return true;
    const effects = this.items()[item]?.effects;
    return (effects?.hunger ?? 0) > 0 || (effects?.thirst ?? 0) > 0;
  }

  /** Espaços da mochila: os de base mais os da mochila equipada (§7.3). */
  inventorySize(): number {
    const bag = this.state.data.player.equipment[EQUIP_SLOTS.indexOf('backpack')];
    return BALANCE.inventorySlots + (bag ? (this.items()[bag[0]]?.slots ?? 0) : 0);
  }

  /**
   * Ajusta a mochila ao tamanho dado pela mochila equipada (corre a cada tick). Ao encolher, os
   * itens dos espaços que desaparecem passam para espaços livres (ou juntam-se a stacks); o que
   * não couber fica numa pilha no chão. Sem sítio onde a largar, espera (nada se perde).
   */
  syncBackpack(): void {
    const inventory = this.state.data.player.inventory;
    const size = this.inventorySize();
    if (inventory.length === size) return;
    if (inventory.length < size) {
      while (inventory.length < size) inventory.push(null);
      this.changed();
      return;
    }
    const kept = inventory.slice(0, size);
    const overflow: Container = [];
    for (const slot of inventory.slice(size)) {
      if (!slot) continue;
      const free = kept.indexOf(null);
      if (free >= 0) kept[free] = slot;
      else if (slot[2] === undefined) {
        const left = addItem([kept], slot[0], slot[1], this.items());
        if (left > 0) overflow.push([slot[0], left]);
      } else overflow.push(slot);
    }
    if (overflow.length > 0 && !this.dropItems(overflow)) return;
    inventory.length = 0;
    inventory.push(...kept);
    this.changed();
  }

  /**
   * Dá um item ao jogador (apanhar, loot, drops): as moedas vão para o contador; o resto para a
   * mochila/hotbar. @returns o que não coube.
   */
  give(item: string, qty: number): number {
    if (item === COIN) {
      this.state.data.player.coins += qty;
      return 0;
    }
    return addItem(this.pickupContainers(), item, qty, this.items());
  }

  /** Moedas que tenham ido parar aos slots (arrastadas de um contentor) passam para o contador. */
  sweepCoins(): void {
    const player = this.state.data.player;
    let found = 0;
    for (const container of [player.inventory, player.hotbar]) {
      container.forEach((slot, i) => {
        if (slot?.[0] !== COIN) return;
        found += slot[1];
        container[i] = null;
      });
    }
    if (found === 0) return;
    player.coins += found;
    this.changed();
  }

  /** Tira os efeitos da comida que já acabaram (§7.17). */
  tickBuffs(tick: number): void {
    const player = this.state.data.player;
    if (player.buffs.length === 0) return;
    const active = player.buffs.filter(([, , until]) => until > tick);
    if (active.length === player.buffs.length) return;
    player.buffs = active;
    this.changed();
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
    if (slot && def?.type === 'note' && def.teaches) {
      // Nota: ensina a receita e desaparece (se já se sabia, fica).
      const result = this.readNote(def.teaches);
      if (result !== 'learned') {
        this.bus.emit('note:known', { recipe: def.teaches });
        return false;
      }
      slot[1] -= 1;
      if (slot[1] === 0) container[ref.index] = null;
      this.changed();
      return true;
    }
    // Pergaminho de viagem (§7.18): abre o teletransporte daqui; gasta-se só ao viajar.
    if (slot && def?.type === 'scroll') {
      this.bus.emit('scroll:use', {});
      return true;
    }
    if (!slot || def?.type !== 'consumable' || !def.effects) return false;

    const player = this.state.data.player;
    const clamp = (value: number): number => Math.max(0, Math.min(BALANCE.statMax, value));
    player.hunger = clamp(player.hunger + (def.effects.hunger ?? 0));
    player.thirst = clamp(player.thirst + (def.effects.thirst ?? 0));
    // Nunca mata: comida estragada tira vida, mas deixa pelo menos 1.
    player.hp = Math.max(Math.min(player.hp, 1), clamp(player.hp + (def.effects.hp ?? 0)));
    if (def.stopsBleeding) player.bleed = 0;
    if (def.buff) {
      // Comida com efeito (§7.17): o mesmo efeito renova-se (não se acumula).
      const { effect, value, hours } = def.buff;
      const until = this.state.data.world.tick + gameHoursToTicks(hours);
      player.buffs = [...player.buffs.filter(([e]) => e !== effect), [effect, value, until]];
      this.bus.emit('buff:started', { item: slot[0], effect, value, hours });
    }

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

  /** Nível que falta para equipar o item (null = pode). */
  levelNeeded(item: string | undefined): number | null {
    const level = item ? this.items()[item]?.level : undefined;
    return level !== undefined && level > this.state.data.player.level ? level : null;
  }

  move(from: SlotRef, to: SlotRef): boolean {
    // No equipamento só entra o que é desse slot (nos dois sentidos, se for uma troca).
    const source = this.container(from.container)[from.index];
    const target = this.container(to.container)[to.index];
    if (to.container === 'equipment' && !this.fitsEquipment(source?.[0], to.index)) return false;
    if (from.container === 'equipment' && !this.fitsEquipment(target?.[0], from.index)) return false;
    // Nível mínimo para equipar (§7.16).
    const entering = to.container === 'equipment' ? source : from.container === 'equipment' ? target : null;
    const needed = this.levelNeeded(entering?.[0]);
    if (needed !== null) {
      this.bus.emit('action:blocked', { reason: 'needs_level', level: needed });
      return false;
    }
    if (!this.accepts(to.container, source?.[0]) || !this.accepts(from.container, target?.[0])) {
      this.bus.emit('action:blocked', { reason: 'food_only' });
      return false;
    }
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

  /** Larga o slot inteiro no chão (numa pilha que se abre com a ação para o voltar a apanhar). */
  drop(ref: SlotRef): boolean {
    const container = this.container(ref.container);
    const slot = container[ref.index];
    if (!slot || ref.container.startsWith('bag:') || !this.dropItems([slot])) return false;
    container[ref.index] = null;
    this.changed();
    return true;
  }

  /** Pode-se encantar o item? (armas e roupa, com durabilidade). */
  enchantable(item: string): boolean {
    const def = this.items()[item];
    return def?.durability !== undefined && (def.damage !== undefined || def.armor !== undefined);
  }

  /** Moedas que custa o próximo encantamento do slot (null = não dá ou já está no máximo). */
  enchantCost(ref: SlotRef): number | null {
    const slot = this.container(ref.container)[ref.index];
    if (!slot || !this.enchantable(slot[0])) return null;
    const level = enchantOf(slot);
    return level >= BALANCE.enchantMax ? null : BALANCE.enchantCostBase * 2 ** level;
  }

  /**
   * Encanta a arma/roupa do slot (+1 nível, até `enchantMax`), pagando em moedas: mais dano
   * nas armas e mais defesa na roupa (§7.16).
   */
  enchant(ref: SlotRef): 'ok' | 'max' | 'no_coins' | 'invalid' {
    const container = this.container(ref.container);
    const slot = container[ref.index];
    if (!slot || !this.enchantable(slot[0])) return 'invalid';
    const cost = this.enchantCost(ref);
    if (cost === null) return 'max';
    const player = this.state.data.player;
    if (player.coins < cost) return 'no_coins';
    player.coins -= cost;
    const durability = slot[2] ?? this.items()[slot[0]]?.durability ?? 1;
    const level = enchantOf(slot) + 1;
    container[ref.index] = [slot[0], slot[1], durability, level];
    this.changed();
    this.bus.emit('item:enchanted', { item: slot[0], level });
    return 'ok';
  }

  /** Destrói o slot inteiro (sem volta: a interface pede confirmação). */
  destroy(ref: SlotRef): boolean {
    const container = this.container(ref.container);
    if (!container[ref.index]) return false;
    container[ref.index] = null;
    this.changed();
    return true;
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
  storeSimilar(ref: ContainerRef): number {
    const moved = storeSimilar(this.state.data.player.inventory, this.container(ref), this.items());
    if (moved > 0) this.changed();
    return moved;
  }

  /**
   * "Apanhar tudo" de um contentor para a mochila/hotbar (o que tem desgaste vai inteiro para um
   * slot vazio). @returns true se o contentor ficou vazio.
   */
  takeAll(ref: ContainerRef): boolean {
    const source = this.container(ref);
    const targets = this.pickupContainers();
    let moved = false;
    for (const [i, slot] of source.entries()) {
      if (!slot) continue;
      if (slot[0] === COIN) {
        this.give(COIN, slot[1]);
        source[i] = null;
        moved = true;
        continue;
      }
      if (slot[2] !== undefined) {
        const target = targets.find((c) => c.includes(null));
        if (!target) continue;
        target[target.indexOf(null)] = slot;
        source[i] = null;
        moved = true;
        continue;
      }
      const left = addItem(targets, slot[0], slot[1], this.items());
      if (left < slot[1]) moved = true;
      source[i] = left > 0 ? [slot[0], left] : null;
    }
    if (moved) this.changed();
    return source.every((slot) => slot === null);
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
