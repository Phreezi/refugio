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
import { parseZoneMap, type ZoneMap, type ZoneMapRules } from './zoneMap';
import type { WildZone } from './wilds';
import type { NpcDefs, QuestDef, WaystoneCost } from '../systems/quests/quests';
import { buildWorldLayout, type WorldLayout } from './worldLayout';

/** Mapas selvagens gerados guardados em memória (as zonas desenhadas à volta cabem todas). */
const WILD_CACHE = 32;

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
  /** Mundo selvagem (plano D): zonas geradas quando são precisas. */
  private readonly wildZones = new Map<string, WildZone>();
  /** Mapas gerados (os mais usados ficam; ordem de inserção = o menos usado primeiro). */
  private readonly wildMaps = new Map<string, { json: Record<string, unknown>; map: ZoneMap }>();
  private wildRules: ZoneMapRules | null = null;
  private wildGenerate: ((zone: WildZone) => Record<string, unknown>) | null = null;
  /** Onde estão os NPCs gerados (aldeias): zona e pés (px da zona). */
  private readonly npcHomes = new Map<string, { zoneId: string; x: number; y: number }>();

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

  /**
   * Junta o mundo selvagem: as zonas (definições), os NPCs e as missões das aldeias, e como gerar
   * o mapa de cada zona (validado com as mesmas regras dos desenhados à mão).
   */
  addWilds(wild: {
    zones: ZoneDefs;
    plan: readonly WildZone[];
    npcs: NpcDefs;
    quests: readonly QuestDef[];
    npcHomes: ReadonlyMap<string, { zoneId: string; x: number; y: number }>;
    rules: ZoneMapRules;
    generate: (zone: WildZone) => Record<string, unknown>;
  }): void {
    this.zoneDefs = { ...this.zones, ...wild.zones };
    this.npcDefs = { ...this.npcs, ...wild.npcs };
    this.questList = [...this.quests, ...wild.quests];
    for (const zone of wild.plan) this.wildZones.set(zone.id, zone);
    for (const [npc, home] of wild.npcHomes) this.npcHomes.set(npc, home);
    this.wildRules = wild.rules;
    this.wildGenerate = wild.generate;
    this.layout = null;
  }

  /** Zona gerada por código (mundo selvagem)? */
  isWild(zoneId: string): boolean {
    return this.wildZones.has(zoneId);
  }

  wild(zoneId: string): WildZone | undefined {
    return this.wildZones.get(zoneId);
  }

  /** Onde está um NPC gerado (aldeia): zona e pés. */
  npcHome(npc: string): { zoneId: string; x: number; y: number } | undefined {
    return this.npcHomes.get(npc);
  }

  /** JSON do Tiled de uma zona selvagem (para o Phaser a desenhar); undefined nas outras. */
  wildTiledJson(zoneId: string): Record<string, unknown> | undefined {
    return this.wildZones.has(zoneId) ? this.wildEntry(zoneId).json : undefined;
  }

  /** O mapa da zona se já estiver carregado (as selvagens só depois de geradas). */
  loadedZoneMap(zoneId: string): ZoneMap | undefined {
    return this.zoneMaps.get(zoneId) ?? this.wildMaps.get(zoneId)?.map;
  }

  private wildEntry(zoneId: string): { json: Record<string, unknown>; map: ZoneMap } {
    const cached = this.wildMaps.get(zoneId);
    if (cached) {
      // Passa para o fim (o mais recente).
      this.wildMaps.delete(zoneId);
      this.wildMaps.set(zoneId, cached);
      return cached;
    }
    const zone = this.wildZones.get(zoneId);
    if (!zone || !this.wildRules || !this.wildGenerate)
      throw new Error(`Content: mapa da zona "${zoneId}" não carregado.`);
    const json = this.wildGenerate(zone);
    const entry = { json, map: parseZoneMap(json, this.wildRules, zoneId) };
    this.wildMaps.set(zoneId, entry);
    while (this.wildMaps.size > WILD_CACHE) {
      const oldest = this.wildMaps.keys().next().value;
      if (oldest === undefined) break;
      this.wildMaps.delete(oldest);
    }
    return entry;
  }

  setZoneMap(zoneId: string, map: ZoneMap): void {
    this.zoneMaps.set(zoneId, map);
    this.layout = null;
  }

  /** Mundo contínuo: as zonas com `world` (feito na primeira vez, com os mapas carregados). */
  get world(): WorldLayout {
    this.layout ??= buildWorldLayout(this.zones, (zoneId) => {
      const wild = this.wildZones.get(zoneId);
      return wild ? { width: wild.w, height: wild.h } : this.zoneMap(zoneId);
    });
    return this.layout;
  }

  zoneMap(zoneId: string): ZoneMap {
    const map = this.zoneMaps.get(zoneId);
    if (map) return map;
    return this.wildEntry(zoneId).map;
  }
}

export const content = new Content();
