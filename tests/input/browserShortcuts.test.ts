import { describe, expect, it } from 'vitest';
import { shouldBlockShortcut } from '../../src/input/browserShortcuts';

const key = (
  k: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {},
) => ({
  key: k,
  ctrlKey: mods.ctrl ?? true,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe('atalhos do browser', () => {
  it('anula Ctrl + teclas do jogo (guardar página, marcador, selecionar tudo, procurar…)', () => {
    for (const k of ['w', 'a', 's', 'd', 'S', 'f', 'p', 'z', 'b', '1', ' ', 'ArrowUp', '+', '-'])
      expect(shouldBlockShortcut(key(k)), k).toBe(true);
    expect(shouldBlockShortcut(key('d', { ctrl: false, meta: true }))).toBe(true);
  });

  it('deixa recarregar, copiar/colar, as ferramentas (Ctrl+Shift) e teclas sem Ctrl', () => {
    expect(shouldBlockShortcut(key('r'))).toBe(false);
    expect(shouldBlockShortcut(key('c'))).toBe(false);
    expect(shouldBlockShortcut(key('i', { shift: true }))).toBe(false);
    expect(shouldBlockShortcut(key('w', { ctrl: false }))).toBe(false);
    expect(shouldBlockShortcut(key('F5'))).toBe(false);
    expect(shouldBlockShortcut(key('Control'))).toBe(false);
  });
});
