/// <reference lib="webworker" />
import { analyzeSongSections, generateNotesFromAudio, type NoteGenerationConfig } from '../utils/audio';
import { createMonoAudioSource } from '../utils/monoAudio';

type ChartWorkerRequest =
  | { type: 'load'; sourceId: number; sampleRate: number; samples: Float32Array }
  | { type: 'generate'; requestId: number; sourceId: number; config: NoteGenerationConfig; includeNotes: boolean; includeSections: boolean };

const sources = new Map<number, AudioBuffer>();

self.onmessage = async (event: MessageEvent<ChartWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'load') {
    sources.set(message.sourceId, createMonoAudioSource(message.samples, message.sampleRate));
    // Keep the two most recent songs: the current one and the one being previewed.
    while (sources.size > 2) sources.delete(sources.keys().next().value as number);
    return;
  }

  const source = sources.get(message.sourceId);
  if (!source) {
    self.postMessage({ requestId: message.requestId, error: 'Audio is no longer loaded in the chart worker.' });
    return;
  }
  try {
    const notes = message.includeNotes ? await generateNotesFromAudio(source, message.config) : [];
    const sections = message.includeSections ? analyzeSongSections(source) : undefined;
    self.postMessage({ requestId: message.requestId, notes, sections });
  } catch (error) {
    self.postMessage({ requestId: message.requestId, error: error instanceof Error ? error.message : 'Chart generation failed.' });
  }
};
