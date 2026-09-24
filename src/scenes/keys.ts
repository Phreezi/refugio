/** Chaves das cenas, num só sítio para evitar gralhas e imports circulares entre cenas. */
export const SceneKey = {
  Boot: 'Boot',
  Preload: 'Preload',
  MainMenu: 'MainMenu',
  Zone: 'Zone',
  UI: 'UI',
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
