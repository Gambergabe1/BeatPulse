import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { Disc3 } from 'lucide-react';

interface IntroProps {
  onComplete: () => void;
}

export const Intro: React.FC<IntroProps> = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 3000); // 3 seconds intro
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,243,255,0.11),transparent_38%)]" />
      {/* Particle Effects */}
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-neon-blue rounded-full"
          initial={{ 
            x: Math.random() * window.innerWidth, 
            y: Math.random() * window.innerHeight,
            opacity: 0 
          }}
          animate={{ 
            y: [null, -100],
            opacity: [0, 1, 0]
          }}
          transition={{ 
            duration: 2 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2
          }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ 
          opacity: 1, 
          scale: [1, 1.05, 1],
          textShadow: [
            "0 0 10px #00f3ff, 0 0 20px #00f3ff",
            "0 0 20px #00f3ff, 0 0 40px #00f3ff",
            "0 0 10px #00f3ff, 0 0 20px #00f3ff"
          ]
        }}
        transition={{ 
          duration: 2, 
          repeat: Infinity 
        }}
        className="relative flex flex-col items-center px-6 text-center"
      >
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} className="mb-6 rounded-full border border-neon-blue/30 bg-neon-blue/10 p-4 text-neon-blue">
          <Disc3 className="h-10 w-10" />
        </motion.div>
        <h1 className="text-6xl md:text-8xl font-display font-black text-white italic tracking-tighter uppercase">
          Beat<span className="text-neon-pink">Pulse</span>
        </h1>
        <p className="mt-4 text-[10px] font-black uppercase tracking-[0.4em] text-white/35">Syncing the rhythm network</p>
        <div className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-white/10"><motion.div initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} className="h-full w-1/2 bg-gradient-to-r from-transparent via-neon-blue to-transparent" /></div>
      </motion.div>
    </div>
  );
};
