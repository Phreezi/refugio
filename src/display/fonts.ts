import { versioned } from '../config';

/** Fonte pixel da interface (OFL, `public/assets/fonts/`, ver LICENSES.md). */
export const PIXEL_FONT_FAMILY = 'Pixelify Sans';

/** Os ficheiros da fonte: peso × subconjunto (latin-ext tem os restantes acentos). */
const FONT_FILES = [
  { weight: '400', subset: 'latin' },
  { weight: '400', subset: 'latin-ext' },
  { weight: '700', subset: 'latin' },
  { weight: '700', subset: 'latin-ext' },
] as const;

/** Espera no máximo isto pela fonte (sem rede, arranca com a de reserva). */
const FONT_TIMEOUT_MS = 3000;

/**
 * Carrega a fonte pixel antes do jogo arrancar: o texto do Phaser é desenhado num canvas e as
 * medidas (largura, altura das maiúsculas) ficam em cache, por isso a fonte tem de estar pronta.
 */
export async function loadPixelFont(): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const loads = FONT_FILES.map(async ({ weight, subset }) => {
    const url = versioned(`assets/fonts/pixelify-sans-${subset}-${weight}-normal.woff2`);
    const face = new FontFace(PIXEL_FONT_FAMILY, `url(${url})`, { weight });
    document.fonts.add(await face.load());
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
  try {
    await Promise.race([Promise.all(loads), timeout]);
  } catch (error) {
    console.warn('[fonte] não foi possível carregar a fonte pixel:', error);
  }
}
