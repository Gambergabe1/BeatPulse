import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, RotateCcw, Home, Star, Share2, Activity, List, Music, Save } from 'lucide-react';
import { ReplayEvent, SavedReplay } from '../types';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface HighScore {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

interface GameOverScreenProps {
  score: number;
  accuracy: number;
  maxCombo: number;
  songName: string;
  artist: string;
  songId?: string;
  difficulty: number;
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  audioBuffer: AudioBuffer;
  onRetry: () => void;
  onHome: () => void;
  onReplay: () => void;
  isReplay: boolean;
  replayEvents: ReplayEvent[];
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({
  score,
  accuracy,
  maxCombo,
  songName,
  artist,
  songId,
  difficulty,
  density,
  laneVariety,
  sliderProbability,
  audioBuffer,
  onRetry,
  onHome,
  onReplay,
  isReplay,
  replayEvents
}) => {
  const getGrade = () => {
    if (accuracy >= 95) return { label: 'S', color: 'text-neon-blue', shadow: 'shadow-neon-blue/50' };
    if (accuracy >= 85) return { label: 'A', color: 'text-neon-green', shadow: 'shadow-neon-green/50' };
    if (accuracy >= 75) return { label: 'B', color: 'text-neon-purple', shadow: 'shadow-neon-purple/50' };
    if (accuracy >= 60) return { label: 'C', color: 'text-neon-pink', shadow: 'shadow-neon-pink/50' };
    return { label: 'F', color: 'text-white/40', shadow: 'shadow-transparent' };
  };

  const grade = getGrade();
  const backgroundSeed = encodeURIComponent(songName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [highScores, setHighScores] = useState<HighScore[]>([]);

  const hasSavedRef = useRef(false);

  const handleSaveReplay = async () => {
    if (isSaved || !songId) return;
    
    try {
      const newReplay = {
        id: Date.now().toString(),
        songId,
        songName,
        artist,
        difficulty,
        density: density ?? difficulty,
        laneVariety: laneVariety ?? difficulty,
        sliderProbability: sliderProbability ?? 0.3,
        score,
        accuracy,
        date: new Date().toLocaleDateString(),
        createdAt: new Date().toISOString(),
        events: replayEvents
      };
      
      await addDoc(collection(db, 'replays'), newReplay);
      setIsSaved(true);
    } catch (err) {
      console.error("Failed to save replay:", err);
    }
  };

  useEffect(() => {
    if (hasSavedRef.current) return;
    hasSavedRef.current = true;

    const fetchScores = async () => {
      if (songId) {
        try {
          const songRef = doc(db, 'songs', songId);
          const songSnap = await getDoc(songRef);
          if (songSnap.exists()) {
            setHighScores(songSnap.data().scores || []);
          }
        } catch (err) {
          console.error("Failed to fetch high scores:", err);
        }
      }
    };
    fetchScores();
  }, [songId]);

  const handleShare = async () => {
    const shareText = `I just scored ${score.toLocaleString()} (${accuracy.toFixed(1)}%) with rank ${grade.label} on ${songName} in BeatPulse! 🎵🔥`;
    const shareUrl = window.location.href;

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
        <img 
          src={`https://picsum.photos/seed/${backgroundSeed}/1920/1080`}
          alt=""
          className="w-full h-full object-cover blur-[80px] opacity-20 scale-110"
          referrerPolicy="no-referrer"
        />
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
            Session Complete
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
                <div className="text-4xl font-display font-black text-white">{score.toLocaleString()}</div>
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
          </div>
        </div>

        {/* Leaderboard Section */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-12"
        >
          <div className="flex items-center gap-3 mb-6">
            <List className="w-5 h-5 text-neon-purple" />
            <h3 className="font-display font-bold text-white uppercase tracking-widest text-sm">Top Scores</h3>
          </div>
          
          <div className="space-y-3">
            {highScores.map((hs, idx) => (
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
                  </div>
                </div>
                <div className="text-neon-green font-mono text-sm">{hs.accuracy.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
          <button 
            onClick={onRetry}
            className="w-full px-6 py-5 rounded-full bg-white text-black font-display font-black uppercase tracking-widest hover:bg-neon-blue hover:text-white transition-all flex items-center justify-center gap-3 group text-sm"
          >
            <RotateCcw className="w-5 h-5 group-hover:rotate-[-180deg] transition-transform duration-500" />
            Retry
          </button>
          
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
          ) : (
            <button 
              onClick={onReplay}
              className="w-full px-6 py-5 rounded-full bg-neon-blue text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-3 group text-sm"
            >
              <Music className="w-5 h-5" />
              Watch Again
            </button>
          )}

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
