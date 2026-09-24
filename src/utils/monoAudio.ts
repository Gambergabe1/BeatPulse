/**
 * Chart analysis only needs a mono signal. Mixing once lets the samples be handed to
 * a worker (AudioBuffer itself cannot cross threads) and keeps results identical to
 * analysing the original multi-channel buffer.
 */
export const mixAudioBufferToMono = (audioBuffer: AudioBuffer) => {
  const mono = new Float32Array(audioBuffer.length);
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let i = 0; i < channelData.length; i++) mono[i] += channelData[i] / channelCount;
  }
  return mono;
};

/** A minimal AudioBuffer stand-in exposing only what the chart analysis reads. */
export const createMonoAudioSource = (samples: Float32Array, sampleRate: number) => ({
  length: samples.length,
  duration: samples.length / sampleRate,
  sampleRate,
  numberOfChannels: 1,
  getChannelData: () => samples,
}) as unknown as AudioBuffer;
