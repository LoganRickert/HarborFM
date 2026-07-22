/**
 * Local-only call cues (not sent into the mediasoup room).
 *
 * Use HTMLAudioElement (same path as remote call audio) so cues still play when
 * the tab is backgrounded. AudioContext / speechSynthesis often suspend until
 * the tab is foregrounded again.
 */

let mutedAudio: HTMLAudioElement | null = null;

function getMutedAudio(): HTMLAudioElement {
  if (!mutedAudio) {
    mutedAudio = new Audio("/sounds/muted.wav");
    mutedAudio.preload = "auto";
    mutedAudio.setAttribute("playsinline", "true");
  }
  return mutedAudio;
}

/** Warm the muted clip during an in-call user gesture so background play works. */
export function preloadMutedCue(): void {
  try {
    const el = getMutedAudio();
    el.load();
  } catch {
    /* ignore */
  }
}

/**
 * Play the spoken "Muted" cue (e.g. OS ended/muted the mic while away).
 * Fire-and-forget; uses HTMLAudioElement so it can play after background.
 */
export function playMutedCue(): void {
  try {
    const el = getMutedAudio();
    el.pause();
    el.currentTime = 0;
    void el.play().catch(() => {
      /* autoplay / background policy */
    });
  } catch {
    /* ignore */
  }
}
