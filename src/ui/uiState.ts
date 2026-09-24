/**
 * Estado da interface partilhado entre a UIScene (que recebe os toques) e a cena de jogo.
 * Não é estado do jogo: não se grava.
 */
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
};
