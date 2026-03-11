import React, { useEffect, useRef, useState } from 'react';
import { Note, GameState, Settings } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Home, Music, Pause, Play } from 'lucide-react';

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
}

const LANE_COUNT = 4;
const NOTE_SPEED = 600; // pixels per second

export const GameCanvas: React.FC<GameCanvasProps> = ({
  notes,
  audioContext,
  audioBuffer,
  difficulty,
  onGameEnd,
  onExit,
  isReplay = false,
  replayEvents = [],
  settings
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const localNotesRef = useRef<Note[]>(notes.map(n => ({ ...n, hit: false, missed: false, held: false })));
  const keysPressed = useRef<Set<string>>(new Set());

  const isExitingRef = useRef(false);
  const hasEndedRef = useRef(false);
  const [hitEffects, setHitEffects] = useState<{ id: number; lane: number; type: string }[]>([]);

  const laneKeys = settings.keybindings;
  const laneColors = ['#00f3ff', '#bc13fe', '#ff00ff', '#39ff14'];

  const currentNoteSpeed = NOTE_SPEED * (1 + difficulty * 0.15) * noteSpeedMultiplier;

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
      keysPressed.current.delete(e.key.toLowerCase());
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
          checkHit(lane);
          const key = laneKeys[lane];
          keysPressed.current.add(key);
          activeTouches.set(touch.identifier, key);
        }
      });
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isReplay) return;
      Array.from(e.changedTouches).forEach(touch => {
        const key = activeTouches.get(touch.identifier);
        if (key) {
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
        checkHit(lane);
        const key = laneKeys[lane];
        keysPressed.current.add(key);
        activeMouseLane = key;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isReplay) return;
      if (activeMouseLane) {
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
    
    // Start audio after 10 seconds lead-in
    const leadInTime = 10;
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
    setIsPaused(true);
    if (sourceRef.current) {
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

  const checkHit = (lane: number) => {
    const currentTime = audioContext.currentTime - startTimeRef.current;
    
    // Find the closest unhit note in this lane within the hit window
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

    if (targetNote) {
        const note = targetNote as Note;
        note.hit = true;
        if (note.duration) {
          note.held = true;
        }
        
        const diff = Math.abs(note.time - currentTime);
        let points = 0;
        let accuracyWeight = 0;
        
        if (diff <= perfectWindow) {
          points = 100;
          accuracyWeight = 1;
        } else {
          points = 50;
          accuracyWeight = 0.5;
        }
        
        const effectId = Date.now() + Math.random();
        const type = diff <= perfectWindow ? 'PERFECT' : 'GREAT';
        if (!isReplay) {
          replayEventsRef.current.push({ time: currentTime, lane, type });
        }
        
        if (settings.visualEffects) {
          setHitEffects(prev => [...prev.slice(-10), { id: effectId, lane, type }]);
          setTimeout(() => {
            setHitEffects(prev => prev.filter(e => e.id !== effectId));
          }, 600);
        }
        
        playFeedbackSound(type as 'PERFECT' | 'GREAT');
        
        setGameState(prev => {
          const newCombo = prev.combo + 1;
          const newHitNotes = prev.hitNotes + 1;
          
          // Weighted accuracy: (sum of weights) / totalNotes
          // We'll track totalWeight in the state or calculate it differently
          // For simplicity, let's just use a running average
          const currentTotalWeight = (prev.accuracy / 100) * prev.totalNotes;
          const newAccuracy = ((currentTotalWeight + accuracyWeight) / prev.totalNotes) * 100;

          let multiplier = 1;
          if (newCombo >= 20) multiplier = 2;
          else if (newCombo >= 10) multiplier = 1.5;

          return {
            ...prev,
            score: prev.score + Math.floor(points * multiplier),
            combo: newCombo,
            maxCombo: Math.max(prev.maxCombo, newCombo),
            hitNotes: newHitNotes,
            accuracy: newAccuracy
          };
        });
    }
  };

  const gameLoop = () => {
    if (isPaused) return;
    const currentTime = audioContext.currentTime - startTimeRef.current;
    setGameState(prev => ({ ...prev, currentTime }));

    if (isReplay) {
      replayEvents.forEach((e, index) => {
        // Use a slightly larger window for replay events to ensure they trigger even with frame drops
        if (!triggeredEventsRef.current.has(index) && currentTime >= e.time - 0.03) {
          triggeredEventsRef.current.add(index);
          
          if (e.type !== 'MISS') {
            const key = laneKeys[e.lane];
            keysPressed.current.add(key);
            setTimeout(() => keysPressed.current.delete(key), 100);
          }
          
          // Find corresponding note
          const targetNote = localNotesRef.current.find(n => 
            n.lane === e.lane && !n.missed && 
            ( (!n.hit && Math.abs(n.time - e.time) < 0.1) || 
              (n.hit && n.held && n.duration) )
          );

          if (targetNote) {
            if (!targetNote.hit) {
              targetNote.hit = true;
              if (targetNote.duration) targetNote.held = true;
              
              let points = e.type === 'PERFECT' ? 100 : 50;
              let accuracyWeight = e.type === 'PERFECT' ? 1 : 0.5;
              playFeedbackSound(e.type as 'PERFECT' | 'GREAT');
              
              setGameState(prev => {
                const newCombo = prev.combo + 1;
                const newHitNotes = prev.hitNotes + 1;
                
                const currentTotalWeight = (prev.accuracy / 100) * prev.totalNotes;
                const newAccuracy = ((currentTotalWeight + accuracyWeight) / prev.totalNotes) * 100;

                let multiplier = 1;
                if (newCombo >= 20) multiplier = 2;
                else if (newCombo >= 10) multiplier = 1.5;

                return {
                  ...prev,
                  score: prev.score + Math.floor(points * multiplier),
                  combo: newCombo,
                  maxCombo: Math.max(prev.maxCombo, newCombo),
                  hitNotes: newHitNotes,
                  accuracy: newAccuracy
                };
              });
            } else if (targetNote.held) {
              targetNote.held = false;
              if (e.type === 'MISS') {
                targetNote.missed = true;
                setGameState(prev => ({ ...prev, combo: 0 }));
              } else {
                playFeedbackSound('PERFECT');
                setGameState(prev => {
                  const newCombo = prev.combo + 1;
                  let multiplier = 1;
                  if (newCombo >= 20) multiplier = 2;
                  else if (newCombo >= 10) multiplier = 1.5;
                  return {
                    ...prev,
                    score: prev.score + Math.floor(100 * multiplier),
                    combo: newCombo,
                    maxCombo: Math.max(prev.maxCombo, newCombo),
                  };
                });
              }
            }
          }

          if (settings.visualEffects) {
            const effectId = Date.now() + Math.random();
            setHitEffects(prev => [...prev.slice(-10), { id: effectId, lane: e.lane, type: e.type }]);
            setTimeout(() => {
              setHitEffects(prev => prev.filter(e => e.id !== effectId));
            }, 600);
          }
        }
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
      
      if (!note.hit && !note.missed && currentTime >= note.time + hitWindow) {
        note.missed = true;
        if (!isReplay) {
          replayEventsRef.current.push({ time: currentTime, lane: note.lane, type: 'MISS' });
        }
        
        // Trigger MISS effect
        if (settings.visualEffects) {
          const effectId = Date.now() + Math.random();
          setHitEffects(prev => [...prev.slice(-10), { id: effectId, lane: note.lane, type: 'MISS' }]);
          missedLanesRef.current[note.lane] = Date.now();
          setTimeout(() => {
            setHitEffects(prev => prev.filter(e => e.id !== effectId));
          }, 600);
        }
        playFeedbackSound('MISS');

        setGameState(prev => ({ ...prev, combo: 0 }));
      }

      if (!isReplay && note.hit && note.held && note.duration) {
        if (currentTime >= note.time + note.duration) {
          note.held = false;
          // Successfully completed slider
          const effectId = Date.now() + Math.random();
          replayEventsRef.current.push({ time: currentTime, lane: note.lane, type: 'PERFECT' });
          if (settings.visualEffects) {
            setHitEffects(prev => [...prev.slice(-10), { id: effectId, lane: note.lane, type: 'PERFECT' }]);
            setTimeout(() => {
              setHitEffects(prev => prev.filter(e => e.id !== effectId));
            }, 600);
          }
          playFeedbackSound('PERFECT');
          setGameState(prev => {
            const newCombo = prev.combo + 1;
            let multiplier = 1;
            if (newCombo >= 20) multiplier = 2;
            else if (newCombo >= 10) multiplier = 1.5;
            return {
              ...prev,
              score: prev.score + Math.floor(100 * multiplier),
              combo: newCombo,
              maxCombo: Math.max(prev.maxCombo, newCombo),
            };
          });
        } else if (!keysPressed.current.has(laneKeys[note.lane])) {
          // Released early!
          note.held = false;
          note.missed = true;
          replayEventsRef.current.push({ time: currentTime, lane: note.lane, type: 'MISS' });
          if (settings.visualEffects) {
            const effectId = Date.now() + Math.random();
            setHitEffects(prev => [...prev.slice(-10), { id: effectId, lane: note.lane, type: 'MISS' }]);
            missedLanesRef.current[note.lane] = Date.now();
            setTimeout(() => {
              setHitEffects(prev => prev.filter(e => e.id !== effectId));
            }, 600);
          }
          playFeedbackSound('MISS');
          
          setGameState(prev => {
            // Subtract the weight that was added when the slider head was hit
            // This is a bit complex with the current running average, but let's try
            // We assume the head hit was at least a GREAT (0.5 weight)
            // If we want to be precise, we'd need to store the weight on the note
            const weightToRemove = 0.5; 
            const currentTotalWeight = (prev.accuracy / 100) * prev.totalNotes;
            const newAccuracy = Math.max(0, ((currentTotalWeight - weightToRemove) / prev.totalNotes) * 100);
            
            return { 
              ...prev, 
              combo: 0,
              hitNotes: Math.max(0, prev.hitNotes - 1),
              accuracy: newAccuracy
            };
          });
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

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw lanes
    const laneWidth = width / LANE_COUNT;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    for (let i = 1; i < LANE_COUNT; i++) {
      ctx.beginPath();
      ctx.moveTo(i * laneWidth, 0);
      ctx.lineTo(i * laneWidth, height);
      ctx.stroke();
    }

    // Draw hit line
    const hitLineY = height - 100;
    const pulse = Math.sin(Date.now() / 150) * 2;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 + pulse * 0.1})`;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2 + pulse;
    ctx.beginPath();
    ctx.moveTo(0, hitLineY);
    ctx.lineTo(width, hitLineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;

    // Draw lane indicators (keys)
    laneKeys.forEach((key, i) => {
      const isPressed = keysPressed.current.has(key);
      const isMissed = Date.now() - (missedLanesRef.current[i] || 0) < 300;
      ctx.fillStyle = isPressed ? laneColors[i] : (isMissed ? '#ff0000' : 'rgba(255, 255, 255, 0.2)');
      ctx.fillRect(i * laneWidth + 10, hitLineY - 10, laneWidth - 20, 20);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px Outfit';
      ctx.textAlign = 'center';
      ctx.fillText(key.toUpperCase(), i * laneWidth + laneWidth / 2, hitLineY + 40);
    });

    // Draw notes
    localNotesRef.current.forEach(note => {
      if (note.missed) return;
      if (note.hit && !note.held) return;

      const timeDiff = note.time - currentTime;
      
      let yBottom = hitLineY - (currentNoteSpeed * timeDiff);
      
      if (note.held) {
        yBottom = hitLineY;
      }

      let yTop = yBottom;
      if (note.duration) {
        const endTimeDiff = (note.time + note.duration) - currentTime;
        yTop = hitLineY - (currentNoteSpeed * endTimeDiff);
      }

      if (note.held) {
        yTop = yTop; // Remove the capping logic to allow smooth shrinking
      }

      if (yBottom > -100 && yTop < height) {
        const noteWidth = laneWidth - 30;
        const x = note.lane * laneWidth + 15;

        // Draw active slider lane glow
        if (note.held && settings.visualEffects) {
          const glowGradient = ctx.createLinearGradient(0, hitLineY, 0, yTop);
          glowGradient.addColorStop(0, `${laneColors[note.lane]}44`);
          glowGradient.addColorStop(1, 'transparent');
          ctx.fillStyle = glowGradient;
          ctx.fillRect(note.lane * laneWidth, yTop, laneWidth, hitLineY - yTop);
          
          // Add some "sparks" at the hit line
          for (let i = 0; i < 3; i++) {
            const sparkX = x + Math.random() * noteWidth;
            const sparkY = hitLineY + (Math.random() - 0.5) * 10;
            const sparkSize = Math.random() * 4 + 2;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.fillStyle = laneColors[note.lane];
        
        if (settings.visualEffects) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = laneColors[note.lane];
        }
        
        if (note.duration) {
          // Draw slider body
          const sliderHeight = Math.max(10, yBottom - yTop);
          const gradient = ctx.createLinearGradient(x, yTop, x, yBottom);
          gradient.addColorStop(0, laneColors[note.lane]);
          gradient.addColorStop(0.5, `${laneColors[note.lane]}88`);
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
          
          ctx.fillStyle = gradient;
          ctx.globalAlpha = note.held ? 0.9 : 0.4;
          ctx.beginPath();
          ctx.roundRect(x, yTop, noteWidth, sliderHeight, 10);
          ctx.fill();
          
          // Add inner "core" line to slider
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x + noteWidth / 2, yTop + 10);
          ctx.lineTo(x + noteWidth / 2, yBottom - 10);
          ctx.stroke();
          ctx.lineWidth = 2;
          
          ctx.globalAlpha = 1.0;
          
          // Draw start and end caps
          ctx.fillStyle = laneColors[note.lane];
          if (!note.held) {
            // Start cap (head)
            const headGradient = ctx.createRadialGradient(x + noteWidth/2, yBottom, 5, x + noteWidth/2, yBottom, 20);
            headGradient.addColorStop(0, '#fff');
            headGradient.addColorStop(1, laneColors[note.lane]);
            ctx.fillStyle = headGradient;
            ctx.beginPath();
            ctx.roundRect(x - 2, yBottom - 14, noteWidth + 4, 28, 10);
            ctx.fill();
          }
          
          // End cap (tail)
          ctx.fillStyle = laneColors[note.lane];
          ctx.beginPath();
          ctx.roundRect(x, yTop - 12, noteWidth, 24, 8);
          ctx.fill();
        } else {
          // Normal note
          const noteHeight = 28;
          
          // Note body with gradient
          const gradient = ctx.createLinearGradient(x, yBottom - noteHeight/2, x, yBottom + noteHeight/2);
          gradient.addColorStop(0, '#fff');
          gradient.addColorStop(0.2, laneColors[note.lane]);
          gradient.addColorStop(1, laneColors[note.lane]);
          
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, yBottom - noteHeight / 2, noteWidth, noteHeight, 10);
          ctx.fill();
          
          // Inner glow/shine
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.roundRect(x + 8, yBottom - noteHeight / 2 + 4, noteWidth - 16, 6, 4);
          ctx.fill();
        }
        
        if (settings.visualEffects) {
          ctx.shadowBlur = 0;
        }
      }
    });
  };

  return (
    <div className="relative w-full min-h-screen md:h-full flex flex-col items-center justify-center bg-black overflow-hidden px-3 md:px-0 pt-16 md:pt-0 pb-32 md:pb-0">
      {/* Desktop HUD */}
      <div className="absolute top-8 left-8 hidden md:flex flex-col gap-2 z-10">
        <div className="text-2xl md:text-4xl font-display font-black text-neon-blue tracking-tighter">
          {gameState.score.toLocaleString()}
        </div>
        <div className="text-xs md:text-xl font-display font-semibold text-white/60">
          ACC: {gameState.accuracy.toFixed(1)}%
        </div>
      </div>

      <div className="absolute top-8 right-8 hidden md:block text-right z-10">
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

      {/* Mobile HUD */}
      <div className="absolute top-3 left-3 right-3 md:hidden z-20">
        <div className="rounded-2xl border border-white/10 bg-black/70 backdrop-blur-md px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-display font-black text-neon-blue tracking-tight">
              {gameState.score.toLocaleString()}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">
              Acc {gameState.accuracy.toFixed(1)}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-display font-black italic text-neon-pink leading-none">
              {gameState.combo}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">
              Combo
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-white/10 z-10">
        <div 
          className="h-full bg-neon-green transition-all duration-100 ease-linear"
          style={{ width: `${Math.max(0, (gameState.currentTime / gameState.duration) * 100)}%` }}
        />
      </div>

      <div className="relative w-full max-w-[600px] aspect-[3/4]">
        <canvas 
          ref={canvasRef}
          width={600}
          height={800}
          className="w-full h-full shadow-2xl shadow-neon-purple/20 border-x border-white/5 touch-none"
        />

        {/* Hit Effects Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <AnimatePresence>
            {hitEffects.map((effect) => (
              <motion.div
                key={effect.id}
                initial={{ opacity: 0, y: 20, scale: 0.5 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.5 }}
                className="absolute flex flex-col items-center justify-center"
                style={{
                  left: `${effect.lane * 25 + 12.5}%`,
                  top: '81.25%',
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
                className="absolute bottom-[12.5%] w-[25%]"
                style={{
                  left: `${effect.lane * 25}%`,
                  background: `linear-gradient(to top, ${laneColors[effect.lane]}, transparent)`,
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Mobile Touch Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-[600px] px-4 md:hidden z-20">
        <div className="flex justify-between gap-2">
          {laneKeys.map((key, index) => (
            <button
              key={key}
              className="flex-1 h-24 rounded-2xl bg-white/10 border border-white/20 active:bg-neon-blue/40 transition-colors"
              onTouchStart={(e) => {
                if (isReplay) return;
                e.preventDefault();
                keysPressed.current.add(key);
                checkHit(index);
              }}
              onTouchEnd={(e) => {
                if (isReplay) return;
                e.preventDefault();
                keysPressed.current.delete(key);
              }}
            />
          ))}
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
            
            <button 
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
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        onClick={() => {
          if (isPaused) resumeGame();
          else pauseGame();
        }}
        className="absolute bottom-32 md:bottom-8 right-4 md:right-8 p-2 md:p-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors z-10"
      >
        {isPaused ? <Play className="w-5 h-5 md:w-6 md:h-6" /> : <Pause className="w-5 h-5 md:w-6 md:h-6" />}
      </button>

      <button 
        onClick={() => {
          stopGame();
          onExit();
        }}
        className="absolute bottom-32 md:bottom-8 left-4 md:left-8 p-2 md:p-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors z-10"
      >
        <Home className="w-5 h-5 md:w-6 md:h-6" />
      </button>

      {isPaused && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-30">
          <h2 className="text-6xl font-display font-black text-white uppercase tracking-widest mb-8">Paused</h2>
          
          <div className="mb-8 w-64 flex flex-col gap-4">
            <div>
              <label className="text-white text-sm mb-2 block">Note Speed: {noteSpeedMultiplier.toFixed(1)}x</label>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1" 
                value={noteSpeedMultiplier} 
                onChange={(e) => setNoteSpeedMultiplier(parseFloat(e.target.value))}
                className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-neon-blue"
              />
            </div>
            <div>
              <label className="text-white text-sm mb-2 block">Hit Window: {hitWindow.toFixed(2)}s</label>
              <input 
                type="range" 
                min="0.05" 
                max="0.3" 
                step="0.01" 
                value={hitWindow} 
                onChange={(e) => setHitWindow(parseFloat(e.target.value))}
                className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-neon-blue"
              />
            </div>
            <div>
              <label className="text-white text-sm mb-2 block">Perfect Window: {perfectWindow.toFixed(2)}s</label>
              <input 
                type="range" 
                min="0.01" 
                max="0.1" 
                step="0.01" 
                value={perfectWindow} 
                onChange={(e) => setPerfectWindow(parseFloat(e.target.value))}
                className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-neon-blue"
              />
            </div>
          </div>

          <button 
            onClick={resumeGame}
            className="px-8 py-4 rounded-2xl bg-neon-blue text-black font-display font-black uppercase tracking-widest hover:bg-white transition-all"
          >
            Resume
          </button>
        </div>
      )}
    </div>
  );
};
