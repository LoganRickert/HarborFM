import { castTranscriptLabel } from '@harborfm/shared';
import {
  parseSrt,
  parseSrtTimeToSeconds,
} from '../SegmentModal/utils/srt';

export type LaneTranscriptCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptLaneInfo = {
  laneKey: string;
  label: string;
  castId: string | null;
};

/** Split `Speaker: spoken text` prefixes from multi-track Whisper SRT cues. */
export function parseCueSpeaker(text: string): {
  speaker: string | null;
  body: string;
} {
  const raw = text.trim();
  const m = raw.match(/^(.+?):\s*([\s\S]*)$/);
  if (!m) return { speaker: null, body: raw };
  const speaker = m[1]!.trim();
  const body = m[2]!.trim();
  if (!speaker) return { speaker: null, body: raw };
  return { speaker, body: body || raw };
}

function normLabel(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Map merged segment SRT cues onto advanced-editor lanes by speaker prefix
 * (cast nickname/name, then lane label). Unlabeled / unmatched cues are skipped.
 */
export function cuesByLaneKey(opts: {
  srtText: string;
  lanes: TranscriptLaneInfo[];
  castById: Map<
    string,
    { id: string; name: string; nickname?: string | null }
  >;
}): Map<string, LaneTranscriptCue[]> {
  const out = new Map<string, LaneTranscriptCue[]>();
  for (const lane of opts.lanes) out.set(lane.laneKey, []);

  const labelToLaneKey = new Map<string, string>();
  for (const lane of opts.lanes) {
    const fromLabel = normLabel(lane.label);
    if (fromLabel && !labelToLaneKey.has(fromLabel)) {
      labelToLaneKey.set(fromLabel, lane.laneKey);
    }
    if (lane.castId) {
      const member = opts.castById.get(lane.castId);
      if (member) {
        const castLabel = normLabel(castTranscriptLabel(member));
        if (castLabel && !labelToLaneKey.has(castLabel)) {
          labelToLaneKey.set(castLabel, lane.laneKey);
        }
        const name = normLabel(member.name);
        if (name && !labelToLaneKey.has(name)) {
          labelToLaneKey.set(name, lane.laneKey);
        }
      }
    }
  }

  for (const entry of parseSrt(opts.srtText)) {
    const { speaker, body } = parseCueSpeaker(entry.text);
    if (!speaker || !body) continue;
    const laneKey = labelToLaneKey.get(normLabel(speaker));
    if (!laneKey) continue;
    const startMs = parseSrtTimeToSeconds(entry.start) * 1000;
    const endMs = parseSrtTimeToSeconds(entry.end) * 1000;
    if (!(endMs > startMs)) continue;
    out.get(laneKey)!.push({ startMs, endMs, text: body });
  }

  return out;
}
