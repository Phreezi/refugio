import type { ItemDefs, PropDefs, ResourceDefs } from '../data/types';
import type { ZoneMap } from './zoneMap';

/**
 * Conteúdo já validado no arranque (PreloadScene), partilhado pelas cenas.
 * Não é estado do jogo: é igual para todos os jogos e não se grava.
 */
class Content {
  private itemDefs: ItemDefs | null = null;
  private resourceDefs: ResourceDefs | null = null;
  private propDefs: PropDefs | null = null;
  private readonly zoneMaps = new Map<string, ZoneMap>();

  setItems(defs: ItemDefs): void {
    this.itemDefs = defs;
  }

  get items(): ItemDefs {
    if (this.itemDefs === null) throw new Error('Content: itens ainda não carregados.');
    return this.itemDefs;
  }

  setResources(defs: ResourceDefs): void {
    this.resourceDefs = defs;
  }

  get resources(): ResourceDefs {
    if (this.resourceDefs === null) throw new Error('Content: recursos ainda não carregados.');
    return this.resourceDefs;
  }

  setProps(defs: PropDefs): void {
    this.propDefs = defs;
  }

  get props(): PropDefs {
    if (this.propDefs === null) throw new Error('Content: obstáculos ainda não carregados.');
    return this.propDefs;
  }

  setZoneMap(zoneId: string, map: ZoneMap): void {
    this.zoneMaps.set(zoneId, map);
  }

  zoneMap(zoneId: string): ZoneMap {
    const map = this.zoneMaps.get(zoneId);
    if (!map) throw new Error(`Content: mapa da zona "${zoneId}" não carregado.`);
    return map;
  }
}

export const content = new Content();
