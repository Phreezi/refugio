import { describe, expect, it } from 'vitest';
import { splitSpeech } from '../../src/ui/speech';

describe('splitSpeech', () => {
  it('uma fala curta fica numa página', () => {
    expect(splitSpeech('Olá. Tudo bem?')).toEqual(['Olá. Tudo bem?']);
  });

  it('uma fala longa divide-se por frases, sem passar do máximo', () => {
    const text = 'Primeira frase bastante comprida aqui. Segunda frase também comprida. Terceira!';
    const pages = splitSpeech(text, 40);
    // As frases curtas juntam-se enquanto couberem no máximo.
    expect(pages).toEqual([
      'Primeira frase bastante comprida aqui.',
      'Segunda frase também comprida. Terceira!',
    ]);
    expect(pages.every((page) => page.length <= 40)).toBe(true);
    expect(pages.join(' ')).toBe(text);
  });
});
