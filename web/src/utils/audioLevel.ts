/**
 * Compute audio level from AnalyserNode using time-domain (RMS) data with
 * asymmetric smoothing: fast attack when level rises, slow decay when it falls.
 * This gives a sustained meter that holds during speech without requiring
 * continuous yelling.
 * @see https://stackoverflow.com/questions/44360301/web-audio-api-creating-a-peak-meter-with-analysernode
 */
const TIME_DOMAIN_BUFFER_SIZE = 2048;

/** RMS sensitivity: higher = more response to quiet sounds. ~6-8 works for speech. */
const RMS_SENSITIVITY = 7;

/** Fast attack when level rises (0.4 = ~60% of gap per frame at 60fps) */
const ATTACK = 0.4;

/** Slow decay when level falls (0.03 = ~3% of gap per frame) */
const DECAY = 0.03;

export function createAudioLevelProcessor(analyser: AnalyserNode) {
  analyser.fftSize = TIME_DOMAIN_BUFFER_SIZE;
  const buffer = new Float32Array(analyser.fftSize);
  let smoothed = 0;

  return function computeLevel(): number {
    analyser.getFloatTimeDomainData(buffer);
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    const rawLevel = Math.min(100, rms * RMS_SENSITIVITY * 100);

    const alpha = rawLevel > smoothed ? ATTACK : DECAY;
    smoothed = smoothed + alpha * (rawLevel - smoothed);

    return Math.round(Math.min(100, Math.max(0, smoothed)));
  };
}
