import { secondsToTicks } from '../core/Clock';
import { eventBus } from '../core/EventBus';
import { gameState } from '../core/GameState';
import { BALANCE } from '../data/balance';
import { FallbackAdapter } from './adapters/FallbackAdapter';
import { IndexedDbAdapter } from './adapters/IndexedDbAdapter';
import { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { MemoryAdapter } from './adapters/MemoryAdapter';
import type { StorageAdapter } from './adapters/StorageAdapter';
import { Autosave } from './Autosave';
import { SaveManager, type LoadResult } from './SaveManager';

/** localStorage, se o browser o permitir (em alguns modos privados até o acesso lança erro). */
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Web: IndexedDB → localStorage → memória (se o browser bloquear tudo, ex.: modo privado). */
function createWebStorage(storage: Storage | null): StorageAdapter {
  const local: StorageAdapter = storage ? new LocalStorageAdapter(storage) : new MemoryAdapter();
  const fallback = new FallbackAdapter(local, new MemoryAdapter());
  return typeof indexedDB === 'undefined'
    ? fallback
    : new FallbackAdapter(new IndexedDbAdapter(indexedDB), fallback);
}

const localStorageRef = localStorageOrNull();
const storage = createWebStorage(localStorageRef);
/** Jogos (slots) da lista do menu inicial. */
export const GAME_SLOTS = 3;
const SLOT_KEY = 'refugio.slot';

function lastSlot(): number {
  try {
    const slot = Number(localStorageRef?.getItem(SLOT_KEY) ?? 0);
    return Number.isInteger(slot) && slot >= 0 && slot < GAME_SLOTS ? slot : 0;
  } catch {
    return 0;
  }
}

/** O save do jogo escolhido no menu (troca-se com `selectSlot`). */
export const saves = new SaveManager(storage, lastSlot(), Date.now, localStorageRef);

/** Escolhe o jogo (slot) onde se lê e grava, e lembra-o para a próxima vez. */
export function selectSlot(slot: number): void {
  saves.useSlot(slot);
  try {
    localStorageRef?.setItem(SLOT_KEY, String(slot));
  } catch {
    // Sem localStorage: vale só nesta sessão.
  }
}

/** Resumo de cada jogo para a lista do menu (null = vazio). */
export async function loadSlotSummaries(): Promise<(LoadResult | null)[]> {
  return Promise.all(
    Array.from({ length: GAME_SLOTS }, async (_, slot) => {
      const manager = new SaveManager(storage, slot, Date.now, localStorageRef);
      const result = await manager.load();
      return result.save ? result : null;
    }),
  );
}
export const autosave = new Autosave(saves, gameState, eventBus, secondsToTicks(BALANCE.autosaveSec));

/**
 * Grava ao esconder o separador ou sair da página (CLAUDE.md §10.2). Aqui a escrita tem de ser
 * síncrona: ao recarregar/fechar, o browser corta escritas assíncronas no IndexedDB.
 */
export function installSaveOnHide(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave.flushSync();
  });
  window.addEventListener('pagehide', () => {
    autosave.flushSync();
  });
}
