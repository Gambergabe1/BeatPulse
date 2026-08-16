/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Intro } from './components/Intro';
import { Menu } from './components/Menu';
import { GameCanvas } from './components/GameCanvas';
import { GameOverScreen } from './components/GameOverScreen';
import { Tutorial } from './components/Tutorial';
import { SongData, Settings } from './types';
import { leaveMultiplayerRoom, saveGlobalScore, ScoreRecord, MultiplayerRoom, updateMultiplayerProgress } from './services/pulseApi';
import { DEFAULT_DIFFICULTY, getChartSettingsForDifficulty } from './utils/chartSettings';
import { getPlayerId, getPlayerToken } from './utils/playerIdentity';

const defaultChartSettings = getChartSettingsForDifficulty(DEFAULT_DIFFICULTY);

type View = 'INTRO' | 'TUTORIAL' | 'MENU' | 'GAME' | 'RESULTS';

const defaultSettings: Settings = {
  volume: 1,
  visualEffects: true,
  keybindings: ['d', 'f', 'j', 'k'],
  advancedChartMode: false,
  complexity: defaultChartSettings.complexity,
  density: defaultChartSettings.density,
  laneVariety: defaultChartSettings.laneVariety,
  sliderProbability: defaultChartSettings.sliderProbability,
  stamina: defaultChartSettings.stamina
};

export default function App() {
  const [view, setView] = useState<View>('INTRO');
  const [songData, setSongData] = useState<SongData | null>(null);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('beatpulse_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultSettings, ...parsed };
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  const [lastResult, setLastResult] = useState<{
    score: number;
    accuracy: number;
    maxCombo: number;
    replayEvents: { time: number; lane: number; type: string }[];
    highScores?: ScoreRecord[];
    multiplayerRoom?: MultiplayerRoom;
  } | null>(null);
  const [isReplay, setIsReplay] = useState(false);
  const [multiplayerRoom, setMultiplayerRoom] = useState<MultiplayerRoom | null>(null);
  const playerId = useMemo(() => getPlayerId(), []);
  const playerToken = useMemo(() => getPlayerToken(), []);

  const [audioContext] = useState(() => new (window.AudioContext || (window as any).webkitAudioContext)());

  const handleIntroComplete = useCallback(() => {
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (hasSeenTutorial) {
      setView('MENU');
    } else {
      setView('TUTORIAL');
    }
  }, []);

  const handleTutorialComplete = useCallback(() => {
    setView('MENU');
  }, []);

  const handleStartGame = useCallback(async (
    data: SongData,
    replay = false,
    replayEvents?: { time: number; lane: number; type: string }[],
    matchRoom?: MultiplayerRoom
  ) => {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    setSongData(data);
    setIsReplay(replay);
    setMultiplayerRoom(matchRoom || null);
    if (replay && replayEvents) {
      setLastResult(prev => ({
        score: prev?.score || 0,
        accuracy: prev?.accuracy || 0,
        maxCombo: prev?.maxCombo || 0,
        replayEvents,
        highScores: prev?.highScores,
      }));
    }
    setView('GAME');
  }, [audioContext]);

  const handleGameEnd = useCallback(async (score: number, accuracy: number, maxCombo: number, replayEvents: { time: number; lane: number; type: string }[]) => {
    setLastResult({ score, accuracy, maxCombo, replayEvents, multiplayerRoom: multiplayerRoom || undefined });
    setView('RESULTS');

    if (multiplayerRoom) {
      try {
        const username = localStorage.getItem('username') || 'Anonymous';
        const updatedRoom = await updateMultiplayerProgress(
          { playerId, playerToken, username },
          multiplayerRoom.id,
          { score, combo: maxCombo, accuracy, progress: 1, finished: true }
        );
        setMultiplayerRoom(updatedRoom);
        setLastResult(prev => prev ? { ...prev, multiplayerRoom: updatedRoom } : prev);
      } catch (err) {
        console.error('Failed to submit multiplayer result:', err);
      }
    }

    if (songData && !isReplay) {
      try {
        const username = localStorage.getItem('username') || 'Anonymous';
        const result = await saveGlobalScore({
          songId: songData.id,
          score,
          accuracy,
          date: new Date().toLocaleDateString(),
          username,
          songName: songData.name,
          artist: songData.artist
        });

        if (result.song?.scores) {
          setLastResult(prev =>
            prev
              ? {
                  ...prev,
                  highScores: result.song?.scores || prev.highScores,
                }
              : prev
          );
        }
      } catch (err) {
        console.error("Failed to save score submission:", err);
      }
    }
  }, [songData, isReplay, multiplayerRoom, playerId, playerToken]);

  const handleRetry = useCallback(() => {
    setIsReplay(false);
    setMultiplayerRoom(null);
    setView('GAME');
  }, []);

  const handleHome = useCallback(() => {
    setView('MENU');
    setSongData(null);
    setMultiplayerRoom(null);
  }, []);

  const handleExitGame = useCallback(() => {
    if (multiplayerRoom) {
      const username = localStorage.getItem('username') || 'Anonymous';
      leaveMultiplayerRoom({ playerId, playerToken, username }, multiplayerRoom.id)
        .catch((err) => console.warn('Failed to leave multiplayer room:', err));
    }
    handleHome();
  }, [handleHome, multiplayerRoom?.id, playerId, playerToken]);

  const handleMultiplayerProgress = useCallback((progress: { score: number; combo: number; accuracy: number; progress: number }) => {
    if (!multiplayerRoom) return;
    const username = localStorage.getItem('username') || 'Anonymous';
    updateMultiplayerProgress({ playerId, playerToken, username }, multiplayerRoom.id, progress)
      .then(setMultiplayerRoom)
      .catch((err) => console.warn('Multiplayer progress update failed:', err));
  }, [multiplayerRoom?.id, playerId, playerToken]);

  const handleSaveSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
    localStorage.setItem('beatpulse_settings', JSON.stringify(newSettings));
  }, []);

  return (
    <div className="w-full min-h-screen bg-black text-white font-sans">
      {view === 'INTRO' && (
        <Intro onComplete={handleIntroComplete} />
      )}

      {view === 'TUTORIAL' && (
        <Tutorial onComplete={handleTutorialComplete} />
      )}

      {view === 'MENU' && (
        <Menu 
          onStartGame={handleStartGame} 
          audioContext={audioContext} 
          settings={settings}
          multiplayerRoom={multiplayerRoom}
          synchronizedStartAt={multiplayerRoom?.startAt}
          onMultiplayerProgress={handleMultiplayerProgress}
          onSaveSettings={handleSaveSettings}
        />
      )}

      {view === 'GAME' && songData && (
        <GameCanvas 
          notes={songData.notes}
          audioContext={audioContext}
          audioBuffer={songData.audioBuffer}
          difficulty={songData.difficulty}
          onGameEnd={handleGameEnd}
          onExit={handleExitGame}
          isReplay={isReplay}
          replayEvents={lastResult?.replayEvents || []}
          settings={settings}
        />
      )}

      {view === 'RESULTS' && songData && lastResult && (
        <GameOverScreen 
          score={lastResult.score}
          accuracy={lastResult.accuracy}
          maxCombo={lastResult.maxCombo}
          songName={songData.name}
          artist={songData.artist}
          songId={songData.id}
          difficulty={songData.difficulty}
          density={songData.density}
          laneVariety={songData.laneVariety}
          sliderProbability={songData.sliderProbability}
          stamina={songData.stamina}
          audioBuffer={songData.audioBuffer}
          onRetry={handleRetry}
          onReplay={() => handleStartGame(songData, true, lastResult.replayEvents)}
          onHome={handleHome}
          isReplay={isReplay}
          replayEvents={lastResult.replayEvents}
          initialHighScores={lastResult.highScores}
          multiplayerRoom={lastResult.multiplayerRoom}
          playerId={playerId}
          playerToken={playerToken}
        />
      )}
    </div>
  );
}
