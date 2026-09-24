import type { Note, SongSection } from '../types';
import { analyzeSongSections, generateNotesFromAudio, type NoteGenerationConfig } from './audio';
import { mixAudioBufferToMono } from './monoAudio';

export interface GeneratedChart {
  notes: Note[];
  sections?: SongSection[];
}

interface PendingRequest {
  resolve: (chart: GeneratedChart) => void;
  reject: (error: Error) => void;
}

const WORKER_SOURCE_LIMIT = 2;

let worker: Worker | null | undefined;
let nextId = 1;
const sourceIds = new WeakMap<AudioBuffer, number>();
const loadedSources: number[] = [];
const pending = new Map<number, PendingRequest>();

const failPending = (message: string) => {
  const requests = [...pending.values()];
  pending.clear();
  requests.forEach((request) => request.reject(new Error(message)));
};

const getWorker = () => {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('../workers/chartWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ requestId: number; notes?: Note[]; sections?: SongSection[]; error?: string }>) => {
      const { requestId, notes, sections, error } = event.data;
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId);
      if (error || !notes) request.reject(new Error(error || 'Chart generation failed.'));
      else request.resolve({ notes, sections });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker?.terminate();
      worker = null;
      loadedSources.length = 0;
      failPending('The chart worker stopped unexpectedly.');
    };
  } catch {
    worker = null;
  }
  return worker;
};

const ensureSourceLoaded = (target: Worker, audioBuffer: AudioBuffer) => {
  let sourceId = sourceIds.get(audioBuffer);
  if (sourceId !== undefined && loadedSources.includes(sourceId)) return sourceId;
  sourceId = nextId++;
  sourceIds.set(audioBuffer, sourceId);
  const samples = mixAudioBufferToMono(audioBuffer);
  target.postMessage({ type: 'load', sourceId, sampleRate: audioBuffer.sampleRate, samples }, [samples.buffer]);
  // Mirrors the worker's own eviction so we know when to resend audio.
  loadedSources.push(sourceId);
  while (loadedSources.length > WORKER_SOURCE_LIMIT) loadedSources.shift();
  return sourceId;
};

const generateOnMainThread = async (audioBuffer: AudioBuffer, config: NoteGenerationConfig, includeNotes: boolean, includeSections: boolean): Promise<GeneratedChart> => ({
  notes: includeNotes ? await generateNotesFromAudio(audioBuffer, config) : [],
  sections: includeSections ? analyzeSongSections(audioBuffer) : undefined,
});

/**
 * Generates a chart (and optionally the song sections) off the main thread so the
 * menu stays responsive while long songs are analysed. Falls back to the main thread
 * when workers are unavailable; results are identical either way.
 */
export const generateChart = async (
  audioBuffer: AudioBuffer,
  config: NoteGenerationConfig,
  options: { includeNotes?: boolean; includeSections?: boolean } = {}
): Promise<GeneratedChart> => {
  const includeNotes = options.includeNotes ?? true;
  const includeSections = options.includeSections ?? false;
  const target = getWorker();
  if (!target) return generateOnMainThread(audioBuffer, config, includeNotes, includeSections);

  try {
    const sourceId = ensureSourceLoaded(target, audioBuffer);
    const requestId = nextId++;
    return await new Promise<GeneratedChart>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      target.postMessage({ type: 'generate', requestId, sourceId, config, includeNotes, includeSections });
    });
  } catch (error) {
    console.warn('Chart worker unavailable, generating on the main thread.', error);
    return generateOnMainThread(audioBuffer, config, includeNotes, includeSections);
  }
};
