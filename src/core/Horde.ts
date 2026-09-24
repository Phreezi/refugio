import { BALANCE } from '../data/balance';
import {
  HORDE_GROUP,
  HORDE_REWARD_TABLE,
  type EnemyGroups,
  type ItemDefs,
  type LootTables,
} from '../data/types';
import { rollLoot } from '../systems/loot/loot';
import { secondsToTicks } from './Clock';
import type { Combat } from './Combat';
import type { EventBus, GameEvents } from './EventBus';
import { BASE_ZONE_ID, type GameState } from './GameState';
import { hoursToTicks } from './Homestead';
import type { ZoneContext } from './Interaction';

export interface HordeContent {
  items: ItemDefs;
  enemyGroups: EnemyGroups;
  lootTables: LootTables;
}

/** Tick da próxima horda: às `hordeHour` h, `hordeEveryDays` dias depois do dia de `tick`. */
export function nextHordeTick(tick: number): number {
  const dayTicks = secondsToTicks(BALANCE.dayLengthSec);
  const day = Math.floor(tick / dayTicks);
  const hour = (BALANCE.hordeHour - BALANCE.dayStartHour + 24) % 24;
  return (day + BALANCE.hordeEveryDays) * dayTicks + hoursToTicks(hour);
}

/** Tamanho relativo da horda número `count` (cada uma um pouco maior, até um limite). */
export function hordeScale(count: number): number {
  return 1 + (Math.min(count, BALANCE.hordeMaxGrowth) * BALANCE.hordeGrowthPct) / 100;
}

/**
 * Hordas opcionais (CLAUDE.md §7.13): desligadas por defeito. Ligadas, a cada `hordeEveryDays`
 * dias de jogo uma horda ataca a base às `hordeHour` h — mas só com o jogador lá (se estiver fora,
 * espera por ele). Vencer dá uma mochila com loot; morrer faz a horda ir-se embora sem prémio.
 */
export class Horde {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly combat: Combat;
  private readonly content: () => HordeContent;
  private zone: ZoneContext | null = null;

  constructor(state: GameState, bus: EventBus<GameEvents>, combat: Combat, content: () => HordeContent) {
    this.state = state;
    this.bus = bus;
    this.combat = combat;
    this.content = content;
  }

  get enabled(): boolean {
    return this.state.data.settings.hordes;
  }

  /** Chamado depois de o Combat entrar na zona: uma horda a meio (jogo recarregado) volta. */
  setZone(zone: ZoneContext | null): void {
    this.zone = zone;
    const horde = this.state.hasGame ? this.state.data.horde : null;
    if (!horde?.active || zone?.zoneId !== BASE_ZONE_ID) return;
    if (this.enabled) this.spawn();
    else horde.active = false;
  }

  /** Um tick: marca a próxima horda, fá-la chegar e vê se já foi vencida. */
  tick(): void {
    if (!this.enabled) return;
    const data = this.state.data;
    const horde = data.horde;
    const tick = data.world.tick;
    if (horde.at === 0) {
      horde.at = nextHordeTick(tick);
      this.state.markDirty();
    }
    if (this.zone?.zoneId !== BASE_ZONE_ID) return;
    if (!horde.active && tick >= horde.at) {
      horde.active = true;
      this.state.markDirty();
      this.spawn();
    } else if (horde.active && this.combat.hordeLeft === 0) this.win();
  }

  /** O jogador morreu: a horda vai-se embora (sem prémio) e marca-se a seguinte. */
  playerDied(): void {
    const horde = this.state.data.horde;
    if (!horde.active) return;
    this.combat.clearHorde();
    this.finish(false);
  }

  private spawn(): void {
    const zone = this.zone;
    if (!zone) return;
    const points = zone.map.exits.length > 0 ? zone.map.exits : [zone.map.playerSpawn];
    const size = this.combat.spawnHorde(HORDE_GROUP, points, hordeScale(this.state.data.horde.count));
    this.bus.emit('horde:started', { size });
  }

  private win(): void {
    const { items, lootTables } = this.content();
    const table = lootTables[HORDE_REWARD_TABLE];
    const data = this.state.data;
    if (table) {
      const reward = rollLoot(table, items, data.world);
      const { x, y } = data.player;
      this.combat.dropBag(BASE_ZONE_ID, x, y, reward, false);
    }
    this.finish(true);
  }

  private finish(won: boolean): void {
    const data = this.state.data;
    const horde = data.horde;
    horde.active = false;
    if (won) horde.count += 1;
    horde.at = nextHordeTick(data.world.tick);
    this.state.markDirty();
    this.bus.emit('horde:ended', { won });
  }
}
