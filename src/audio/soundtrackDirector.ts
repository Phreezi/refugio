// Diretor da banda sonora: 2×/s olha para o jogo (cena, zona, hora, inimigos, pausa) e diz à
// música e ao ambiente o que tocar (a escolha é de soundtrack.ts, que é puro). Atravessar uma
// borda do mundo contínuo não recomeça a cena, por isso não se ouvem eventos: lê-se a zona do
// jogador; se o contexto não mudou, a música continua sem recomeçar.

import type Phaser from 'phaser';
import { isNight } from '../core/DayNight';
import { gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { BALANCE } from '../data/balance';
import { SceneKey } from '../scenes/keys';
import { uiState } from '../ui/uiState';
import { content } from '../world/content';
import { BASE_TILESET_NAME, baseTileIndex } from '../world/tileset';
import { TILE_SIZE, zoneMapKey } from '../config';
import { ambience } from './ambience';
import { music, PAUSE_DUCK } from './music';
import {
  chooseAmbience,
  chooseMood,
  isTense,
  waterMaskFromTiled,
  waterNearness,
  type AmbienceMix,
  type Mood,
  type MoodInput,
  type WaterMask,
} from './soundtrack';

const POLL_MS = 500;
/** A tensão fica mais um bocado depois de o último inimigo desistir (não liga e desliga aos soluços). */
const TENSION_HOLD_MS = 3000;
const WATER_IDS = [baseTileIndex('water'), baseTileIndex('waterfall')];
/** Máscaras de água guardadas (as das últimas zonas). */
const WATER_CACHE = 8;

/** Estado exposto em `window.__soundtrack` (só em desenvolvimento: testes no browser). */
export interface SoundtrackDebug {
  mood: Mood | null;
  tension: boolean;
  ambience: AmbienceMix;
  changes: number;
}

export function installSoundtrack(game: Phaser.Game): void {
  const water = new Map<string, WaterMask | null>();
  let tenseAt = -Infinity;
  const debug: SoundtrackDebug = {
    mood: null,
    tension: false,
    ambience: chooseAmbience({ mood: null, night: false, water: 0 }),
    changes: 0,
  };
  if (import.meta.env.DEV) (window as unknown as { __soundtrack?: SoundtrackDebug }).__soundtrack = debug;

  const waterOf = (zoneId: string): WaterMask | null => {
    if (water.has(zoneId)) return water.get(zoneId) ?? null;
    const cached: unknown = game.cache.tilemap.get(zoneMapKey(zoneId));
    const json =
      content.wildTiledJson(zoneId) ??
      (typeof cached === 'object' && cached !== null && 'data' in cached ? cached.data : undefined);
    const mask = waterMaskFromTiled(json, BASE_TILESET_NAME, WATER_IDS);
    water.set(zoneId, mask);
    if (water.size > WATER_CACHE) {
      const oldest = water.keys().next().value;
      if (oldest !== undefined) water.delete(oldest);
    }
    return mask;
  };

  const poll = (): void => {
    const scenes = game.scene;
    const inGame = scenes.isActive(SceneKey.Zone) || scenes.isActive(SceneKey.WorldMap);
    const scene: MoodInput['scene'] = scenes.isActive(SceneKey.MainMenu)
      ? 'menu'
      : inGame && gameState.hasGame
        ? 'game'
        : 'none';
    let mood: Mood | null;
    let night = false;
    let near = 0;
    let tense = false;
    if (scene === 'game') {
      const data = gameState.data;
      const player = data.player;
      const zone = content.zones[player.zoneId];
      night = isNight(data.world.tick, BALANCE);
      mood = chooseMood({
        scene,
        danger: zone?.danger ?? 1,
        underground: zone?.dungeon !== undefined || zone?.darkness !== undefined,
        biome: content.wild(player.zoneId)?.biome,
        night,
      });
      near = waterNearness(waterOf(player.zoneId), player.x / TILE_SIZE, player.y / TILE_SIZE);
      tense = scenes.isActive(SceneKey.Zone) && isTense(simulation.combat.list, player, data.horde.active);
    } else {
      mood = chooseMood({ scene, danger: 0, underground: false, night: false });
    }
    // A carregar (entre o menu e a zona, ou entre cenas): a música que estava continua.
    if (scene === 'none' && debug.mood !== null) mood = debug.mood;
    const now = performance.now();
    if (tense) tenseAt = now;
    else tense = scene === 'game' && now - tenseAt < TENSION_HOLD_MS;
    if (mood !== debug.mood) debug.changes += 1;
    debug.mood = mood;
    debug.tension = tense;
    music.setMood(mood);
    music.setTension(tense);
    // Pausa: baixa (no co-op o tempo não pára e o som também não).
    const duck = uiState.paused && !uiState.coop ? PAUSE_DUCK : 1;
    music.setDuck(duck);
    ambience.setDuck(duck);
    debug.ambience = chooseAmbience({ mood, night, water: near });
    ambience.update(debug.ambience, POLL_MS / 1000);
  };
  window.setInterval(poll, POLL_MS);
}
