import type { StorageAdapter } from './StorageAdapter';

/** Guarda só em memória: último recurso (ex.: navegação privada sem armazenamento) e testes. */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'memória';
  readonly data = new Map<string, string>();

  load(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  save(key: string, data: string): Promise<void> {
    this.data.set(key, data);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}
