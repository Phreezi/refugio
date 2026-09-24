import type { Rect, Vec2 } from '../movement/geometry';
import type { Facing } from '../movement/movement';

// Ação contextual (CLAUDE.md §7.2): escolhe automaticamente o alvo mais próximo EM FRENTE do
// jogador, com prioridade zombie > contentor > recurso.

export type TargetKind = 'enemy' | 'container' | 'resource';

const PRIORITY: Readonly<Record<TargetKind, number>> = { enemy: 3, container: 2, resource: 1 };

export interface Target<T = unknown> {
  kind: TargetKind;
  /** Área onde o alvo "está" (caixa de colisão ou área à volta dos pés). */
  area: Rect;
  data: T;
}

const FACING_VECTORS: Readonly<Record<Facing, Vec2>> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Ponto de `area` mais próximo de `p`. */
function closestPoint(area: Rect, p: Vec2): Vec2 {
  return {
    x: Math.max(area.x, Math.min(p.x, area.x + area.w)),
    y: Math.max(area.y, Math.min(p.y, area.y + area.h)),
  };
}

/**
 * @param from ponto de referência do jogador (centro da caixa dos pés)
 * @param reach distância máxima (px) até à área do alvo
 */
export function pickTarget<T>(
  from: Vec2,
  facing: Facing,
  targets: readonly Target<T>[],
  reach: number,
): Target<T> | null {
  const dir = FACING_VECTORS[facing];
  let best: { target: Target<T>; distance: number } | null = null;
  for (const target of targets) {
    const point = closestPoint(target.area, from);
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance > reach) continue;
    // "Em frente": no semiplano para onde olha (encostado ao alvo também conta).
    if (distance > 2 && (dx * dir.x + dy * dir.y) / distance < 0.2) continue;
    const better =
      !best ||
      PRIORITY[target.kind] > PRIORITY[best.target.kind] ||
      (PRIORITY[target.kind] === PRIORITY[best.target.kind] && distance < best.distance);
    if (better) best = { target, distance };
  }
  return best?.target ?? null;
}
