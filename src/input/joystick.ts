import type { Vec2 } from '../systems/movement/geometry';

// Matemática do joystick virtual (lógica pura, testável). O desenho e os toques estão na UIScene.

const EIGHTH = Math.PI / 4;

export interface JoystickReading {
  /** Direção de movimento: vetor unitário numa das 8 direções, ou zero dentro da zona morta. */
  direction: Vec2;
  /** Deslocamento do manípulo em relação ao centro, limitado ao raio (px de jogo, inteiros). */
  knob: Vec2;
  /** Joystick pouco empurrado (entre a zona morta e `sneakZone`): anda agachado (§7.8). */
  sneak: boolean;
}

/**
 * Converte o arrasto do dedo (em relação ao centro do joystick) numa das 8 direções
 * (CLAUDE.md §7.1: movimento em 8 direções).
 * @param deadZone fração do raio (0–1) abaixo da qual não há movimento.
 * @param sneakZone fração do raio abaixo da qual (e acima da zona morta) se anda agachado.
 */
export function readJoystick(
  dx: number,
  dy: number,
  radius: number,
  deadZone: number,
  sneakZone = 0,
): JoystickReading {
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  const knob = { x: Math.round(dx * scale), y: Math.round(dy * scale) };
  if (distance < radius * deadZone || distance === 0)
    return { direction: { x: 0, y: 0 }, knob, sneak: false };
  const sneak = distance < radius * sneakZone;

  const angle = Math.round(Math.atan2(dy, dx) / EIGHTH) * EIGHTH;
  // Arredondar evita resíduos como 6e-17 que estragariam a comparação com zero.
  const x = Math.round(Math.cos(angle) * 1e6) / 1e6;
  const y = Math.round(Math.sin(angle) * 1e6) / 1e6;
  return { direction: { x, y }, knob, sneak };
}

/** Direção a partir das teclas premidas (não normalizada: a Simulation normaliza). */
export function keyboardDirection(keys: { up: boolean; down: boolean; left: boolean; right: boolean }): Vec2 {
  return {
    x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
    y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0),
  };
}
