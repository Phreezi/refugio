/**
 * Estado da interface partilhado entre a UIScene (que recebe os toques) e a cena de jogo.
 * Não é estado do jogo: não se grava.
 */
/**
 * Tocar fora de um painel fecha-o; se esse toque foi no botão que o abre, o botão não o deve
 * reabrir logo a seguir (ms).
 */
export const REOPEN_GUARD_MS = 300;

export const uiState = {
  /** Botão de ação (toque) ou clique no mundo premido. */
  actionHeld: false,
  /** Painel aberto (mochila/baú/crafting): o jogador não anda nem faz ações. */
  modalOpen: false,
  /** Mensagem a mostrar quando o HUD abrir (ex.: resumo do tempo offline). */
  pendingNotice: null as string | null,
  /** Menu de pausa aberto: o tempo de jogo pára. */
  paused: false,
  /** Reabrir o menu de pausa nesta vista quando o HUD se refizer (mudou a língua/tamanho). */
  reopenPause: null as 'main' | 'settings' | 'stats' | null,
  /** Co-op ligado: o tempo não pára (pausa, mapa-mundo) e a velocidade fica em x1. */
  coop: false,
};
