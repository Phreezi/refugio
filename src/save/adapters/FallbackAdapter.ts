import type { StorageAdapter } from './StorageAdapter';

/**
 * Usa `primary` e, se ele falhar (ex.: IndexedDB indisponível em navegação privada), passa a usar
 * `fallback` de vez. Ao ler, se o primário não tiver nada, espreita o fallback (saves antigos).
 */
export class FallbackAdapter implements StorageAdapter {
  private readonly primary: StorageAdapter;
  private readonly fallback: StorageAdapter;
  private failed = false;

  constructor(primary: StorageAdapter, fallback: StorageAdapter) {
    this.primary = primary;
    this.fallback = fallback;
  }

  get name(): string {
    return this.failed ? this.fallback.name : this.primary.name;
  }

  async load(key: string): Promise<string | null> {
    const fromPrimary = await this.run((a) => a.load(key));
    if (fromPrimary !== null || this.failed) return fromPrimary;
    return this.fallback.load(key).catch(() => null);
  }

  save(key: string, data: string): Promise<void> {
    return this.run((a) => a.save(key, data));
  }

  async remove(key: string): Promise<void> {
    await this.run((a) => a.remove(key));
    // Apagar também cópias antigas no fallback, para um save apagado não "ressuscitar".
    if (!this.failed) await this.fallback.remove(key).catch(() => undefined);
  }

  private async run<T>(op: (adapter: StorageAdapter) => Promise<T>): Promise<T> {
    if (!this.failed) {
      try {
        return await op(this.primary);
      } catch (error) {
        console.warn(`[save] ${this.primary.name} falhou; a usar ${this.fallback.name}.`, error);
        this.failed = true;
      }
    }
    return op(this.fallback);
  }
}
