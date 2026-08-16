/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Intro } from './components/Intro';
import { Menu } from './components/Menu';
import { GameCanvas } from './components/GameCanvas';
import { GameOverScreen } from './components/GameOverScreen';
import { Tutorial } from './components/Tutorial';
import { DEFAULT_GAMEPLAY_OPTIONS, GameplayOptions, JudgementSummary, SongData, Settings } from './types';
import { getSocialSnapshot, leaveMultiplayerRoom, saveGlobalScore, ScoreRecord, MultiplayerRoom, updateMultiplayerProgress } from './services/pulseApi';
import { DEFAULT_DIFFICULTY, getChartSettingsForDifficulty } from './utils/chartSettings';
import { getPlayerId, getPlayerToken } from './utils/playerIdentity';
import { awardRunProgress, LevelReward, loadPlayerProgress, MissionProgress, rateMap, PlayerProgress } from './utils/progression';

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
  stamina: defaultChartSettings.stamina,
  gameplay: { ...DEFAULT_GAMEPLAY_OPTIONS },
  laneTheme: 'pulse',
  visualTheme: 'pulse',
  hitSound: 'classic',
  menuTheme: 'pulse',
  reducedMotion: false,
  largeNotes: false,
  hapticFeedback: true,
};

const keepNewestRoom = (current: MultiplayerRoom | null, candidate: MultiplayerRoom) => {
  if (!current || current.id !== candidate.id) return candidate;
  return new Date(candidate.updatedAt).getTime() >= new Date(current.updatedAt).getTime() ? candidate : current;
};

export default function App() {
  const [view, setView] = useState<View>('INTRO');
  const [songData, setSongData] = useState<SongData | null>(null);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('beatpulse_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...defaultSettings,
          ...parsed,
          gameplay: { ...DEFAULT_GAMEPLAY_OPTIONS, ...(parsed.gameplay || {}) },
        };
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
    fullCombo: boolean;
    judgements: JudgementSummary;
    gameplay: GameplayOptions;
    replayEvents: { time: number; lane: number; type: string }[];
    highScores?: ScoreRecord[];
    leaderboardStatus?: 'idle' | 'saving' | 'saved' | 'failed' | 'unranked';
    leaderboardError?: string;
    multiplayerRoom?: MultiplayerRoom;
    earnedXp?: number;
    levelUpRewards?: LevelReward[];
    previousLevel?: number;
    completedMissions?: MissionProgress[];
  } | null>(null);
  const [isReplay, setIsReplay] = useState(false);
  const [multiplayerRoom, setMultiplayerRoom] = useState<MultiplayerRoom | null>(null);
  const [gameplayOptions, setGameplayOptions] = useState<GameplayOptions>({ ...DEFAULT_GAMEPLAY_OPTIONS });
  const [progress, setProgress] = useState<PlayerProgress>(() => loadPlayerProgress());
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
    setGameplayOptions(matchRoom || replay
      ? { ...DEFAULT_GAMEPLAY_OPTIONS }
      : { ...DEFAULT_GAMEPLAY_OPTIONS, ...settings.gameplay });
    if (replay && replayEvents) {
      setLastResult(prev => ({
        score: prev?.score || 0,
        accuracy: prev?.accuracy || 0,
        maxCombo: prev?.maxCombo || 0,
        fullCombo: prev?.fullCombo || false,
        judgements: prev?.judgements || { perfect: 0, great: 0, miss: 0, holdBreak: 0, timingOffsets: [] },
        gameplay: prev?.gameplay || { ...DEFAULT_GAMEPLAY_OPTIONS },
        replayEvents,
        highScores: prev?.highScores,
      }));
    }
    setView('GAME');
  }, [audioContext, settings.gameplay]);

  const handleGameEnd = useCallback(async (score: number, accuracy: number, maxCombo: number, replayEvents: { time: number; lane: number; type: string }[], fullCombo: boolean, judgements: JudgementSummary) => {
    const isModifiedRun = gameplayOptions.practiceMode || gameplayOptions.hiddenNotes || gameplayOptions.mirrorLanes || gameplayOptions.randomLanes || gameplayOptions.practiceSpeed !== 1;
    const progressionUpdate = !isReplay && !gameplayOptions.practiceMode
      ? awardRunProgress({
        score,
        accuracy,
        maxCombo,
        fullCombo,
        judgements,
        song: songData ? { id: songData.id, name: songData.name, artist: songData.artist } : undefined,
        multiplayer: Boolean(multiplayerRoom),
        ranked: !isModifiedRun && !multiplayerRoom,
      })
      : null;
    if (progressionUpdate) setProgress(progressionUpdate.progress);
    setLastResult({
      score,
      accuracy,
      maxCombo,
      fullCombo,
      judgements,
      gameplay: gameplayOptions,
      earnedXp: progressionUpdate?.earnedXp,
      levelUpRewards: progressionUpdate?.levelUpRewards,
      previousLevel: progressionUpdate?.previousLevel,
      completedMissions: progressionUpdate?.completedMissions,
      replayEvents,
      leaderboardStatus: songData && !isReplay ? (isModifiedRun ? 'unranked' : 'saving') : 'idle',
      multiplayerRoom: multiplayerRoom || undefined,
    });
    setView('RESULTS');

    if (multiplayerRoom) {
      try {
        const username = localStorage.getItem('username') || 'Anonymous';
        const updatedRoom = await updateMultiplayerProgress(
          { playerId, playerToken, username },
          multiplayerRoom.id,
          { score, combo: maxCombo, accuracy, progress: 1, finished: true }
        );
        setMultiplayerRoom(current => keepNewestRoom(current, updatedRoom));
        setLastResult(prev => prev ? { ...prev, multiplayerRoom: updatedRoom } : prev);
      } catch (err) {
        console.error('Failed to submit multiplayer result:', err);
      }
    }

    if (songData && !isReplay && !isModifiedRun) {
      try {
        const username = localStorage.getItem('username') || 'Anonymous';
        const result = await saveGlobalScore({
          songId: songData.id,
          score,
          accuracy,
          date: new Date().toLocaleDateString(),
          username,
          songName: songData.name,
          artist: songData.artist,
          fullCombo,
        });

        setLastResult(prev =>
          prev
            ? {
                ...prev,
                highScores: result.song?.scores || prev.highScores,
                leaderboardStatus: 'saved',
                leaderboardError: undefined,
              }
            : prev
        );
      } catch (err) {
        console.error("Failed to save score submission:", err);
        const message = err instanceof Error ? err.message : 'Unable to update the leaderboard.';
        setLastResult(prev => prev ? {
          ...prev,
          leaderboardStatus: 'failed',
          leaderboardError: message,
        } : prev);
      }
    }
  }, [songData, isReplay, multiplayerRoom, playerId, playerToken, gameplayOptions]);

  const handleRateMap = useCallback((rating: number) => {
    if (!songData?.id) return;
    setProgress(rateMap(songData.id, rating));
  }, [songData?.id]);

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
      .then(updatedRoom => setMultiplayerRoom(current => keepNewestRoom(current, updatedRoom)))
      .catch((err) => console.warn('Multiplayer progress update failed:', err));
  }, [multiplayerRoom?.id, playerId, playerToken]);

  useEffect(() => {
    if (view !== 'GAME' || !multiplayerRoom) return;
    let cancelled = false;
    const roomId = multiplayerRoom.id;
    const syncMatch = async () => {
      try {
        const snapshot = await getSocialSnapshot({
          playerId,
          playerToken,
          username: localStorage.getItem('username') || 'Anonymous',
        });
        const nextRoom = snapshot.activeRoom;
        if (!cancelled && nextRoom?.id === roomId) {
          setMultiplayerRoom(current => keepNewestRoom(current, nextRoom));
        }
      } catch (error) {
        console.warn('Failed to refresh live multiplayer standings:', error);
      }
    };
    syncMatch();
    const timer = window.setInterval(syncMatch, 1250);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [view, multiplayerRoom?.id, playerId, playerToken]);

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
          multiplayerPlayerId={playerId}
          synchronizedStartAt={multiplayerRoom?.startAt}
          onMultiplayerProgress={handleMultiplayerProgress}
          onSaveSettings={handleSaveSettings}
          progress={progress}
          onUpdateProgress={setProgress}
        />
      )}

      {view === 'GAME' && songData && (
        <GameCanvas 
          notes={songData.notes}
          sections={songData.sections}
          audioContext={audioContext}
          audioBuffer={songData.audioBuffer}
          difficulty={songData.difficulty}
          onGameEnd={handleGameEnd}
          onExit={handleExitGame}
          isReplay={isReplay}
          replayEvents={lastResult?.replayEvents || []}
          settings={settings}
          gameplayOptions={gameplayOptions}
          multiplayerRoom={multiplayerRoom}
          multiplayerPlayerId={playerId}
          synchronizedStartAt={multiplayerRoom?.startAt}
          onMultiplayerProgress={handleMultiplayerProgress}
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
          judgements={lastResult.judgements}
          gameplay={lastResult.gameplay}
          earnedXp={lastResult.earnedXp}
          levelUpRewards={lastResult.levelUpRewards}
          previousLevel={lastResult.previousLevel}
          completedMissions={lastResult.completedMissions}
          mapRating={songData.id ? progress.mapRatings[songData.id] : undefined}
          onRateMap={handleRateMap}
          initialHighScores={lastResult.highScores}
          fullCombo={lastResult.fullCombo}
          leaderboardStatus={lastResult.leaderboardStatus}
          leaderboardError={lastResult.leaderboardError}
          multiplayerRoom={lastResult.multiplayerRoom}
          playerId={playerId}
          playerToken={playerToken}
        />
      )}
    </div>
  );
}
