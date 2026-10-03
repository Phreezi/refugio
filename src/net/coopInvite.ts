import type Phaser from 'phaser';
import { gameState } from '../core/GameState';
import { t } from '../i18n';
import { autosave } from '../save';
import { SceneKey } from '../scenes/keys';
import { confirmDialog } from '../ui/confirmDialog';
import { uiState } from '../ui/uiState';
import { coop } from './coop';
import { presence } from './presence';

// Convites do co-op (Fase 15): quando o parceiro abre o vosso jogo co-op, chega um convite a
// este aparelho. Se se estiver noutro jogo (de um jogador ou outro co-op), pergunta-se se se quer
// entrar; o jogo atual fica gravado e abre-se o co-op (o menu trata de o continuar).

export function installCoopInvites(game: Phaser.Game): void {
  void presence.start();
  presence.onInvite = (invite) => {
    // Já se está nesse co-op (a jogar ou à espera): não há nada a perguntar.
    const here = gameState.hasGame ? gameState.data.coop?.code : undefined;
    if (coop.code === invite.code || here === invite.code || uiState.coopWaitingCode === invite.code) return;
    void confirmDialog(
      t('coop.invite_text', { name: invite.name }),
      t('coop.invite_yes'),
      t('coop.invite_no'),
    ).then((yes) => {
      if (!yes) return;
      const open = (): void => {
        coop.leave();
        gameState.clear();
        for (const key of [SceneKey.Zone, SceneKey.WorldMap, SceneKey.UI])
          if (game.scene.isActive(key) || game.scene.isPaused(key)) game.scene.stop(key);
        game.scene.start(SceneKey.MainMenu, { resume: invite.code });
      };
      // O jogo atual fica gravado (o convidado grava a personagem ao sair do co-op).
      if (gameState.hasGame && !coop.isGuest) void autosave.flush().then(open);
      else open();
    });
  };
}
