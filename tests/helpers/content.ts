import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/assets/manifest';
import { PALETTE_NAMES } from '../../src/assets/palette';
import items from '../../src/data/items.json';
import props from '../../src/data/props.json';
import resources from '../../src/data/resources.json';
import { parseItems, parseProps, parseResources } from '../../src/data/types';

/** Conteúdo real do jogo (JSON validados), para testes de integração da lógica. */
export function loadContent() {
  const url = new URL('../../public/assets/manifest.json', import.meta.url);
  const manifest = parseManifest(JSON.parse(readFileSync(url, 'utf8')), PALETTE_NAMES);
  const keys = Object.keys(manifest.assets);
  const itemDefs = parseItems(items, keys);
  return {
    items: itemDefs,
    resources: parseResources(resources, keys, Object.keys(itemDefs)),
    props: parseProps(props, keys),
  };
}
