import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_FOOTPRINT } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { countItem } from '../../src/systems/inventory/inventory';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const N = 30;
const SIZE = 16;
const ZONE = 'zone_pine_forest';

function map(spawns: { id: string; x: number; y: number }[], exits: ZoneMap['exits'] = []): ZoneMap {
  return {
    width: N,
    height: N,
    tileSize: SIZE,
    solid: new Array<boolean>(N * N).fill(false),
    floor: new Array<boolean>(N * N).fill(false),
    playerSpawn: { x: 40, y: 40 },
    exits,
    resources: [],
    props: [],
    chests: [],
    stations: [],
    containers: [],
    enemySpawns: spawns,
  };
}

function setup(zone: ZoneMap, player = { x: 240, y: 240 }) {
  const state = new GameState();
  state.newGame(player, 42);
  state.data.player.zoneId = ZONE;
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('player:damaged', ({ amount }) => events.push(`hurt:${String(amount)}`));
  bus.on('enemy:killed', ({ enemy }) => events.push(`killed:${enemy}`));
  bus.on('player:died', ({ zoneId, bag }) => events.push(`died:${zoneId}:${String(bag)}`));
  bus.on('zone:change', ({ to }) => events.push(`zone:${to}`));
  bus.on('skill:levelUp', ({ skill, level }) => events.push(`skill:${skill}:${String(level)}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  sim.setZone({
    zoneId: ZONE,
    map: zone,
    collision: CollisionWorld.fromZone(zone, content.resources, content.props),
    ...content,
  });
  sim.setRespawnPoint({ x: 100, y: 100 });
  sim.reset();
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < (seconds * 1000) / FIXED_STEP_MS; i++) {
      each?.();
      sim.update(FIXED_STEP_MS);
    }
  };
  return { state, sim, bus, events, run };
}

describe('Combate', () => {
  it('um arrastado vê o jogador, aproxima-se, avisa e só depois acerta', () => {
    const { state, sim, events, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    const [walker] = sim.combat.list;
    expect(walker).toBeDefined();
    run(0.1);
    expect(walker?.state).toBe('chase');
    // Chega ao jogador e começa o aviso (ainda sem dano).
    for (let i = 0; i < 400 && walker?.state !== 'windup'; i++) sim.update(FIXED_STEP_MS);
    expect(walker?.state).toBe('windup');
    expect(events).toEqual([]);
    run(BALANCE.enemyWindupSec + 0.1);
    expect(events).toEqual(['hurt:6']);
    expect(state.data.player.hp).toBe(94);
  });

  it('recuar durante o aviso evita o golpe; a armadura reduz o dano', () => {
    const { state, sim, events, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    const walker = sim.combat.list[0];
    for (let i = 0; i < 400 && walker?.state !== 'windup'; i++) sim.update(FIXED_STEP_MS);
    sim.setMoveIntent({ x: -1, y: 0 });
    run(BALANCE.enemyWindupSec + 0.05);
    sim.setMoveIntent({ x: 0, y: 0 });
    expect(events).toEqual([]);
    // Com camisa (10%) e chapéu (5%): 6 → 5.
    state.data.player.equipment[1] = ['cloth_hat', 1, 100];
    state.data.player.equipment[2] = ['cloth_shirt', 1, 150];
    for (let i = 0; i < 600 && events.length === 0; i++) sim.update(FIXED_STEP_MS);
    expect(events).toEqual(['hurt:5']);
    expect(state.data.player.equipment[2]).toEqual(['cloth_shirt', 1, 149]);
  });

  it('agachado, os inimigos só o veem a metade da distância', () => {
    const { sim, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    sim.setMoveIntent({ x: 0, y: 0 }, true);
    run(0.1);
    expect(sim.combat.list[0]?.state).not.toBe('chase');
  });

  it('desistem fora do raio (leash), voltam a casa e recuperam a vida', () => {
    const { state, sim, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem inimigo');
    run(0.5);
    walker.hp = 10;
    // O jogador foge para longe (teleporte: mais do que o leash).
    state.data.player.x = 40;
    state.data.player.y = 40;
    run(12);
    expect(walker.hp).toBe(40);
    expect(Math.hypot(walker.x - walker.home.x, walker.y - walker.home.y)).toBeLessThanOrEqual(50); // em casa (a passear perto)
  });

  it('aceitação da Fase 6: com a moca, vence 3 arrastados sem morrer se recuar entre ataques', () => {
    const { state, sim, events } = setup(
      map([
        { id: 'walker', x: 300, y: 230 },
        { id: 'walker', x: 310, y: 250 },
        { id: 'walker', x: 300, y: 270 },
      ]),
    );
    state.data.player.equipment[0] = ['wooden_club', 1, 100];
    const player = state.data.player;
    for (let tick = 0; tick < 20 * 90 && sim.combat.list.length > 0; tick++) {
      const enemies = sim.combat.list;
      const near = (e: { x: number; y: number }) => Math.hypot(e.x - player.x, e.y - player.y);
      const threat = enemies.find((e) => e.state === 'windup' && near(e) < 24);
      const target = [...enemies].sort((a, b) => near(a) - near(b))[0];
      if (threat) {
        // Recua do ataque anunciado.
        sim.setActionHeld(false);
        sim.setMoveIntent({ x: player.x - threat.x, y: player.y - threat.y });
      } else if (target) {
        const inFront = sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type === 'enemy';
        if (inFront) {
          sim.setMoveIntent({ x: 0, y: 0 });
          sim.setActionHeld(true);
        } else {
          sim.setActionHeld(false);
          sim.setMoveIntent({ x: target.x - player.x, y: target.y - player.y });
        }
      }
      sim.update(FIXED_STEP_MS);
    }
    expect(sim.combat.list).toHaveLength(0);
    expect(events.filter((e) => e === 'killed:zombie_walker')).toHaveLength(3);
    expect(events.some((e) => e.startsWith('died'))).toBe(false);
    expect(player.hp).toBeGreaterThan(50);
    expect(player.equipment[0]?.[2]).toBeLessThan(100); // a moca gastou-se
  });

  it('matar dá os drops (veado: carne e couro)', () => {
    const { state, sim, events } = setup(map([{ id: 'deer', x: 250, y: 240 }]));
    const deer = sim.combat.list[0];
    if (!deer) throw new Error('sem veado');
    deer.hp = 1;
    expect(sim.combat.attack(deer.uid)).toBe(true);
    expect(events).toContain('killed:deer');
    expect(countItem([state.data.player.inventory], 'raw_meat')).toBeGreaterThanOrEqual(2);
    expect(countItem([state.data.player.inventory], 'leather')).toBe(1);
  });

  it('ao morrer: a mochila fica no chão, hotbar e equipamento ficam, e volta à base', () => {
    const { state, sim, bus, events, run } = setup(map([]));
    const player = state.data.player;
    player.inventory[0] = ['wood', 12];
    player.inventory[3] = ['stone_axe', 1, 50];
    player.equipment[0] = ['wooden_club', 1, 80];
    player.hp = 1;
    sim.combat.damagePlayer(10, { x: player.x + 5, y: player.y });
    run(0.1);
    expect(events).toContain(`died:${ZONE}:true`);
    expect(player.zoneId).toBe(BASE_ZONE_ID);
    expect(player.inventory.every((slot) => slot === null)).toBe(true);
    expect(player.hotbar[0]).toEqual(['berries', 5]);
    expect(player.equipment[0]).toEqual(['wooden_club', 1, 80]);
    const bags = state.data.zones[ZONE]?.bags ?? [];
    expect(bags).toHaveLength(1);
    expect(bags[0]?.items).toEqual([
      ['wood', 12],
      ['stone_axe', 1, 50],
    ]);
    expect(bags[0]?.expiresAt).toBeGreaterThan(Date.now() + 47 * 3_600_000);

    // Volta à zona e apanha a mochila com a ação contextual.
    player.zoneId = ZONE;
    const bag = bags[0];
    if (!bag) throw new Error('sem mochila');
    Object.assign(player, { x: bag.x, y: bag.y + 8, facing: 'up' });
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('bag');
    // A ação abre-a ao lado da mochila; "Apanhar tudo" esvazia-a e ela desaparece.
    const opened: string[] = [];
    bus.on('container:open', ({ container }) => opened.push(container));
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    run(0.1);
    expect(opened).toEqual([`bag:${ZONE}:0`]);
    expect(sim.actions.takeAll(`bag:${ZONE}:0`)).toBe(true);
    run(0.1);
    expect(state.data.zones[ZONE]?.bags).toEqual([]);
    expect(countItem([player.inventory], 'wood')).toBe(12);
    expect(player.inventory.find((slot) => slot?.[0] === 'stone_axe')).toEqual(['stone_axe', 1, 50]);
  });

  it('mochilas expiradas desaparecem ao entrar na zona', () => {
    const { state, sim } = setup(map([]));
    state.data.zones[ZONE] = {
      depleted: {},
      bags: [{ x: 1, y: 1, items: [['wood', 1]], expiresAt: Date.now() - 1, death: true }],
      loot: {},
      ground: [],
    };
    const zone = map([]);
    sim.setZone({
      zoneId: ZONE,
      map: zone,
      collision: CollisionWorld.fromZone(zone, content.resources, content.props),
      ...content,
    });
    expect(state.data.zones[ZONE].bags).toEqual([]);
  });

  it('pisar uma saída pede a mudança de zona; ao entrar fica junto à saída de volta', () => {
    const exits = [{ x: 8, y: 240, to: BASE_ZONE_ID }];
    const { state, sim, events, run } = setup(map([], exits), { x: 40, y: 240 });
    sim.setMoveIntent({ x: -1, y: 0 });
    run(1);
    expect(events).toEqual([`zone:${BASE_ZONE_ID}`]);
    const base = map([], [{ x: 472, y: 240, to: ZONE }]);
    sim.enterZone(BASE_ZONE_ID, base);
    expect(state.data.player).toMatchObject({ zoneId: BASE_ZONE_ID, x: 444, y: 240 });
  });
});

describe('Equipamento', () => {
  it('equipar troca com o que estava; só entra o que é desse slot', () => {
    const { state, sim } = setup(map([]));
    const { player } = state.data;
    player.inventory[0] = ['wooden_club', 1, 90];
    player.inventory[1] = ['cloth_shirt', 1, 150];
    player.inventory[2] = ['machete', 1, 180];
    expect(sim.actions.equip({ container: 'inventory', index: 0 })).toBe(true);
    expect(player.equipment[0]).toEqual(['wooden_club', 1, 90]);
    expect(sim.actions.move({ container: 'inventory', index: 1 }, { container: 'equipment', index: 0 })).toBe(
      false,
    );
    expect(sim.actions.equip({ container: 'inventory', index: 1 })).toBe(true);
    expect(player.equipment[2]).toEqual(['cloth_shirt', 1, 150]);
    expect(sim.actions.equip({ container: 'inventory', index: 2 })).toBe(true);
    expect(player.equipment[0]?.[0]).toBe('machete');
    expect(player.inventory[2]).toEqual(['wooden_club', 1, 90]);
    expect(sim.combat.weapon()).toMatchObject({ damage: 20, reach: 16 });
    expect(sim.actions.unequip(0)).toBe(true);
    expect(player.equipment[0]).toBeNull();
    expect(sim.combat.weapon().damage).toBe(BALANCE.fistDamage);
  });
});

describe('Inimigos T2 (Fase 8)', () => {
  it('o inchado, derrotado, incha e rebenta ao fim do aviso: dano em área (fugir evita)', () => {
    const { state, sim, events, run } = setup(map([{ id: 'bloated', x: 250, y: 240 }]));
    const bloated = sim.combat.list[0];
    if (!bloated) throw new Error('sem inchado');
    bloated.hp = 1;
    expect(sim.combat.attack(bloated.uid)).toBe(true);
    expect(bloated.dying).toBeGreaterThan(0);
    expect(events).not.toContain('killed:zombie_bloated');
    // Não se pode bater num inchado a rebentar.
    expect(sim.combat.attack(bloated.uid)).toBe(false);
    const hp = state.data.player.hp;
    run(1);
    expect(events).toContain('killed:zombie_bloated');
    expect(state.data.player.hp).toBe(hp - 12);

    // Longe da explosão: sem dano.
    const far = setup(map([{ id: 'bloated', x: 250, y: 240 }]));
    const other = far.sim.combat.list[0];
    if (!other) throw new Error('sem inchado');
    other.hp = 1;
    far.sim.combat.attack(other.uid);
    far.state.data.player.x = 150;
    const farHp = far.state.data.player.hp;
    far.run(1);
    expect(far.state.data.player.hp).toBe(farHp);
  });

  it('o javali avisa e carrega em linha reta; sair da frente evita o golpe', () => {
    const { state, sim, events, run } = setup(map([{ id: 'boars', x: 300, y: 240 }]));
    const boar = sim.combat.list[0];
    if (!boar) throw new Error('sem javali');
    for (let i = 0; i < 200 && boar.state !== 'windup'; i++) sim.update(FIXED_STEP_MS);
    expect(boar.state).toBe('windup');
    expect(boar.charging).toBe(true);
    run(BALANCE.enemyWindupSec * 2 + 0.05);
    expect(boar.state).toBe('charge');
    run(1);
    expect(events.some((e) => e.startsWith('hurt:'))).toBe(true);
    expect(state.data.player.hp).toBeLessThan(100);
  });
});

describe('Inimigos T3 e medicina (Fase 10)', () => {
  it('o brutamontes avisa durante mais tempo e bate com força', () => {
    const { sim, events, run } = setup(map([{ id: 'tanks', x: 262, y: 240 }]));
    const tank = sim.combat.list[0];
    if (!tank) throw new Error('sem brutamontes');
    for (let i = 0; i < 200 && tank.state !== 'windup'; i++) sim.update(FIXED_STEP_MS);
    expect(tank.state).toBe('windup');
    run(BALANCE.enemyWindupSec + 0.1);
    // Um aviso normal já teria acabado; o dele ainda não.
    expect(tank.state).toBe('windup');
    expect(events).toEqual([]);
    run(1);
    expect(events.some((e) => e.startsWith('hurt:'))).toBe(true);
  });

  it('o gritador mantém a distância e o grito põe os outros à procura do jogador', () => {
    const zone = map([
      { id: 'screamer', x: 300, y: 240 },
      { id: 'walker', x: 380, y: 340 },
    ]);
    const { sim, run } = setup(zone);
    const walker = sim.combat.list.find((e) => e.id === 'zombie_walker');
    const screamer = sim.combat.list.find((e) => e.id === 'zombie_screamer');
    if (!walker || !screamer) throw new Error('faltam inimigos');
    run(0.2);
    // Longe demais para o ver, mas foi alertado pelo grito.
    expect(walker.alert).toBeGreaterThan(0);
    expect(walker.state).toBe('chase');
    run(3);
    const scream = content.enemies.zombie_screamer?.scream;
    expect(Math.hypot(screamer.x - 240, screamer.y - 240)).toBeGreaterThan((scream?.keepAway ?? 0) * 0.6);
  });

  it('sangrar tira vida devagar; uma ligadura estanca', () => {
    const { state, sim, run } = setup(map([]));
    const player = state.data.player;
    sim.combat.damagePlayer(5, { x: 250, y: 240 }, 100);
    expect(player.bleed).toBeGreaterThan(0);
    const hp = player.hp;
    run(6);
    expect(player.hp).toBeLessThan(hp);
    expect(player.hp).toBeGreaterThan(hp - 6);
    player.inventory[0] = ['bandage', 1];
    expect(sim.actions.use({ container: 'inventory', index: 0 })).toBe(true);
    expect(player.bleed).toBe(0);
    const after = player.hp;
    run(4);
    expect(player.hp).toBeGreaterThanOrEqual(after);
  });
});

describe('Armas à distância (Fase 10)', () => {
  it('a besta mira sozinha no inimigo mais perto, gasta um virote e o virote acerta', () => {
    const { state, sim, events, run } = setup(map([{ id: 'walker', x: 330, y: 240 }]));
    const player = state.data.player;
    sim.combat.roll = () => 0.99; // acerta sempre
    player.equipment[0] = ['crossbow', 1, 240];
    player.inventory[0] = ['bolt', 2];
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem arrastado');
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('enemy');
    expect(sim.combat.shoot()).toBe('shot');
    expect(countItem([player.inventory], 'bolt')).toBe(1);
    expect(player.facing).toBe('right');
    expect(sim.combat.shots).toHaveLength(1);
    run(0.6);
    expect(sim.combat.shots).toHaveLength(0);
    expect(walker.hp).toBe(40 - 18);
    // O virote que sobrou entrou na besta (aljava). Sem virotes: avisa e não dispara.
    expect(player.quiver).toEqual([['bolt', 1]]);
    player.quiver = [];
    player.inventory[0] = null;
    expect(sim.combat.shoot()).toBe('no_ammo');
    expect(events.filter((e) => e.startsWith('hurt:'))).toEqual([]);
  });

  it('sem inimigos ao alcance não dispara (a ação faz o resto)', () => {
    const { state, sim } = setup(map([{ id: 'walker', x: 450, y: 450 }]));
    state.data.player.equipment[0] = ['crossbow', 1, 240];
    state.data.player.inventory[0] = ['bolt', 5];
    expect(sim.combat.shoot()).toBeNull();
    expect(countItem([state.data.player.inventory], 'bolt')).toBe(5);
  });

  it('a mira não atravessa paredes (nem o ataque automático dispara contra elas)', () => {
    const zone = map([{ id: 'walker', x: 330, y: 240 }]);
    // Uma parede entre o jogador e o inimigo (coluna de tiles x = 17).
    for (let y = 0; y < N; y++) (zone.solid as boolean[])[y * N + 17] = true;
    const { state, sim } = setup(zone);
    state.data.player.equipment[0] = ['crossbow', 1, 240];
    state.data.player.inventory[0] = ['bolt', 1];
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem arrastado');
    walker.state = 'idle';
    walker.timer = 1000;
    expect(sim.combat.canSee(walker)).toBe(false);
    expect(sim.combat.shoot()).toBeNull();
    expect(sim.combat.aimTarget()).toBeNull();
  });
});

describe('Arco, mira presa, flechas no chão e perícias', () => {
  it('com a ação premida a mira fica presa no mesmo inimigo; ao largar vai ao mais perto', () => {
    const { state, sim } = setup(
      map([
        { id: 'walker', x: 300, y: 240 },
        { id: 'walker', x: 320, y: 240 },
      ]),
    );
    sim.combat.roll = () => 0.99;
    const player = state.data.player;
    player.equipment[0] = ['short_bow', 1, 100];
    player.inventory[0] = ['arrow', 20];
    const [a, b] = sim.combat.list;
    if (!a || !b) throw new Error('faltam arrastados');
    a.x = 300;
    b.x = 320;
    a.y = b.y = 240;
    expect(sim.combat.shoot(true)).toBe('shot');
    expect(sim.combat.aimTarget()?.uid).toBe(a.uid);
    // O outro fica mais perto, mas a mira continua presa enquanto a ação está premida.
    a.x = 330;
    b.x = 290;
    expect(sim.combat.shoot(true)).toBe('shot');
    expect(sim.combat.aimTarget()?.uid).toBe(a.uid);
    sim.setActionHeld(false);
    expect(sim.combat.aimTarget()?.uid).toBe(b.uid);
  });

  it('uma flecha que falha fica no chão e apanha-se ao passar por cima', () => {
    const { state, sim, run } = setup(map([{ id: 'walker', x: 300, y: 240 }]));
    let rolls = 0;
    sim.combat.roll = () => (rolls++ === 0 ? 0 : 0.99); // falha o tiro; a flecha não parte
    const player = state.data.player;
    player.equipment[0] = ['short_bow', 1, 100];
    player.inventory[0] = ['arrow', 3];
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem arrastado');
    walker.state = 'idle';
    walker.timer = 10000;
    expect(sim.combat.shoot()).toBe('shot');
    run(1);
    expect(walker.hp).toBe(40);
    const ground = state.data.zones[ZONE]?.ground ?? [];
    expect(ground).toHaveLength(1);
    expect(ground[0]?.[2]).toBe('arrow');
    // As flechas entram no arco (aljava); a do chão também vai lá parar.
    expect(player.quiver).toEqual([['arrow', 2]]);
    const [gx, gy] = ground[0] ?? [0, 0];
    player.x = gx;
    player.y = gy;
    run(0.1);
    expect(player.quiver).toEqual([['arrow', 3]]);
    expect(countItem([player.inventory], 'arrow')).toBe(0);
    expect(state.data.zones[ZONE]?.ground).toEqual([]);
  });

  it('cada golpe treina a perícia da arma; a subir de nível falha-se menos', () => {
    const { state, sim, events } = setup(map([{ id: 'walker', x: 112, y: 240 }]));
    sim.combat.roll = () => 0.99;
    const player = state.data.player;
    player.equipment[0] = ['machete', 1, 180];
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem arrastado');
    walker.hp = 10000;
    for (let i = 0; i < 15; i++) sim.combat.attack(walker.uid);
    expect(player.skills.blade).toBe(15);
    expect(events).toContain('skill:blade:2');
    expect(player.skills.fists).toBeUndefined();
  });
});

describe('Aljava e corpos', () => {
  it('as flechas entram no arco; ao tirar o arco voltam para a mochila e o excesso fica no chão', () => {
    const { state, sim, run } = setup(map([]));
    const player = state.data.player;
    player.equipment[0] = ['short_bow', 1, 100];
    player.inventory[0] = ['arrow', 999];
    player.inventory[1] = ['stone_arrow', 40];
    player.hotbar[2] = ['arrow', 500];
    run(0.1);
    expect(player.quiver).toEqual([
      ['arrow', 1499],
      ['stone_arrow', 40],
    ]);
    expect(sim.combat.ammoCount()).toBe(1539);
    // Tira o arco com a mochila quase cheia: o que não couber fica numa pilha no chão.
    player.inventory.fill(['wood', 50]);
    player.inventory[0] = null;
    player.hotbar.fill(['stone', 50]);
    player.equipment[0] = null;
    run(0.1);
    expect(player.quiver).toEqual([]);
    expect(player.inventory[0]).toEqual(['arrow', 999]);
    const pile = state.data.zones[ZONE]?.bags[0]?.items ?? [];
    expect(pile).toEqual([
      ['arrow', 500],
      ['stone_arrow', 40],
    ]);
  });

  it('o arco usa primeiro a flecha com mais dano; as que não partem apanham-se do corpo', () => {
    const { state, sim, run } = setup(map([{ id: 'walker', x: 300, y: 240 }]));
    sim.combat.roll = () => 0.99; // acerta e não parte
    const player = state.data.player;
    player.equipment[0] = ['short_bow', 1, 100];
    player.quiver = [
      ['arrow', 5],
      ['iron_arrow', 1],
    ];
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem arrastado');
    walker.state = 'idle';
    walker.timer = 10000;
    walker.hp = 7 + 6 + 1; // a de ferro (7 + 6) não chega; a seguinte mata
    expect(sim.combat.shoot()).toBe('shot');
    run(1);
    expect(walker.hp).toBe(1);
    expect(sim.combat.shoot()).toBe('shot');
    run(1);
    expect(sim.combat.list).toHaveLength(0);
    const corpse = sim.combat.corpses[0];
    expect(corpse?.arrows).toEqual({ iron_arrow: 1, arrow: 1 });
    player.x = corpse?.x ?? 0;
    player.y = corpse?.y ?? 0;
    run(0.1);
    expect(player.quiver).toEqual([
      ['arrow', 5],
      ['iron_arrow', 1],
    ]);
    // O corpo desaparece ao fim de corpseSec.
    run(BALANCE.corpseSec);
    expect(sim.combat.corpses).toHaveLength(0);
  });
});

describe('Largar, apanhar e destruir itens', () => {
  it('largar põe o item numa pilha no chão; a pilha abre-se e apanha-se o que se quiser', () => {
    const { state, sim, run } = setup(map([]));
    const player = state.data.player;
    player.inventory[0] = ['wood', 7];
    player.inventory[1] = ['stone_axe', 1, 40];
    expect(sim.actions.drop({ container: 'inventory', index: 0 })).toBe(true);
    expect(sim.actions.drop({ container: 'inventory', index: 1 })).toBe(true);
    const bags = state.data.zones[ZONE]?.bags ?? [];
    expect(bags).toHaveLength(1); // junta-se à mesma pilha
    expect(bags[0]?.items).toEqual([
      ['wood', 7],
      ['stone_axe', 1, 40],
    ]);
    expect(bags[0]?.death).toBe(false);
    sim.actions.move({ container: `bag:${ZONE}:0`, index: 1 }, { container: 'inventory', index: 5 });
    expect(player.inventory[5]).toEqual(['stone_axe', 1, 40]);
    run(0.1);
    expect(state.data.zones[ZONE]?.bags[0]?.items).toEqual([['wood', 7], null]);
  });

  it('destruir tira o item de vez', () => {
    const { state, sim } = setup(map([]));
    state.data.player.hotbar[0] = ['berries', 5];
    expect(sim.actions.destroy({ container: 'hotbar', index: 0 })).toBe(true);
    expect(state.data.player.hotbar[0]).toBeNull();
    expect(state.data.zones[ZONE]?.bags ?? []).toEqual([]);
  });
});

describe('Estatísticas (Fase 11)', () => {
  it('contam inimigos derrotados, mortes e o tempo de jogo', () => {
    const { state, sim, run } = setup(map([{ id: 'walker', x: 250, y: 240 }]));
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem arrastado');
    walker.hp = 1;
    sim.combat.attack(walker.uid);
    run(1);
    state.data.player.hp = 0;
    run(0.1);
    const stats = state.data.stats;
    expect(stats.kills).toBe(1);
    expect(stats.deaths).toBe(1);
    expect(stats.playTicks).toBeGreaterThanOrEqual(20);
  });
});

describe('Tutorial (Fase 11)', () => {
  it('mostra um passo de cada vez e avança quando o jogador faz a coisa', () => {
    const { state, sim, run } = setup(map([]));
    const tutorial = sim.tutorial;
    expect(tutorial.current()).toBe('move');
    sim.setMoveIntent({ x: 1, y: 0 });
    run(0.2);
    sim.setMoveIntent({ x: 0, y: 0 });
    expect(tutorial.current()).toBe('gather');
    state.data.tutorial.done.push('gather', 'craft', 'build');
    // "Comer" só aparece com fome.
    expect(tutorial.current()).toBe('travel');
    state.data.player.hunger = 40;
    expect(tutorial.current()).toBe('eat');
    tutorial.dismiss();
    expect(tutorial.current()).toBeNull();
  });
});
