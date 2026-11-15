import React, { useState } from 'react';
import { Clock, Keyboard, Library, Upload } from 'lucide-react';
import type { PlayerRecentRun } from '../../utils/progression';
import type { DifficultyPreset } from '../../utils/chartSettings';
import type { ChartRecord } from '../../utils/chartRecords';

/** Shared card surface so every panel on the Play page lines up. */
export const Card: React.FC<{ title?: string; icon?: React.ElementType; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, icon: Icon, action, className = '', children }) => (
  <section className={`rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6 ${className}`}>
    {title && (
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
          {Icon && <Icon className="h-4 w-4 text-white/45" />}
          {title}
        </h2>
        {action}
      </div>
    )}
    {children}
  </section>
);

interface SongDropZoneProps {
  isUploading: boolean;
  onFile: (file: File) => void;
  onBrowseLibrary: () => void;
}

/** Big drop target for a song file; clicking it opens the file picker. */
export const SongDropZone: React.FC<SongDropZoneProps> = ({ isUploading, onFile, onBrowseLibrary }) => {
  const [isDragging, setIsDragging] = useState(false);
  return (
    <div className="space-y-3">
      <label
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed p-8 text-center transition ${isDragging ? 'border-neon-blue bg-neon-blue/10' : 'border-white/15 bg-white/[0.03] hover:border-neon-blue/50 hover:bg-white/[0.05]'}`}
      >
        <input
          type="file"
          accept="audio/*"
          className="sr-only"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
        <span className="mb-4 rounded-2xl bg-neon-blue/10 p-4 text-neon-blue"><Upload className="h-8 w-8" /></span>
        <span className="font-display text-xl font-bold text-white">Add a song</span>
        <span className="mt-1 text-sm text-white/50"><span className="hidden sm:inline">Drop an MP3, WAV or OGG file here, or click to browse</span><span className="sm:hidden">Tap to choose an MP3, WAV or OGG file</span></span>
        <span className="mt-4 text-xs text-white/35">BeatPulse charts it automatically in your browser. Nothing uploads until you publish.</span>
        {isUploading && (
          <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm" role="status">
            <span className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-neon-blue border-t-transparent" />
            <span className="font-display font-bold text-neon-blue">Analyzing beats…</span>
          </span>
        )}
      </label>
      <button
        type="button"
        onClick={onBrowseLibrary}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
      >
        <Library className="h-4 w-4" /> Or pick a song from the library
      </button>
    </div>
  );
};

interface DifficultyPickerProps {
  presets: DifficultyPreset[];
  selectedId: string | null;
  records: Array<{ preset: DifficultyPreset; record: ChartRecord }>;
  /** Presets that have an official stored chart (community songs); undefined means all. */
  officialIds?: Set<string>;
  onSelect: (value: number) => void;
}

/** Segmented difficulty control showing each difficulty's best rank. */
export const DifficultyPicker: React.FC<DifficultyPickerProps> = ({ presets, selectedId, records, officialIds, onSelect }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Difficulty">
    {presets.map((preset) => {
      const selected = selectedId === preset.id;
      const record = records.find((entry) => entry.preset.id === preset.id)?.record;
      const hasOfficial = !officialIds || officialIds.has(preset.id);
      return (
        <button
          key={preset.id}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => onSelect(preset.value)}
          title={hasOfficial ? preset.description : 'No official chart yet: generated locally and unranked'}
          className={`rounded-2xl border px-3 py-3 text-left transition ${selected ? 'border-neon-blue bg-neon-blue text-black shadow-[0_0_18px_rgba(0,243,255,0.25)]' : 'border-white/10 bg-white/[0.02] text-white/75 hover:border-white/25 hover:text-white'}`}
        >
          <span className="block text-sm font-bold">{preset.label}</span>
          <span className={`mt-0.5 block text-xs ${selected ? 'text-black/60' : 'text-white/40'}`}>
            {record ? `Best ${record.bestRank}${record.fullCombo ? ' · FC' : ''}` : hasOfficial ? 'Not played' : 'Unranked'}
          </span>
        </button>
      );
    })}
  </div>
);

/** Shows the player's actual lane keys, so the hint stays right after rebinding. */
export const ControlsCard: React.FC<{ keybindings: string[]; movingSliders: boolean; onRebind: () => void }> = ({ keybindings, movingSliders, onRebind }) => (
  <Card
    title="Controls"
    icon={Keyboard}
    action={<button type="button" onClick={onRebind} className="text-xs font-semibold text-neon-blue hover:text-white">Change keys</button>}
  >
    <div className="grid grid-cols-4 gap-2">
      {keybindings.map((key, lane) => (
        <div key={lane} className="rounded-xl border border-white/10 bg-black/30 py-2 text-center">
          <span className="block font-mono text-lg font-bold uppercase text-white">{key === ' ' ? '␣' : key}</span>
          <span className="block text-[11px] text-white/40">Lane {lane + 1}</span>
        </div>
      ))}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-white/45">
      {movingSliders
        ? 'Tap notes at the line, hold trails and follow curved slides, then release on the tail.'
        : 'Hit notes at the line, hold straight trails and release on the tail.'}
      {' '}Esc pauses, ` restarts.
    </p>
  </Card>
);

export const RecentRunsCard: React.FC<{ runs: PlayerRecentRun[] }> = ({ runs }) => (
  <Card title="Recent runs" icon={Clock}>
    {runs.length === 0 ? (
      <p className="text-sm text-white/40">Your last few runs show up here.</p>
    ) : (
      <ul className="space-y-2">
        {runs.slice(0, 4).map((run) => (
          <li key={run.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">{run.songName}</span>
              <span className="block truncate text-xs text-white/40">{run.artist}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-sm text-neon-blue">{run.score.toLocaleString()}</span>
              <span className="block font-mono text-xs text-white/45">{run.accuracy.toFixed(1)}%{run.fullCombo ? ' · FC' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
