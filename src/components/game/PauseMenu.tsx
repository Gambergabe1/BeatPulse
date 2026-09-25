import React from 'react';
import { Play, RotateCcw } from 'lucide-react';
import type { GameState } from '../../types';
import { TIMING_PRESETS } from './gameplayRules';

type TimingPreset = (typeof TIMING_PRESETS)[number];
type PracticeLoop = { start: number; end?: number };

export interface PauseMenuProps {
  activeTimingPreset: TimingPreset | undefined;
  applyTimingPreset: (preset: TimingPreset) => void;
  audioBuffer: AudioBuffer;
  gameState: GameState;
  gameStateRef: React.RefObject<GameState>;
  hitWindow: number;
  isPracticeMode: boolean;
  isReplay: boolean;
  noteSpeedMultiplier: number;
  onRestart: (() => void) | undefined;
  perfectWindow: number;
  practiceLoop: PracticeLoop | null;
  practiceLoopRef: React.RefObject<PracticeLoop | null>;
  previewPracticeSection: () => void;
  replayEvents: { time: number; lane: number; type: string }[];
  replayPlaybackSpeed: number;
  replaySeekTime: number;
  restartPracticeAt: (songTime: number) => void;
  resumeGame: () => void;
  setHitWindow: React.Dispatch<React.SetStateAction<number>>;
  setNoteSpeedMultiplier: React.Dispatch<React.SetStateAction<number>>;
  setPerfectWindow: React.Dispatch<React.SetStateAction<number>>;
  setReplaySeekTime: React.Dispatch<React.SetStateAction<number>>;
  setReplaySpeed: (speed: number) => void;
  stopGame: () => void;
  updatePracticeLoop: (next: PracticeLoop | null) => void;
}

/** Pause overlay: scroll speed, timing windows, practice loops, replay seeking, resume and restart. */
export const PauseMenu: React.FC<PauseMenuProps> = ({
  activeTimingPreset,
  applyTimingPreset,
  audioBuffer,
  gameState,
  gameStateRef,
  hitWindow,
  isPracticeMode,
  isReplay,
  noteSpeedMultiplier,
  onRestart,
  perfectWindow,
  practiceLoop,
  practiceLoopRef,
  previewPracticeSection,
  replayEvents,
  replayPlaybackSpeed,
  replaySeekTime,
  restartPracticeAt,
  resumeGame,
  setHitWindow,
  setNoteSpeedMultiplier,
  setPerfectWindow,
  setReplaySeekTime,
  setReplaySpeed,
  stopGame,
  updatePracticeLoop,
}) => (
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

            {isReplay && <div className="mt-4 rounded-2xl border border-neon-blue/20 bg-neon-blue/[0.05] p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-white">Replay controls</p><p className="mt-1 text-xs text-white/40">Study the input stream at your own pace.</p></div><select aria-label="Replay speed" value={replayPlaybackSpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs font-bold text-neon-blue outline-none"><option value={0.5}>0.5×</option><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></div>
              <label className="mt-4 block text-[10px] font-black uppercase tracking-wider text-white/35">Timeline marker <span className="float-right font-mono text-neon-blue">{replaySeekTime.toFixed(1)}s</span><input aria-label="Replay timeline" type="range" min="0" max={Math.max(0, gameState.duration - 0.05)} step="0.1" value={replaySeekTime} onChange={(event) => setReplaySeekTime(Number(event.target.value))} className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-blue" /></label>
              <button type="button" onClick={() => restartPracticeAt(replaySeekTime)} className="mt-3 w-full rounded-xl border border-neon-blue/30 bg-neon-blue/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-neon-blue transition hover:bg-neon-blue hover:text-black">Jump to marker</button>
              <div className="mt-3 flex flex-wrap gap-1.5">{replayEvents.filter((event) => event.time >= replaySeekTime).slice(0, 6).map((event, index) => <span key={`${event.time}-${event.lane}-${index}`} className="rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white/55">{event.time.toFixed(1)}s · Lane {event.lane + 1} · {event.type.replace(/_/g, ' ')}</span>)}</div>
            </div>}

            {isPracticeMode && <div className="mt-4 rounded-2xl border border-neon-green/20 bg-neon-green/[0.05] p-4">
              <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-white">Practice tools</p><p className="mt-1 text-xs text-white/40">Loop a rough spot or let BeatPulse demonstrate it.</p></div><span className="rounded-full border border-neon-green/25 bg-neon-green/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-neon-green">Unranked</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { const start = Math.max(0, gameStateRef.current.currentTime); updatePracticeLoop({ start, end: practiceLoopRef.current?.end && practiceLoopRef.current.end > start ? practiceLoopRef.current.end : undefined }); }} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-white/65 hover:bg-white/10">Set A</button>
                <button type="button" onClick={() => { const end = Math.min(audioBuffer.duration, gameStateRef.current.currentTime); const start = practiceLoopRef.current?.start ?? Math.max(0, end - 4); updatePracticeLoop({ start: Math.min(start, Math.max(0, end - 0.5)), end: Math.max(end, start + 0.5) }); }} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-white/65 hover:bg-white/10">Set B</button>
                <button type="button" disabled={!practiceLoop} onClick={() => restartPracticeAt(practiceLoop.start)} className="rounded-xl border border-neon-blue/25 bg-neon-blue/10 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-neon-blue disabled:opacity-30">Restart loop</button>
                <button type="button" onClick={previewPracticeSection} className="rounded-xl border border-neon-purple/25 bg-neon-purple/10 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-neon-purple">Autoplay preview</button>
              </div>
              <p className="mt-3 text-[10px] text-white/35">{practiceLoop?.end ? `Looping ${practiceLoop.start.toFixed(1)}s–${practiceLoop.end.toFixed(1)}s.` : practiceLoop ? `Loop starts at ${practiceLoop.start.toFixed(1)}s. Set B to finish it.` : 'Set A and B to repeat a section.'}</p>
            </div>}

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
            {onRestart && (
              <button
                onClick={() => {
                  stopGame();
                  onRestart();
                }}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-3.5 font-display font-black uppercase tracking-widest text-white transition-all hover:bg-white/10"
              >
                <RotateCcw className="h-5 w-5" /> Restart
              </button>
            )}
            <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
              Esc resume{onRestart ? ' · ` restart' : ''}
            </p>
          </div>
        </div>
);
