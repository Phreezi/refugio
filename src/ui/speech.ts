// Falas dos NPCs em páginas (puro: testável sem Phaser).

/** Frases por página: junta frases curtas até ~90 letras (uma fala longa fica em várias). */
export function splitSpeech(text: string, max = 90): string[] {
  // Frase = texto até à pontuação final (sem lookbehind: o Safari antigo não o suporta).
  const sentences = (text.match(/[^.!?…]+[.!?…]*/g) ?? [])
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const pages: string[] = [];
  for (const sentence of sentences) {
    const lastPage = pages[pages.length - 1];
    if (lastPage !== undefined && lastPage.length + 1 + sentence.length <= max)
      pages[pages.length - 1] = `${lastPage} ${sentence}`;
    else pages.push(sentence);
  }
  return pages.length > 0 ? pages : [text];
}
