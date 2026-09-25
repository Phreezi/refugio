/** Chaves das cenas, num só sítio para evitar gralhas e imports circulares entre cenas. */
export const SceneKey = {
  Boot: 'Boot',
  Preload: 'Preload',
  MainMenu: 'MainMenu',
  Zone: 'Zone',
  WorldMap: 'WorldMap',
  UI: 'UI',
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];

/** Evento (na UIScene) de quando o jogador passou a andar para outra zona do mundo contínuo. */
export const ZONE_CROSSED_EVENT = 'zone-crossed';
