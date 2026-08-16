import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Note, GameState, Settings } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Home, Pause, Play } from 'lucide-react';
import { MultiplayerRoom } from '../services/pulseApi';
import { prefersMovingSliders } from '../utils/device';

interface GameCanvasProps {
  notes: Note[];
  audioContext: AudioContext;
  audioBuffer: AudioBuffer;
  difficulty: number;
  onGameEnd: (score: number, accuracy: number, maxCombo: number, replayEvents: { time: number; lane: number; type: string }[]) => void;
  onExit: () => void;
  isReplay?: boolean;
  replayEvents?: { time: number; lane: number; type: string }[];
  settings: Settings;
  multiplayerRoom?: MultiplayerRoom | null;
  synchronizedStartAt?: string;
  onMultiplayerProgress?: (progress: { score: number; combo: number; accuracy: number; progress: number }) => void;
}

const LANE_COUNT = 4;
const NOTE_SPEED = 600; // pixels per second
const HOLD_GRACE_SECONDS = 0.115;
const TIMING_PRESETS = [
  { id: 'relaxed', label: 'Relaxed', hitWindow: 0.22, perfectWindow: 0.08, description: 'More room around every note.' },
  { id: 'standard', label: 'Standard', hitWindow: 0.15, perfectWindow: 0.05, description: 'Balanced timing for normal play.' },
  { id: 'precise', label: 'Precise', hitWindow: 0.11, perfectWindow: 0.035, description: 'Tighter timing for competitive runs.' },
] as const;

interface HoldTracker {
  nextTickTime: number;
  tickInterval: number;
  lastValidTime: number;
  lastRequiredLane: number;
  headWeight: number;
}

const getSlideProgress = (note: Note, time: number) =>
  note.duration ? Math.max(0, Math.min(1, (time - note.time) / note.duration)) : 0;

const getSlideLanePosition = (note: Note, time: number) => {
  const endLane = note.endLane ?? note.lane;
  const progress = getSlideProgress(note, time);
  const easedProgress = progress * progress * (3 - 2 * progress);
  return note.lane + (endLane - note.lane) * easedProgress;
};

const getRequiredSlideLane = (note: Note, time: number) =>
  Math.round(getSlideLanePosition(note, time));

const estimateVisualBeat = (notes: Note[]) => {
  const uniqueTimes = [...new Set(notes.map((note) => Number(note.time.toFixed(3))))].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < uniqueTimes.length; i++) {
    const interval = uniqueTimes[i] - uniqueTimes[i - 1];
    if (interval >= 0.14 && interval <= 1.1) intervals.push(interval);
  }
  intervals.sort((a, b) => a - b);
  let interval = intervals[Math.floor(intervals.length / 2)] ?? 0.5;
  while (interval < 0.34) interval *= 2;
  while (interval > 0.78) interval /= 2;
  return { interval, origin: notes[0]?.time ?? 0 };
};

export const GameCanvas: React.FC<GameCanvasProps> = ({
  notes,
  audioContext,
  audioBuffer,
  difficulty,
  onGameEnd,
  onExit,
  isReplay = false,
  replayEvents = [],
  settings,
  multiplayerRoom,
  synchronizedStartAt,
  onMultiplayerProgress,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const movingSlidersEnabled = useMemo(prefersMovingSliders, []);
  const [noteSpeedMultiplier, setNoteSpeedMultiplier] = useState(1);
  const [hitWindow, setHitWindow] = useState(0.15);
  const [perfectWindow, setPerfectWindow] = useState(0.05);
  const [isPaused, setIsPaused] = useState(false);
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    score: 0,
    combo: 0,
    maxCombo: 0,
    accuracy: 0,
    totalNotes: notes.length,
    hitNotes: 0,
    currentTime: 0,
    duration: audioBuffer.duration
  });

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const replayEventsRef = useRef<{ time: number; lane: number; type: string }[]>([]);
  const triggeredEventsRef = useRef<Set<number>>(new Set());
  const missedLanesRef = useRef<Record<number, number>>({});
  const localNotesRef = useRef<Note[]>(notes.map((note) => ({
    ...note,
    endLane: movingSlidersEnabled ? note.endLane : undefined,
    hit: false,
    missed: false,
    held: false,
  })));
  const holdTrackersRef = useRef<Map<string, HoldTracker>>(new Map());
  const replayHoldKeysRef = useRef<Set<string>>(new Set());
  const keysPressed = useRef<Set<string>>(new Set());
  const lastProgressSentRef = useRef(0);

  const isExitingRef = useRef(false);
  const hasEndedRef = useRef(false);
  const [hitEffects, setHitEffects] = useState<{ id: number; lane: number; type: string }[]>([]);

  const laneKeys = settings.keybindings;
  const laneColors = ['#00f3ff', '#a855f7', '#ff4fcf', '#65ff8f'];
  const visualBeat = useMemo(() => estimateVisualBeat(notes), [notes]);

  const currentNoteSpeed = NOTE_SPEED * (1 + difficulty * 0.15) * noteSpeedMultiplier;
  const activeTimingPreset = TIMING_PRESETS.find((preset) =>
    Math.abs(preset.hitWindow - hitWindow) < 0.001 && Math.abs(preset.perfectWindow - perfectWindow) < 0.001
  );

  const applyTimingPreset = (preset: (typeof TIMING_PRESETS)[number]) => {
    setHitWindow(preset.hitWindow);
    setPerfectWindow(preset.perfectWindow);
  };

  const endGame = () => {
    if (hasEndedRef.current || isExitingRef.current) return;
    hasEndedRef.current = true;
    
    const finalStats = gameStateRef.current;
    const eventsToPass = isReplay ? replayEvents : replayEventsRef.current;
    onGameEnd(finalStats.score, finalStats.accuracy, finalStats.maxCombo, eventsToPass);
    setGameState(prev => ({ ...prev, isPlaying: false }));
    stopGame();
  };

  useEffect(() => {
    const activeTouches = new Map<number, string>();
    let activeMouseLane: string | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isReplay) return;
      const key = e.key.toLowerCase();
      if (laneKeys.includes(key)) {
        keysPressed.current.add(key);
        checkHit(laneKeys.indexOf(key));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isReplay) return;
      const key = e.key.toLowerCase();
      const lane = laneKeys.indexOf(key);
      if (lane >= 0) checkRelease(lane);
      keysPressed.current.delete(key);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isReplay) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      
      Array.from(e.changedTouches).forEach(touch => {
        const x = (touch.clientX - rect.left) * scaleX;
        const laneWidth = canvas.width / LANE_COUNT;
        const lane = Math.floor(x / laneWidth);
        
        if (lane >= 0 && lane < LANE_COUNT) {
          const key = laneKeys[lane];
          keysPressed.current.add(key);
          checkHit(lane);
          activeTouches.set(touch.identifier, key);
        }
      });
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isReplay) return;
      Array.from(e.changedTouches).forEach(touch => {
        const key = activeTouches.get(touch.identifier);
        if (key) {
          const lane = laneKeys.indexOf(key);
          if (lane >= 0) checkRelease(lane);
          keysPressed.current.delete(key);
          activeTouches.delete(touch.identifier);
        }
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isReplay) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const x = (e.clientX - rect.left) * scaleX;
      const laneWidth = canvas.width / LANE_COUNT;
      const lane = Math.floor(x / laneWidth);
      
      if (lane >= 0 && lane < LANE_COUNT) {
        const key = laneKeys[lane];
        keysPressed.current.add(key);
        checkHit(lane);
        activeMouseLane = key;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isReplay) return;
      if (activeMouseLane) {
        const lane = laneKeys.indexOf(activeMouseLane);
        if (lane >= 0) checkRelease(lane);
        keysPressed.current.delete(activeMouseLane);
        activeMouseLane = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handleMouseUp);
    
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd);
      canvas.addEventListener('touchcancel', handleTouchEnd);
      canvas.addEventListener('mousedown', handleMouseDown);
    }

    startGame();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleMouseUp);
      if (canvas) {
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);
        canvas.removeEventListener('mousedown', handleMouseDown);
      }
      stopGame();
    };
  }, []);

  const startGame = () => {
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = audioBuffer;
    gainNode.gain.value = settings.volume;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Solo play keeps the familiar lead-in. Multiplayer uses the shared server timestamp.
    const leadInTime = synchronizedStartAt
      ? Math.max(0.25, (new Date(synchronizedStartAt).getTime() - Date.now()) / 1000)
      : 10;
    startTimeRef.current = audioContext.currentTime + leadInTime;
    source.start(audioContext.currentTime + leadInTime);
    sourceRef.current = source;
    
    setGameState(prev => ({ ...prev, isPlaying: true }));
    requestRef.current = requestAnimationFrame(gameLoop);

    source.onended = () => {
      endGame();
    };
  };

  const stopGame = () => {
    isExitingRef.current = true;
    if (sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    cancelAnimationFrame(requestRef.current);
  };

  const pauseGame = () => {
    if (multiplayerRoom) return;
    setIsPaused(true);
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    cancelAnimationFrame(requestRef.current);
  };

  const resumeGame = () => {
    setIsPaused(false);
    const currentTime = gameStateRef.current.currentTime;
    
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = audioBuffer;
    gainNode.gain.value = settings.volume;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    startTimeRef.current = audioContext.currentTime - currentTime;
    source.start(0, currentTime);
    sourceRef.current = source;
    
    source.onended = () => {
      endGame();
    };
    
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const playFeedbackSound = (type: 'PERFECT' | 'GREAT' | 'MISS') => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    // Base volume adjusted by settings
    const baseVolume = settings.volume;
    
    if (type === 'PERFECT') {
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.1 * baseVolume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001 * baseVolume, audioContext.currentTime + 0.05);
      osc.start();
      osc.stop(audioContext.currentTime + 0.05);
    } else if (type === 'GREAT') {
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.1 * baseVolume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001 * baseVolume, audioContext.currentTime + 0.05);
      osc.start();
      osc.stop(audioContext.currentTime + 0.05);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      gain.gain.setValueAtTime(0.2 * baseVolume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001 * baseVolume, audioContext.currentTime + 0.1);
      osc.start();
      osc.stop(audioContext.currentTime + 0.1);
    }
  };

  const showJudgement = (lane: number, type: 'PERFECT' | 'GREAT' | 'MISS') => {
    if (type === 'MISS') missedLanesRef.current[lane] = Date.now();
    if (!settings.visualEffects) return;
    const effectId = Date.now() + Math.random();
    setHitEffects(prev => [...prev.slice(-10), { id: effectId, lane, type }]);
    setTimeout(() => setHitEffects(prev => prev.filter(effect => effect.id !== effectId)), 600);
  };

  const finishHold = (note: Note, currentTime: number, judgement: 'PERFECT' | 'GREAT') => {
    if (!note.held) return;
    note.held = false;
    holdTrackersRef.current.delete(note.id);
    const lane = getRequiredSlideLane(note, note.time + (note.duration ?? 0));
    if (!isReplay) {
      replayEventsRef.current.push({ time: currentTime, lane, type: `HOLD_END_${judgement}` });
    }
    showJudgement(lane, judgement);
    playFeedbackSound(judgement);
    setGameState(prev => {
      const newCombo = prev.combo + 1;
      const multiplier = newCombo >= 20 ? 2 : newCombo >= 10 ? 1.5 : 1;
      return {
        ...prev,
        score: prev.score + Math.floor((judgement === 'PERFECT' ? 100 : 50) * multiplier),
        combo: newCombo,
        maxCombo: Math.max(prev.maxCombo, newCombo),
      };
    });
  };

  const breakHold = (note: Note, currentTime: number) => {
    if (!note.held) return;
    const tracker = holdTrackersRef.current.get(note.id);
    const lane = getRequiredSlideLane(note, currentTime);
    note.held = false;
    note.missed = true;
    holdTrackersRef.current.delete(note.id);
    if (!isReplay) replayEventsRef.current.push({ time: currentTime, lane, type: 'HOLD_BREAK' });
    showJudgement(lane, 'MISS');
    playFeedbackSound('MISS');
    setGameState(prev => {
      const currentWeight = (prev.accuracy / 100) * prev.totalNotes;
      const correctedWeight = Math.max(0, currentWeight - (tracker?.headWeight ?? 0.5));
      return {
        ...prev,
        combo: 0,
        hitNotes: Math.max(0, prev.hitNotes - 1),
        accuracy: prev.totalNotes > 0 ? (correctedWeight / prev.totalNotes) * 100 : 0,
      };
    });
  };

  const checkRelease = (lane: number) => {
    const currentTime = audioContext.currentTime - startTimeRef.current;
    localNotesRef.current.forEach((note) => {
      if (!note.held || !note.duration) return;
      const requiredLane = getRequiredSlideLane(note, currentTime);
      if (requiredLane !== lane) return;
      const tailDifference = Math.abs(note.time + note.duration - currentTime);
      if (tailDifference <= hitWindow) {
        finishHold(note, currentTime, tailDifference <= perfectWindow ? 'PERFECT' : 'GREAT');
      }
    });
  };

  const checkHit = (lane: number) => {
    const currentTime = audioContext.currentTime - startTimeRef.current;
    let targetNote: Note | null = null;
    let minDiff = Infinity;

    localNotesRef.current.forEach(n => {
      if (n.lane === lane && !n.hit && !n.missed && !n.held) {
        const diff = Math.abs(n.time - currentTime);
        if (diff <= hitWindow && diff < minDiff) {
          minDiff = diff;
          targetNote = n;
        }
      }
    });

    if (!targetNote) return;
    const note = targetNote as Note;
    const diff = Math.abs(note.time - currentTime);
    const judgement: 'PERFECT' | 'GREAT' = diff <= perfectWindow ? 'PERFECT' : 'GREAT';
    const points = judgement === 'PERFECT' ? 100 : 50;
    const accuracyWeight = judgement === 'PERFECT' ? 1 : 0.5;
    note.hit = true;
    if (note.duration) {
      note.held = true;
      const tickInterval = note.tickInterval ?? Math.max(0.16, Math.min(0.45, note.duration / 4));
      holdTrackersRef.current.set(note.id, {
        nextTickTime: note.time + tickInterval,
        tickInterval,
        lastValidTime: currentTime,
        lastRequiredLane: lane,
        headWeight: accuracyWeight,
      });
    }
    if (!isReplay) replayEventsRef.current.push({ time: currentTime, lane, type: judgement });
    showJudgement(lane, judgement);
    playFeedbackSound(judgement);
    setGameState(prev => {
      const newCombo = prev.combo + 1;
      const currentTotalWeight = (prev.accuracy / 100) * prev.totalNotes;
      const newAccuracy = prev.totalNotes > 0
        ? ((currentTotalWeight + accuracyWeight) / prev.totalNotes) * 100
        : 0;
      const multiplier = newCombo >= 20 ? 2 : newCombo >= 10 ? 1.5 : 1;
      return {
        ...prev,
        score: prev.score + Math.floor(points * multiplier),
        combo: newCombo,
        maxCombo: Math.max(prev.maxCombo, newCombo),
        hitNotes: prev.hitNotes + 1,
        accuracy: newAccuracy,
      };
    });
  };

  const gameLoop = () => {
    if (isPaused) return;
    const currentTime = audioContext.currentTime - startTimeRef.current;
    setGameState(prev => ({ ...prev, currentTime }));
    if (onMultiplayerProgress && Date.now() - lastProgressSentRef.current >= 750) {
      lastProgressSentRef.current = Date.now();
      const state = gameStateRef.current;
      onMultiplayerProgress({
        score: state.score,
        combo: state.combo,
        accuracy: state.accuracy,
        progress: Math.max(0, Math.min(1, currentTime / state.duration)),
      });
    }

    if (isReplay) {
      replayHoldKeysRef.current.forEach((key) => keysPressed.current.delete(key));
      replayHoldKeysRef.current.clear();
      localNotesRef.current.forEach((note) => {
        if (!note.held || !note.duration) return;
        const key = laneKeys[getRequiredSlideLane(note, currentTime)];
        keysPressed.current.add(key);
        replayHoldKeysRef.current.add(key);
        const tracker = holdTrackersRef.current.get(note.id);
        if (!tracker) return;
        const tailTime = note.time + note.duration;
        while (currentTime >= tracker.nextTickTime && tracker.nextTickTime < tailTime - perfectWindow) {
          setGameState(prev => ({ ...prev, score: prev.score + (prev.combo >= 20 ? 50 : prev.combo >= 10 ? 38 : 25) }));
          tracker.nextTickTime += tracker.tickInterval;
        }
      });

      replayEvents.forEach((e, index) => {
        if (triggeredEventsRef.current.has(index) || currentTime < e.time - 0.03) return;
        triggeredEventsRef.current.add(index);
        const isHoldEnd = e.type.startsWith('HOLD_END_');
        const isMiss = e.type === 'MISS' || e.type === 'HOLD_BREAK';
        const tailNote = isHoldEnd || e.type === 'HOLD_BREAK'
          ? localNotesRef.current
              .filter((note) => note.held && note.duration)
              .sort((a, b) => Math.abs(a.time + (a.duration ?? 0) - e.time) - Math.abs(b.time + (b.duration ?? 0) - e.time))[0]
          : undefined;

        if (isHoldEnd && tailNote) {
          finishHold(tailNote, e.time, e.type.endsWith('GREAT') ? 'GREAT' : 'PERFECT');
          return;
        }
        if (e.type === 'HOLD_BREAK' && tailNote) {
          breakHold(tailNote, e.time);
          return;
        }

        const targetNote = localNotesRef.current.find((note) =>
          note.lane === e.lane && !note.hit && !note.missed && Math.abs(note.time - e.time) < 0.14
        );
        if (!targetNote) {
          const legacyHold = localNotesRef.current.find((note) =>
            note.held && note.duration &&
            (note.lane === e.lane || (note.endLane ?? note.lane) === e.lane) &&
            e.time >= note.time && e.time <= note.time + note.duration + hitWindow
          );
          if (legacyHold) {
            if (isMiss) breakHold(legacyHold, e.time);
            else finishHold(legacyHold, e.time, e.type === 'GREAT' ? 'GREAT' : 'PERFECT');
          }
          return;
        }
        if (isMiss) {
          targetNote.missed = true;
          showJudgement(e.lane, 'MISS');
          playFeedbackSound('MISS');
          setGameState(prev => ({ ...prev, combo: 0 }));
          return;
        }

        const judgement: 'PERFECT' | 'GREAT' = e.type === 'PERFECT' ? 'PERFECT' : 'GREAT';
        const accuracyWeight = judgement === 'PERFECT' ? 1 : 0.5;
        targetNote.hit = true;
        if (targetNote.duration) {
          targetNote.held = true;
          const tickInterval = targetNote.tickInterval ?? Math.max(0.16, Math.min(0.45, targetNote.duration / 4));
          holdTrackersRef.current.set(targetNote.id, {
            nextTickTime: targetNote.time + tickInterval,
            tickInterval,
            lastValidTime: e.time,
            lastRequiredLane: targetNote.lane,
            headWeight: accuracyWeight,
          });
        }
        showJudgement(e.lane, judgement);
        playFeedbackSound(judgement);
        setGameState(prev => {
          const newCombo = prev.combo + 1;
          const multiplier = newCombo >= 20 ? 2 : newCombo >= 10 ? 1.5 : 1;
          const currentWeight = (prev.accuracy / 100) * prev.totalNotes;
          return {
            ...prev,
            score: prev.score + Math.floor((judgement === 'PERFECT' ? 100 : 50) * multiplier),
            combo: newCombo,
            maxCombo: Math.max(prev.maxCombo, newCombo),
            hitNotes: prev.hitNotes + 1,
            accuracy: prev.totalNotes > 0 ? ((currentWeight + accuracyWeight) / prev.totalNotes) * 100 : 0,
          };
        });
      });
    }

    // Fallback: If current time exceeds duration + 1 second, force end game
    if (currentTime > gameStateRef.current.duration + 1) {
      endGame();
      return;
    }

    // Check for missed notes
    const activeWindow = 2.0; // Only process notes within 2 seconds of current time
    localNotesRef.current.forEach(note => {
      // Skip notes far in the future or already processed
      if (note.time > currentTime + activeWindow) return;
      
      if (!isReplay && !note.hit && !note.missed && currentTime >= note.time + hitWindow) {
        note.missed = true;
        replayEventsRef.current.push({ time: currentTime, lane: note.lane, type: 'MISS' });
        showJudgement(note.lane, 'MISS');
        playFeedbackSound('MISS');
        setGameState(prev => ({ ...prev, combo: 0 }));
      }

      if (!isReplay && note.hit && note.held && note.duration) {
        const tracker = holdTrackersRef.current.get(note.id);
        if (!tracker) return;
        const requiredLane = getRequiredSlideLane(note, currentTime);
        const requiredKeyHeld = keysPressed.current.has(laneKeys[requiredLane]);
        if (requiredKeyHeld) tracker.lastValidTime = currentTime;
        tracker.lastRequiredLane = requiredLane;

        const tailTime = note.time + note.duration;
        while (currentTime >= tracker.nextTickTime && tracker.nextTickTime < tailTime - perfectWindow) {
          if (currentTime - tracker.lastValidTime <= HOLD_GRACE_SECONDS) {
            setGameState(prev => ({ ...prev, score: prev.score + (prev.combo >= 20 ? 50 : prev.combo >= 10 ? 38 : 25) }));
          }
          tracker.nextTickTime += tracker.tickInterval;
        }

        if (!requiredKeyHeld && currentTime - tracker.lastValidTime > HOLD_GRACE_SECONDS) {
          breakHold(note, currentTime);
        } else if (currentTime > tailTime + perfectWindow) {
          if (requiredKeyHeld) finishHold(note, currentTime, 'GREAT');
          else breakHold(note, currentTime);
        }
      }
    });

    draw();
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const currentTime = audioContext.currentTime - startTimeRef.current;
    const laneWidth = width / LANE_COUNT;
    const hitLineY = height - 100;
    const beatPosition = (currentTime - visualBeat.origin) / visualBeat.interval;
    const beatPhase = ((beatPosition % 1) + 1) % 1;
    const beatPulse = Math.exp(-beatPhase * 5.5);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#091426');
    background.addColorStop(0.52, '#080b18');
    background.addColorStop(1, '#03050b');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const ambientGlow = ctx.createRadialGradient(width / 2, height * 0.28, 10, width / 2, height * 0.28, width * 0.78);
    ambientGlow.addColorStop(0, `rgba(105, 68, 220, ${0.09 + beatPulse * 0.035})`);
    ambientGlow.addColorStop(0.48, 'rgba(0, 198, 255, 0.025)');
    ambientGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = ambientGlow;
    ctx.fillRect(0, 0, width, height);

    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const laneGradient = ctx.createLinearGradient(0, 0, 0, hitLineY);
      laneGradient.addColorStop(0, lane % 2 === 0 ? 'rgba(255,255,255,0.008)' : 'rgba(105,68,220,0.012)');
      laneGradient.addColorStop(1, lane % 2 === 0 ? 'rgba(0,243,255,0.018)' : 'rgba(188,19,254,0.018)');
      ctx.fillStyle = laneGradient;
      ctx.fillRect(lane * laneWidth, 0, laneWidth, hitLineY);
    }

    const firstGridBeat = Math.floor((currentTime - visualBeat.origin) / visualBeat.interval) - 1;
    const visibleBeats = Math.ceil(height / (currentNoteSpeed * visualBeat.interval)) + 3;
    for (let index = firstGridBeat; index <= firstGridBeat + visibleBeats; index++) {
      const beatTime = visualBeat.origin + index * visualBeat.interval;
      const y = hitLineY - currentNoteSpeed * (beatTime - currentTime);
      if (y < 0 || y > hitLineY) continue;
      const major = ((index % 4) + 4) % 4 === 0;
      const perspectiveInset = Math.max(0, (hitLineY - y) * 0.08);
      ctx.strokeStyle = major ? 'rgba(166, 139, 250, 0.14)' : 'rgba(255, 255, 255, 0.045)';
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(perspectiveInset, y);
      ctx.lineTo(width - perspectiveInset, y);
      ctx.stroke();
    }

    ctx.lineWidth = 1;
    for (let i = 1; i < LANE_COUNT; i++) {
      const divider = ctx.createLinearGradient(0, 0, 0, height);
      divider.addColorStop(0, 'rgba(255,255,255,0.025)');
      divider.addColorStop(0.72, 'rgba(255,255,255,0.12)');
      divider.addColorStop(1, 'rgba(255,255,255,0.035)');
      ctx.strokeStyle = divider;
      ctx.beginPath();
      ctx.moveTo(i * laneWidth, 0);
      ctx.lineTo(i * laneWidth, height);
      ctx.stroke();
    }

    if (settings.visualEffects) {
      for (let wave = 0; wave < 2; wave++) {
        ctx.strokeStyle = wave === 0 ? 'rgba(0,243,255,0.035)' : 'rgba(188,19,254,0.03)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const y = height * (0.24 + wave * 0.14) + Math.sin(x / (62 + wave * 18) + currentTime * (0.55 + wave * 0.12)) * (10 + beatPulse * 4);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    const edgeShade = ctx.createLinearGradient(0, 0, width, 0);
    edgeShade.addColorStop(0, 'rgba(0,0,0,0.38)');
    edgeShade.addColorStop(0.14, 'transparent');
    edgeShade.addColorStop(0.86, 'transparent');
    edgeShade.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = edgeShade;
    ctx.fillRect(0, 0, width, height);

    ctx.shadowColor = '#a78bfa';
    ctx.shadowBlur = settings.visualEffects ? 8 + beatPulse * 6 : 0;
    ctx.strokeStyle = `rgba(224, 231, 255, ${0.58 + beatPulse * 0.16})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitLineY);
    ctx.lineTo(width, hitLineY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    laneKeys.forEach((key, i) => {
      const isPressed = keysPressed.current.has(key);
      const isMissed = Date.now() - (missedLanesRef.current[i] || 0) < 300;
      const receptorX = i * laneWidth + 12;
      ctx.fillStyle = isPressed ? laneColors[i] : isMissed ? '#fb7185' : 'rgba(255,255,255,0.09)';
      if (isPressed && settings.visualEffects) {
        ctx.shadowColor = laneColors[i];
        ctx.shadowBlur = 18;
      }
      ctx.beginPath();
      ctx.roundRect(receptorX, hitLineY - 13, laneWidth - 24, 26, 9);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isPressed ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.18)';
      ctx.stroke();

      ctx.fillStyle = isPressed ? '#fff' : 'rgba(255,255,255,0.58)';
      ctx.font = '700 18px Outfit';
      ctx.textAlign = 'center';
      ctx.fillText(key.toUpperCase(), i * laneWidth + laneWidth / 2, hitLineY + 40);
    });

    const visibleNotes = localNotesRef.current.filter((note) => !note.missed && !(note.hit && !note.held));
    visibleNotes.filter((note) => note.duration).forEach((note) => {
      const tailTime = note.time + (note.duration ?? 0);
      const visibleStartTime = note.held ? Math.max(note.time, Math.min(currentTime, tailTime)) : note.time;
      const startY = note.held ? hitLineY : hitLineY - currentNoteSpeed * (note.time - currentTime);
      const tailY = hitLineY - currentNoteSpeed * (tailTime - currentTime);
      if (startY < -100 || tailY > height + 100) return;

      const startProgress = getSlideProgress(note, visibleStartTime);
      const pathSteps = Math.max(8, Math.ceil((1 - startProgress) * 28));
      const drawPath = () => {
        ctx.beginPath();
        for (let step = pathSteps; step >= 0; step--) {
          const progress = startProgress + (1 - startProgress) * (step / pathSteps);
          const pointTime = note.time + (note.duration ?? 0) * progress;
          const x = (getSlideLanePosition(note, pointTime) + 0.5) * laneWidth;
          const y = note.held && step === 0 ? hitLineY : hitLineY - currentNoteSpeed * (pointTime - currentTime);
          if (step === pathSteps) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      const startColor = laneColors[note.lane];
      const endColor = laneColors[note.endLane ?? note.lane];
      const bodyGradient = ctx.createLinearGradient(0, tailY, 0, startY);
      bodyGradient.addColorStop(0, endColor);
      bodyGradient.addColorStop(1, startColor);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = note.held ? 0.82 : 0.5;
      ctx.strokeStyle = bodyGradient;
      ctx.lineWidth = laneWidth * 0.48;
      if (settings.visualEffects) {
        ctx.shadowColor = note.held ? '#ffffff' : startColor;
        ctx.shadowBlur = note.held ? 18 : 11;
      }
      drawPath();
      ctx.stroke();

      ctx.globalAlpha = note.held ? 0.86 : 0.58;
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 5;
      ctx.shadowBlur = 0;
      drawPath();
      ctx.stroke();
      ctx.globalAlpha = 1;

      const tickInterval = note.tickInterval ?? Math.max(0.16, Math.min(0.45, (note.duration ?? 0) / 4));
      for (let tickTime = note.time + tickInterval; tickTime < tailTime - 0.04; tickTime += tickInterval) {
        if (tickTime < visibleStartTime) continue;
        const tickX = (getSlideLanePosition(note, tickTime) + 0.5) * laneWidth;
        const tickY = hitLineY - currentNoteSpeed * (tickTime - currentTime);
        if (tickY < -12 || tickY > hitLineY + 12) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(tickX, tickY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      const tailX = ((note.endLane ?? note.lane) + 0.5) * laneWidth;
      ctx.fillStyle = endColor;
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(tailX - laneWidth * 0.34, tailY - 11, laneWidth * 0.68, 22, 8);
      ctx.fill();
      ctx.stroke();

      if (!note.held) {
        const headX = (note.lane + 0.5) * laneWidth;
        const headGradient = ctx.createLinearGradient(0, startY - 15, 0, startY + 15);
        headGradient.addColorStop(0, '#ffffff');
        headGradient.addColorStop(0.28, startColor);
        headGradient.addColorStop(1, startColor);
        ctx.fillStyle = headGradient;
        ctx.beginPath();
        ctx.roundRect(headX - laneWidth * 0.4, startY - 15, laneWidth * 0.8, 30, 10);
        ctx.fill();
      } else {
        const activeX = (getSlideLanePosition(note, currentTime) + 0.5) * laneWidth;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.7 + beatPulse * 0.25;
        ctx.beginPath();
        ctx.arc(activeX, hitLineY, 20 + beatPulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });

    visibleNotes.filter((note) => !note.duration).forEach((note) => {
      if (note.missed) return;
      if (note.hit && !note.held) return;
      const timeDiff = note.time - currentTime;
      const y = hitLineY - currentNoteSpeed * timeDiff;
      if (y < -60 || y > height + 60) return;
      const noteWidth = laneWidth - 30;
      const x = note.lane * laneWidth + 15;
      const color = laneColors[note.lane];
      const gradient = ctx.createLinearGradient(x, y - 14, x, y + 14);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.22, color);
      gradient.addColorStop(1, color);
      ctx.fillStyle = gradient;
      if (settings.visualEffects) {
        ctx.shadowBlur = 13;
        ctx.shadowColor = color;
      }
      ctx.beginPath();
      ctx.roundRect(x, y - 14, noteWidth, 28, 9);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.44)';
      ctx.beginPath();
      ctx.roundRect(x + 8, y - 10, noteWidth - 16, 5, 3);
      ctx.fill();
    });

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  };

  return (
    <div
      data-slider-mode={movingSlidersEnabled ? 'moving' : 'straight'}
      className="relative flex h-[100dvh] min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-[#02050b]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.12),transparent_38%),radial-gradient(circle_at_16%_75%,rgba(0,243,255,0.06),transparent_32%),radial-gradient(circle_at_84%_72%,rgba(188,19,254,0.07),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px)] [background-size:100%_48px]" />
      {/* HUD */}
      <div className="absolute left-4 top-4 z-10 flex min-w-36 flex-col gap-0.5 rounded-2xl border border-white/10 bg-[#050813]/70 px-4 py-3 shadow-xl backdrop-blur-xl md:left-8 md:top-8 md:min-w-44 md:px-5 md:py-4">
        <div className="text-[9px] font-black uppercase tracking-[0.24em] text-white/35">Score</div>
        <div className="text-2xl md:text-4xl font-display font-black text-neon-blue tracking-tighter">
          {gameState.score.toLocaleString()}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45 md:text-xs">
          Accuracy <span className="text-white/75">{gameState.accuracy.toFixed(1)}%</span>
        </div>
      </div>

      <div className="absolute right-4 top-4 z-10 min-w-32 rounded-2xl border border-white/10 bg-[#050813]/70 px-4 py-3 text-right shadow-xl backdrop-blur-xl md:right-8 md:top-8 md:min-w-40 md:px-5 md:py-4">
        <div className="text-4xl md:text-6xl font-display font-black text-neon-pink italic">
          {gameState.combo}
        </div>
        <div className="text-[10px] md:text-sm font-display font-bold text-white/40 uppercase tracking-widest flex items-center justify-end gap-1 md:gap-2">
          Combo
          {gameState.combo >= 10 && (
            <span className="text-neon-green text-[8px] md:text-xs bg-neon-green/10 px-1.5 md:px-2 py-0.5 rounded border border-neon-green/20">
              {gameState.combo >= 20 ? '2.0x' : '1.5x'}
            </span>
          )}
        </div>
      </div>

      {multiplayerRoom && (
        <div className="absolute left-4 top-24 z-20 hidden w-48 rounded-2xl border border-white/10 bg-black/70 p-3 backdrop-blur-xl lg:block">
          <div className="mb-2 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.18em] text-white/35">
            <span>Live standings</span><span className="text-neon-purple">{multiplayerRoom.code}</span>
          </div>
          <div className="space-y-1.5">
            {[...multiplayerRoom.participants].sort((a, b) => b.score - a.score).slice(0, 5).map((player, index) => (
              <div key={player.playerId} className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-2 text-xs">
                <span className="min-w-0 truncate text-white/65"><span className="mr-2 font-mono text-white/25">{index + 1}</span>{player.username}</span>
                <span className="ml-2 font-mono text-neon-blue">{player.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 z-30 h-1 w-full bg-white/10">
        <div 
          className="h-full bg-gradient-to-r from-neon-blue via-neon-purple to-neon-green shadow-[0_0_12px_rgba(0,243,255,0.55)] transition-all duration-100 ease-linear"
          style={{ width: `${Math.max(0, (gameState.currentTime / gameState.duration) * 100)}%` }}
        />
      </div>

      <div className="relative z-[1] aspect-[3/4] max-h-[calc(100dvh-20px)] w-full max-w-[600px]">
        <canvas 
          ref={canvasRef}
          width={600}
          height={800}
          className="h-full w-full touch-none rounded-[28px] border border-white/10 shadow-[0_30px_100px_rgba(0,0,0,0.55),0_0_45px_rgba(124,58,237,0.12)]"
        />

      {/* Mobile Touch Controls */}
      <div className="absolute bottom-3 left-0 z-20 flex w-full justify-between px-3 md:hidden">
        {laneKeys.map((key, index) => (
          <button
            key={key}
            aria-label={`Lane ${index + 1}: ${key.toUpperCase()}`}
            className="w-[20%] h-24 rounded-2xl bg-white/10 border border-white/20 active:bg-neon-blue/40 transition-colors"
            onTouchStart={(e) => {
              if (isReplay) return;
              e.preventDefault();
              keysPressed.current.add(key);
              checkHit(index);
            }}
            onTouchEnd={(e) => {
              if (isReplay) return;
              e.preventDefault();
              checkRelease(index);
              keysPressed.current.delete(key);
            }}
          />
        ))}
      </div>

      {/* Hit Effects Overlay */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="relative h-full w-full">
          <AnimatePresence>
            {hitEffects.map((effect) => (
              <motion.div
                key={effect.id}
                initial={{ opacity: 0, y: 20, scale: 0.5 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.5 }}
                className="absolute flex flex-col items-center justify-center"
                style={{
                  left: `${(effect.lane + 0.5) * 25}%`,
                  top: 'calc(87.5% - 50px)',
                  transform: 'translateX(-50%)',
                }}
              >
                {/* Rating Text */}
                <motion.div
                  className={`text-3xl font-display font-black italic tracking-tighter ${
                    effect.type === 'PERFECT' ? 'text-neon-blue' : 
                    effect.type === 'GREAT' ? 'text-neon-green' : 'text-white/40'
                  }`}
                  style={{ textShadow: effect.type === 'MISS' ? 'none' : `0 0 20px ${effect.type === 'PERFECT' ? '#00f3ff' : '#39ff14'}` }}
                >
                  {effect.type}
                </motion.div>
                
                {/* Lane Indicator Dot */}
                <div 
                  className="w-2 h-2 rounded-full mt-1"
                  style={{ backgroundColor: laneColors[effect.lane], boxShadow: `0 0 10px ${laneColors[effect.lane]}` }}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Lane Flash */}
          <AnimatePresence>
            {hitEffects.filter(e => e.type !== 'MISS').map((effect) => (
              <motion.div
                key={`flash-${effect.id}`}
                initial={{ opacity: 0.6, height: 0 }}
                animate={{ opacity: 0, height: 300 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-[100px] w-[150px]"
                style={{
                  left: `${effect.lane * 25}%`,
                  bottom: '12.5%',
                  width: '25%',
                  background: `linear-gradient(to top, ${laneColors[effect.lane]}, transparent)`,
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
      </div>

      {/* Countdown Overlay */}
      <AnimatePresence>
        {gameState.currentTime < 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none"
          >
            <div className="text-sm font-display font-bold text-neon-blue uppercase tracking-[0.5em] mb-4">
              Get Ready
            </div>
            <AnimatePresence mode="wait">
              <motion.div 
                key={Math.ceil(Math.abs(gameState.currentTime))}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.5 }}
                className="text-9xl font-display font-black text-white italic"
              >
                {Math.ceil(Math.abs(gameState.currentTime))}
              </motion.div>
            </AnimatePresence>
            <div className="mt-5 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45 backdrop-blur-md">
              {movingSlidersEnabled
                ? 'Tap notes · hold trails · follow moving slides'
                : 'Tap notes · hold straight trails · release on the tail'}
            </div>
            
            {!multiplayerRoom && <button 
              onClick={() => {
                if (sourceRef.current) {
                  // Stop the current lead-in source
                  sourceRef.current.onended = null; // Remove old listener to prevent double endGame
                  sourceRef.current.stop();
                  
                  const source = audioContext.createBufferSource();
                  const gainNode = audioContext.createGain();
                  
                  source.buffer = audioBuffer;
                  gainNode.gain.value = settings.volume;
                  
                  source.connect(gainNode);
                  gainNode.connect(audioContext.destination);
                  
                  // Start immediately
                  startTimeRef.current = audioContext.currentTime;
                  source.start(0);
                  sourceRef.current = source;
                  
                  source.onended = () => {
                    endGame();
                  };
                }
              }}
              className="mt-12 px-6 py-2 rounded-full border border-white/20 text-white/40 text-xs font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all pointer-events-auto"
            >
              Skip Countdown
            </button>}
          </motion.div>
        )}
      </AnimatePresence>

      {!multiplayerRoom && <button 
        aria-label={isPaused ? 'Resume game' : 'Pause game'}
        onClick={() => {
          if (isPaused) resumeGame();
          else pauseGame();
        }}
        className="absolute bottom-4 right-4 z-20 rounded-full border border-white/10 bg-black/40 p-2.5 text-white/60 backdrop-blur-lg transition-colors hover:bg-white/10 hover:text-white md:bottom-8 md:right-8 md:p-3"
      >
        {isPaused ? <Play className="w-5 h-5 md:w-6 md:h-6" /> : <Pause className="w-5 h-5 md:w-6 md:h-6" />}
      </button>}

      <button 
        aria-label="Exit to menu"
        onClick={() => {
          stopGame();
          onExit();
        }}
        className="absolute bottom-4 left-4 z-20 rounded-full border border-white/10 bg-black/40 p-2.5 text-white/60 backdrop-blur-lg transition-colors hover:bg-white/10 hover:text-white md:bottom-8 md:left-8 md:p-3"
      >
        <Home className="w-5 h-5 md:w-6 md:h-6" />
      </button>

      {isPaused && (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[#02040a]/85 p-4 backdrop-blur-xl">
          <div className="my-auto w-full max-w-md rounded-[30px] border border-white/10 bg-[#080b15]/95 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.6)] sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-neon-blue">Game paused</p>
                <h2 className="mt-1 font-display text-4xl font-black text-white">Take a breath</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/35">
                {Math.round(Math.max(0, Math.min(1, gameState.currentTime / gameState.duration)) * 100)}%
              </span>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-white">Scroll speed</p>
                  <p className="mt-1 text-xs text-white/40">Changes spacing, not chart difficulty.</p>
                </div>
                <span className="font-mono text-sm text-neon-blue">{noteSpeedMultiplier.toFixed(1)}x</span>
              </div>
              <input
                aria-label="Note scroll speed"
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={noteSpeedMultiplier}
                onChange={(e) => setNoteSpeedMultiplier(parseFloat(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-blue"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="mb-4">
                <p className="text-sm font-bold text-white">Timing assist</p>
                <p className="mt-1 text-xs text-white/40">
                  {activeTimingPreset?.description ?? 'Custom timing windows are active.'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {TIMING_PRESETS.map((preset) => {
                  const isSelected = activeTimingPreset?.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => applyTimingPreset(preset)}
                      className={`rounded-xl border px-2 py-3 text-[10px] font-black uppercase tracking-[0.12em] transition-all ${
                        isSelected
                          ? 'border-neon-purple/50 bg-neon-purple/15 text-white'
                          : 'border-white/8 bg-white/[0.035] text-white/40 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <details className="mt-4 border-t border-white/8 pt-4">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition-colors hover:text-white">
                  Fine tune timing
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-2 flex items-center justify-between text-xs text-white/55">
                      Hit window <span className="font-mono text-white/35">{Math.round(hitWindow * 1000)} ms</span>
                    </label>
                    <input
                      aria-label="Hit timing window"
                      type="range"
                      min="0.05"
                      max="0.3"
                      step="0.005"
                      value={hitWindow}
                      onChange={(e) => setHitWindow(Math.max(perfectWindow, parseFloat(e.target.value)))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-purple"
                    />
                  </div>
                  <div>
                    <label className="mb-2 flex items-center justify-between text-xs text-white/55">
                      Perfect window <span className="font-mono text-white/35">{Math.round(perfectWindow * 1000)} ms</span>
                    </label>
                    <input
                      aria-label="Perfect timing window"
                      type="range"
                      min="0.01"
                      max="0.1"
                      step="0.005"
                      value={perfectWindow}
                      onChange={(e) => setPerfectWindow(Math.min(hitWindow, parseFloat(e.target.value)))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-purple"
                    />
                  </div>
                </div>
              </details>
            </div>

            <button
              onClick={resumeGame}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-blue px-8 py-4 font-display font-black uppercase tracking-widest text-black transition-all hover:bg-white"
            >
              <Play className="h-5 w-5 fill-current" /> Resume
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
