/**
 * Lane-level track FX helpers for the advanced editor Track Settings dialog.
 * Maps UI controls <-> clip fields remake already understands (volume, eqBands, gate, comp).
 */
import type {
  SegmentTrackClip,
  SegmentTrackComp,
  SegmentTrackEqBand,
  SegmentTrackGate,
} from '@harborfm/shared';
import { editorLaneKey, type EditorClip } from './clipOps';

export const EQ_LOW_HZ = 200;
export const EQ_MID_HZ = 1000;
export const EQ_HIGH_HZ = 4000;
export const EQ_MID_Q = 1;
export const EQ_DB_MIN = -20;
export const EQ_DB_MAX = 20;

/** Volume fader: -60 dB .. +6 dB (linear gain on clip.volume). */
export const VOLUME_DB_MIN = -60;
export const VOLUME_DB_MAX = 6;

export const COMP_THRESHOLD_DB_MIN = -60;
export const COMP_THRESHOLD_DB_MAX = 0;
export const GATE_THRESHOLD_DB_MIN = -80;
export const GATE_THRESHOLD_DB_MAX = 0;

export type TrackEqUi = {
  lowDb: number;
  midDb: number;
  highDb: number;
};

export type TrackSettingsUi = {
  muted: boolean;
  volumeDb: number;
  eq: TrackEqUi;
  compEnabled: boolean;
  compThresholdDb: number;
  compRatio: number;
  compAttackMs: number;
  compReleaseMs: number;
  compMakeupDb: number;
  gateEnabled: boolean;
  gateThresholdDb: number;
  gateAttackMs: number;
  gateHoldMs: number;
  gateReleaseMs: number;
};

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return VOLUME_DB_MIN;
  return clamp(20 * Math.log10(linear), VOLUME_DB_MIN, VOLUME_DB_MAX);
}

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 1;
  if (db <= VOLUME_DB_MIN) return 0;
  return Math.pow(10, clamp(db, VOLUME_DB_MIN, VOLUME_DB_MAX) / 20);
}

/** Linear amplitude threshold (0..1) <-> dB for gate/comp UI. */
export function thresholdLinearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return GATE_THRESHOLD_DB_MIN;
  return 20 * Math.log10(linear);
}

export function thresholdDbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 0.01;
  return Math.pow(10, db / 20);
}

function findBandGain(
  bands: SegmentTrackEqBand[] | undefined,
  type: SegmentTrackEqBand['type'],
  freqHz: number,
): number {
  if (!bands?.length) return 0;
  const match = bands.find(
    (b) =>
      b.type === type &&
      b.enabled !== false &&
      Math.abs(b.freqHz - freqHz) / freqHz < 0.35,
  );
  if (match) return clamp(match.gainDb, EQ_DB_MIN, EQ_DB_MAX);
  const byType = bands.find((b) => b.type === type && b.enabled !== false);
  return byType ? clamp(byType.gainDb, EQ_DB_MIN, EQ_DB_MAX) : 0;
}

export function eqBandsToUi(
  bands: SegmentTrackEqBand[] | undefined,
): TrackEqUi {
  return {
    lowDb: findBandGain(bands, 'loshelf', EQ_LOW_HZ),
    midDb: findBandGain(bands, 'band', EQ_MID_HZ),
    highDb: findBandGain(bands, 'hishelf', EQ_HIGH_HZ),
  };
}

export function uiToEqBands(eq: TrackEqUi): SegmentTrackEqBand[] | undefined {
  const lowDb = clamp(eq.lowDb, EQ_DB_MIN, EQ_DB_MAX);
  const midDb = clamp(eq.midDb, EQ_DB_MIN, EQ_DB_MAX);
  const highDb = clamp(eq.highDb, EQ_DB_MIN, EQ_DB_MAX);
  if (lowDb === 0 && midDb === 0 && highDb === 0) return undefined;
  return [
    {
      type: 'loshelf',
      freqHz: EQ_LOW_HZ,
      gainDb: lowDb,
      q: 0.707,
      enabled: true,
    },
    {
      type: 'band',
      freqHz: EQ_MID_HZ,
      gainDb: midDb,
      q: EQ_MID_Q,
      enabled: true,
    },
    {
      type: 'hishelf',
      freqHz: EQ_HIGH_HZ,
      gainDb: highDb,
      q: 0.707,
      enabled: true,
    },
  ];
}

export const DEFAULT_TRACK_SETTINGS: TrackSettingsUi = {
  muted: false,
  volumeDb: 0,
  eq: { lowDb: 0, midDb: 0, highDb: 0 },
  compEnabled: false,
  compThresholdDb: -18,
  compRatio: 3,
  compAttackMs: 10,
  compReleaseMs: 100,
  compMakeupDb: 0,
  gateEnabled: false,
  gateThresholdDb: -40,
  gateAttackMs: 5,
  gateHoldMs: 50,
  gateReleaseMs: 100,
};

export function clipToTrackSettings(clip: SegmentTrackClip): TrackSettingsUi {
  const volume =
    typeof clip.volume === 'number' && Number.isFinite(clip.volume)
      ? clip.volume
      : 1;
  const gate = clip.gate;
  const comp = clip.comp;
  return {
    muted: clip.muted === true,
    volumeDb: linearToDb(volume),
    eq: eqBandsToUi(clip.eqBands),
    compEnabled: Boolean(comp),
    compThresholdDb: comp
      ? clamp(
          thresholdLinearToDb(comp.threshold),
          COMP_THRESHOLD_DB_MIN,
          COMP_THRESHOLD_DB_MAX,
        )
      : DEFAULT_TRACK_SETTINGS.compThresholdDb,
    compRatio: comp
      ? clamp(comp.ratio, 1, 20)
      : DEFAULT_TRACK_SETTINGS.compRatio,
    compAttackMs: comp
      ? clamp(comp.attackMs, 0.1, 2000)
      : DEFAULT_TRACK_SETTINGS.compAttackMs,
    compReleaseMs: comp
      ? clamp(comp.releaseMs, 1, 9000)
      : DEFAULT_TRACK_SETTINGS.compReleaseMs,
    compMakeupDb: comp
      ? clamp(comp.makeupDb ?? 0, 0, 24)
      : DEFAULT_TRACK_SETTINGS.compMakeupDb,
    gateEnabled: Boolean(gate),
    gateThresholdDb: gate
      ? clamp(
          thresholdLinearToDb(gate.threshold),
          GATE_THRESHOLD_DB_MIN,
          GATE_THRESHOLD_DB_MAX,
        )
      : DEFAULT_TRACK_SETTINGS.gateThresholdDb,
    gateAttackMs: gate
      ? clamp(gate.attackMs, 0.1, 9000)
      : DEFAULT_TRACK_SETTINGS.gateAttackMs,
    gateHoldMs: gate
      ? clamp(gate.holdMs ?? 50, 0, 9000)
      : DEFAULT_TRACK_SETTINGS.gateHoldMs,
    gateReleaseMs: gate
      ? clamp(gate.releaseMs, 1, 9000)
      : DEFAULT_TRACK_SETTINGS.gateReleaseMs,
  };
}

export function readLaneTrackSettings(
  clips: EditorClip[],
  laneKey: string,
): TrackSettingsUi {
  const lane = clips.filter((c) => editorLaneKey(c) === laneKey);
  if (!lane.length) return { ...DEFAULT_TRACK_SETTINGS };
  // Prefer a clip that still follows the track (no manual Clip Settings override).
  const inherited = lane.find((c) => c.fxOverride !== true);
  return clipToTrackSettings(inherited ?? lane[0]!);
}

/** Seed per-lane track FX defaults from clips (non-overridden preferred). */
export function buildLaneFxDefaults(
  clips: EditorClip[],
): Record<string, TrackSettingsUi> {
  const out: Record<string, TrackSettingsUi> = {};
  const locked = new Set<string>();
  for (const clip of clips) {
    const key = editorLaneKey(clip);
    if (locked.has(key)) continue;
    if (clip.fxOverride === true) {
      if (!out[key]) out[key] = clipToTrackSettings(clip);
      continue;
    }
    out[key] = clipToTrackSettings(clip);
    locked.add(key);
  }
  return out;
}

export function trackSettingsToClipPatch(
  settings: TrackSettingsUi,
): Partial<SegmentTrackClip> {
  const volume = dbToLinear(settings.volumeDb);
  const eqBands = uiToEqBands(settings.eq);

  let gate: SegmentTrackGate | undefined;
  if (settings.gateEnabled) {
    gate = {
      threshold: clamp(
        thresholdDbToLinear(settings.gateThresholdDb),
        0.0001,
        1,
      ),
      attackMs: clamp(settings.gateAttackMs, 0.1, 9000),
      holdMs: clamp(settings.gateHoldMs, 0, 9000),
      releaseMs: clamp(settings.gateReleaseMs, 1, 9000),
      range: 0,
    };
  }

  let comp: SegmentTrackComp | undefined;
  if (settings.compEnabled) {
    comp = {
      threshold: clamp(
        thresholdDbToLinear(settings.compThresholdDb),
        0.0001,
        1,
      ),
      ratio: clamp(settings.compRatio, 1, 20),
      attackMs: clamp(settings.compAttackMs, 0.1, 2000),
      releaseMs: clamp(settings.compReleaseMs, 1, 9000),
      makeupDb: clamp(settings.compMakeupDb, 0, 24),
      kneeDb: 2.828,
    };
  }

  return {
    muted: settings.muted,
    volume,
    eqBands,
    gate,
    comp,
    // Drop raw Reaper chunks so remake/export use param fields.
    reaEqChunkBase64: undefined,
    reaGateChunkBase64: undefined,
    reaCompChunkBase64: undefined,
  };
}

/**
 * Apply track settings to every clip on the lane that is still following the
 * track (no Clip Settings override). Clears stale Rea* VST chunks.
 */
export function applyTrackSettingsToLane(
  clips: EditorClip[],
  laneKey: string,
  settings: TrackSettingsUi,
): EditorClip[] {
  const patch = trackSettingsToClipPatch(settings);
  return clips.map((c) => {
    if (editorLaneKey(c) !== laneKey) return c;
    if (c.fxOverride === true) return c;
    return applyPatchToClip(c, patch);
  });
}

/**
 * Apply mute / volume / EQ / dynamics to a single clip and mark it as a
 * manual override of the track settings.
 */
export function applyTrackSettingsToClip(
  clips: EditorClip[],
  uiId: string,
  settings: TrackSettingsUi,
): EditorClip[] {
  const patch = trackSettingsToClipPatch(settings);
  return clips.map((c) => {
    if (c.uiId !== uiId) return c;
    return { ...applyPatchToClip(c, patch), fxOverride: true };
  });
}

/**
 * Clear a clip's FX override and re-apply the current track settings.
 */
export function resetClipFxToTrackSettings(
  clips: EditorClip[],
  uiId: string,
  settings: TrackSettingsUi,
): EditorClip[] {
  const patch = trackSettingsToClipPatch(settings);
  return clips.map((c) => {
    if (c.uiId !== uiId) return c;
    const next = applyPatchToClip(c, patch);
    delete (next as { fxOverride?: boolean }).fxOverride;
    return next;
  });
}

function applyPatchToClip(
  clip: EditorClip,
  patch: Partial<SegmentTrackClip>,
): EditorClip {
  const next: EditorClip = { ...clip, ...patch };
  delete (next as { reaEqChunkBase64?: string }).reaEqChunkBase64;
  delete (next as { reaGateChunkBase64?: string }).reaGateChunkBase64;
  delete (next as { reaCompChunkBase64?: string }).reaCompChunkBase64;
  if (!patch.eqBands) delete (next as { eqBands?: SegmentTrackEqBand[] }).eqBands;
  if (!patch.gate) delete (next as { gate?: SegmentTrackGate }).gate;
  if (!patch.comp) delete (next as { comp?: SegmentTrackComp }).comp;
  return next;
}
