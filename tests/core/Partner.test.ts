import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const N = 40;
const ZONE = 'zone_pine_forest';

function map(spawns: { id: string; x: number; y: number }[]): ZoneMap {
  return {
    width: N,
    height: N,
    tileSize: 16,
    solid: new Array<boolean>(N * N).fill(false),
    floor: new Array<boolean>(N * N).fill(false),
    playerSpawn: { x: 40, y: 40 },
    exits: [],
    resources: [],
    props: [],
    chests: [],
    stations: [],
    containers: [],
    enemySpawns: spawns,
  };
}

function setup(spawns: { id: string; x: number; y: number }[]) {
  const state = new GameState();
  state.newGame({ x: 100, y: 240 }, 42);
  state.data.player.zoneId = ZONE;
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('player:damaged', () => events.push('player:hurt'));
  bus.on('partner:damaged', () => events.push('partner:hurt'));
  bus.on('partner:down', () => events.push('partner:down'));
  bus.on('partner:revived', () => events.push('partner:revived'));
  bus.on('partner:action', ({ kind }) => events.push(`partner:${kind}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  const zone = map(spawns);
  sim.setZone({
    zoneId: ZONE,
    map: zone,
    collision: CollisionWorld.fromZone(zone, content.resources, content.props),
    ...content,
  });
  sim.setRespawnPoint({ x: 40, y: 40 });
  sim.reset();
  const run = (seconds: number) => {
    for (let i = 0; i < (seconds * 1000) / FIXED_STEP_MS; i++) sim.update(FIXED_STEP_MS);
  };
  return { state, sim, events, run };
}

describe('Parceiro (co-op)', () => {
  it('os inimigos atacam o jogador mais perto: o parceiro', () => {
    const { sim, events, run } = setup([{ id: 'walker', x: 440, y: 240 }]);
    sim.setPartner(null);
    sim.movePartner(400, 240, 'right', false, false);
    run(6);
    expect(events).toContain('partner:hurt');
    expect(events).not.toContain('player:hurt');
  });

  it('o parceiro bate no inimigo à frente dele com a arma que trouxe', () => {
    const { sim, events, run } = setup([{ id: 'walker', x: 414, y: 240 }]);
    sim.setPartner('machete');
    sim.movePartner(400, 240, 'right', false, false);
    const walker = sim.combat.list[0];
    const hp = walker?.hp ?? 0;
    sim.partnerAction();
    run(0.1);
    expect(events).toContain('partner:attack');
    const machete = content.items.machete?.damage ?? 0;
    expect(machete).toBeGreaterThan(0);
    expect(hp - (walker?.hp ?? 0)).toBe(machete);
  });

  it('caído, volta ao pé do anfitrião com a vida cheia e não anda entretanto', () => {
    const { state, sim, events, run } = setup([]);
    sim.setPartner(null);
    const partner = sim.partner;
    expect(partner).not.toBeNull();
    if (!partner) return;
    sim.movePartner(300, 240, 'left', true, false);
    partner.hp = 0;
    partner.downUntil = state.data.world.tick + 20;
    sim.movePartner(350, 240, 'left', true, false); // ignorado: está caído
    expect(partner.x).toBe(300);
    run(BALANCE.partnerDownSec);
    expect(events).toContain('partner:revived');
    expect(partner).toMatchObject({ x: 100, y: 240, hp: BALANCE.statMax, downUntil: 0 });
  });

  it('sem parceiro, setPartner(undefined) tira-o do jogo', () => {
    const { sim } = setup([]);
    sim.setPartner(null);
    expect(sim.partner).not.toBeNull();
    sim.setPartner(undefined);
    expect(sim.partner).toBeNull();
  });
});

describe('Mundo emprestado (convidado)', () => {
  it('um estado emprestado nunca fica por gravar', () => {
    const host = new GameState();
    host.newGame({ x: 10, y: 10 }, 1);
    const guest = new GameState();
    guest.load(structuredClone(host.data), true);
    guest.markDirty();
    expect(guest.borrowed).toBe(true);
    expect(guest.dirty).toBe(false);
    guest.load(structuredClone(host.data));
    guest.markDirty();
    expect(guest.dirty).toBe(true);
  });
});
