/** Armazenamento de texto por chave (CLAUDE.md §10.4). Web, Android e YouTube têm o seu. */
export interface StorageAdapter {
  /** Nome para mensagens de debug (ex.: "IndexedDB"). */
  readonly name: string;
  load(key: string): Promise<string | null>;
  save(key: string, data: string): Promise<void>;
  remove(key: string): Promise<void>;
}
