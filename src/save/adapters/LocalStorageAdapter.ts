import type { StorageAdapter } from './StorageAdapter';

type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Corre uma operação síncrona e devolve-a como Promise (exceções viram rejeições). */
function attempt<T>(op: () => T): Promise<T> {
  try {
    return Promise.resolve(op());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Fallback do IndexedDB. Síncrono por baixo (o que até ajuda ao gravar no `pagehide`). */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage';
  private readonly storage: SyncStorage;

  constructor(storage: SyncStorage) {
    this.storage = storage;
  }

  load(key: string): Promise<string | null> {
    return attempt(() => this.storage.getItem(key));
  }

  save(key: string, data: string): Promise<void> {
    return attempt(() => {
      this.storage.setItem(key, data);
    });
  }

  remove(key: string): Promise<void> {
    return attempt(() => {
      this.storage.removeItem(key);
    });
  }
}
