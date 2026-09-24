/**
 * Estado da interface partilhado entre a UIScene (que recebe os toques) e a cena de jogo.
 * Não é estado do jogo: não se grava.
 */
export const uiState = {
  /** Botão de ação (toque) ou clique no mundo premido. */
  actionHeld: false,
  /** Painel aberto (mochila/baú): o jogador não anda nem faz ações. */
  modalOpen: false,
};
