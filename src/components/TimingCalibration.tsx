import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Check, RotateCcw, Volume2 } from 'lucide-react';

interface TimingCalibrationProps {
  audioContext: AudioContext;
  volume: number;
  currentOffsetMs: number;
  onApply: (offsetMs: number) => void;
}

const BEAT_INTERVAL_MS = 600;
const REQUIRED_TAPS = 8;
const MAX_OFFSET_MS = 120;

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
};

export const TimingCalibration: React.FC<TimingCalibrationProps> = ({ audioContext, volume, currentOffsetMs, onApply }) => {
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(0);
  const [samples, setSamples] = useState<number[]>([]);
  const [recommendedOffset, setRecommendedOffset] = useState<number | null>(null);
  const startAtRef = useRef(0);
  const emittedBeatRef = useRef(-1);
  const timerRef = useRef<number | null>(null);
  const sampleRef = useRef<number[]>([]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRunning(false);
  }, []);

  const complete = useCallback((nextSamples: number[]) => {
    stop();
    if (!nextSamples.length) return;
    setRecommendedOffset(Math.round(-median(nextSamples)));
  }, [stop]);

  const playBeat = useCallback((accent: boolean) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = accent ? 880 : 660;
    gain.gain.setValueAtTime(Math.max(0.015, volume * 0.07), audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.085);
  }, [audioContext, volume]);

  const start = async () => {
    if (audioContext.state === 'suspended') await audioContext.resume();
    stop();
    sampleRef.current = [];
    setSamples([]);
    setRecommendedOffset(null);
    setBeat(0);
    emittedBeatRef.current = -1;
    startAtRef.current = performance.now() + 900;
    setRunning(true);
    timerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startAtRef.current;
      if (elapsed < 0) return;
      const nextBeat = Math.floor(elapsed / BEAT_INTERVAL_MS);
      if (nextBeat !== emittedBeatRef.current && nextBeat < REQUIRED_TAPS + 4) {
        emittedBeatRef.current = nextBeat;
        setBeat(nextBeat + 1);
        playBeat(nextBeat % 4 === 0);
      }
      if (nextBeat >= REQUIRED_TAPS + 4) stop();
    }, 16);
  };

  const recordTap = useCallback(() => {
    if (!running) return;
    const elapsed = performance.now() - startAtRef.current;
    if (elapsed < -120) return;
    const nearestBeat = Math.round(elapsed / BEAT_INTERVAL_MS);
    if (nearestBeat < 0 || nearestBeat > REQUIRED_TAPS + 2) return;
    const offset = elapsed - nearestBeat * BEAT_INTERVAL_MS;
    if (Math.abs(offset) > 260) return;
    const nextSamples = [...sampleRef.current, offset].slice(-REQUIRED_TAPS);
    sampleRef.current = nextSamples;
    setSamples(nextSamples);
    if (nextSamples.length >= REQUIRED_TAPS) complete(nextSamples);
  }, [complete, running]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!running || (event.code !== 'Space' && event.code !== 'Enter')) return;
      event.preventDefault();
      recordTap();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recordTap, running]);

  useEffect(() => () => stop(), [stop]);

  const applyRecommendation = () => {
    if (recommendedOffset === null) return;
    onApply(Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, recommendedOffset)));
  };

  return (
    <section className="rounded-2xl border border-neon-blue/25 bg-gradient-to-br from-neon-blue/[0.08] to-neon-purple/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-neon-blue" /><p className="text-sm font-bold text-white">Timing calibration</p></div><p className="mt-1 text-xs leading-relaxed text-white/40">Tap with the pulse eight times. BeatPulse measures your average timing and sets a practical input offset.</p></div><span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[10px] font-bold text-white/50">Current {currentOffsetMs > 0 ? '+' : ''}{currentOffsetMs} ms</span></div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"><button type="button" onClick={running ? stop : start} className={`flex min-w-44 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-wider transition ${running ? 'border border-neon-pink/35 bg-neon-pink/10 text-neon-pink' : 'bg-neon-blue text-black hover:bg-white'}`}>{running ? <><RotateCcw className="h-4 w-4" /> Stop test</> : <><Volume2 className="h-4 w-4" /> Start tap test</>}</button>{running && <button type="button" onClick={recordTap} className="min-h-12 flex-1 rounded-xl border border-neon-green/35 bg-neon-green/10 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-neon-green active:scale-[0.98]">Tap now · {samples.length}/{REQUIRED_TAPS}</button>}{!running && recommendedOffset !== null && <button type="button" onClick={applyRecommendation} className="flex items-center justify-center gap-2 rounded-xl border border-neon-green/35 bg-neon-green/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-neon-green hover:bg-neon-green hover:text-black"><Check className="h-4 w-4" /> Apply {recommendedOffset > 0 ? '+' : ''}{recommendedOffset} ms</button>}</div>
      {running && <div className="mt-4 flex h-2 gap-1">{Array.from({ length: REQUIRED_TAPS }, (_, index) => <span key={index} className={`flex-1 rounded-full transition ${index < samples.length ? 'bg-neon-green' : index === (beat - 1) % REQUIRED_TAPS ? 'bg-neon-blue shadow-[0_0_12px_#00f3ff]' : 'bg-white/10'}`} />)}</div>}
      {recommendedOffset !== null && <p className="mt-3 text-xs text-white/55">Recommended from {samples.length} taps: <span className="font-mono font-bold text-neon-green">{recommendedOffset > 0 ? '+' : ''}{recommendedOffset} ms</span>. You can always fine-tune it with the slider below.</p>}
    </section>
  );
};
