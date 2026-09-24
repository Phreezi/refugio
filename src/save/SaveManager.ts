import type { GameStateData } from '../core/GameState';
import type { StorageAdapter } from './adapters/StorageAdapter';
import { parseSave, SaveError, serializeSave, type ParsedSave } from './schema';

const KEY_PREFIX = 'refugio.save';
const SLOT_SUFFIXES = ['a', 'b'] as const;
const EMERGENCY_SUFFIX = 'x';

/** Armazenamento síncrono (localStorage) para a cópia de emergência ao fechar a página. */
export type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LoadedSave extends ParsedSave {
  /** Texto gravado (para exportar tal como está). */
  text: string;
}

export interface LoadResult {
  /** O save válido mais recente, ou null se não houver nenhum. */
  save: LoadedSave | null;
  /** Havia uma cópia estragada (checksum, JSON…): usou-se a outra, ou nenhuma. */
  corrupted: boolean;
}

/**
 * Gravação robusta (CLAUDE.md §10.3): dois slots rotativos (A/B) por jogo. Grava sempre no
 * mais antigo (ou estragado); ao carregar escolhe o mais recente válido. Assim, fechar o
 * separador a meio de uma escrita nunca estraga as duas cópias.
 *
 * Ao fechar a página, a escrita assíncrona (IndexedDB) pode ser cortada pelo browser; por isso
 * `saveSync` grava ainda uma cópia de emergência síncrona (localStorage), que entra na escolha
 * do "mais recente válido" ao carregar.
 */
export class SaveManager {
  private readonly adapter: StorageAdapter;
  private readonly keys: readonly [string, string];
  private readonly emergencyKey: string;
  private readonly emergency: SyncStorage | null;
  private readonly now: () => number;
  /** Índice do slot onde se grava a seguir (null = ainda não se sabe; descobre-se ao gravar). */
  private next: 0 | 1 | null = null;
  private lastTimestamp = 0;
  /** Primeira leitura dos slots, partilhada por gravações em paralelo (escolhem slots diferentes). */
  private discovering: Promise<unknown> | null = null;

  /**
   * @param gameSlot slot de jogo (a v1 usa só o 0; a estrutura já prevê 3).
   * @param emergency armazenamento síncrono para `saveSync` (null = sem cópia de emergência).
   */
  constructor(
    adapter: StorageAdapter,
    gameSlot = 0,
    now: () => number = Date.now,
    emergency: SyncStorage | null = null,
  ) {
    this.adapter = adapter;
    const prefix = `${KEY_PREFIX}.${String(gameSlot)}`;
    this.keys = [`${prefix}.${SLOT_SUFFIXES[0]}`, `${prefix}.${SLOT_SUFFIXES[1]}`];
    this.emergencyKey = `${prefix}.${EMERGENCY_SUFFIX}`;
    this.emergency = emergency;
    this.now = now;
  }

  get storageName(): string {
    return this.adapter.name;
  }

  async load(): Promise<LoadResult> {
    const texts = await Promise.all(this.keys.map((key) => this.adapter.load(key)));
    let corrupted = false;
    const parse = (text: string | null): LoadedSave | null => {
      if (text === null) return null;
      try {
        return { ...parseSave(text), text };
      } catch (error) {
        corrupted = true;
        console.warn('[save] cópia inválida ignorada:', error instanceof Error ? error.message : error);
        return null;
      }
    };
    const [a, b] = texts.map(parse);
    const slotNewest: 0 | 1 = b && (!a || b.timestamp > a.timestamp) ? 1 : 0;
    const slotSave = (slotNewest === 0 ? a : b) ?? null;
    const emergency = parse(this.readEmergency());
    const save = emergency && (!slotSave || emergency.timestamp > slotSave.timestamp) ? emergency : slotSave;
    // Grava-se a seguir no outro slot (o mais antigo ou estragado).
    this.next = slotSave ? (slotNewest === 0 ? 1 : 0) : 0;
    this.lastTimestamp = Math.max(this.lastTimestamp, save?.timestamp ?? 0);
    return { save, corrupted };
  }

  /**
   * Cópia de emergência síncrona (ao esconder/fechar a página). Não substitui os slots A/B:
   * é só a mais recente enquanto a próxima gravação normal não acontecer.
   * @returns false se não houver armazenamento síncrono ou se a escrita falhar.
   */
  saveSync(state: GameStateData): boolean {
    if (!this.emergency) return false;
    const timestamp = Math.max(this.now(), this.lastTimestamp + 1);
    try {
      this.emergency.setItem(this.emergencyKey, serializeSave(state, timestamp));
      this.lastTimestamp = timestamp;
      return true;
    } catch (error) {
      console.warn('[save] cópia de emergência falhou:', error);
      return false;
    }
  }

  private readEmergency(): string | null {
    try {
      return this.emergency?.getItem(this.emergencyKey) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Grava o estado. A serialização acontece já (síncrona), por isso alterações feitas enquanto
   * a escrita decorre não se misturam nesta gravação.
   */
  async save(state: GameStateData): Promise<void> {
    // Timestamps sempre crescentes, mesmo que o relógio do sistema recue.
    const timestamp = Math.max(this.now(), this.lastTimestamp + 1);
    const text = serializeSave(state, timestamp);
    if (this.next === null) await (this.discovering ??= this.load());
    const index = this.next ?? 0;
    this.next = index === 0 ? 1 : 0;
    this.lastTimestamp = timestamp;
    await this.adapter.save(this.keys[index], text);
  }

  /** Apaga as duas cópias. */
  async remove(): Promise<void> {
    await Promise.all(this.keys.map((key) => this.adapter.remove(key)));
    try {
      this.emergency?.removeItem(this.emergencyKey);
    } catch {
      // sem acesso ao localStorage: não havia cópia de emergência
    }
    this.next = 0;
    this.lastTimestamp = 0;
  }

  /**
   * Valida um save importado (ficheiro exportado). Não grava: quem chama decide.
   * @throws SaveError com o motivo.
   */
  parseImport(text: string): ParsedSave {
    return parseSave(text.trim());
  }
}

export { SaveError };
