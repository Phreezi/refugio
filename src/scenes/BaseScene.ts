import Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { BASE_MAP_TILES, TILE_SIZE } from '../config';
import { gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { SceneKey } from './keys';

/**
 * A base do jogador. Fase 0: relva placeholder e o jogador (quadrado) ao centro.
 * O mapa Tiled, o movimento e as colisões chegam na Fase 1.
 */
export class BaseScene extends Phaser.Scene {
  private player: Phaser.GameObjects.Image | null = null;

  constructor() {
    super(SceneKey.Base);
  }

  create(): void {
    const mapSize = BASE_MAP_TILES * TILE_SIZE;
    const camera = this.cameras.main;
    camera.setBackgroundColor(PALETTE.grass);
    this.add.tileSprite(0, 0, mapSize, mapSize, 'tile_grass').setOrigin(0);

    const { x, y } = gameState.data.player;
    // Origem nos pés (meio da base do sprite), para o Y-sort da Fase 1.
    this.player = this.add.image(x, y, 'player').setOrigin(0.5, 1);

    camera.setBounds(0, 0, mapSize, mapSize);
    // O 2.º argumento TEM de ser true: startFollow sobrepõe camera.roundPixels.
    camera.startFollow(this.player, true);

    simulation.reset();
    this.scene.launch(SceneKey.UI);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop(SceneKey.UI);
      this.player = null;
    });
  }

  override update(): void {
    // rawDelta = tempo real entre frames; o delta "suavizado" do Phaser fica limitado a
    // 16,7 ms com a janela sem foco, o que atrasaria o relógio do jogo.
    simulation.update(this.game.loop.rawDelta);
    const { x, y } = gameState.data.player;
    this.player?.setPosition(x, y);
  }
}
