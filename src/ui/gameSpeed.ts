// Velocidade do jogo (botão x1/x2/x3 no HUD): multiplica o tempo real que entra na lógica,
// por isso acelera TUDO o que corre no passo fixo — relógio do dia, fome/sede, movimento,
// golpes, reaparecimento de recursos. Preferência de quem joga, guardada no browser.

import { uiState } from './uiState';

export const GAME_SPEEDS = [1, 2, 3] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

const STORAGE_KEY = 'refugio.speed';

function read(): GameSpeed {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return GAME_SPEEDS.find((speed) => speed === value) ?? 1;
  } catch {
    return 1;
  }
}

let current: GameSpeed = typeof window === 'undefined' ? 1 : read();

/** Velocidade atual (em co-op fica sempre em x1: o tempo é o mesmo para os dois jogadores). */
export function gameSpeed(): GameSpeed {
  return uiState.coop ? 1 : current;
}

/** Passa à velocidade seguinte (x1 → x2 → x3 → x1). */
export function nextGameSpeed(): GameSpeed {
  const index = GAME_SPEEDS.indexOf(current);
  current = GAME_SPEEDS[(index + 1) % GAME_SPEEDS.length] ?? 1;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(current));
  } catch {
    // sem localStorage: dura só esta sessão
  }
  return current;
}
