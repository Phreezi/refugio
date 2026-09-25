import type {
  EnemyDefs,
  EnemyGroups,
  ItemDefs,
  LootTables,
  PropDefs,
  Recipes,
  ResourceDefs,
  StationDefs,
  StructureDefs,
  ZoneDefs,
} from '../data/types';
import type { ZoneMap } from './zoneMap';
import type { NpcDefs, QuestDef, WaystoneCost } from '../systems/quests/quests';
import { buildWorldLayout, type WorldLayout } from './worldLayout';

/**
 * Conteúdo já validado no arranque (PreloadScene), partilhado pelas cenas.
 * Não é estado do jogo: é igual para todos os jogos e não se grava.
 */
class Content {
  private itemDefs: ItemDefs | null = null;
  private stationDefs: StationDefs | null = null;
  private recipeList: Recipes | null = null;
  private resourceDefs: ResourceDefs | null = null;
  private propDefs: PropDefs | null = null;
  private structureDefs: StructureDefs | null = null;
  private enemyDefs: EnemyDefs | null = null;
  private groups: EnemyGroups | null = null;
  private zoneDefs: ZoneDefs | null = null;
  private lootDefs: LootTables | null = null;
  private readonly zoneMaps = new Map<string, ZoneMap>();
  private layout: WorldLayout | null = null;
  private npcDefs: NpcDefs | null = null;
  private questList: readonly QuestDef[] | null = null;
  private waystoneDefs: Readonly<Record<string, WaystoneCost>> | null = null;

  setQuests(
    npcs: NpcDefs,
    quests: readonly QuestDef[],
    waystones: Readonly<Record<string, WaystoneCost>>,
  ): void {
    this.npcDefs = npcs;
    this.questList = quests;
    this.waystoneDefs = waystones;
  }

  get npcs(): NpcDefs {
    if (this.npcDefs === null) throw new Error('Content: NPCs ainda não carregados.');
    return this.npcDefs;
  }

  get quests(): readonly QuestDef[] {
    if (this.questList === null) throw new Error('Content: missões ainda não carregadas.');
    return this.questList;
  }

  get waystones(): Readonly<Record<string, WaystoneCost>> {
    if (this.waystoneDefs === null) throw new Error('Content: postes ainda não carregados.');
    return this.waystoneDefs;
  }

  setItems(defs: ItemDefs): void {
    this.itemDefs = defs;
  }

  get items(): ItemDefs {
    if (this.itemDefs === null) throw new Error('Content: itens ainda não carregados.');
    return this.itemDefs;
  }

  setCrafting(stations: StationDefs, recipes: Recipes): void {
    this.stationDefs = stations;
    this.recipeList = recipes;
  }

  get stations(): StationDefs {
    if (this.stationDefs === null) throw new Error('Content: estações ainda não carregadas.');
    return this.stationDefs;
  }

  get recipes(): Recipes {
    if (this.recipeList === null) throw new Error('Content: receitas ainda não carregadas.');
    return this.recipeList;
  }

  setResources(defs: ResourceDefs): void {
    this.resourceDefs = defs;
  }

  get resources(): ResourceDefs {
    if (this.resourceDefs === null) throw new Error('Content: recursos ainda não carregados.');
    return this.resourceDefs;
  }

  setProps(defs: PropDefs): void {
    this.propDefs = defs;
  }

  get props(): PropDefs {
    if (this.propDefs === null) throw new Error('Content: obstáculos ainda não carregados.');
    return this.propDefs;
  }

  setStructures(defs: StructureDefs): void {
    this.structureDefs = defs;
  }

  get structures(): StructureDefs {
    if (this.structureDefs === null) throw new Error('Content: peças de construção ainda não carregadas.');
    return this.structureDefs;
  }

  setEnemies(defs: EnemyDefs, groups: EnemyGroups): void {
    this.enemyDefs = defs;
    this.groups = groups;
  }

  get enemies(): EnemyDefs {
    if (this.enemyDefs === null) throw new Error('Content: inimigos ainda não carregados.');
    return this.enemyDefs;
  }

  get enemyGroups(): EnemyGroups {
    if (this.groups === null) throw new Error('Content: grupos de inimigos ainda não carregados.');
    return this.groups;
  }

  setLootTables(defs: LootTables): void {
    this.lootDefs = defs;
  }

  get lootTables(): LootTables {
    if (this.lootDefs === null) throw new Error('Content: tabelas de loot ainda não carregadas.');
    return this.lootDefs;
  }

  setZones(defs: ZoneDefs): void {
    this.zoneDefs = defs;
  }

  get zones(): ZoneDefs {
    if (this.zoneDefs === null) throw new Error('Content: zonas ainda não carregadas.');
    return this.zoneDefs;
  }

  setZoneMap(zoneId: string, map: ZoneMap): void {
    this.zoneMaps.set(zoneId, map);
    this.layout = null;
  }

  /** Mundo contínuo: as zonas com `world` (feito na primeira vez, com os mapas carregados). */
  get world(): WorldLayout {
    this.layout ??= buildWorldLayout(this.zones, (zoneId) => this.zoneMap(zoneId));
    return this.layout;
  }

  zoneMap(zoneId: string): ZoneMap {
    const map = this.zoneMaps.get(zoneId);
    if (!map) throw new Error(`Content: mapa da zona "${zoneId}" não carregado.`);
    return map;
  }
}

export const content = new Content();
