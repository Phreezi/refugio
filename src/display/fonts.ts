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

/** Algarismos com a fonte Tiny5. */
const DIGITS = 'U+0030-0039';

/** Espera no máximo isto pela fonte (sem rede, arranca com a de reserva). */
const FONT_TIMEOUT_MS = 3000;

/**
 * Carrega a fonte pixel antes do jogo arrancar: o texto do Phaser é desenhado num canvas e as
 * medidas (largura, altura das maiúsculas) ficam em cache, por isso a fonte tem de estar pronta.
 */
export async function loadPixelFont(): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const faces = FONT_FILES.map(
    ({ weight, subset }) =>
      new FontFace(
        PIXEL_FONT_FAMILY,
        `url(${versioned(`assets/fonts/pixelify-sans-${subset}-${weight}-normal.woff2`)})`,
        {
          weight,
        },
      ),
  );
  // Os algarismos vêm da Tiny5 (OFL): os da Pixelify fazem o 2 e o 5 parecerem um Z e um S.
  // Faces com a mesma família e peso: vale a última acrescentada, só para o seu unicodeRange.
  const digits = versioned('assets/fonts/tiny5-latin-400-normal.woff2');
  for (const weight of ['400', '700'])
    faces.push(new FontFace(PIXEL_FONT_FAMILY, `url(${digits})`, { weight, unicodeRange: DIGITS }));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
  try {
    await Promise.race([Promise.all(faces.map((face) => face.load())), timeout]);
  } catch (error) {
    console.warn('[fonte] não foi possível carregar a fonte pixel:', error);
  }
  // Acrescentadas pela ordem (a dos algarismos por último), só as que carregaram.
  for (const face of faces) if (face.status === 'loaded') document.fonts.add(face);
}
