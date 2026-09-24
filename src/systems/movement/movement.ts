import type { CollisionWorld } from './CollisionWorld';
import { footprintRect, isZero, overlaps, ZERO, type Rect, type Vec2 } from './geometry';

export type Facing = 'down' | 'left' | 'right' | 'up';

/** Vetor unitário na mesma direção (ou zero). */
export function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  if (length === 0 || !Number.isFinite(length)) return ZERO;
  return { x: v.x / length, y: v.y / length };
}

/**
 * Direção do sprite a partir da intenção de movimento. Nas diagonais mantém a direção
 * atual se ela for uma das componentes (evita "tremer" ao andar na diagonal).
 */
export function facingFromIntent(intent: Vec2, current: Facing): Facing {
  if (isZero(intent)) return current;
  const horizontal: Facing = intent.x < 0 ? 'left' : 'right';
  const vertical: Facing = intent.y < 0 ? 'up' : 'down';
  const ax = Math.abs(intent.x);
  const ay = Math.abs(intent.y);
  if (Math.abs(ax - ay) < 1e-6) {
    if (current === horizontal || current === vertical) return current;
    return horizontal;
  }
  return ax > ay ? horizontal : vertical;
}

/** Desloca `box` ao longo de um eixo, parando encostado ao primeiro sólido à frente. */
function sweepAxis(box: Rect, delta: number, axis: 'x' | 'y', world: CollisionWorld): number {
  if (delta === 0) return 0;
  const moved: Rect = axis === 'x' ? { ...box, x: box.x + delta } : { ...box, y: box.y + delta };
  const sweep: Rect = {
    x: Math.min(box.x, moved.x),
    y: Math.min(box.y, moved.y),
    w: box.w + (axis === 'x' ? Math.abs(delta) : 0),
    h: box.h + (axis === 'y' ? Math.abs(delta) : 0),
  };
  let allowed = delta;
  for (const solid of world.solidsIn(sweep)) {
    // Sólidos em que já estamos metidos são ignorados, para nunca ficar preso.
    if (overlaps(solid, box)) continue;
    if (axis === 'x') {
      if (delta > 0) allowed = Math.min(allowed, solid.x - (box.x + box.w));
      else allowed = Math.max(allowed, solid.x + solid.w - box.x);
    } else if (delta > 0) {
      allowed = Math.min(allowed, solid.y - (box.y + box.h));
    } else {
      allowed = Math.max(allowed, solid.y + solid.h - box.y);
    }
  }
  // Um sólido "atrás" (distância com sinal contrário) nunca empurra para trás.
  return delta > 0 ? Math.max(0, allowed) : Math.min(0, allowed);
}

/**
 * Move uma caixa de colisão (definida pelos pés) com deslize ao longo das paredes:
 * resolve primeiro o eixo X e depois o Y.
 * @returns a nova posição dos pés.
 */
export function moveWithCollision(
  feet: Vec2,
  footprint: { width: number; height: number },
  delta: Vec2,
  world: CollisionWorld,
): Vec2 {
  const box = footprintRect(feet, footprint);
  const dx = sweepAxis(box, delta.x, 'x', world);
  box.x += dx;
  const dy = sweepAxis(box, delta.y, 'y', world);
  return { x: feet.x + dx, y: feet.y + dy };
}
