import { describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { createNewGameState, GameState } from '../../src/core/GameState';
import { FallbackAdapter } from '../../src/save/adapters/FallbackAdapter';
import { LocalStorageAdapter } from '../../src/save/adapters/LocalStorageAdapter';
import { MemoryAdapter } from '../../src/save/adapters/MemoryAdapter';
import type { StorageAdapter } from '../../src/save/adapters/StorageAdapter';
import { Autosave } from '../../src/save/Autosave';
import { SaveManager } from '../../src/save/SaveManager';

const SPAWN = { x: 392, y: 392 };
const KEYS = ['refugio.save.0.a', 'refugio.save.0.b'];

function setup() {
  const adapter = new MemoryAdapter();
  let clock = 1000;
  const manager = new SaveManager(adapter, 0, () => (clock += 1000));
  return { adapter, manager };
}

function stateWithTick(tick: number) {
  const state = createNewGameState(SPAWN);
  state.world.tick = tick;
  return state;
}

describe('SaveManager', () => {
  it('sem save: load() devolve null', async () => {
    const { manager } = setup();
    expect(await manager.load()).toEqual({ save: null, corrupted: false });
  });

  it('grava alternando entre os slots A e B e carrega o mais recente', async () => {
    const { adapter, manager } = setup();
    await manager.save(stateWithTick(1));
    await manager.save(stateWithTick(2));
    await manager.save(stateWithTick(3));
    expect([...adapter.data.keys()].sort()).toEqual(KEYS);
    const { save } = await manager.load();
    expect(save?.state.world.tick).toBe(3);
  });

  it('um novo SaveManager (reabrir o jogo) grava por cima da cópia mais antiga', async () => {
    const { adapter, manager } = setup();
    await manager.save(stateWithTick(1)); // A
    await manager.save(stateWithTick(2)); // B
    const reopened = new SaveManager(adapter, 0, () => 99_999);
    await reopened.save(stateWithTick(3)); // deve ir para A (a mais antiga)
    expect(adapter.data.get(KEYS[0] ?? '')).toContain('"tick":3');
    expect(adapter.data.get(KEYS[1] ?? '')).toContain('"tick":2');
  });

  it('save corrompido → recupera do outro slot e avisa (corrupted)', async () => {
    const { adapter, manager } = setup();
    await manager.save(stateWithTick(1));
    await manager.save(stateWithTick(2));
    // Estraga a cópia mais recente (B), como se o separador fechasse a meio da escrita.
    adapter.data.set(KEYS[1] ?? '', (adapter.data.get(KEYS[1] ?? '') ?? '').slice(0, 40));
    const result = await new SaveManager(adapter).load();
    expect(result.corrupted).toBe(true);
    expect(result.save?.state.world.tick).toBe(1);
  });

  it('as duas cópias estragadas → sem save, mas avisa', async () => {
    const { adapter } = setup();
    adapter.data.set(KEYS[0] ?? '', 'lixo');
    adapter.data.set(KEYS[1] ?? '', '{}');
    expect(await new SaveManager(adapter).load()).toEqual({ save: null, corrupted: true });
  });

  it('gravações em paralelo logo ao abrir usam slots diferentes', async () => {
    const { adapter, manager } = setup();
    await Promise.all([manager.save(stateWithTick(1)), manager.save(stateWithTick(2))]);
    expect(adapter.data.size).toBe(2);
  });

  it('timestamps sempre crescentes, mesmo que o relógio recue', async () => {
    const adapter = new MemoryAdapter();
    const manager = new SaveManager(adapter, 0, () => 5000);
    await manager.save(stateWithTick(1));
    await manager.save(stateWithTick(2));
    expect((await manager.load()).save?.state.world.tick).toBe(2);
  });

  it('remove() apaga as duas cópias', async () => {
    const { adapter, manager } = setup();
    await manager.save(stateWithTick(1));
    await manager.save(stateWithTick(2));
    await manager.remove();
    expect(adapter.data.size).toBe(0);
    expect((await manager.load()).save).toBeNull();
  });

  it('importar: aceita um save exportado e recusa texto inválido', async () => {
    const { manager } = setup();
    await manager.save(stateWithTick(7));
    const exported = (await manager.load()).save?.text ?? '';
    expect(manager.parseImport(`\n${exported}\n`).state.world.tick).toBe(7);
    expect(() => manager.parseImport('{"version":1}')).toThrow();
  });
});

describe('adaptadores', () => {
  it('LocalStorageAdapter: guarda, lê e apaga; exceções viram rejeições', async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v === 'grande') throw new Error('QuotaExceededError');
        map.set(k, v);
      },
      removeItem: (k: string) => map.delete(k),
    };
    const adapter = new LocalStorageAdapter(storage);
    await adapter.save('k', 'v');
    expect(await adapter.load('k')).toBe('v');
    await adapter.remove('k');
    expect(await adapter.load('k')).toBeNull();
    await expect(adapter.save('k', 'grande')).rejects.toThrow('Quota');
  });

  it('FallbackAdapter: se o primário falhar, passa a usar o secundário de vez', async () => {
    const broken: StorageAdapter = {
      name: 'avariado',
      load: () => Promise.reject(new Error('x')),
      save: () => Promise.reject(new Error('x')),
      remove: () => Promise.reject(new Error('x')),
    };
    const fallback = new MemoryAdapter();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new FallbackAdapter(broken, fallback);
    await adapter.save('k', 'v');
    expect(adapter.name).toBe('memória');
    expect(await adapter.load('k')).toBe('v');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('FallbackAdapter: lê saves antigos do secundário e apaga em ambos', async () => {
    const primary = new MemoryAdapter();
    const secondary = new MemoryAdapter();
    secondary.data.set('k', 'antigo');
    const adapter = new FallbackAdapter(primary, secondary);
    expect(await adapter.load('k')).toBe('antigo');
    await adapter.remove('k');
    expect(secondary.data.has('k')).toBe(false);
  });
});

describe('Autosave', () => {
  function autosaveSetup(everyTicks = 300) {
    vi.useFakeTimers();
    const adapter = new MemoryAdapter();
    const saves = new SaveManager(adapter);
    const state = new GameState();
    const bus = new EventBus<GameEvents>();
    const autosave = new Autosave(saves, state, bus, everyTicks, 500);
    return { adapter, saves, state, bus, autosave };
  }

  it('grava de X em X ticks (com debounce de 500 ms) se houver alterações', async () => {
    const { adapter, state, bus, autosave } = autosaveSetup();
    state.newGame(SPAWN);
    autosave.start();
    bus.emit('world:tick', { tick: 299 });
    await vi.advanceTimersByTimeAsync(600);
    expect(adapter.data.size).toBe(0);
    bus.emit('world:tick', { tick: 300 });
    bus.emit('world:tick', { tick: 600 }); // pedidos seguidos juntam-se num só
    await vi.advanceTimersByTimeAsync(600);
    expect(adapter.data.size).toBe(1);
    expect(state.dirty).toBe(false);
    autosave.stop();
    vi.useRealTimers();
  });

  it('sem alterações não grava; morte pede gravação', async () => {
    const { adapter, state, bus, autosave } = autosaveSetup();
    state.newGame(SPAWN);
    state.markSaved();
    autosave.start();
    bus.emit('world:tick', { tick: 300 });
    await vi.advanceTimersByTimeAsync(600);
    expect(adapter.data.size).toBe(0);
    state.markDirty();
    bus.emit('player:died', { zoneId: 'zone_base', bag: false });
    await vi.advanceTimersByTimeAsync(600);
    expect(adapter.data.size).toBe(1);
    autosave.stop();
    vi.useRealTimers();
  });

  it('flush() grava já e stop() deixa de ouvir os eventos', async () => {
    const { adapter, saves, state, bus, autosave } = autosaveSetup();
    state.newGame(SPAWN);
    await autosave.flush();
    expect((await saves.load()).save?.state.player.x).toBe(SPAWN.x);
    autosave.start();
    autosave.stop();
    state.markDirty();
    bus.emit('world:tick', { tick: 300 });
    await vi.advanceTimersByTimeAsync(600);
    expect(adapter.data.size).toBe(1);
    vi.useRealTimers();
  });

  it('se a escrita falhar, volta a marcar alterações para tentar outra vez', async () => {
    vi.useRealTimers();
    const failing: StorageAdapter = {
      name: 'x',
      load: () => Promise.resolve(null),
      save: () => Promise.reject(new Error('disco cheio')),
      remove: () => Promise.resolve(),
    };
    const state = new GameState();
    state.newGame(SPAWN);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const autosave = new Autosave(new SaveManager(failing), state, new EventBus<GameEvents>(), 300);
    await autosave.flush();
    expect(state.dirty).toBe(true);
    error.mockRestore();
  });
});

describe('cópia de emergência (ao fechar a página)', () => {
  function syncStorage() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
  }

  it('saveSync grava já; load() escolhe-a se for a mais recente', async () => {
    const adapter = new MemoryAdapter();
    const emergency = syncStorage();
    let clock = 0;
    const manager = new SaveManager(adapter, 0, () => (clock += 10), emergency);
    await manager.save(stateWithTick(1));
    expect(manager.saveSync(stateWithTick(2))).toBe(true);
    const reopened = new SaveManager(adapter, 0, () => 1, emergency);
    expect((await reopened.load()).save?.state.world.tick).toBe(2);
    // A gravação normal seguinte é mais recente e vence a de emergência.
    await reopened.save(stateWithTick(3));
    expect((await new SaveManager(adapter, 0, () => 1, emergency).load()).save?.state.world.tick).toBe(3);
  });

  it('remove() apaga também a cópia de emergência; sem armazenamento síncrono, saveSync devolve false', async () => {
    const emergency = syncStorage();
    const manager = new SaveManager(new MemoryAdapter(), 0, Date.now, emergency);
    manager.saveSync(stateWithTick(1));
    await manager.remove();
    expect(emergency.map.size).toBe(0);
    expect(new SaveManager(new MemoryAdapter()).saveSync(stateWithTick(1))).toBe(false);
  });

  it('Autosave.flushSync usa a cópia de emergência e limpa as alterações', () => {
    const emergency = syncStorage();
    const state = new GameState();
    state.newGame(SPAWN);
    const autosave = new Autosave(
      new SaveManager(new MemoryAdapter(), 0, Date.now, emergency),
      state,
      new EventBus<GameEvents>(),
      300,
    );
    autosave.flushSync();
    expect(emergency.map.size).toBe(1);
    expect(state.dirty).toBe(false);
  });
});
