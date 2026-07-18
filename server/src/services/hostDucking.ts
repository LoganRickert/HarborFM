import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import type {
  MultitrackManifest,
  MultitrackSegmentEntry,
} from "./multitrackRemake.js";
import { waveformPath } from "../modules/segments/utils.js";

/** Match UI silence detection (8-bit min/max peak scale). */
export const HOST_DUCKING_SILENCE_THRESHOLD = 12;
/** Silence runs at least this long split speech islands. */
export const HOST_DUCKING_MIN_SILENCE_SEC = 2;
/** Keep exclusive floor this long after speech ends (talker hangover). */
export const HOST_DUCKING_HOLD_SEC = 0.5;
/**
 * When a host starts talking during another's island, yield the floor this
 * many seconds before the prior island ends so the next host is not chopped.
 */
export const HOST_DUCKING_BACKFILL_SEC = 1;

export const HOST_DUCKING_FILENAME = "host_ducking.json";
/** Sidecar for diagnosing gaps: islands, play ranges, handoffs, dead zones. */
export const HOST_DUCKING_DEBUG_FILENAME = "host_ducking_debug.json";

export type HostDuckingTrack = {
  segmentId?: string;
  filePath: string;
  participantName?: string | null;
  /** Absolute timeline seconds where this host is gated out. */
  mute: Array<[number, number]>;
};

export type HostDuckingFile = {
  version: 1;
  silenceThreshold: number;
  minSilenceSec: number;
  /** Seconds the floor holder keeps control after their speech island ends. */
  holdSec: number;
  tracks: HostDuckingTrack[];
};

export type HostDuckingDebugTrack = {
  key: string;
  segmentId?: string;
  filePath: string;
  participantName?: string | null;
  takeStartSec: number;
  takeEndSec: number;
  /** Speech islands before hold / handoff padding. */
  speechIslands: Array<[number, number]>;
  /** Islands after hold + lead-in padding (what exclusive mutes use). */
  gatedIslands: Array<[number, number]>;
  mute: Array<[number, number]>;
  /** Play intervals = take minus mutes (what DAW clips use). */
  play: Array<[number, number]>;
};

export type HostDuckingDebugHandoff = {
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
  silenceStartSec: number;
  speechStartSec: number;
  leadInStartSec: number;
  gapSec: number;
};

export type HostDuckingDebugFile = {
  version: 1;
  timelineStartSec: number;
  timelineEndSec: number;
  silenceThreshold: number;
  minSilenceSec: number;
  holdSec: number;
  tracks: HostDuckingDebugTrack[];
  handoffs: HostDuckingDebugHandoff[];
  /**
   * Timeline spans where no host with media is playing (DAW dead air).
   * Sorted longest-first.
   */
  deadZones: Array<{ startSec: number; endSec: number; durationSec: number }>;
  /**
   * Speech islands that are fully or mostly muted in the final play map.
   * kind=bug: muted while no other host is playing (should not happen).
   * kind=exclusive: muted because another host held the floor (expected).
   */
  mutedSpeech: Array<{
    key: string;
    label: string;
    islandStartSec: number;
    islandEndSec: number;
    mutedSec: number;
    audibleSec: number;
    kind: "bug" | "exclusive";
    otherPlaying?: string[];
  }>;
  /** Quick counts for scanning. */
  summary: {
    trackCount: number;
    handoffCount: number;
    deadZoneCount: number;
    deadZoneSec: number;
    mutedSpeechBugCount: number;
    mutedSpeechExclusiveCount: number;
  };
};

type WaveformJson = {
  version?: number;
  channels?: number;
  sample_rate?: number;
  samples_per_pixel?: number;
  bits?: number;
  length?: number;
  data: number[];
};

type SpeechIsland = {
  trackKey: string;
  filePath: string;
  segmentId?: string;
  participantName?: string | null;
  /** Timeline seconds. */
  startSec: number;
  endSec: number;
};

function isHostEntry(entry: MultitrackSegmentEntry): boolean {
  if (entry.source === "soundboard") return false;
  if (entry.soundboardAssetId) return false;
  return true;
}

function trackKey(entry: MultitrackSegmentEntry): string {
  const base =
    typeof entry.filePath === "string"
      ? basename(entry.filePath.replace(/\\/g, "/"))
      : "";
  return (
    (typeof entry.segmentId === "string" && entry.segmentId) ||
    base ||
    String(entry.participantId ?? entry.participantName ?? "track")
  );
}

function entryFileBase(entry: MultitrackSegmentEntry): string | null {
  if (typeof entry.filePath !== "string" || !entry.filePath) return null;
  return basename(entry.filePath.replace(/\\/g, "/"));
}

function takeTimelineRangeSec(entry: MultitrackSegmentEntry): {
  startSec: number;
  endSec: number;
} {
  const startMs = typeof entry.startMs === "number" ? entry.startMs : 0;
  const startSec = startMs / 1000;
  if (typeof entry.lengthMs === "number" && entry.lengthMs > 0) {
    return { startSec, endSec: startSec + entry.lengthMs / 1000 };
  }
  if (typeof entry.endMs === "number" && entry.endMs > startMs) {
    return { startSec, endSec: entry.endMs / 1000 };
  }
  return { startSec, endSec: startSec };
}

/**
 * Media duration from waveform peaks metadata.
 * Returns null when the waveform is empty or missing rate/pixel info
 * (broken/empty takes from brief joins).
 */
export function waveformDurationSec(waveform: WaveformJson): number | null {
  const length =
    typeof waveform.length === "number" && waveform.length > 0
      ? waveform.length
      : null;
  const sampleRate =
    typeof waveform.sample_rate === "number" && waveform.sample_rate > 0
      ? waveform.sample_rate
      : null;
  const spp =
    typeof waveform.samples_per_pixel === "number" &&
    waveform.samples_per_pixel > 0
      ? waveform.samples_per_pixel
      : null;
  if (length == null || sampleRate == null || spp == null) return null;
  const dur = (length * spp) / sampleRate;
  return Number.isFinite(dur) && dur > 0 ? dur : null;
}

/**
 * Timeline range for a take, clamped to real media length so short joins
 * with inflated endMs cannot stretch speech islands across the session.
 * Returns null when there is no usable media.
 */
export function effectiveTakeRangeSec(
  entry: MultitrackSegmentEntry,
  waveform: WaveformJson | null,
): {
  startSec: number;
  endSec: number;
  /** Full file duration from waveform (media-local). */
  fileDurSec: number;
  sourceOffsetSec: number;
} | null {
  const manifest = takeTimelineRangeSec(entry);
  const sourceOffsetSec =
    typeof entry.sourceOffsetMs === "number" && entry.sourceOffsetMs > 0
      ? entry.sourceOffsetMs / 1000
      : 0;

  if (!waveform) return null;
  const fileDurSec = waveformDurationSec(waveform);
  if (fileDurSec == null || fileDurSec <= 0) return null;

  const playableMediaSec = Math.max(0, fileDurSec - sourceOffsetSec);
  if (playableMediaSec <= 0) return null;

  const clampedEnd = Math.min(
    manifest.endSec,
    manifest.startSec + playableMediaSec,
  );
  if (clampedEnd <= manifest.startSec) return null;
  return {
    startSec: manifest.startSec,
    endSec: clampedEnd,
    fileDurSec,
    sourceOffsetSec,
  };
}

function loadWaveform(mtDir: string, fileBase: string): WaveformJson | null {
  const audioAbs = join(mtDir, fileBase);
  const wavAbs = waveformPath(audioAbs);
  if (!existsSync(wavAbs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(wavAbs, "utf8")) as WaveformJson;
    if (!Array.isArray(parsed.data) || parsed.data.length < 2) return null;
    // Empty / corrupt audiowaveform output (length 0, sample_rate 0).
    if (waveformDurationSec(parsed) == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Speech islands from waveform peaks. Silence runs of minSilenceSec split islands.
 * Returns intervals in media-local seconds (0 = start of file / sourceOffset 0).
 */
export function speechIslandsFromWaveform(
  waveform: WaveformJson,
  mediaDurationSec: number,
  silenceThreshold = HOST_DUCKING_SILENCE_THRESHOLD,
  minSilenceSec = HOST_DUCKING_MIN_SILENCE_SEC,
): Array<[number, number]> {
  if (mediaDurationSec <= 0) return [];
  const channels = Math.max(1, waveform.channels ?? 1);
  const pairsPerChannel =
    typeof waveform.length === "number" && waveform.length >= 0
      ? waveform.length
      : Math.floor(waveform.data.length / (2 * channels));
  if (pairsPerChannel <= 0) return [];

  const minSilencePixels = Math.max(
    1,
    Math.ceil(minSilenceSec / (mediaDurationSec / pairsPerChannel)),
  );

  const speechRuns: Array<[number, number]> = [];
  let speechStart: number | null = null;
  let silenceRun = 0;

  const flushSpeech = (endPixel: number) => {
    if (speechStart == null) return;
    const startSec = (speechStart / pairsPerChannel) * mediaDurationSec;
    const endSec = (endPixel / pairsPerChannel) * mediaDurationSec;
    if (endSec > startSec) speechRuns.push([startSec, endSec]);
    speechStart = null;
  };

  for (let i = 0; i < pairsPerChannel; i++) {
    const base = i * 2 * channels;
    const min = waveform.data[base] ?? 0;
    const max = waveform.data[base + 1] ?? 0;
    const isSilent =
      Math.abs(min) <= silenceThreshold && Math.abs(max) <= silenceThreshold;

    if (!isSilent) {
      if (speechStart == null) speechStart = i;
      silenceRun = 0;
    } else {
      silenceRun += 1;
      if (speechStart != null && silenceRun >= minSilencePixels) {
        flushSpeech(i - silenceRun + 1);
      }
    }
  }
  flushSpeech(pairsPerChannel);

  return speechRuns;
}

function mergeMuteRanges(
  ranges: Array<[number, number]>,
): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    if (e <= s) continue;
    const last = out[out.length - 1];
    if (!last || s > last[1]) {
      out.push([s, e]);
    } else {
      last[1] = Math.max(last[1], e);
    }
  }
  return out;
}

/**
 * Subtract mute ranges from [takeStart, takeEnd] → play intervals (timeline sec).
 */
export function playIntervalsAfterMutes(
  takeStartSec: number,
  takeEndSec: number,
  mutes: Array<[number, number]>,
): Array<[number, number]> {
  if (takeEndSec <= takeStartSec) return [];
  let play: Array<[number, number]> = [[takeStartSec, takeEndSec]];
  for (const [ms, me] of mergeMuteRanges(mutes)) {
    const next: Array<[number, number]> = [];
    for (const [ps, pe] of play) {
      const muteStart = Math.max(ps, ms);
      const muteEnd = Math.min(pe, me);
      if (muteStart >= muteEnd) {
        next.push([ps, pe]);
        continue;
      }
      if (muteStart > ps) next.push([ps, muteStart]);
      if (muteEnd < pe) next.push([muteEnd, pe]);
    }
    play = next;
  }
  return play.filter(([s, e]) => e > s);
}

/**
 * Assign exclusive floor on overlapping speech: earliest island start wins.
 * Open / no-speech regions produce no mutes (everyone stays unmuted).
 * Islands should already include any post-speech hold extension.
 *
 * Multiple islands on the same track can be active at once (e.g. after lead-in
 * padding overlaps a following island). Ends only remove that island instance.
 */
export function computeExclusiveMutes(
  islands: SpeechIsland[],
): Map<string, Array<[number, number]>> {
  const mutes = new Map<string, Array<[number, number]>>();
  if (islands.length === 0) return mutes;

  const keys = [...new Set(islands.map((i) => i.trackKey))];
  for (const k of keys) mutes.set(k, []);

  type Edge = { t: number; kind: "start" | "end"; island: SpeechIsland };
  const edges: Edge[] = [];
  for (const island of islands) {
    edges.push({ t: island.startSec, kind: "start", island });
    edges.push({ t: island.endSec, kind: "end", island });
  }
  edges.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    // Process ends before starts at the same time so open gaps stay open.
    if (a.kind !== b.kind) return a.kind === "end" ? -1 : 1;
    return a.island.startSec - b.island.startSec;
  });

  /** Active islands per track (same track can have overlapping islands). */
  const active = new Map<string, Set<SpeechIsland>>();
  let prevT: number | null = null;
  let floorKey: string | null = null;

  const pickFloor = (): string | null => {
    let best: SpeechIsland | null = null;
    for (const set of active.values()) {
      for (const island of set) {
        if (
          !best ||
          island.startSec < best.startSec ||
          (island.startSec === best.startSec &&
            island.trackKey.localeCompare(best.trackKey) < 0)
        ) {
          best = island;
        }
      }
    }
    return best?.trackKey ?? null;
  };

  const flush = (until: number) => {
    if (prevT == null || until <= prevT || !floorKey) return;
    for (const [key, list] of mutes) {
      if (key === floorKey) continue;
      list.push([prevT, until]);
    }
  };

  for (const edge of edges) {
    if (prevT != null && edge.t > prevT) {
      flush(edge.t);
    }
    if (edge.kind === "start") {
      let set = active.get(edge.island.trackKey);
      if (!set) {
        set = new Set();
        active.set(edge.island.trackKey, set);
      }
      set.add(edge.island);
    } else {
      const set = active.get(edge.island.trackKey);
      if (set) {
        set.delete(edge.island);
        if (set.size === 0) active.delete(edge.island.trackKey);
      }
    }
    floorKey = pickFloor();
    prevT = edge.t;
  }

  for (const [key, list] of mutes) {
    mutes.set(key, mergeMuteRanges(list));
  }
  return mutes;
}

/** Cross-host release: prior host went silent, a different host's next island begins. */
type HostHandoff = {
  fromKey: string;
  toKey: string;
  /**
   * Timeline sec where silence begins on the prior host (speech island end,
   * before any hold extension).
   */
  silenceStartSec: number;
  /**
   * Timeline sec where silence ends / next host speech begins (original island
   * start, before lead-in).
   */
  speechStartSec: number;
};

/**
 * Find host→host releases (different track, prior island ended before next speech).
 * Call on islands before hold extension so silenceStartSec is the true silence start.
 * Same-host pauses are ignored so a speaker keeps continuous audio through their own gaps.
 */
export function findHostHandoffs(islands: SpeechIsland[]): HostHandoff[] {
  const handoffs: HostHandoff[] = [];
  for (const next of islands) {
    let prev: SpeechIsland | null = null;
    for (const cand of islands) {
      if (cand.trackKey === next.trackKey) continue;
      if (cand.endSec <= next.startSec && (!prev || cand.endSec > prev.endSec)) {
        prev = cand;
      }
    }
    if (!prev) continue;
    // Not a release if the prior host has more speech before this next island
    // (brief self-pause). Those must not cut the prior host for a third party.
    const priorSpeaksAgain = islands.some(
      (i) =>
        i.trackKey === prev!.trackKey &&
        i.startSec > prev!.endSec &&
        i.startSec < next.startSec,
    );
    if (priorSpeaksAgain) continue;
    handoffs.push({
      fromKey: prev.trackKey,
      toKey: next.trackKey,
      silenceStartSec: prev.endSec,
      speechStartSec: next.startSec,
    });
  }
  return handoffs;
}

/**
 * Next host lead-in: up to padSec before speech, but not before the prior
 * host's silence started (avoids a silence ITEM over the prior talker).
 */
export function applyHandoffPadding(
  islands: SpeechIsland[],
  handoffs: HostHandoff[],
  padSec = HOST_DUCKING_MIN_SILENCE_SEC,
): void {
  if (padSec <= 0 || handoffs.length === 0) return;
  for (const h of handoffs) {
    const next = islands.find(
      (i) => i.trackKey === h.toKey && i.startSec === h.speechStartSec,
    );
    if (!next) continue;
    next.startSec = Math.max(
      h.silenceStartSec,
      h.speechStartSec - padSec,
    );
  }
}

/** Lead-in start for a handoff (clamped to prior silence start). */
export function handoffLeadInStart(
  h: HostHandoff,
  padSec = HOST_DUCKING_MIN_SILENCE_SEC,
): number {
  return Math.max(h.silenceStartSec, h.speechStartSec - padSec);
}

/**
 * Trim prior-host hold so it cannot cover the next host's real speech start.
 * Runs on islands (before exclusive mutes).
 */
export function trimHoldPastNextSpeech(
  islands: SpeechIsland[],
  handoffs: HostHandoff[],
): void {
  for (const h of handoffs) {
    if (h.speechStartSec <= h.silenceStartSec) continue;
    for (const island of islands) {
      if (island.trackKey !== h.fromKey) continue;
      if (island.startSec >= h.speechStartSec) continue;
      if (island.endSec <= h.speechStartSec) continue;
      // Only cut the hangover past the next host's speech, not earlier speech.
      if (h.silenceStartSec < h.speechStartSec) {
        island.endSec = Math.max(island.startSec, h.speechStartSec);
      }
    }
  }
}

/**
 * When B starts during A's island and continues after A, end A's island
 * early by backfillSec so B is not chopped. Skips when a third host already
 * holds an earlier floor through the yield point.
 */
export function applyOverlapBackfillToIslands(
  islands: SpeechIsland[],
  backfillSec = HOST_DUCKING_BACKFILL_SEC,
): void {
  if (backfillSec <= 0) return;
  for (const next of islands) {
    for (const prior of islands) {
      if (prior.trackKey === next.trackKey) continue;
      if (!(prior.startSec < next.startSec && next.startSec < prior.endSec)) {
        continue;
      }
      if (next.endSec <= prior.endSec) continue;
      const yieldAt = Math.max(next.startSec, prior.endSec - backfillSec);
      if (yieldAt >= prior.endSec - 1e-6) continue;
      const blocked = islands.some(
        (c) =>
          c.trackKey !== prior.trackKey &&
          c.trackKey !== next.trackKey &&
          c.startSec < prior.startSec &&
          c.startSec < yieldAt &&
          c.endSec > yieldAt,
      );
      if (blocked) continue;
      prior.endSec = Math.max(prior.startSec, yieldAt);
    }
  }
}

/**
 * Handoff mute tweaks after exclusive floor assignment:
 * Prior host muted from silence start until next lead-in (not across later
 * speech on that same track). Lead-in is not force-unmuted over other hosts.
 */
export function applyHandoffMuteOverrides(
  muteMap: Map<string, Array<[number, number]>>,
  handoffs: HostHandoff[],
  islands: SpeechIsland[] = [],
  padSec = HOST_DUCKING_MIN_SILENCE_SEC,
): void {
  if (handoffs.length === 0) return;
  for (const h of handoffs) {
    const silenceStart = h.silenceStartSec;
    const speechStart = h.speechStartSec;
    const leadInStart = handoffLeadInStart(h, padSec);

    let priorMuteEnd = leadInStart > silenceStart ? leadInStart : speechStart;
    for (const island of islands) {
      if (island.trackKey !== h.fromKey) continue;
      if (island.endSec <= silenceStart) continue;
      const justEnded =
        island.startSec < silenceStart &&
        island.endSec <= silenceStart + HOST_DUCKING_HOLD_SEC + 1e-6;
      if (justEnded) continue;
      if (island.startSec >= priorMuteEnd) continue;
      priorMuteEnd = Math.min(
        priorMuteEnd,
        Math.max(silenceStart, island.startSec),
      );
    }
    if (priorMuteEnd > silenceStart + 1e-6) {
      const prior = muteMap.get(h.fromKey) ?? [];
      prior.push([silenceStart, priorMuteEnd]);
      muteMap.set(h.fromKey, mergeMuteRanges(prior));
    }
  }
}

function trackLabel(meta: {
  participantName?: string | null;
  filePath: string;
  key: string;
}): string {
  if (meta.participantName) return meta.participantName;
  return meta.filePath || meta.key;
}

function overlapSec(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Spans where no listed play-map has coverage. */
export function findDeadZones(
  playByKey: Map<string, Array<[number, number]>>,
  timelineStartSec: number,
  timelineEndSec: number,
  minDurationSec = 0.25,
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  if (timelineEndSec <= timelineStartSec) return [];
  const covered: Array<[number, number]> = [];
  for (const play of playByKey.values()) {
    for (const [s, e] of play) {
      const a = Math.max(timelineStartSec, s);
      const b = Math.min(timelineEndSec, e);
      if (b > a) covered.push([a, b]);
    }
  }
  const merged = mergeMuteRanges(covered);
  const zones: Array<{ startSec: number; endSec: number; durationSec: number }> =
    [];
  let cursor = timelineStartSec;
  for (const [s, e] of merged) {
    if (s > cursor) {
      const dur = s - cursor;
      if (dur >= minDurationSec) {
        zones.push({ startSec: cursor, endSec: s, durationSec: dur });
      }
    }
    cursor = Math.max(cursor, e);
  }
  if (timelineEndSec - cursor >= minDurationSec) {
    zones.push({
      startSec: cursor,
      endSec: timelineEndSec,
      durationSec: timelineEndSec - cursor,
    });
  }
  zones.sort((a, b) => b.durationSec - a.durationSec);
  return zones;
}

export type HostDuckingComputeResult = {
  ducking: HostDuckingFile;
  debug: HostDuckingDebugFile;
};

/** Build host_ducking.json + debug sidecar from multitrack dir + manifest. */
export function computeHostDuckingWithDebug(
  mtDir: string,
  manifest: MultitrackManifest,
): HostDuckingComputeResult {
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  const islands: SpeechIsland[] = [];
  const speechIslandsByKey = new Map<string, Array<[number, number]>>();
  const takeByKey = new Map<string, { startSec: number; endSec: number }>();
  const hostMeta: Array<{
    key: string;
    filePath: string;
    segmentId?: string;
    participantName?: string | null;
  }> = [];

  for (const entry of segments) {
    if (!isHostEntry(entry)) continue;
    const fileBase = entryFileBase(entry);
    if (!fileBase) continue;
    const key = trackKey(entry);
    hostMeta.push({
      key,
      filePath: fileBase,
      segmentId: typeof entry.segmentId === "string" ? entry.segmentId : undefined,
      participantName:
        typeof entry.participantName === "string"
          ? entry.participantName
          : null,
    });

    const waveform = loadWaveform(mtDir, fileBase);
    const take = effectiveTakeRangeSec(entry, waveform);
    if (!take || !waveform) continue;
    takeByKey.set(key, { startSec: take.startSec, endSec: take.endSec });

    const localIslands = speechIslandsFromWaveform(waveform, take.fileDurSec);
    const speechList = speechIslandsByKey.get(key) ?? [];
    for (const [ls, le] of localIslands) {
      const rawStart = take.startSec + (ls - take.sourceOffsetSec);
      const rawEnd = take.startSec + (le - take.sourceOffsetSec);
      const islandStart = Math.max(take.startSec, rawStart);
      const islandEnd = Math.min(take.endSec, rawEnd);
      if (islandEnd <= islandStart) continue;
      speechList.push([islandStart, islandEnd]);
      islands.push({
        trackKey: key,
        filePath: fileBase,
        segmentId:
          typeof entry.segmentId === "string" ? entry.segmentId : undefined,
        participantName:
          typeof entry.participantName === "string"
            ? entry.participantName
            : null,
        startSec: islandStart,
        endSec: islandEnd,
      });
    }
    speechIslandsByKey.set(key, speechList);
  }

  const handoffs = findHostHandoffs(islands);
  const labelByKey = new Map(
    hostMeta.map((m) => [m.key, trackLabel(m)] as const),
  );
  const debugHandoffs: HostDuckingDebugHandoff[] = handoffs.map((h) => ({
    fromKey: h.fromKey,
    toKey: h.toKey,
    fromLabel: labelByKey.get(h.fromKey) ?? h.fromKey,
    toLabel: labelByKey.get(h.toKey) ?? h.toKey,
    silenceStartSec: h.silenceStartSec,
    speechStartSec: h.speechStartSec,
    leadInStartSec: handoffLeadInStart(h, HOST_DUCKING_MIN_SILENCE_SEC),
    gapSec: h.speechStartSec - h.silenceStartSec,
  }));

  if (HOST_DUCKING_HOLD_SEC > 0) {
    for (const island of islands) {
      island.endSec += HOST_DUCKING_HOLD_SEC;
    }
  }

  applyHandoffPadding(islands, handoffs, HOST_DUCKING_MIN_SILENCE_SEC);
  trimHoldPastNextSpeech(islands, handoffs);
  applyOverlapBackfillToIslands(islands, HOST_DUCKING_BACKFILL_SEC);

  const gatedIslandsByKey = new Map<string, Array<[number, number]>>();
  for (const island of islands) {
    const list = gatedIslandsByKey.get(island.trackKey) ?? [];
    list.push([island.startSec, island.endSec]);
    gatedIslandsByKey.set(island.trackKey, list);
  }

  const muteMap = computeExclusiveMutes(islands);
  applyHandoffMuteOverrides(
    muteMap,
    handoffs,
    islands,
    HOST_DUCKING_MIN_SILENCE_SEC,
  );

  const seen = new Set<string>();
  const tracks: HostDuckingTrack[] = [];
  const debugTracks: HostDuckingDebugTrack[] = [];
  const playByKey = new Map<string, Array<[number, number]>>();
  let timelineStart = 0;
  let timelineEnd = 0;

  for (const meta of hostMeta) {
    if (seen.has(meta.key)) continue;
    seen.add(meta.key);
    const mute = muteMap.get(meta.key) ?? [];
    tracks.push({
      segmentId: meta.segmentId,
      filePath: meta.filePath,
      participantName: meta.participantName,
      mute,
    });
    const take = takeByKey.get(meta.key);
    if (!take) {
      debugTracks.push({
        key: meta.key,
        segmentId: meta.segmentId,
        filePath: meta.filePath,
        participantName: meta.participantName,
        takeStartSec: 0,
        takeEndSec: 0,
        speechIslands: [],
        gatedIslands: [],
        mute,
        play: [],
      });
      continue;
    }
    timelineStart = Math.min(timelineStart, take.startSec);
    timelineEnd = Math.max(timelineEnd, take.endSec);
    const play = playIntervalsAfterMutes(take.startSec, take.endSec, mute);
    playByKey.set(meta.key, play);
    debugTracks.push({
      key: meta.key,
      segmentId: meta.segmentId,
      filePath: meta.filePath,
      participantName: meta.participantName,
      takeStartSec: take.startSec,
      takeEndSec: take.endSec,
      speechIslands: speechIslandsByKey.get(meta.key) ?? [],
      gatedIslands: gatedIslandsByKey.get(meta.key) ?? [],
      mute,
      play,
    });
  }

  const deadZones = findDeadZones(playByKey, timelineStart, timelineEnd);

  const mutedSpeech: HostDuckingDebugFile["mutedSpeech"] = [];
  for (const tr of debugTracks) {
    for (const [is, ie] of tr.speechIslands) {
      let audible = 0;
      for (const [ps, pe] of tr.play) {
        audible += overlapSec(is, ie, ps, pe);
      }
      const islandDur = ie - is;
      const mutedSec = Math.max(0, islandDur - audible);
      if (islandDur < 0.5 || mutedSec < Math.min(1, islandDur * 0.5)) continue;

      // Sample a few points in the muted portion to see if others are playing.
      const others = new Set<string>();
      const samples = 5;
      for (let i = 0; i < samples; i++) {
        const t = is + ((i + 0.5) / samples) * islandDur;
        if (tr.play.some(([ps, pe]) => t >= ps && t < pe)) continue;
        for (const other of debugTracks) {
          if (other.key === tr.key) continue;
          if (other.play.some(([ps, pe]) => t >= ps && t < pe)) {
            others.add(trackLabel(other));
          }
        }
      }
      const kind = others.size > 0 ? "exclusive" : "bug";
      mutedSpeech.push({
        key: tr.key,
        label: trackLabel(tr),
        islandStartSec: is,
        islandEndSec: ie,
        mutedSec,
        audibleSec: audible,
        kind,
        otherPlaying: others.size > 0 ? [...others] : undefined,
      });
    }
  }
  mutedSpeech.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "bug" ? -1 : 1;
    return b.mutedSec - a.mutedSec;
  });

  const ducking: HostDuckingFile = {
    version: 1,
    silenceThreshold: HOST_DUCKING_SILENCE_THRESHOLD,
    minSilenceSec: HOST_DUCKING_MIN_SILENCE_SEC,
    holdSec: HOST_DUCKING_HOLD_SEC,
    tracks,
  };

  const bugCount = mutedSpeech.filter((m) => m.kind === "bug").length;
  const debug: HostDuckingDebugFile = {
    version: 1,
    timelineStartSec: timelineStart,
    timelineEndSec: timelineEnd,
    silenceThreshold: HOST_DUCKING_SILENCE_THRESHOLD,
    minSilenceSec: HOST_DUCKING_MIN_SILENCE_SEC,
    holdSec: HOST_DUCKING_HOLD_SEC,
    tracks: debugTracks,
    handoffs: debugHandoffs,
    deadZones,
    mutedSpeech,
    summary: {
      trackCount: debugTracks.length,
      handoffCount: debugHandoffs.length,
      deadZoneCount: deadZones.length,
      deadZoneSec: deadZones.reduce((a, z) => a + z.durationSec, 0),
      mutedSpeechBugCount: bugCount,
      mutedSpeechExclusiveCount: mutedSpeech.length - bugCount,
    },
  };

  return { ducking, debug };
}

/** Build host_ducking.json contents from multitrack dir + manifest. */
export function computeHostDucking(
  mtDir: string,
  manifest: MultitrackManifest,
): HostDuckingFile {
  return computeHostDuckingWithDebug(mtDir, manifest).ducking;
}

export function hostDuckingPath(mtDir: string): string {
  return join(mtDir, HOST_DUCKING_FILENAME);
}

export function hostDuckingDebugPath(mtDir: string): string {
  return join(mtDir, HOST_DUCKING_DEBUG_FILENAME);
}

export function writeHostDuckingFile(
  mtDir: string,
  ducking: HostDuckingFile,
): string {
  const path = hostDuckingPath(mtDir);
  writeFileSync(path, JSON.stringify(ducking, null, 2));
  return path;
}

export function writeHostDuckingDebugFile(
  mtDir: string,
  debug: HostDuckingDebugFile,
): string {
  const path = hostDuckingDebugPath(mtDir);
  writeFileSync(path, JSON.stringify(debug, null, 2));
  return path;
}

export function readHostDuckingFile(mtDir: string): HostDuckingFile | null {
  const path = hostDuckingPath(mtDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as HostDuckingFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.tracks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Generate ducking + debug sidecars from waveforms. */
export function generateAndWriteHostDucking(
  mtDir: string,
  manifest: MultitrackManifest,
): HostDuckingFile {
  const { ducking, debug } = computeHostDuckingWithDebug(mtDir, manifest);
  writeHostDuckingFile(mtDir, ducking);
  writeHostDuckingDebugFile(mtDir, debug);
  return ducking;
}

function matchMuteForEntry(
  ducking: HostDuckingFile,
  entry: MultitrackSegmentEntry,
): Array<[number, number]> {
  const fileBase = entryFileBase(entry);
  const sid = typeof entry.segmentId === "string" ? entry.segmentId : null;
  for (const t of ducking.tracks) {
    if (sid && t.segmentId && t.segmentId === sid) return t.mute ?? [];
  }
  for (const t of ducking.tracks) {
    if (fileBase && basename(t.filePath.replace(/\\/g, "/")) === fileBase) {
      return t.mute ?? [];
    }
  }
  return [];
}

/**
 * Build a remake manifest: one clamped take per host with muteSec silence
 * windows applied as chunked volume gates (not micro-clips). Hundreds of atrim
 * clips made ffmpeg unusable. Soundboard and ungated hosts pass through;
 * empty/unusable media is omitted.
 */
export function buildManifestForRemake(
  manifest: MultitrackManifest,
  ducking: HostDuckingFile | null,
  mtDir?: string | null,
): MultitrackManifest {
  if (!ducking) return manifest;
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  const out: MultitrackSegmentEntry[] = [];

  for (const entry of segments) {
    if (!isHostEntry(entry)) {
      out.push(entry);
      continue;
    }

    let startSec: number;
    let endSec: number;
    if (mtDir) {
      const fileBase = entryFileBase(entry);
      const waveform = fileBase ? loadWaveform(mtDir, fileBase) : null;
      const take = effectiveTakeRangeSec(entry, waveform);
      if (!take) continue;
      startSec = take.startSec;
      endSec = take.endSec;
    } else {
      const range = takeTimelineRangeSec(entry);
      startSec = range.startSec;
      endSec = range.endSec;
    }
    if (endSec <= startSec) continue;

    const baseSourceOffsetMs =
      typeof entry.sourceOffsetMs === "number" && entry.sourceOffsetMs > 0
        ? entry.sourceOffsetMs
        : 0;
    const lengthMs = Math.round((endSec - startSec) * 1000);
    if (lengthMs <= 0) continue;
    const startMs = Math.round(startSec * 1000);

    const rawMutes = matchMuteForEntry(ducking, entry);
    const muteSec = mergeMuteRanges(
      rawMutes
        .map(([s, e]): [number, number] => [
          Math.max(startSec, s),
          Math.min(endSec, e),
        ])
        .filter(([s, e]) => e > s),
    );

    out.push({
      ...entry,
      startMs,
      endMs: startMs + lengthMs,
      lengthMs,
      sourceOffsetMs: baseSourceOffsetMs > 0 ? baseSourceOffsetMs : undefined,
      muteSec: muteSec.length > 0 ? muteSec : undefined,
    });
  }

  return { ...manifest, segments: out };
}

/**
 * Build DAW export clips: host takes split around mute ranges into multiple
 * ITEMs / OTIO clips. Same clamping rules as remake.
 */
export function buildManifestForDawClips(
  manifest: MultitrackManifest,
  ducking: HostDuckingFile | null,
  mtDir?: string | null,
): MultitrackManifest {
  if (!ducking) return manifest;
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  const out: MultitrackSegmentEntry[] = [];

  for (const entry of segments) {
    if (!isHostEntry(entry)) {
      out.push(entry);
      continue;
    }

    let startSec: number;
    let endSec: number;
    if (mtDir) {
      const fileBase = entryFileBase(entry);
      const waveform = fileBase ? loadWaveform(mtDir, fileBase) : null;
      const take = effectiveTakeRangeSec(entry, waveform);
      if (!take) continue;
      startSec = take.startSec;
      endSec = take.endSec;
    } else {
      const range = takeTimelineRangeSec(entry);
      startSec = range.startSec;
      endSec = range.endSec;
    }
    if (endSec <= startSec) continue;

    const mutes = matchMuteForEntry(ducking, entry);
    const play =
      mutes.length === 0
        ? ([[startSec, endSec]] as Array<[number, number]>)
        : playIntervalsAfterMutes(startSec, endSec, mutes);
    if (play.length === 0) continue;

    const baseSourceOffsetMs =
      typeof entry.sourceOffsetMs === "number" && entry.sourceOffsetMs > 0
        ? entry.sourceOffsetMs
        : 0;

    for (const [ps, pe] of play) {
      const lengthMs = Math.round((pe - ps) * 1000);
      if (lengthMs <= 0) continue;
      const startMs = Math.round(ps * 1000);
      const sourceOffsetMs =
        baseSourceOffsetMs + Math.round((ps - startSec) * 1000);
      out.push({
        ...entry,
        startMs,
        endMs: startMs + lengthMs,
        lengthMs,
        sourceOffsetMs: sourceOffsetMs > 0 ? sourceOffsetMs : undefined,
        muteSec: undefined,
        segmentId:
          play.length === 1
            ? entry.segmentId
            : `${entry.segmentId ?? "clip"}_${startMs}`,
      });
    }
  }

  return { ...manifest, segments: out };
}
