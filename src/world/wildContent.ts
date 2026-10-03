import type { ZoneDef } from '../data/types';
import { defineTexts, LANGUAGES, textIn, type Language } from '../i18n';
import type { NpcDef, QuestDef } from '../systems/quests/quests';
import {
  BASE_TILES,
  BASE_TILESET_FILE,
  BASE_TILESET_NAME,
  baseTileIndex,
  URBAN_TILES_COLUMNS,
  URBAN_TILES_COUNT,
  URBAN_TILESET_FILE,
  URBAN_TILESET_NAME,
  type BaseTile,
} from './tileset';
import { content } from './content';
import type { ZoneMapRules } from './zoneMap';
import {
  dangerOf,
  generateWild,
  hash,
  VILLAGE_QUARRY,
  villageNpcIds,
  villageSpots,
  type Biome,
  type WildPlan,
  type WildZone,
} from './wilds';

// Liga o mundo selvagem (world/wilds.ts) ao jogo: as definições das zonas, os NPCs e as missões
// das aldeias (uma cadeia que vai de aldeia em aldeia, cada vez mais longe de casa) e os textos
// gerados nas duas línguas.

const BIOME_NAME: Readonly<Record<Language, Readonly<Record<Biome, string>>>> = {
  'pt-PT': {
    meadow: 'Prado de {name}',
    forest: 'Bosque de {name}',
    hills: 'Colinas de {name}',
    marsh: 'Pântano de {name}',
    urban: 'Subúrbio de {name}',
  },
  en: {
    meadow: '{name} Meadow',
    forest: '{name} Woods',
    hills: '{name} Hills',
    marsh: '{name} Marsh',
    urban: '{name} Suburb',
  },
};
const VILLAGE_NAME: Readonly<Record<Language, string>> = {
  'pt-PT': 'Aldeia de {name}',
  en: '{name} Village',
};

const ELDERS = [
  ['Sr. Abílio', 'Mr. Abílio'],
  ['D. Rosa', 'Mrs. Rosa'],
  ['Sr. Joaquim', 'Mr. Joaquim'],
  ['D. Amélia', 'Mrs. Amélia'],
  ['Sr. Custódio', 'Mr. Custódio'],
  ['D. Fátima', 'Mrs. Fátima'],
  ['Sr. Albano', 'Mr. Albano'],
  ['D. Lurdes', 'Mrs. Lurdes'],
  ['Sr. Belmiro', 'Mr. Belmiro'],
  ['D. Graça', 'Mrs. Graça'],
  ['Sr. Horácio', 'Mr. Horácio'],
  ['D. Celeste', 'Mrs. Celeste'],
] as const;
const TRADERS = ['Ti Zé', 'Ti Quim', 'Tia Benta', 'Ti Manel', 'Tia Rosário', 'Ti Chico'] as const;
const ELDER_SPRITES = ['npc_old_man', 'npc_farmer', 'npc_fisher', 'npc_doctor'] as const;

const HELLO: Readonly<Record<Language, readonly string[]>> = {
  'pt-PT': [
    'Bem-vindo a {place}. Aqui ainda se planta e se reza para que os mortos não venham.',
    'Viajante! Há muito tempo que ninguém passava por {place}.',
    'Em {place} partilhamos o que temos. Mas os caminhos à volta estão cada vez piores.',
    'Fica o tempo que quiseres. O poço é de todos, e o comerciante faz bons preços.',
  ],
  en: [
    'Welcome to {place}. We still plant here, and pray the dead stay away.',
    'A traveller! Nobody has come through {place} in a long time.',
    'In {place} we share what we have. But the roads around here keep getting worse.',
    'Stay as long as you like. The well is for everyone, and our trader is fair.',
  ],
};
const TRADER_HELLO: Readonly<Record<Language, string>> = {
  'pt-PT': 'Tenho de tudo um pouco. Dá uma vista de olhos.',
  en: 'A bit of everything. Have a look.',
};

const QUEST_TEXT: Readonly<
  Record<
    Language,
    Readonly<
      Record<
        | 'kill'
        | 'killText'
        | 'killDone'
        | 'collect'
        | 'collectText'
        | 'collectDone'
        | 'news'
        | 'newsText'
        | 'newsDone',
        string
      >
    >
  >
> = {
  'pt-PT': {
    kill: 'Ameaça em {place}',
    killText: 'Andam {enemy} à volta de {place}. Derruba {n} e a aldeia dorme melhor.',
    killDone: 'Obrigado. Esta noite ninguém fica de vigia.',
    collect: 'Reforçar {place}',
    collectText: 'Precisamos de {item} para reforçar as casas. Traz-me {n}.',
    collectDone: 'Isto chega para o inverno. Toma, mereces.',
    news: 'Notícias para {next}',
    newsText: 'Há anos que não sabemos nada da aldeia de {next}, mais para longe. Vai lá e fala com {npc}.',
    newsDone: 'Vens de {place}? Então ainda há gente por lá! Que alívio.',
  },
  en: {
    kill: 'Trouble in {place}',
    killText: '{enemy} are prowling around {place}. Take down {n} and the village will sleep better.',
    killDone: 'Thank you. Nobody has to keep watch tonight.',
    collect: 'Shoring up {place}',
    collectText: 'We need {item} to reinforce the houses. Bring me {n}.',
    collectDone: 'That will see us through winter. Here, you earned it.',
    news: 'News for {next}',
    newsText: 'We have not heard from {next} in years, further out. Go there and talk to {npc}.',
    newsDone: 'You come from {place}? So there are still people there! What a relief.',
  },
};

/** O que a aldeia pede, pelo bioma. */
const VILLAGE_NEEDS: Readonly<Record<Biome, readonly [string, number]>> = {
  forest: ['wood', 25],
  meadow: ['fiber', 15],
  hills: ['stone', 25],
  marsh: ['clay', 10],
  urban: ['scrap_metal', 10],
};

const fill = (template: string, params: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });

/** Nome da zona selvagem numa língua. */
function zoneName(zone: WildZone, language: Language): string {
  return fill(zone.village ? VILLAGE_NAME[language] : BIOME_NAME[language][zone.biome], { name: zone.name });
}

/** Junta o mundo selvagem ao conteúdo (chamado no arranque, depois dos mapas à mão). */
export function installWilds(plan: WildPlan, rules: ZoneMapRules): void {
  const zones: Record<string, ZoneDef> = {};
  const npcs: Record<string, NpcDef> = {};
  const quests: QuestDef[] = [];
  const npcHomes = new Map<string, { zoneId: string; x: number; y: number }>();
  const texts: Record<Language, Record<string, string>> = { 'pt-PT': {}, en: {} };
  for (const zone of plan.zones) {
    const danger = dangerOf(zone.level);
    zones[zone.id] = {
      name: `zone.${zone.id.slice('zone_'.length)}`,
      map: '',
      danger,
      worldMapPos: { x: 0, y: 0 },
      world: { x: zone.x, y: zone.y },
      travelCost: { hunger: 0, thirst: 0 },
      respawnDays: danger,
      unlockLevel: zone.level,
      nightEnemyMultiplier: 1.5,
      hidden: true,
    };
    for (const language of LANGUAGES)
      texts[language][`zone.${zone.id.slice('zone_'.length)}`] = zoneName(zone, language);
  }
  // Aldeias, da mais perto para a mais longe de casa: cada uma manda à seguinte.
  const villages = plan.zones
    .filter((z) => z.village)
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  villages.forEach((village, k) => {
    const ids = villageNpcIds(village);
    const spots = villageSpots(village);
    const pickIndex = (n: number, salt: number): number => Math.floor(hash(village.seed, salt) * n);
    const elderName = ELDERS[pickIndex(ELDERS.length, 21)] ?? ELDERS[0];
    npcs[ids.elder] = {
      sprite: ELDER_SPRITES[pickIndex(ELDER_SPRITES.length, 22)] ?? 'npc_old_man',
      role: 'quests',
    };
    npcs[ids.trader] = { sprite: 'npc_merchant', role: 'shop', shop: 'merchant' };
    npcHomes.set(ids.elder, { zoneId: village.id, ...spots.elder });
    npcHomes.set(ids.trader, { zoneId: village.id, ...spots.trader });
    const hello = pickIndex(4, 23);
    const trader = TRADERS[pickIndex(TRADERS.length, 24)] ?? TRADERS[0];
    for (const language of LANGUAGES) {
      const place = zoneName(village, language);
      texts[language][`npc.${ids.elder}`] = language === 'en' ? elderName[1] : elderName[0];
      texts[language][`npc.${ids.elder}.hello`] = fill(HELLO[language][hello] ?? '', { place });
      texts[language][`npc.${ids.trader}`] = trader;
      texts[language][`npc.${ids.trader}.hello`] = TRADER_HELLO[language];
    }
    const danger = dangerOf(village.level);
    const level = Math.max(1, village.level - 1);
    const [enemy] = VILLAGE_QUARRY[danger] ?? ['zombie_walker'];
    const [item, qty] = VILLAGE_NEEDS[village.biome];
    const killN = 4 + danger;
    const prefix = `q_${ids.elder.replace('_elder', '')}`;
    quests.push({
      id: `${prefix}_1`,
      giver: ids.elder,
      turnIn: ids.elder,
      level,
      goals: [{ type: 'kill', enemy, qty: killN }],
      reward: { xp: 40 * level, coins: 8 * level, items: [] },
    });
    quests.push({
      id: `${prefix}_2`,
      giver: ids.elder,
      turnIn: ids.elder,
      level,
      after: `${prefix}_1`,
      goals: [{ type: 'collect', item, qty }],
      reward: { xp: 50 * level, coins: 10 * level, items: [['travel_scroll', 1]] },
    });
    for (const language of LANGUAGES) {
      const q = QUEST_TEXT[language];
      const place = zoneName(village, language);
      const enemyName = textIn(language, `enemy.${enemy}`);
      const itemName = textIn(language, `item.${item}`);
      texts[language][`quest.${prefix}_1`] = fill(q.kill, { place });
      texts[language][`quest.${prefix}_1.text`] = fill(q.killText, { place, enemy: enemyName, n: killN });
      texts[language][`quest.${prefix}_1.done`] = q.killDone;
      texts[language][`quest.${prefix}_2`] = fill(q.collect, { place });
      texts[language][`quest.${prefix}_2.text`] = fill(q.collectText, { item: itemName, n: qty });
      texts[language][`quest.${prefix}_2.done`] = q.collectDone;
    }
    const next = villages[k + 1];
    if (!next) return;
    const nextIds = villageNpcIds(next);
    const nextLevel = Math.max(level, next.level - 2);
    quests.push({
      id: `${prefix}_3`,
      giver: ids.elder,
      turnIn: nextIds.elder,
      level: nextLevel,
      after: `${prefix}_2`,
      goals: [{ type: 'talk', npc: nextIds.elder }],
      reward: { xp: 60 * nextLevel, coins: 12 * nextLevel, items: [] },
    });
    const nextElder = ELDERS[Math.floor(hash(next.seed, 21) * ELDERS.length)] ?? ELDERS[0];
    for (const language of LANGUAGES) {
      const q = QUEST_TEXT[language];
      const place = zoneName(village, language);
      const nextPlace = zoneName(next, language);
      const npc = language === 'en' ? nextElder[1] : nextElder[0];
      texts[language][`quest.${prefix}_3`] = fill(q.news, { next: nextPlace });
      texts[language][`quest.${prefix}_3.text`] = fill(q.newsText, { next: nextPlace, npc });
      texts[language][`quest.${prefix}_3.done`] = fill(q.newsDone, { place });
    }
  });
  defineTexts(texts);
  const gid = (tile: string): number => baseTileIndex(tile as BaseTile) + 1;
  const tileset = {
    name: BASE_TILESET_NAME,
    image: `../${BASE_TILESET_FILE}`,
    count: BASE_TILES.length,
    urban: {
      name: URBAN_TILESET_NAME,
      image: `../${URBAN_TILESET_FILE}`,
      count: URBAN_TILES_COUNT,
      columns: URBAN_TILES_COLUMNS,
    },
  };
  content.addWilds({
    zones,
    plan: plan.zones,
    npcs,
    quests,
    npcHomes,
    rules: {
      ...rules,
      minExits: 0,
      npcIds: [...(rules.npcIds ?? []), ...Object.keys(npcs)],
    },
    generate: (zone) => generateWild(zone, gid, tileset),
  });
}
