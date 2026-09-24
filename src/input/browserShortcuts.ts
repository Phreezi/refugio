/**
 * Atalhos do browser que estragam o jogo (CLAUDE.md §7.2): com Ctrl/Cmd premido, as teclas do
 * jogo (Ctrl+S guardar página, Ctrl+D marcador, Ctrl+A selecionar tudo, Ctrl+F procurar…) são
 * anuladas. Ctrl+W, Ctrl+T e Ctrl+N o browser não deixa anular: enquanto o Ctrl estiver premido,
 * fechar ou sair da página pede confirmação.
 */

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Com Ctrl/Cmd: continuam a funcionar recarregar (R), copiar/colar e as ferramentas (com Shift). */
const ALLOWED_WITH_CTRL = new Set(['r', 'c', 'v', 'x', '0']);

/** Anular este atalho? (só combinações com Ctrl/Cmd; F5, F11, F12… ficam livres) */
export function shouldBlockShortcut(e: KeyInfo): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (ALLOWED_WITH_CTRL.has(key)) return false;
  // Letras, dígitos, espaço, setas, +/− (o zoom da página é tratado pelo jogo).
  return /^[a-z0-9 +=-]$/.test(key) || key.startsWith('arrow');
}

/** Liga a proteção (enquanto uma cena de jogo corre). Devolve a função que a desliga. */
export function installShortcutGuard(target: Window = window): () => void {
  let ctrlDown = false;
  const onKeyDown = (event: KeyboardEvent): void => {
    ctrlDown = event.ctrlKey || event.metaKey;
    if (shouldBlockShortcut(event)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    ctrlDown = event.ctrlKey || event.metaKey;
  };
  const onBlur = (): void => {
    ctrlDown = false;
  };
  // Só com o Ctrl premido (Ctrl+W por engano): o browser pergunta antes de fechar.
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (ctrlDown) event.preventDefault();
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('blur', onBlur);
  target.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('keyup', onKeyUp, true);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('beforeunload', onBeforeUnload);
  };
}
