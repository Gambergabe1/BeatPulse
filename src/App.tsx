/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Intro } from './components/Intro';
import { Menu } from './components/Menu';
import { GameCanvas } from './components/GameCanvas';
import { GameOverScreen } from './components/GameOverScreen';
import { Tutorial } from './components/Tutorial';
import { SongData, Settings } from './types';
import { saveGlobalScore, ScoreRecord } from './services/pulseApi';

type View = 'INTRO' | 'TUTORIAL' | 'MENU' | 'GAME' | 'RESULTS';

const defaultSettings: Settings = {
  volume: 1,
  visualEffects: true,
  keybindings: ['d', 'f', 'j', 'k'],
  complexity: 0.5,
  density: 0.5,
  laneVariety: 0.5,
  sliderProbability: 0.3,
  stamina: 0.5
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
  } | null>(null);
  const [isReplay, setIsReplay] = useState(false);

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
    replayEvents?: { time: number; lane: number; type: string }[]
  ) => {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    setSongData(data);
    setIsReplay(replay);
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
    setLastResult({ score, accuracy, maxCombo, replayEvents });
    setView('RESULTS');

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
  }, [songData, isReplay]);

  const handleRetry = useCallback(() => {
    setIsReplay(false);
    setView('GAME');
  }, []);

  const handleHome = useCallback(() => {
    setView('MENU');
    setSongData(null);
  }, []);

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
          onExit={handleHome}
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
        />
      )}
    </div>
  );
}
