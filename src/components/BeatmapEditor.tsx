import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Music2, Play, Plus, Trash2, X } from 'lucide-react';
import { Note, SongData } from '../types';

interface BeatmapEditorProps {
  song: SongData;
  audioContext: AudioContext;
  volume: number;
  onNotesChange: (notes: Note[]) => void;
  onTestChart: () => void;
  onClose: () => void;
}

type DragState = { id: string; kind: 'move' | 'resize' } | null;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const snapTime = (value: number) => Math.round(value * 4) / 4;
const getNoteDuration = (note: Note) => Math.max(0, note.duration || 0);

const sortNotes = (notes: Note[]) => [...notes].sort((left, right) => left.time - right.time || left.lane - right.lane);

export const BeatmapEditor: React.FC<BeatmapEditorProps> = ({ song, audioContext, volume, onNotesChange, onTestChart, onClose }) => {
  const [viewStart, setViewStart] = useState(0);
  const [viewLength, setViewLength] = useState(16);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<DragState>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const songDuration = Math.max(1, song.audioBuffer.duration);
  const viewEnd = Math.min(songDuration, viewStart + viewLength);
  const actualViewLength = Math.max(1, viewEnd - viewStart);
  const selectedNote = song.notes.find((note) => note.id === selectedId) || null;
  const visibleNotes = useMemo(
    () => song.notes.filter((note) => note.time >= viewStart - getNoteDuration(note) && note.time <= viewEnd),
    [song.notes, viewEnd, viewStart]
  );

  useEffect(() => () => {
    if (previewSourceRef.current) {
      previewSourceRef.current.stop();
      previewSourceRef.current = null;
    }
  }, []);

  const updateNote = (noteId: string, patch: Partial<Note>) => {
    onNotesChange(sortNotes(song.notes.map((note) => note.id === noteId ? { ...note, ...patch, hit: false, missed: false, held: false } : note)));
  };

  const addNote = (time: number, lane: number) => {
    const note: Note = {
      id: crypto.randomUUID(),
      time: snapTime(clamp(time, 0, Math.max(0, songDuration - 0.05))),
      lane: clamp(lane, 0, 3),
      hit: false,
      missed: false,
    };
    onNotesChange(sortNotes([...song.notes, note]));
    setSelectedId(note.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    onNotesChange(song.notes.filter((note) => note.id !== selectedId));
    setSelectedId(null);
  };

  const previewWindow = async () => {
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (previewSourceRef.current) {
      previewSourceRef.current.stop();
      previewSourceRef.current = null;
      return;
    }
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = song.audioBuffer;
    gain.gain.value = clamp(volume * 0.7, 0, 1);
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(0, viewStart, Math.min(8, songDuration - viewStart));
    source.onended = () => { if (previewSourceRef.current === source) previewSourceRef.current = null; };
    previewSourceRef.current = source;
  };

  const getPointerPosition = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const time = viewStart + ((event.clientX - rect.left) / rect.width) * actualViewLength;
    const lane = Math.floor(((event.clientY - rect.top) / rect.height) * 4);
    return { time: snapTime(clamp(time, viewStart, viewEnd)), lane: clamp(lane, 0, 3), rect };
  };

  const handleGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-note]')) return;
    const { time, lane } = getPointerPosition(event);
    addNote(time, lane);
  };

  const handleGridPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { time, lane } = getPointerPosition(event);
    const note = song.notes.find((entry) => entry.id === dragRef.current?.id);
    if (!note) return;
    if (dragRef.current.kind === 'move') {
      updateNote(note.id, { time: snapTime(clamp(time, 0, Math.max(0, songDuration - getNoteDuration(note)))), lane });
    } else {
      updateNote(note.id, { duration: snapTime(clamp(time - note.time, 0.25, Math.max(0.25, songDuration - note.time))) });
    }
  };

  const beginNoteDrag = (event: React.PointerEvent<HTMLElement>, note: Note, kind: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: note.id, kind };
    setSelectedId(note.id);
  };

  const stopDrag = () => { dragRef.current = null; };
  const moveWindow = (direction: -1 | 1) => setViewStart((current) => snapTime(clamp(current + direction * Math.max(2, actualViewLength * 0.65), 0, Math.max(0, songDuration - actualViewLength))));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:p-6">
      <section className="mx-auto w-full max-w-6xl rounded-[2rem] border border-white/10 bg-[#101015] p-4 shadow-2xl sm:p-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.22em] text-neon-purple">Beatmap editor</p><h2 className="mt-1 truncate font-display text-2xl font-black text-white">{song.name}</h2><p className="mt-1 text-xs text-white/40">Click an empty lane to place a note. Drag a note to move it; drag its right edge to resize a hold.</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => addNote(viewStart + actualViewLength / 2, 1)} className="flex items-center gap-2 rounded-xl border border-neon-purple/30 bg-neon-purple/10 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-neon-purple"><Plus className="h-4 w-4" /> Add note</button><button type="button" onClick={previewWindow} className="flex items-center gap-2 rounded-xl border border-neon-blue/30 bg-neon-blue/10 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-neon-blue"><Music2 className="h-4 w-4" /> Preview 8s</button><button type="button" onClick={onTestChart} className="flex items-center gap-2 rounded-xl bg-neon-green px-3 py-2.5 text-xs font-black uppercase tracking-wider text-black"><Play className="h-4 w-4 fill-current" /> Test chart</button><button type="button" onClick={onClose} aria-label="Close beatmap editor" className="rounded-xl border border-white/10 p-2.5 text-white/45 transition hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button></div>
        </header>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><button type="button" onClick={() => moveWindow(-1)} className="rounded-lg border border-white/10 p-2 text-white/45 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button><span className="font-mono text-xs text-white/50">{viewStart.toFixed(2)}s – {viewEnd.toFixed(2)}s</span><button type="button" onClick={() => moveWindow(1)} className="rounded-lg border border-white/10 p-2 text-white/45 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button></div><label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-wider text-white/35">Zoom <input aria-label="Timeline zoom" type="range" min="8" max="32" step="4" value={viewLength} onChange={(event) => setViewLength(Number(event.target.value))} className="w-24 accent-neon-purple" /></label></div>
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-7 border-b border-white/10 bg-black/40 text-[9px] font-mono text-white/30">{Array.from({ length: Math.ceil(actualViewLength) + 1 }, (_, index) => <span key={index} className="relative min-w-0 flex-1 border-r border-white/[0.04] pl-1 pt-2">{Math.floor(viewStart + index)}s</span>)}</div>
              <div className="relative mt-7 h-[340px] touch-none select-none" onPointerDown={handleGridPointerDown} onPointerMove={handleGridPointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
                {Array.from({ length: 4 }, (_, lane) => <div key={lane} className="absolute inset-x-0 border-b border-white/[0.08] bg-gradient-to-r from-white/[0.025] to-transparent" style={{ top: `${lane * 25}%`, height: '25%' }}><span className="absolute left-2 top-2 text-[9px] font-black uppercase tracking-widest text-white/20">Lane {lane + 1}</span></div>)}
                {Array.from({ length: Math.ceil(actualViewLength * 4) + 1 }, (_, index) => <div key={index} className="pointer-events-none absolute inset-y-0 border-l border-white/[0.045]" style={{ left: `${(index / (actualViewLength * 4)) * 100}%` }} />)}
                {visibleNotes.map((note) => {
                  const left = ((note.time - viewStart) / actualViewLength) * 100;
                  const width = Math.max(1.1, (getNoteDuration(note) / actualViewLength) * 100);
                  const isSelected = selectedId === note.id;
                  return <button key={note.id} type="button" data-note onPointerDown={(event) => beginNoteDrag(event, note, 'move')} onClick={(event) => { event.stopPropagation(); setSelectedId(note.id); }} className={`absolute z-20 flex min-w-3 items-center rounded-md border px-1 text-[9px] font-black text-black shadow-lg transition ${isSelected ? 'border-white bg-neon-orange shadow-neon-orange/30' : 'border-neon-blue/40 bg-neon-blue hover:bg-white'}`} style={{ left: `${left}%`, top: `calc(${note.lane * 25}% + 5px)`, width: `${width}%`, height: 'calc(25% - 10px)' }} title={`${note.time.toFixed(2)}s · Lane ${note.lane + 1}`}><span className="truncate">{note.duration ? `${note.duration.toFixed(2)}s` : '•'}</span>{note.duration ? <span data-note onPointerDown={(event) => beginNoteDrag(event, note, 'resize')} className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize rounded-r bg-white/80" aria-label="Resize hold" /> : null}</button>;
                })}
              </div>
            </div>
            <p className="mt-3 text-xs text-white/35">{song.notes.length} notes · quarter-beat snapping · {visibleNotes.length} notes in this window</p>
          </div>

          <aside className="rounded-2xl border border-white/10 bg-black/25 p-4">
            {selectedNote ? <><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-neon-orange">Selected note</p><p className="mt-1 font-mono text-sm text-white">{selectedNote.time.toFixed(2)}s</p></div><button type="button" onClick={deleteSelected} className="rounded-lg border border-neon-pink/25 bg-neon-pink/10 p-2 text-neon-pink"><Trash2 className="h-4 w-4" /></button></div><label className="block text-[10px] font-black uppercase tracking-wider text-white/35">Time <span className="float-right font-mono text-neon-blue">{selectedNote.time.toFixed(2)}s</span><input aria-label="Selected note time" type="range" min={Math.max(0, viewStart - actualViewLength)} max={Math.min(songDuration, viewEnd + actualViewLength)} step="0.25" value={selectedNote.time} onChange={(event) => updateNote(selectedNote.id, { time: Number(event.target.value) })} className="mt-2 w-full accent-neon-blue" /></label><div className="mt-5"><p className="text-[10px] font-black uppercase tracking-wider text-white/35">Lane</p><div className="mt-2 grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((lane) => <button key={lane} type="button" onClick={() => updateNote(selectedNote.id, { lane })} className={`rounded-lg px-2 py-2 text-xs font-black ${selectedNote.lane === lane ? 'bg-neon-purple text-black' : 'bg-white/5 text-white/45 hover:bg-white/10'}`}>{lane + 1}</button>)}</div></div><label className="mt-5 block text-[10px] font-black uppercase tracking-wider text-white/35">Hold length <span className="float-right font-mono text-neon-green">{selectedNote.duration ? `${selectedNote.duration.toFixed(2)}s` : 'Tap'}</span><input aria-label="Selected hold length" type="range" min="0" max="4" step="0.25" value={selectedNote.duration || 0} onChange={(event) => { const duration = Number(event.target.value); updateNote(selectedNote.id, { duration: duration || undefined, endLane: duration ? selectedNote.endLane : undefined }); }} className="mt-2 w-full accent-neon-green" /></label>{selectedNote.duration ? <div className="mt-5"><p className="text-[10px] font-black uppercase tracking-wider text-white/35">End lane</p><div className="mt-2 grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((lane) => <button key={lane} type="button" onClick={() => updateNote(selectedNote.id, { endLane: lane === selectedNote.lane ? undefined : lane })} className={`rounded-lg px-2 py-2 text-xs font-black ${selectedNote.endLane === lane || (lane === selectedNote.lane && selectedNote.endLane === undefined) ? 'bg-neon-blue text-black' : 'bg-white/5 text-white/45 hover:bg-white/10'}`}>{lane + 1}</button>)}</div></div> : null}</> : <div className="flex min-h-56 flex-col items-center justify-center text-center"><Plus className="mb-3 h-7 w-7 text-white/20" /><p className="font-display font-bold text-white/60">Select a note</p><p className="mt-1 text-xs leading-relaxed text-white/30">Click any note to fine-tune it, or click an empty lane to add one.</p></div>}
          </aside>
        </div>
      </section>
    </div>
  );
};
