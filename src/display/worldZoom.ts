// Zoom do mundo escolhido pelo jogador (roda do rato, teclas +/−, pinça com 2 dedos).
// O zoom da vista (display/view.ts) é o máximo; pode afastar-se até metade, sempre em níveis
// INTEIROS de píxeis do dispositivo por píxel de jogo, para a pixel art continuar exata.
// A preferência fica no browser (localStorage): é uma conveniência de quem vê, não do jogo.

const STORAGE_KEY = 'refugio.zoomOut';

/**
 * Níveis de zoom possíveis, do mais perto (o zoom da vista) ao mais longe (≥ metade).
 * Ex.: 4 → [4, 3, 2]; 3 → [3, 2]; 2 → [2, 1]; zoom fracionário (ecrã minúsculo) → só ele.
 */
export function zoomLevels(viewZoom: number): number[] {
  if (!Number.isInteger(viewZoom) || viewZoom < 1) return [viewZoom];
  const levels: number[] = [];
  for (let z = viewZoom; z >= Math.max(1, Math.ceil(viewZoom / 2)); z--) levels.push(z);
  return levels;
}

/**
 * Passo da pinça: compara a distância atual entre os dedos com a do último passo.
 * @returns +1 (aproximar), −1 (afastar) ou 0.
 */
export function pinchStep(startDistance: number, distance: number, threshold = 1.3): -1 | 0 | 1 {
  if (!(startDistance > 0) || !(distance > 0)) return 0;
  const ratio = distance / startDistance;
  if (ratio >= threshold) return 1;
  if (ratio <= 1 / threshold) return -1;
  return 0;
}

function readSteps(): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

let stepsOut = typeof window === 'undefined' ? 0 : readSteps();
const listeners = new Set<() => void>();

/** Zoom do mundo para uma vista com este zoom. */
export function worldZoomFor(viewZoom: number): number {
  const levels = zoomLevels(viewZoom);
  return levels[Math.min(stepsOut, levels.length - 1)] ?? viewZoom;
}

/**
 * Aproxima (+1) ou afasta (−1) um nível.
 * @returns true se o zoom mudou.
 */
export function stepWorldZoom(direction: 1 | -1, viewZoom: number): boolean {
  const levels = zoomLevels(viewZoom);
  const current = Math.min(stepsOut, levels.length - 1);
  const next = Math.max(0, Math.min(levels.length - 1, current - direction));
  if (next === current) return false;
  stepsOut = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // sem localStorage: o zoom só dura esta sessão
  }
  for (const listener of listeners) listener();
  return true;
}

/** Avisa quando o jogador muda o zoom. Devolve a função que cancela. */
export function onWorldZoomChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
