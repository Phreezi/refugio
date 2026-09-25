import type { Facing } from '../systems/movement/movement';

/**
 * O boneco do convidado no mundo do anfitrião (co-op, CLAUDE.md §11 Fase 15). Vive só em memória
 * no anfitrião (não se grava): a posição chega pela rede (o convidado anda no ecrã dele) e a
 * lógica do anfitrião trata do resto — os inimigos também o atacam, e ele bate e apanha coisas.
 */
export interface Partner {
  x: number;
  y: number;
  /** Posição anterior (para interpolar no ecrã). */
  px: number;
  py: number;
  facing: Facing;
  moved: boolean;
  sneak: boolean;
  hp: number;
  /** Arma que o convidado trouxe equipada (só para o dano e o alcance), ou null (punhos). */
  weapon: string | null;
  /** Caído: volta ao pé do anfitrião, com a vida cheia, neste tick (0 = de pé). */
  downUntil: number;
  /** Invulnerável até este tick (depois de levar um golpe). */
  invulnerableUntil: number;
}

export function createPartner(at: { x: number; y: number }, hp: number, weapon: string | null): Partner {
  return {
    x: at.x,
    y: at.y,
    px: at.x,
    py: at.y,
    facing: 'down',
    moved: false,
    sneak: false,
    hp,
    weapon,
    downUntil: 0,
    invulnerableUntil: 0,
  };
}

/** O parceiro está de pé (os inimigos só atacam quem está de pé)? */
export function partnerUp(partner: Partner | null): partner is Partner {
  return partner !== null && partner.downUntil === 0 && partner.hp > 0;
}
