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
import { SaveManager } from './SaveManager';

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
export const saves = new SaveManager(createWebStorage(localStorageRef), 0, Date.now, localStorageRef);
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
