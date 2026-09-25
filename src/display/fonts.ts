import { versioned } from '../config';

/**
 * Fonte pixel da interface: **Tiny5** (OFL, `public/assets/fonts/`, ver LICENSES.md), com
 * minúsculas e acentos. Desenha-se sempre com cada píxel da letra = um número inteiro de píxeis
 * do ecrã (ver `pixelFontSize` em ui/text.ts), por isso as letras e os números ficam nítidos.
 */
export const PIXEL_FONT_FAMILY = 'Tiny5';

/** Os ficheiros da fonte (latin-ext tem os restantes acentos). */
const FONT_FILES = ['latin', 'latin-ext'] as const;

/** Espera no máximo isto pela fonte (sem rede, arranca com a de reserva). */
const FONT_TIMEOUT_MS = 3000;

/**
 * Carrega a fonte pixel antes do jogo arrancar: o texto do Phaser é desenhado num canvas e as
 * medidas (largura, altura das maiúsculas) ficam em cache, por isso a fonte tem de estar pronta.
 */
export async function loadPixelFont(): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const faces = FONT_FILES.map(
    (subset) =>
      new FontFace(PIXEL_FONT_FAMILY, `url(${versioned(`assets/fonts/tiny5-${subset}-400-normal.woff2`)})`),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
  try {
    await Promise.race([Promise.all(faces.map((face) => face.load())), timeout]);
  } catch (error) {
    console.warn('[fonte] não foi possível carregar a fonte pixel:', error);
  }
  for (const face of faces) if (face.status === 'loaded') document.fonts.add(face);
}
