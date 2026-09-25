import React from 'react';
import { motion } from 'motion/react';
import { Activity, Settings as SettingsIcon } from 'lucide-react';
import { DIFFICULTY_PRESETS } from '../utils/chartSettings';
import { GameplayOptions, Settings } from '../types';
import { TimingCalibration } from './TimingCalibration';
import { getSeasonTier, PlayerProgress } from '../utils/progression';
import { formatPercentLabel } from './menuShared';
import type { DifficultyPreset } from '../utils/chartSettings';
import type { LevelReward } from '../utils/progression';

export interface SettingsPanelProps {
  activeKeybindIndex: number | null;
  advancedChartMode: boolean;
  advancedControls: { id: string; label: string; hint: string; value: number; onChange: React.Dispatch<React.SetStateAction<number>>; accentClass: string; valueClass: string; badgeClass: string; minLabel: string; maxLabel: string; summary: string; }[];
  audioContext: AudioContext;
  chartProfileRows: { label: string; value: number; summary: string; accentClass: string; }[];
  complexity: number;
  difficultyPreset: DifficultyPreset;
  gameplayOptions: GameplayOptions;
  handleProfileLoadout: (updates: Partial<Pick<PlayerProgress, "selectedAvatar" | "selectedBadge" | "selectedTitle" | "selectedFrame" | "selectedTitleColor">>) => void;
  keybindingPrompt: string;
  localSettings: Settings;
  onSaveSettings: (settings: Settings) => void;
  progress: PlayerProgress;
  resetChartSettings: () => void;
  selectDifficultyPreset: (value: number) => void;
  setActiveKeybindIndex: React.Dispatch<React.SetStateAction<number>>;
  setComplexity: React.Dispatch<React.SetStateAction<number>>;
  setLocalSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setUsername: React.Dispatch<React.SetStateAction<string>>;
  toggleAdvancedChartMode: () => void;
  upcomingLevelRewards: LevelReward[];
  updateGameplayOptions: (changes: Partial<GameplayOptions>) => void;
  username: string;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  activeKeybindIndex,
  advancedChartMode,
  advancedControls,
  audioContext,
  chartProfileRows,
  complexity,
  difficultyPreset,
  gameplayOptions,
  handleProfileLoadout,
  keybindingPrompt,
  localSettings,
  onSaveSettings,
  progress,
  resetChartSettings,
  selectDifficultyPreset,
  setActiveKeybindIndex,
  setComplexity,
  setLocalSettings,
  setUsername,
  toggleAdvancedChartMode,
  upcomingLevelRewards,
  updateGameplayOptions,
  username,
}) => (
              <div className="py-4">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-white/5 bg-white/5 p-5 sm:p-6">
                      <div className="mb-6">
                        <h4 className="flex items-center gap-2 font-display font-bold text-white">
                          <Activity className="h-5 w-5 text-neon-blue" />
                          Chart Difficulty
                        </h4>
                        <p className="mt-2 max-w-2xl text-sm text-white/50">
                          Pick a level and play. BeatPulse still adjusts the chart to each song's BPM and changing pace.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {DIFFICULTY_PRESETS.map((preset) => {
                          const isSelected = !advancedChartMode && difficultyPreset.id === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => selectDifficultyPreset(preset.value)}
                              className={`group rounded-2xl border p-4 text-left transition-all ${
                                isSelected
                                  ? 'border-neon-blue/60 bg-neon-blue/10 shadow-[0_0_28px_rgba(0,243,255,0.1)]'
                                  : 'border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.07]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`font-display text-lg font-black ${isSelected ? 'text-neon-blue' : 'text-white'}`}>
                                  {preset.label}
                                </span>
                                <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-neon-blue shadow-[0_0_10px_#00f3ff]' : 'bg-white/15'}`} />
                              </div>
                              <p className="mt-2 min-h-10 text-xs leading-relaxed text-white/45">{preset.description}</p>
                              <p className={`mt-3 text-[9px] font-black uppercase tracking-[0.18em] ${isSelected ? 'text-neon-blue/80' : 'text-white/25'}`}>
                                {preset.pace}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-white">{advancedChartMode ? 'Custom profile' : `${difficultyPreset.label} profile`}</p>
                              <span className="rounded-full border border-neon-purple/20 bg-neon-purple/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-neon-purple">
                                BPM adaptive
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-white/40">
                              {advancedChartMode ? 'Manual values are active.' : difficultyPreset.description}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={toggleAdvancedChartMode}
                              className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
                                advancedChartMode
                                  ? 'border-neon-pink/35 bg-neon-pink/10 text-neon-pink hover:bg-neon-pink/20'
                                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              {advancedChartMode ? 'Use preset' : 'Customize'}
                            </button>
                            <button
                              type="button"
                              onClick={resetChartSettings}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 transition-all hover:bg-white/10 hover:text-white"
                            >
                              Reset
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {chartProfileRows.map((row) => (
                            <div key={row.label} className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2.5">
                              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30">{row.label}</p>
                              <p className={`mt-1 text-xs font-display font-bold ${row.accentClass}`}>{row.summary}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {advancedChartMode ? (
                        <div className="mt-5 rounded-[24px] border border-neon-pink/15 bg-neon-pink/[0.045] p-4 sm:p-5">
                          <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-white">Customize chart</p>
                              <p className="mt-1 text-xs text-white/45">Fine tune only what matters to you.</p>
                            </div>
                            <span className="rounded-full border border-neon-pink/20 bg-neon-pink/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-neon-pink">
                              Custom
                            </span>
                          </div>

                          <div className="mb-4 rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-white">Base intensity</p>
                                <p className="mt-1 text-xs text-white/45">Overall pattern complexity.</p>
                              </div>
                              <span className="font-mono text-xs text-neon-purple">{formatPercentLabel(complexity)}</span>
                            </div>
                            <input
                              aria-label="Base chart intensity"
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={complexity}
                              onChange={(e) => setComplexity(parseFloat(e.target.value))}
                              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-purple"
                            />
                            <div className="mt-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-white/25">
                              <span>Simple</span><span>Complex</span>
                            </div>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-2">
                            {advancedControls.map((control) => (
                              <div key={control.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-bold text-white">{control.label}</p>
                                    <p className="mt-1 text-xs text-white/45">{control.hint}</p>
                                  </div>
                                  <span className={`font-mono text-xs ${control.valueClass}`}>{formatPercentLabel(control.value)}</span>
                                </div>
                                <input
                                  aria-label={control.label}
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={control.value}
                                  onChange={(e) => control.onChange(parseFloat(e.target.value))}
                                  className={`h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 ${control.accentClass}`}
                                />
                                <div className="mt-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-white/25">
                                  <span>{control.minLabel}</span><span>{control.maxLabel}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-5">
                        <div>
                          <h4 className="font-display font-bold text-white">Keybindings</h4>
                          <p className={`text-xs mt-1 ${activeKeybindIndex !== null ? 'text-neon-pink' : 'text-white/40'}`}>
                            {keybindingPrompt}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                          {activeKeybindIndex !== null ? 'Listening' : '4 Lanes'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {localSettings.keybindings.map((key, index) => (
                          <button
                            key={index}
                            onClick={() => setActiveKeybindIndex(index)}
                            className={`rounded-2xl border p-4 text-left transition-all ${
                              activeKeybindIndex === index
                                ? 'border-neon-pink bg-neon-pink/10 text-white shadow-[0_0_24px_rgba(255,0,153,0.15)]'
                                : 'border-white/10 bg-black/20 text-white hover:bg-white/10'
                            }`}
                          >
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Lane {index + 1}</p>
                            <p className="mt-3 font-display text-3xl font-black">
                              {activeKeybindIndex === index ? '?' : key.toUpperCase()}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-2xl border border-neon-orange/20 bg-gradient-to-br from-neon-orange/[0.09] to-neon-purple/[0.05] p-6">
                      <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-orange">{getSeasonTier(progress)} · {progress.season}</p><h4 className="mt-2 font-display text-3xl font-black text-white">Level {progress.level}</h4><p className="mt-1 text-sm text-white/45">{progress.xp.toLocaleString()} XP · {progress.runs} completed runs</p></div><div className="flex gap-2"><div className="rounded-2xl border border-neon-blue/20 bg-neon-blue/[0.08] px-3 py-3 text-right"><p className="font-display text-xl font-black text-neon-blue">{progress.pulseShards.toLocaleString()}</p><p className="text-[9px] font-black uppercase tracking-wider text-white/35">Shards</p></div><div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-right"><p className="font-display text-xl font-black text-neon-orange">{progress.fullCombos}</p><p className="text-[9px] font-black uppercase tracking-wider text-white/35">Full combos</p></div></div></div>
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/25"><div className="h-full rounded-full bg-gradient-to-r from-neon-orange to-neon-purple" style={{ width: `${Math.min(100, ((progress.xp % 900) / 900) * 100)}%` }} /></div>
                      <div className="mt-4 flex flex-wrap gap-2">{progress.achievements.slice(-4).map((achievement) => <span key={achievement} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/50">{achievement.replace(/-/g, ' ')}</span>)}{progress.achievements.length === 0 && <span className="text-xs text-white/35">Finish a run to begin your collection.</span>}</div>
                    </div>
                    <div className="rounded-2xl border border-neon-purple/20 bg-neon-purple/[0.05] p-5">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-purple">Profile loadout</p><h4 className="mt-1 font-display text-xl font-black text-white">Show your rewards</h4><p className="mt-1 text-xs text-white/40">Unlock and equip avatars, titles, badges, and frames as you level up.</p></div><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br from-neon-blue/25 to-neon-purple/35 font-display text-xl font-black text-white">{progress.selectedAvatar.charAt(0).toUpperCase()}</div></div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-[10px] font-black uppercase tracking-wider text-white/35">Avatar<select value={progress.selectedAvatar} onChange={(event) => handleProfileLoadout({ selectedAvatar: event.target.value as PlayerProgress['selectedAvatar'] })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold capitalize text-white outline-none focus:border-neon-purple/50">{progress.unlockedAvatars.map((avatar) => <option key={avatar} value={avatar}>{avatar}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-wider text-white/35">Profile frame<select value={progress.selectedFrame} onChange={(event) => handleProfileLoadout({ selectedFrame: event.target.value as PlayerProgress['selectedFrame'] })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold capitalize text-white outline-none focus:border-neon-purple/50">{progress.unlockedFrames.map((frame) => <option key={frame} value={frame}>{frame}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-wider text-white/35">Title<select value={progress.selectedTitle} onChange={(event) => handleProfileLoadout({ selectedTitle: event.target.value as PlayerProgress['selectedTitle'] })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold capitalize text-white outline-none focus:border-neon-purple/50">{progress.unlockedTitles.map((title) => <option key={title} value={title}>{title.replace(/-/g, ' ')}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-wider text-white/35">Badge<select value={progress.selectedBadge || ''} onChange={(event) => handleProfileLoadout({ selectedBadge: event.target.value ? event.target.value as NonNullable<PlayerProgress['selectedBadge']> : undefined })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold capitalize text-white outline-none focus:border-neon-purple/50"><option value="">No badge</option>{progress.unlockedBadges.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-wider text-white/35">Title color<select value={progress.selectedTitleColor} onChange={(event) => handleProfileLoadout({ selectedTitleColor: event.target.value as PlayerProgress['selectedTitleColor'] })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold capitalize text-white outline-none focus:border-neon-purple/50">{progress.unlockedTitleColors.map((color) => <option key={color} value={color}>{color}</option>)}</select></label></div>
                      <div className="mt-5 border-t border-white/8 pt-4"><div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">Next rewards</p><span className="text-[10px] font-mono text-neon-blue">Lvl {upcomingLevelRewards[0]?.level || progress.level}</span></div><div className="mt-3 space-y-2">{upcomingLevelRewards.map((reward) => <div key={reward.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-bold text-white">{reward.label}</p><p className="mt-0.5 truncate text-[10px] text-white/35">Level {reward.level} · {reward.description}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-neon-purple">{reward.kind}</span></div>)}{upcomingLevelRewards.length === 0 && <p className="text-xs text-white/35">You have collected every current level reward.</p>}</div></div>
                    </div>
                    <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                      <div className="mb-5">
                        <h4 className="font-display font-bold text-white flex items-center gap-2">
                          <SettingsIcon className="w-5 h-5 text-neon-purple" />
                          Quick Settings
                        </h4>
                        <p className="text-white/50 text-sm mt-2">
                          The everyday controls in one spot.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-3">
                            Username
                          </label>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-neon-purple outline-none transition-all"
                            placeholder="Enter username"
                          />
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                              <h5 className="text-sm font-bold text-white">Master Volume</h5>
                              <p className="text-xs text-white/40 mt-1">Adjust the overall game volume.</p>
                            </div>
                            <span className="text-neon-blue font-mono text-sm">{formatPercentLabel(localSettings.volume)}</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={localSettings.volume}
                            onChange={(e) => {
                              const newSettings = { ...localSettings, volume: parseFloat(e.target.value) };
                              setLocalSettings(newSettings);
                              onSaveSettings(newSettings);
                            }}
                            className="w-full accent-neon-blue h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4 flex items-center justify-between gap-4">
                          <div>
                            <h5 className="text-sm font-bold text-white">Visual Effects</h5>
                            <p className="text-xs text-white/40 mt-1">Hit flashes and particles.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${localSettings.visualEffects ? 'text-neon-green' : 'text-white/30'}`}>
                              {localSettings.visualEffects ? 'On' : 'Off'}
                            </span>
                            <button
                              onClick={() => {
                                const newSettings = { ...localSettings, visualEffects: !localSettings.visualEffects };
                                setLocalSettings(newSettings);
                                onSaveSettings(newSettings);
                              }}
                              className={`w-14 h-8 rounded-full transition-colors relative ${localSettings.visualEffects ? 'bg-neon-green' : 'bg-white/20'}`}
                            >
                              <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${localSettings.visualEffects ? 'left-7' : 'left-1'}`} />
                            </button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                          <div className="mb-4"><h5 className="text-sm font-bold text-white">Accessibility</h5><p className="mt-1 text-xs text-white/40">Tune the playfield for comfort and readability.</p></div>
                          <label className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Lane colors</label>
                          <select aria-label="Lane color theme" value={localSettings.laneTheme} onChange={(event) => { const nextSettings = { ...localSettings, laneTheme: event.target.value as Settings['laneTheme'] }; setLocalSettings(nextSettings); onSaveSettings(nextSettings); }} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-blue/50">{progress.unlockedLaneThemes.map((theme) => <option key={theme} value={theme}>{theme === 'colorblind' ? 'Colorblind safe' : theme.replace(/-/g, ' ')}</option>)}</select>
                          <label className="mt-4 block text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Hit sound</label>
                          <select aria-label="Hit sound" value={localSettings.hitSound} onChange={(event) => { const nextSettings = { ...localSettings, hitSound: event.target.value as Settings['hitSound'] }; setLocalSettings(nextSettings); onSaveSettings(nextSettings); }} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm capitalize text-white outline-none focus:border-neon-blue/50">{progress.unlockedHitSounds.map((sound) => <option key={sound} value={sound}>{sound}</option>)}</select>
                          <div className="mt-4 grid grid-cols-3 gap-2">{progress.unlockedThemes.map((theme) => <button key={theme} type="button" aria-pressed={localSettings.visualTheme === theme} onClick={() => { const nextSettings = { ...localSettings, visualTheme: theme }; setLocalSettings(nextSettings); onSaveSettings(nextSettings); }} className={`rounded-xl border px-2 py-2 text-[9px] font-black uppercase tracking-wider ${localSettings.visualTheme === theme ? 'border-neon-purple/45 bg-neon-purple/15 text-white' : 'border-white/10 text-white/45 hover:bg-white/10'}`}>{theme}</button>)}</div>
                          <div className="mt-4 space-y-2">{([
                            ['reducedMotion', 'Reduced motion', 'Keeps feedback clear with less movement.'],
                            ['largeNotes', 'Larger notes', 'Makes notes and receptors easier to read.'],
                            ['hapticFeedback', 'Haptic feedback', 'Uses a short vibration when your device supports it.'],
                          ] as Array<[keyof Pick<Settings, 'reducedMotion' | 'largeNotes' | 'hapticFeedback'>, string, string]>).map(([key, label, hint]) => <button key={key} type="button" aria-pressed={localSettings[key]} onClick={() => { const nextSettings = { ...localSettings, [key]: !localSettings[key] }; setLocalSettings(nextSettings); onSaveSettings(nextSettings); }} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left ${localSettings[key] ? 'border-neon-green/25 bg-neon-green/[0.07]' : 'border-white/8 bg-black/10'}`}><span><span className="block text-xs font-bold text-white">{label}</span><span className="mt-0.5 block text-[10px] text-white/35">{hint}</span></span><span className={`h-2.5 w-2.5 rounded-full ${localSettings[key] ? 'bg-neon-green shadow-[0_0_8px_#39ff14]' : 'bg-white/20'}`} /></button>)}</div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-neon-blue/20 bg-neon-blue/[0.05] p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><h4 className="font-display font-bold text-white">Practice & modifiers</h4><p className="mt-1 text-xs text-white/40">Practice tools are local only. Modified runs do not enter leaderboards.</p></div>
                        <button type="button" onClick={() => updateGameplayOptions({ practiceMode: !gameplayOptions.practiceMode })} className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${gameplayOptions.practiceMode ? 'border-neon-green/35 bg-neon-green/15 text-neon-green' : 'border-white/10 bg-black/20 text-white/40'}`}>{gameplayOptions.practiceMode ? 'Practice on' : 'Practice off'}</button>
                      </div>

                      <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-white">Input offset</p><p className="mt-1 text-xs text-white/40">Calibrate how early or late your taps register.</p></div><span className="font-mono text-sm text-neon-blue">{gameplayOptions.inputOffsetMs > 0 ? '+' : ''}{gameplayOptions.inputOffsetMs} ms</span></div>
                        <input aria-label="Input timing offset" type="range" min="-120" max="120" step="5" value={gameplayOptions.inputOffsetMs} onChange={(event) => updateGameplayOptions({ inputOffsetMs: parseInt(event.target.value, 10) })} className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-blue" />
                      </div>

                      <div className="mt-4">
                        <TimingCalibration
                          audioContext={audioContext}
                          volume={localSettings.volume}
                          currentOffsetMs={gameplayOptions.inputOffsetMs}
                          onApply={(inputOffsetMs) => updateGameplayOptions({ inputOffsetMs })}
                        />
                      </div>

                      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-white">Practice pace</p><p className="mt-1 text-xs text-white/40">Slows audio and chart timing together.</p></div><span className="font-mono text-sm text-neon-green">{gameplayOptions.practiceSpeed.toFixed(2).replace(/0$/, '')}x</span></div>
                        <div className="mt-3 grid grid-cols-3 gap-2">{[0.5, 0.75, 1].map((speed) => <button key={speed} type="button" disabled={!gameplayOptions.practiceMode} aria-pressed={gameplayOptions.practiceSpeed === speed} onClick={() => updateGameplayOptions({ practiceSpeed: speed })} className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wider disabled:opacity-30 ${gameplayOptions.practiceSpeed === speed ? 'border-neon-green/35 bg-neon-green/10 text-neon-green' : 'border-white/8 text-white/45 hover:bg-white/10'}`}>{speed.toFixed(2).replace(/0$/, '')}x</button>)}</div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-white">Scroll speed</p><p className="mt-1 text-xs text-white/40">Changes note spacing without changing the chart.</p></div><span className="font-mono text-sm text-neon-blue">{gameplayOptions.scrollSpeed.toFixed(1)}x</span></div>
                        <input aria-label="Default note scroll speed" type="range" min="0.6" max="1.6" step="0.1" value={gameplayOptions.scrollSpeed} onChange={(event) => updateGameplayOptions({ scrollSpeed: parseFloat(event.target.value) })} className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-blue" />
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">{([
                        ['hiddenNotes', 'Hidden', 'Notes fade before the hit line.'],
                        ['mirrorLanes', 'Mirror', 'Flip the lane layout.'],
                        ['randomLanes', 'Random', 'Shuffle the lane order.'],
                        ['noFail', 'No fail', 'Keep playing when health runs out.'],
                      ] as Array<[keyof Pick<GameplayOptions, 'hiddenNotes' | 'mirrorLanes' | 'randomLanes' | 'noFail'>, string, string]>).map(([key, label, hint]) => <button key={key} type="button" aria-pressed={gameplayOptions[key]} onClick={() => updateGameplayOptions({ [key]: !gameplayOptions[key] })} className={`rounded-2xl border p-3 text-left transition ${gameplayOptions[key] ? 'border-neon-purple/35 bg-neon-purple/10 text-white' : 'border-white/8 bg-black/20 text-white/55 hover:bg-white/5'}`}><p className="text-xs font-black uppercase tracking-wider">{label}</p><p className="mt-1 text-[10px] leading-relaxed text-white/35">{hint}</p></button>)}</div>
                    </div>
                  </div>
                </div>
              </div>
);
