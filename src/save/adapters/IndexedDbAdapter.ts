import type { StorageAdapter } from './StorageAdapter';

const DB_NAME = 'refugio';
const DB_VERSION = 1;
const STORE = 'saves';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB: pedido falhou'));
    };
  });
}

/** Armazenamento principal na web (CLAUDE.md §3): mais espaço e mais fiável do que o localStorage. */
export class IndexedDbAdapter implements StorageAdapter {
  readonly name = 'IndexedDB';
  private readonly factory: IDBFactory;
  private db: Promise<IDBDatabase> | null = null;

  constructor(factory: IDBFactory) {
    this.factory = factory;
  }

  async load(key: string): Promise<string | null> {
    const db = await this.open();
    const value: unknown = await requestToPromise(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(key),
    );
    return typeof value === 'string' ? value : null;
  }

  async save(key: string, data: string): Promise<void> {
    const db = await this.open();
    // 'strict': só conclui depois de o browser garantir a escrita em disco.
    const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
    tx.objectStore(STORE).put(data, key);
    await this.complete(tx);
  }

  async remove(key: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await this.complete(tx);
  }

  private complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        reject(tx.error ?? new Error('IndexedDB: transação abortada'));
      };
    });
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB: não abriu'));
      };
      request.onblocked = () => {
        reject(new Error('IndexedDB: bloqueado por outro separador'));
      };
    }).catch((error: unknown) => {
      this.db = null; // tentar de novo da próxima vez
      throw error;
    });
    return this.db;
  }
}
