import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Zap, Target, Trophy, ChevronRight, Check, Users } from 'lucide-react';

interface TutorialProps {
  onComplete: () => void;
}

export const Tutorial: React.FC<TutorialProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Welcome to BeatPulse",
      description: "Get ready to experience rhythm evolution. Let's quickly go over how to play.",
      icon: <Music className="w-16 h-16 text-neon-blue" />,
      color: "text-neon-blue"
    },
    {
      title: "Hit the Notes",
      description: "Press D, F, J, or K as notes cross the target. For trails, keep holding; when a trail bends, move to the lane it points toward and release on its tail.",
      icon: <Target className="w-16 h-16 text-neon-pink" />,
      color: "text-neon-pink"
    },
    {
      title: "Build Your Combo",
      description: "Hit notes consecutively without missing to build your combo multiplier. A higher combo means massive scores!",
      icon: <Zap className="w-16 h-16 text-neon-purple" />,
      color: "text-neon-purple"
    },
    {
      title: "Upload & Compete",
      description: "Upload any MP3/WAV file to auto-generate beats. Save it to the community and compete on the global leaderboard!",
      icon: <Trophy className="w-16 h-16 text-neon-green" />,
      color: "text-neon-green"
    },
    {
      title: "Bring Your Crew",
      description: "Add friends by code, message them, and race together in live rooms with shared countdowns and real-time standings.",
      icon: <Users className="w-16 h-16 text-neon-blue" />,
      color: "text-neon-blue"
    }
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      localStorage.setItem('hasSeenTutorial', 'true');
      onComplete();
    }
  };

  return (
    <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-neon-blue/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-neon-purple/10 blur-[120px] rounded-full" />
      </div>

      <div className="z-10 w-full max-w-lg">
        <div className="flex justify-between items-center mb-8">
          <div className="flex gap-2">
            {steps.map((_, idx) => (
              <div 
                key={idx} 
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === step ? 'w-8 bg-white' : idx < step ? 'w-4 bg-white/50' : 'w-4 bg-white/20'}`}
              />
            ))}
          </div>
          <button 
            onClick={() => {
              localStorage.setItem('hasSeenTutorial', 'true');
              onComplete();
            }}
            className="text-xs font-bold text-white/40 hover:text-white uppercase tracking-widest transition-colors"
          >
            Skip
          </button>
        </div>
        <p className="mb-3 text-right font-mono text-[10px] font-bold uppercase tracking-widest text-white/25">Step {step + 1} / {steps.length}</p>

        <div className="relative h-[400px] w-full bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col items-center text-center overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center h-full w-full"
            >
              <div className={`mb-8 p-6 rounded-3xl bg-white/5 border border-white/10 ${steps[step].color}`}>
                {steps[step].icon}
              </div>
              <h2 className="text-3xl font-display font-black uppercase tracking-tighter mb-4">
                {steps[step].title}
              </h2>
              <p className="text-white/60 text-sm leading-relaxed max-w-sm">
                {steps[step].description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <button 
          onClick={handleNext}
          className="mt-8 w-full py-4 rounded-2xl bg-white text-black font-display font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {step === steps.length - 1 ? (
            <>
              Let's Play <Check className="w-5 h-5" />
            </>
          ) : (
            <>
              Next <ChevronRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
