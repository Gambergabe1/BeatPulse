import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, RotateCcw, Home, Star, Share2, Activity, List, Music, Save, Sparkles, Gift, Gem, Palette, BadgeCheck, CheckCircle2 } from 'lucide-react';
import { GameplayOptions, JudgementSummary, ReplayEvent } from '../types';
import { getGlobalScores, getSocialSnapshot, getSongById, requestMultiplayerRematch, saveReplay, ScoreRecord, MultiplayerRoom } from '../services/pulseApi';
import { getChartSettingsForDifficulty } from '../utils/chartSettings';
import { LevelReward, MissionProgress } from '../utils/progression';

type HighScore = ScoreRecord;

const rewardVisuals: Record<LevelReward['kind'], { icon: React.ElementType; className: string }> = {
  shards: { icon: Gem, className: 'border-neon-blue/30 bg-neon-blue/10 text-neon-blue' },
  theme: { icon: Palette, className: 'border-neon-purple/30 bg-neon-purple/10 text-neon-purple' },
  avatar: { icon: Sparkles, className: 'border-neon-pink/30 bg-neon-pink/10 text-neon-pink' },
  badge: { icon: BadgeCheck, className: 'border-neon-orange/30 bg-neon-orange/10 text-neon-orange' },
  title: { icon: Trophy, className: 'border-neon-green/30 bg-neon-green/10 text-neon-green' },
  frame: { icon: Star, className: 'border-white/20 bg-white/10 text-white' },
};

const useAnimatedNumber = (target: number, duration = 850) => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, target]);

  return value;
};

interface GameOverScreenProps {
  score: number;
  accuracy: number;
  maxCombo: number;
  fullCombo: boolean;
  songName: string;
  artist: string;
  songId?: string;
  difficulty: number;
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  stamina?: number;
  audioBuffer: AudioBuffer;
  onRetry: () => void;
  onHome: () => void;
  onReplay: () => void;
  isReplay: boolean;
  replayEvents: ReplayEvent[];
  judgements: JudgementSummary;
  gameplay: GameplayOptions;
  earnedXp?: number;
  levelUpRewards?: LevelReward[];
  previousLevel?: number;
  completedMissions?: MissionProgress[];
  mapRating?: number;
  onRateMap?: (rating: number) => void;
  initialHighScores?: HighScore[];
  leaderboardStatus?: 'idle' | 'saving' | 'saved' | 'failed' | 'unranked';
  leaderboardError?: string;
  multiplayerRoom?: MultiplayerRoom;
  playerId?: string;
  playerToken?: string;
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({
  score,
  accuracy,
  maxCombo,
  fullCombo,
  songName,
  artist,
  songId,
  difficulty,
  density,
  laneVariety,
  sliderProbability,
  stamina,
  audioBuffer,
  onRetry,
  onHome,
  onReplay,
  isReplay,
  replayEvents,
  judgements,
  gameplay,
  earnedXp,
  levelUpRewards = [],
  previousLevel,
  completedMissions = [],
  mapRating,
  onRateMap,
  initialHighScores = [],
  leaderboardStatus = 'idle',
  leaderboardError,
  multiplayerRoom,
  playerId,
  playerToken,
}) => {
  const difficultyProfile = getChartSettingsForDifficulty(difficulty);
  const getGrade = () => {
    if (accuracy >= 95) return { label: 'S', color: 'text-neon-blue', shadow: 'shadow-neon-blue/50' };
    if (accuracy >= 85) return { label: 'A', color: 'text-neon-green', shadow: 'shadow-neon-green/50' };
    if (accuracy >= 75) return { label: 'B', color: 'text-neon-purple', shadow: 'shadow-neon-purple/50' };
    if (accuracy >= 60) return { label: 'C', color: 'text-neon-pink', shadow: 'shadow-neon-pink/50' };
    return { label: 'F', color: 'text-white/40', shadow: 'shadow-transparent' };
  };

  const grade = getGrade();
  const displayedScore = useAnimatedNumber(score);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [savedReplayId, setSavedReplayId] = useState<string | null>(null);
  const [highScores, setHighScores] = useState<HighScore[]>(initialHighScores);
  const [matchRoom, setMatchRoom] = useState(multiplayerRoom);
  const [personalBest, setPersonalBest] = useState<{ score: number; accuracy: number; maxCombo: number } | null>(null);
  const [previousPersonalBest, setPreviousPersonalBest] = useState<{ score: number; accuracy: number; maxCombo: number } | null>(null);
  const [isNewPersonalBest, setIsNewPersonalBest] = useState(false);
  const totalJudgements = judgements.perfect + judgements.great + judgements.miss;
  const timingBuckets = useMemo(() => {
    const buckets = Array.from({ length: 9 }, () => 0);
    judgements.timingOffsets.forEach((offset) => {
      const index = Math.max(0, Math.min(buckets.length - 1, Math.floor(((offset + 160) / 320) * buckets.length)));
      buckets[index] += 1;
    });
    return buckets;
  }, [judgements.timingOffsets]);
  const timingPeak = Math.max(1, ...timingBuckets);
  const averageOffset = judgements.timingOffsets.length
    ? judgements.timingOffsets.reduce((total, value) => total + value, 0) / judgements.timingOffsets.length
    : 0;
  const matchStandings = useMemo(() => matchRoom ? [...matchRoom.participants].sort((left, right) => right.score - left.score) : [], [matchRoom]);
  const selfMatchPosition = matchStandings.findIndex((player) => player.playerId === playerId);
  const leaderGap = selfMatchPosition > 0 ? Math.max(0, matchStandings[0].score - (matchStandings[selfMatchPosition]?.score || 0)) : 0;
  const hasRematchVoted = Boolean(matchRoom?.rematchVotes?.includes(playerId || ''));

  const handleRematchVote = async () => {
    if (!matchRoom || !playerId || !playerToken || !matchRoom.participants.some((player) => player.playerId === playerId)) return;
    try {
      const username = localStorage.getItem('username') || 'Anonymous';
      setMatchRoom(await requestMultiplayerRematch({ playerId, playerToken, username }, matchRoom.id));
    } catch (error) {
      console.warn('Failed to vote for a rematch:', error);
    }
  };

  const handleSaveReplay = async () => {
    if (isSaved || !songId) return;
    
    try {
      const newReplay = {
        id: Date.now().toString(),
        songId,
        songName,
        artist,
        difficulty,
        density: density ?? difficultyProfile.density,
        laneVariety: laneVariety ?? difficultyProfile.laneVariety,
        sliderProbability: sliderProbability ?? difficultyProfile.sliderProbability,
        stamina: stamina ?? difficultyProfile.stamina,
        score,
        accuracy,
        date: new Date().toLocaleDateString(),
        createdAt: new Date().toISOString(),
        events: replayEvents,
        judgements,
      };
      
      const savedReplay = await saveReplay(newReplay);
      setIsSaved(true);
      setSavedReplayId(savedReplay.id);
    } catch (err) {
      console.error("Failed to save replay:", err);
    }
  };

  useEffect(() => {
    if (!songId || isReplay || gameplay.practiceMode || gameplay.hiddenNotes || gameplay.mirrorLanes || gameplay.randomLanes) return;
    const key = `beatpulse_personal_best:${songId}`;
    let previous: { score: number; accuracy: number; maxCombo: number } | null = null;
    try {
      const stored = localStorage.getItem(key);
      if (stored) previous = JSON.parse(stored);
    } catch {
      previous = null;
    }
    const isNewBest = !previous || score > previous.score || (score === previous.score && accuracy > previous.accuracy);
    const next = isNewBest ? { score, accuracy, maxCombo } : previous;
    if (isNewBest) localStorage.setItem(key, JSON.stringify(next));
    setPreviousPersonalBest(previous);
    setPersonalBest(next);
    setIsNewPersonalBest(isNewBest);
  }, [accuracy, gameplay.hiddenNotes, gameplay.mirrorLanes, gameplay.practiceMode, gameplay.randomLanes, isReplay, maxCombo, score, songId]);

  useEffect(() => {
    if (initialHighScores.length > 0) {
      setHighScores(initialHighScores);
    }
  }, [initialHighScores]);

  useEffect(() => {
    let isCancelled = false;

    const fetchScores = async () => {
      if (!songId || initialHighScores.length > 0) return;

      try {
        const song = await getSongById(songId);
        if (!isCancelled) {
          setHighScores(song.scores || []);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to fetch high scores:", err);
        }
      }
    };

    fetchScores();
    return () => {
      isCancelled = true;
    };
  }, [songId, initialHighScores]);

  useEffect(() => {
    if (leaderboardStatus !== 'saved') return;

    let isCancelled = false;
    const normalized = (value: string) => value.trim().toLocaleLowerCase();

    const refreshLeaderboard = async () => {
      try {
        const { scores } = await getGlobalScores({ limit: 500, offset: 0 });
        const matchingScores = scores
          .filter(entry =>
            songId
              ? entry.songId === songId
              : normalized(entry.songName) === normalized(songName) && normalized(entry.artist) === normalized(artist)
          )
          .slice(0, 5)
          .map(entry => ({
            score: entry.score,
            accuracy: entry.accuracy,
            date: entry.date,
            username: entry.username,
            fullCombo: entry.fullCombo,
          }));

        if (!isCancelled) setHighScores(matchingScores);
      } catch (error) {
        if (!isCancelled) console.error('Failed to refresh the result leaderboard:', error);
      }
    };

    refreshLeaderboard();
    return () => { isCancelled = true; };
  }, [artist, leaderboardStatus, songId, songName]);

  useEffect(() => {
    setMatchRoom(multiplayerRoom);
  }, [multiplayerRoom]);

  useEffect(() => {
    if (!multiplayerRoom || !playerId || !playerToken) return;
    let cancelled = false;
    const refreshStandings = async () => {
      try {
        const snapshot = await getSocialSnapshot({
          playerId,
          playerToken,
          username: localStorage.getItem('username') || 'Anonymous',
        });
        if (!cancelled && snapshot.activeRoom?.id === multiplayerRoom.id) {
          setMatchRoom(snapshot.activeRoom);
        }
      } catch (error) {
        console.warn('Failed to refresh multiplayer standings:', error);
      }
    };
    refreshStandings();
    const timer = window.setInterval(refreshStandings, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [multiplayerRoom?.id, playerId, playerToken]);

  const handleShare = async () => {
    const shareText = `I just scored ${score.toLocaleString()} (${accuracy.toFixed(1)}%) with rank ${grade.label} on ${songName} in BeatPulse! 🎵🔥`;
    const shareUrl = savedReplayId
      ? `${window.location.origin}${window.location.pathname}?replay=${encodeURIComponent(savedReplayId)}`
      : window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'BeatPulse Results',
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Error copying to clipboard:', err);
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number }[] = [];
    
    // Calculate song energy for particle density
    const data = audioBuffer.getChannelData(0);
    let totalEnergy = 0;
    for (let i = 0; i < data.length; i += 100) {
      totalEnergy += Math.abs(data[i]);
    }
    const avgEnergy = totalEnergy / (data.length / 100);
    const particleCount = Math.min(150, Math.floor(avgEnergy * 1000));

    const initParticles = (width: number, height: number) => {
      particles.length = 0;
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          size: Math.random() * 2 + 1,
          alpha: Math.random() * 0.5 + 0.2
        });
      }
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        initParticles(canvas.width, canvas.height);
      }

      const width = canvas.width;
      const height = canvas.height;
      const amp = height / 2;
      const step = Math.ceil(data.length / width);
      const time = Date.now() / 1000;

      ctx.clearRect(0, 0, width, height);
      
      // Draw Particles with reactivity
      particles.forEach(p => {
        // Sample audio data at particle's relative X position
        const dataIdx = Math.floor((p.x / width) * data.length);
        const audioIntensity = Math.abs(data[dataIdx] || 0);
        
        // Particles move faster and grow in high-intensity areas
        const speedMult = 1 + audioIntensity * 15;
        p.x += p.vx * speedMult;
        p.y += p.vy * speedMult;
        
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        const dynamicSize = p.size * (1 + audioIntensity * 4);
        const dynamicAlpha = Math.min(1, p.alpha * (1 + audioIntensity * 3));

        ctx.beginPath();
        ctx.arc(p.x, p.y, dynamicSize, 0, Math.PI * 2);
        
        // Color shifts slightly based on intensity
        const hue = 180 + audioIntensity * 60; // Shift from cyan towards purple
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${dynamicAlpha})`;
        
        if (audioIntensity > 0.3) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = `hsla(${hue}, 100%, 50%, 0.8)`;
        }
        
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Draw smooth reactive waveform
      ctx.beginPath();
      ctx.moveTo(0, amp);

      const wavePulse = Math.sin(time * 3) * 10;
      
      for (let i = 0; i < width; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) {
          const datum = Math.abs(data[(i * step) + j]);
          if (datum > max) max = datum;
        }
        
        // Waveform height reacts to global time and local data
        const localPulse = Math.sin(time * 5 + i * 0.02) * 5;
        const yOffset = (max * amp * 0.8) + wavePulse + localPulse;
        ctx.lineTo(i, amp - yOffset);
      }

      for (let i = width - 1; i >= 0; i--) {
        let max = 0;
        for (let j = 0; j < step; j++) {
          const datum = Math.abs(data[(i * step) + j]);
          if (datum > max) max = datum;
        }
        const localPulse = Math.sin(time * 5 + i * 0.02) * 5;
        const yOffset = (max * amp * 0.8) + wavePulse + localPulse;
        ctx.lineTo(i, amp + yOffset);
      }

      ctx.closePath();
      
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#00f3ff');
      gradient.addColorStop(0.5, '#bc13fe');
      gradient.addColorStop(1, '#00f3ff');
      
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.3 + Math.sin(time * 2) * 0.1; // Pulsing opacity
      ctx.fill();

      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#00f3ff';
      ctx.stroke();
      ctx.shadowBlur = 0;

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener('resize', draw);
    
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', draw);
    };
  }, [audioBuffer]);

  return (
    <div className="min-h-screen w-full bg-[#050505] flex flex-col items-center justify-start md:justify-center p-6 md:p-12 font-sans relative overflow-y-auto overflow-x-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute left-[-10%] top-[-20%] h-[55%] w-[55%] rounded-full bg-neon-blue/10 blur-[140px]" />
        <div className="absolute bottom-[-25%] right-[-10%] h-[60%] w-[60%] rounded-full bg-neon-purple/10 blur-[150px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black/80 to-black" />
        <div className="absolute inset-0 bg-neon-blue/5 mix-blend-overlay" />
      </div>

      {/* Waveform Visualizer Background */}
      <div className="absolute inset-0 z-0 flex items-center justify-center opacity-30 pointer-events-none">
        <div className="w-full h-64 relative">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full"
          />
          <motion.div 
            animate={{ 
              x: ['-100%', '100%'],
            }}
            transition={{ 
              duration: 3, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-1/2"
          />
        </div>
      </div>

      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="max-w-2xl w-full z-10"
      >
        <div className="text-center mb-12">
          <motion.h2 
            initial={{ letterSpacing: "0.2em" }}
            animate={{ letterSpacing: "0.8em" }}
            className="text-xs font-black text-neon-blue uppercase mb-4 opacity-80"
          >
            {multiplayerRoom ? 'Multiplayer Complete' : 'Session Complete'}
          </motion.h2>
          <h1 className="text-5xl md:text-7xl font-display font-black text-white tracking-tighter italic uppercase">
            Game Over
          </h1>
          <div className="mt-4 flex flex-col items-center gap-1">
            <p className="text-white font-display font-bold text-xl uppercase tracking-widest">
              {songName}
            </p>
            {artist && artist !== "Unknown Artist" && (
              <p className="text-neon-blue font-mono text-sm uppercase tracking-[0.3em] opacity-60">
                {artist}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Grade Section */}
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="md:col-span-1 bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col items-center justify-center relative overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em] mb-4">Rank</span>
            <div className={`text-9xl font-display font-black italic ${grade.color} drop-shadow-2xl`}>
              {grade.label}
            </div>
          </motion.div>

          {/* Stats Section */}
          <div className="md:col-span-2 grid grid-cols-1 gap-4">
            <motion.div 
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="bg-white/5 border border-white/10 rounded-3xl p-6 flex items-center justify-between"
            >
              <div>
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em]">Final Score</span>
                <div className="text-4xl font-display font-black text-white tabular-nums">{displayedScore.toLocaleString()}</div>
              </div>
              <Trophy className="w-8 h-8 text-neon-blue opacity-50" />
            </motion.div>

            <div className="grid grid-cols-2 gap-4">
              <motion.div 
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="bg-white/5 border border-white/10 rounded-3xl p-6"
              >
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em]">Accuracy</span>
                <div className="text-3xl font-display font-black text-neon-green">{accuracy.toFixed(1)}%</div>
              </motion.div>
              <motion.div 
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="bg-white/5 border border-white/10 rounded-3xl p-6"
              >
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em]">Max Combo</span>
                <div className="text-3xl font-display font-black text-neon-pink">{maxCombo}</div>
              </motion.div>
            </div>
            {fullCombo && (
              <div className="rounded-2xl border border-neon-orange/40 bg-neon-orange/10 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.2em] text-neon-orange">
                Full Combo
              </div>
            )}
          </div>
        </div>

        {levelUpRewards.length > 0 && <motion.section initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.48 }} className="mb-6 overflow-hidden rounded-3xl border border-neon-orange/35 bg-gradient-to-br from-neon-orange/[0.13] via-neon-purple/[0.08] to-black/20 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="rounded-2xl border border-neon-orange/35 bg-neon-orange/10 p-3 text-neon-orange"><Gift className="h-6 w-6" /></div><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-neon-orange">Level up rewards</p><h3 className="mt-1 font-display text-2xl font-black text-white">Level {previousLevel || Math.max(1, levelUpRewards[0].level - 1)} → Level {Math.max(...levelUpRewards.map((reward) => reward.level))}</h3><p className="mt-1 text-xs text-white/45">Your new items are ready in the Profile loadout.</p></div></div><span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/50">{levelUpRewards.length} new reward{levelUpRewards.length === 1 ? '' : 's'}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{levelUpRewards.map((reward) => { const visual = rewardVisuals[reward.kind]; const RewardIcon = visual.icon; return <div key={reward.id} className={`rounded-2xl border p-4 ${visual.className}`}><div className="flex items-start gap-3"><RewardIcon className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-display text-sm font-black text-white">{reward.label}</p><p className="mt-1 text-xs leading-relaxed text-white/55">{reward.description}</p></div></div></div>; })}</div></motion.section>}

        {completedMissions.length > 0 && <motion.section initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.52 }} className="mb-6 rounded-3xl border border-neon-blue/30 bg-neon-blue/[0.08] p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-neon-blue/15 p-3 text-neon-blue"><CheckCircle2 className="h-6 w-6" /></div><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-neon-blue">Mission complete</p><h3 className="mt-1 font-display text-xl font-black text-white">Rewards are ready to claim</h3><p className="mt-1 text-xs text-white/45">Open Missions from the Progress tab to claim your XP and Pulse Shards.</p></div></div><div className="mt-4 flex flex-wrap gap-2">{completedMissions.map((mission) => <span key={mission.id} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-bold text-white/65">{mission.label} · +{mission.rewardShards} Shards</span>)}</div></motion.section>}

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <motion.section initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.54 }} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Grade breakdown</p><p className="mt-1 text-xs text-white/45">{totalJudgements || 0} judged inputs</p></div>{fullCombo && <span className="rounded-full border border-neon-orange/35 bg-neon-orange/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-neon-orange">FC</span>}</div>
            <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-2xl bg-neon-blue/10 p-3"><p className="font-display text-2xl font-black text-neon-blue">{judgements.perfect}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/40">Perfect</p></div><div className="rounded-2xl bg-neon-green/10 p-3"><p className="font-display text-2xl font-black text-neon-green">{judgements.great}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/40">Great</p></div><div className="rounded-2xl bg-neon-pink/10 p-3"><p className="font-display text-2xl font-black text-neon-pink">{judgements.miss}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/40">Miss</p></div></div>
            {judgements.holdBreak > 0 && <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-wider text-white/35">Includes {judgements.holdBreak} hold break{judgements.holdBreak === 1 ? '' : 's'}.</p>}
          </motion.section>

          <motion.section initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.58 }} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Timing spread</p><p className="mt-1 text-xs text-white/45">{judgements.timingOffsets.length ? `${averageOffset > 8 ? 'Late' : averageOffset < -8 ? 'Early' : 'Centered'} by ${Math.abs(Math.round(averageOffset))} ms` : 'No timing data yet'}</p></div><span className="font-mono text-[10px] text-white/30">EARLY → LATE</span></div>
            <div className="flex h-16 items-end gap-1 rounded-2xl border border-white/5 bg-black/20 px-3 py-2">{timingBuckets.map((count, index) => <div key={index} className={`min-w-0 flex-1 rounded-t-sm ${index === 4 ? 'bg-neon-blue' : 'bg-neon-purple/60'}`} style={{ height: `${Math.max(4, (count / timingPeak) * 100)}%` }} />)}</div>
            <p className="mt-3 text-[10px] text-white/35">Tighter clusters around the center mean more consistent timing.</p>
          </motion.section>
        </div>

        {(isNewPersonalBest || personalBest) && <motion.div initial={isNewPersonalBest ? { scale: 0.94, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} className={`mb-6 rounded-2xl border px-5 py-4 ${isNewPersonalBest ? 'border-neon-green/35 bg-neon-green/10 shadow-[0_0_32px_rgba(57,255,20,0.12)]' : 'border-white/10 bg-white/[0.035]'}`}><div className="flex items-center justify-between gap-4"><div><p className={`text-[10px] font-black uppercase tracking-[0.2em] ${isNewPersonalBest ? 'text-neon-green' : 'text-white/40'}`}>{isNewPersonalBest ? 'New personal best' : 'Personal best'}</p><p className="mt-1 text-sm text-white/65">{personalBest?.score.toLocaleString()} · {personalBest?.accuracy.toFixed(1)}% · {personalBest?.maxCombo} combo</p>{isNewPersonalBest && <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-neon-green/75">{previousPersonalBest ? `+${Math.max(0, score - previousPersonalBest.score).toLocaleString()} score over your last best` : 'Your first score on this chart has been saved.'}</p>}{!isNewPersonalBest && personalBest && <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-white/35">{Math.max(0, personalBest.score - score).toLocaleString()} points to beat your best</p>}</div>{isNewPersonalBest && <motion.div animate={{ rotate: [0, -10, 10, 0], scale: [1, 1.18, 1] }} transition={{ duration: 0.65, delay: 0.2 }} className="rounded-2xl bg-neon-green/15 p-3"><Sparkles className="h-6 w-6 text-neon-green" /></motion.div>}</div></motion.div>}

        {(earnedXp || (songId && onRateMap)) && <div className="mb-6 grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-neon-purple/25 bg-neon-purple/[0.07] px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-purple">Pulse progress</p><p className="mt-1 font-display text-2xl font-black text-white">{earnedXp ? `+${earnedXp} XP` : 'Replay analysis'}</p><p className="mt-1 text-xs text-white/40">Complete runs unlock new themes and achievement milestones.</p></div>{songId && onRateMap && <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Rate this map</p><div className="mt-2 flex items-center gap-1">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" aria-label={`Rate ${rating} out of 5`} aria-pressed={mapRating === rating} onClick={() => onRateMap(rating)} className={`rounded-lg p-1 transition ${rating <= (mapRating || 0) ? 'text-neon-orange' : 'text-white/20 hover:text-white/60'}`}><Star className={`h-5 w-5 ${rating <= (mapRating || 0) ? 'fill-current' : ''}`} /></button>)}</div><p className="mt-1 text-xs text-white/40">{mapRating ? `Your rating: ${mapRating}/5` : 'Your private map rating.'}</p></div>}</div>}

        {matchRoom && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="mb-6 rounded-3xl border border-neon-purple/25 bg-neon-purple/[0.07] p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3"><Activity className="h-5 w-5 text-neon-purple" /><h3 className="font-display text-sm font-bold uppercase tracking-widest">Match standings</h3></div>
              <span className="font-mono text-xs font-bold tracking-[0.2em] text-neon-blue">{matchRoom.code}</span>
            </div>
            {selfMatchPosition >= 0 && <div className="mb-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-xs text-white/50">You finished <span className="font-black text-white">#{selfMatchPosition + 1}</span>{selfMatchPosition > 0 ? <> · <span className="font-mono text-neon-orange">{leaderGap.toLocaleString()}</span> behind the leader</> : <> · <span className="text-neon-green">You led the room</span></>}</div>}
            <div className="space-y-2">
              {[...matchRoom.participants].sort((a, b) => b.score - a.score).map((player, index) => (
                <div key={player.playerId} className={`flex items-center justify-between rounded-2xl border p-4 ${player.playerId === playerId ? 'border-neon-blue/40 bg-neon-blue/10' : 'border-white/5 bg-black/20'}`}>
                  <div className="flex items-center gap-4"><span className={`font-display text-xl font-black ${index === 0 ? 'text-neon-orange' : 'text-white/30'}`}>#{index + 1}</span><div><p className="font-bold">{player.username}{player.playerId === playerId ? ' · You' : ''}</p><p className="text-[10px] uppercase tracking-wider text-white/35">{player.finished ? 'Finished' : 'Still playing'}</p></div></div>
                  <div className="text-right"><p className="font-mono font-bold text-neon-blue">{player.score.toLocaleString()}</p><p className="text-[10px] text-neon-green">{player.accuracy.toFixed(1)}%</p></div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Leaderboard Section */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-12"
        >
          <div className="flex items-center gap-3 mb-6">
            <List className="w-5 h-5 text-neon-purple" />
            <div>
              <h3 className="font-display font-bold text-white uppercase tracking-widest text-sm">
                {songId ? 'Song Top Scores' : 'Local Song Scores'}
              </h3>
              {leaderboardStatus === 'saving' && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-neon-blue">Updating leaderboard…</p>}
              {leaderboardStatus === 'saved' && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-neon-green">Song + global leaderboards updated</p>}
              {leaderboardStatus === 'unranked' && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-neon-orange">Practice and modifier runs stay off leaderboards</p>}
              {leaderboardStatus === 'failed' && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-neon-pink">{leaderboardError || 'Leaderboard update failed'}</p>}
            </div>
          </div>
          
          <div className="space-y-3">
            {highScores.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center text-xs font-bold uppercase tracking-widest text-white/35">
                {leaderboardStatus === 'saving' ? 'Saving your score…' : leaderboardStatus === 'unranked' ? 'Practice run — not submitted.' : leaderboardStatus === 'failed' ? 'Your score was not saved.' : 'No scores yet'}
              </p>
            ) : highScores.map((hs, idx) => (
              <div 
                key={idx} 
                className={`flex items-center justify-between p-4 rounded-2xl border ${
                  hs.score === score && hs.accuracy === accuracy 
                    ? 'bg-neon-purple/20 border-neon-purple/50' 
                    : 'bg-white/5 border-white/5'
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-white/40">0{idx + 1}</span>
                  <div>
                    <div className="text-white font-bold">{hs.score.toLocaleString()}</div>
                    <div className="text-[10px] text-white/40 uppercase tracking-tighter">{hs.username} - {hs.date}</div>
                    {hs.fullCombo && <div className="mt-1 inline-flex rounded-full border border-neon-orange/35 bg-neon-orange/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-neon-orange">Full Combo</div>}
                  </div>
                </div>
                <div className="text-neon-green font-mono text-sm">{hs.accuracy.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-4 w-full">
          {!multiplayerRoom && <button 
            onClick={onRetry}
            className="w-full px-6 py-5 rounded-full bg-white text-black font-display font-black uppercase tracking-widest hover:bg-neon-blue hover:text-white transition-all flex items-center justify-center gap-3 group text-sm"
          >
            <RotateCcw className="w-5 h-5 group-hover:rotate-[-180deg] transition-transform duration-500" />
            Retry
          </button>}

          {matchRoom && matchRoom.participants.some((player) => player.playerId === playerId) && <button onClick={handleRematchVote} className={`w-full px-6 py-5 rounded-full font-display font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 text-sm ${hasRematchVoted ? 'border border-neon-green/35 bg-neon-green/10 text-neon-green' : 'bg-neon-blue text-black hover:bg-white'}`}><RotateCcw className="w-5 h-5" />{hasRematchVoted ? `Voted ${matchRoom.rematchVotes?.length || 0}/${matchRoom.participants.length}` : `Vote rematch ${matchRoom.rematchVotes?.length || 0}/${matchRoom.participants.length}`}</button>}
          
          {!isReplay ? (
            <button 
              onClick={handleSaveReplay}
              disabled={isSaved || !songId}
              title={!songId ? "Cannot save replays for local files" : ""}
              className={`w-full px-6 py-5 rounded-full font-display font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 group text-sm ${
                isSaved 
                  ? 'bg-neon-green/20 text-neon-green border border-neon-green/50 cursor-default'
                  : !songId
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-neon-blue text-white hover:bg-white hover:text-black'
              }`}
            >
              <Save className="w-5 h-5" />
              {isSaved ? 'Saved' : 'Save Replay'}
            </button>
          ) : null}

          {replayEvents.length > 0 ? (
            <button 
              onClick={onReplay}
              className="w-full px-6 py-5 rounded-full bg-neon-blue text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-3 group text-sm"
            >
              <Music className="w-5 h-5" />
              {isReplay ? 'Watch Again' : 'Watch Replay'}
            </button>
          ) : null}

          <button 
            onClick={handleShare}
            className="w-full px-6 py-5 rounded-full bg-neon-purple text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-3 group text-sm"
          >
            <Share2 className={`w-5 h-5 ${isCopied ? 'scale-0' : 'scale-100'} transition-transform`} />
            {isCopied ? 'Copied!' : 'Share'}
          </button>
          <button 
            onClick={onHome}
            className="w-full px-6 py-5 rounded-full bg-white/5 border border-white/10 text-white font-display font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-3 text-sm"
          >
            <Home className="w-5 h-5" />
            Menu
          </button>
        </div>
      </motion.div>
    </div>
  );
};
