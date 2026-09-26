// Animação das armas por cima do boneco (pedido do jogador: "novas animações para as armas,
// principalmente o arco, socos e armas normais"). Lógica pura (sem Phaser): dada a fase do
// golpe `t` ∈ [0, 1], diz onde fica a arma (ou o punho) em relação aos pés do jogador.

export type Facing = 'up' | 'down' | 'left' | 'right';

/** Tipo de animação: golpe em arco (armas e ferramentas), soco, ou disparo (arco, pistola…). */
export type SwingKind = 'melee' | 'punch' | 'ranged';

export interface WeaponPose {
  /** Posição da pega (arma) ou do punho, em px de jogo, relativa aos pés do jogador. */
  dx: number;
  dy: number;
  /** Direção para onde a arma aponta (radianos; 0 = direita, π/2 = baixo). */
  angle: number;
  /** Desenha-se atrás do boneco (a olhar para cima). */
  behind: boolean;
  /** Arco/pistola: quanto a corda está puxada [0, 1] (0 = solto: a flecha já partiu). */
  draw: number;
  /** Pistola: clarão na boca do cano. */
  flash: boolean;
}

/** Ângulo de cada direção (y para baixo). */
export const FACING_ANGLE: Record<Facing, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

/** Mão da frente (px relativos aos pés), para cada direção. */
const HAND: Record<Facing, { x: number; y: number }> = {
  right: { x: 4, y: -12 },
  left: { x: -4, y: -12 },
  down: { x: 4, y: -11 },
  up: { x: -4, y: -13 },
};

const DEG = Math.PI / 180;
/** Golpe em arco: da arma levantada (−75° da direção) até ao fim do golpe (+55°). */
const SWING_FROM = -75 * DEG;
const SWING_TO = 55 * DEG;
/** Parte do golpe em que se levanta a arma (o resto é o golpe, rápido). */
const WINDUP = 0.3;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeOut = (v: number): number => 1 - (1 - v) * (1 - v);

/**
 * Pose da arma na fase `t` do golpe.
 * @param aim direção do disparo (armas à distância); sem ela, a direção do boneco.
 * @param hand soco: 0 = mão da frente, 1 = a outra (os socos alternam).
 */
export function weaponPose(
  kind: SwingKind,
  facing: Facing,
  t: number,
  aim: number | null = null,
  hand = 0,
  flashFraction = 0.25,
): WeaponPose {
  t = clamp01(t);
  const base = HAND[facing];
  const behind = facing === 'up';
  const angle = aim ?? FACING_ANGLE[facing];
  if (kind === 'ranged') {
    // Puxa a corda (a arma recua 2 px) e solta: a arma dá um pequeno salto para a frente.
    const drawing = t < 0.6;
    const draw = drawing ? easeOut(t / 0.6) : 0;
    const recoil = drawing ? -2 * draw : 2 * (1 - (t - 0.6) / 0.4);
    const reach = 5 + recoil;
    return {
      dx: Math.round(base.x / 2 + Math.cos(angle) * reach),
      dy: base.y + Math.round(Math.sin(angle) * reach),
      angle,
      behind,
      draw,
      flash: !drawing && t < 0.6 + flashFraction,
    };
  }
  if (kind === 'punch') {
    // Soco: o punho sai em frente (até 7 px) e volta; alterna as mãos.
    const out = t < 0.4 ? easeOut(t / 0.4) : 1 - (t - 0.4) / 0.6;
    // Cada mão sai do seu lado do corpo (perpendicular à direção do soco).
    const side = hand === 0 ? 2 : -2;
    const px = -Math.sin(angle) * side;
    const py = Math.cos(angle) * side;
    const reach = 3 + 7 * out;
    return {
      dx: Math.round(px + Math.cos(angle) * reach),
      dy: base.y + 2 + Math.round(py + Math.sin(angle) * reach),
      angle,
      behind,
      draw: 0,
      flash: false,
    };
  }
  // Golpe em arco: levanta devagar e desce depressa. A olhar para a esquerda o arco é o espelho.
  const mirror = facing === 'left' ? -1 : 1;
  const phase = t < WINDUP ? 0 : easeOut((t - WINDUP) / (1 - WINDUP));
  const lift = t < WINDUP ? easeOut(t / WINDUP) : 1;
  const offset = (SWING_FROM * lift + (SWING_TO - SWING_FROM) * phase) * mirror;
  return {
    dx: base.x,
    dy: base.y,
    angle: angle + offset,
    behind,
    draw: 0,
    flash: false,
  };
}
