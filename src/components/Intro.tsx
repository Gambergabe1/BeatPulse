import React, { useEffect } from 'react';
import { motion } from 'motion/react';

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

      {/* Pulsing Title */}
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
        className="text-5xl md:text-7xl font-display font-black text-white italic tracking-tighter"
      >
        BeatPulse Rhythm
      </motion.div>
    </div>
  );
};
