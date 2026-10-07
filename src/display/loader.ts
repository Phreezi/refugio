// Ecrã de carregamento de index.html (antes do JS): o jogo esconde-o quando já desenha o seu
// (PreloadScene) ou mostra nele uma mensagem de erro (WebGL, falha ao arrancar).

interface LoaderWindow {
  __refugioNoWebGL?: boolean;
  __refugioLoaderFail?: (text: string) => void;
}

const win = window as unknown as LoaderWindow;

/** O browser não tem WebGL (testado em index.html): o jogo não arranca. */
export function webGlMissing(): boolean {
  return win.__refugioNoWebGL === true;
}

/** Tira o ecrã de carregamento (o Phaser já está a desenhar). */
export function hideLoader(): void {
  document.getElementById('loader')?.remove();
}

/**
 * Mostra um erro no ecrã de carregamento (com o botão "Recarregar"). Devolve falso se ele já
 * não existir (o erro tem de aparecer de outra forma).
 */
export function loaderFail(text: string): boolean {
  if (!document.getElementById('loader') || !win.__refugioLoaderFail) return false;
  win.__refugioLoaderFail(text);
  return true;
}
