export type RecordingSessionStatus = "ACTIVE" | "STOPPED" | "FINALIZING";

export type SegmentStatus =
  | "RECORDING"
  | "FINALIZED"
  | "DEGRADED"
  | "INTERRUPTED"
  | "RECOVERED";

export type RecordingSession = {
  roomId: string;
  episodeId: string;
  podcastId: string;
  sessionId: string | null;
  startedAtEpochMs: number;
  status: RecordingSessionStatus;
};

export type Segment = {
  segmentId: string;
  roomId: string;
  episodeId: string;
  podcastId: string;
  participantId?: string | null;
  producerId: string;
  startMs: number;
  endMs: number;
  codec: string;
  filePath: string;
  tmpPath: string;
  durationMs?: number;
  ffmpegPid?: number;
  exitCode?: number;
  lastPacketAtMs?: number;
  status: SegmentStatus;
};

export type RecordingEvent = {
  event: string;
  assetId?: string;
  clientTimestampMs?: number;
  durationSec?: number;
};

export type RecordingMeta = {
  filePathRelative: string;
  segmentId: string;
  episodeId: string;
  podcastId: string;
  name: string | null;
  sessionId: string | null;
  recordingCallbackSecret: string | null;
};
