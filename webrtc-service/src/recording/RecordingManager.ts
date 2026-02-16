import type { Router, Producer, Consumer, PlainTransport } from "mediasoup/types";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { nanoid } from "nanoid";
import type { RecordingMeta } from "./recordingTypes.js";
import { SegmentRecorder } from "./SegmentRecorder.js";
import { appendSegmentLog } from "./segmentMetadata.js";

export type RoomState = {
  router: Router;
  transports: Map<string, import("mediasoup/types").WebRtcTransport>;
  producers: Map<string, Producer>;
};

export type ActiveSegment = {
  segmentId: string;
  producerId: string;
  consumer: Consumer;
  plainTransport: PlainTransport;
  recorder: SegmentRecorder;
  ffmpeg: ChildProcess;
  filePathRelative: string;
  startedAt: number;
  lastPacketCount: number;
  lastPacketAtMs: number;
  /** e.g. "soundboard" – used to apply start-time corrections */
  source?: string;
};

export type FinalizedSegmentInfo = {
  segmentId: string;
  producerId: string;
  filePathRelative: string;
  startedAt: number;
  source?: string;
  /** Soundboard segment volume 0..1 applied at finalization (default 1) */
  volume?: number;
};

const RECORDING_WARMUP_MS = Number(process.env.RECORDING_WARMUP_MS) || 500;

export type RecordingState = RecordingMeta & {
  activeSegmentsByProducerId: Map<string, ActiveSegment>;
  finalizedSegments: FinalizedSegmentInfo[];
  /** Producers we've finalized (stall/closed/etc) - never re-add as late-joiner */
  finalizedProducerIds: Set<string>;
  recordingStartedAt: number;
  recordingEpochMs?: number;
  portBase: number;
  nextPortIndex: number;
  sessionSegmentId: string;
  episodeDir: string;
  jsonlPath: string;
  checkStorageInterval?: ReturnType<typeof setInterval>;
  producerCheckInterval?: ReturnType<typeof setInterval>;
  heartbeatInterval?: ReturnType<typeof setInterval>;
};

export type RecordingManagerDeps = {
  recordingDataDir: string;
  recordPortBase: number;
  recordPortStride: number;
  getRoom: (roomId: string) => RoomState | undefined;
  recordingByRoom: Map<string, RecordingState>;
  mainAppUrl: string;
  getProducerSource?: (producerId: string) => string | undefined;
  getProducerParticipant?: (producerId: string) => { participantId: string; participantName: string } | undefined;
  getProducerSoundboardAsset?: (producerId: string) => string | undefined;
  /** Volume for soundboard segment; prefers value captured when user stopped that item */
  getSoundboardVolumeForSegment?: (roomId: string, producerId: string) => number;
};

export class RecordingManager {
  private deps: RecordingManagerDeps;

  constructor(deps: RecordingManagerDeps) {
    this.deps = deps;
  }

  async addProducerToRecording(
    roomId: string,
    room: RoomState,
    state: RecordingState,
    producer: Producer,
  ): Promise<ActiveSegment | null> {
    const producerId = producer.id;
    const segmentId = nanoid();

    const routerCodec = room.router.rtpCapabilities.codecs?.find((c: { kind?: string }) => c.kind === "audio");
    const rtpCapabilities = {
      codecs: routerCodec ? [routerCodec] : [],
      headerExtensions: room.router.rtpCapabilities.headerExtensions ?? [],
    };

    const portIdx = state.nextPortIndex++;
    const rtpPort = state.portBase + portIdx * 4;
    const rtcpPort = state.portBase + portIdx * 4 + 1;

    const plainTransport = await room.router.createPlainTransport({
      listenIp: { ip: "127.0.0.1" },
      rtcpMux: false,
      comedia: false,
    });
    const consumer = await plainTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    const payloadType = consumer.rtpParameters.codecs?.[0]?.payloadType ?? 111;

    const recordingDirName = basename(state.episodeDir);
    const recorder = new SegmentRecorder({
      segmentId,
      producerId,
      recordingDataDir: this.deps.recordingDataDir,
      recordingDirName,
    });

    const ffmpeg = recorder.start(rtpPort, rtcpPort, payloadType);

    appendSegmentLog(state.jsonlPath, {
      segmentId,
      producerId,
      startMs: Date.now() - state.recordingStartedAt,
      tmpPath: recorder.getPartPath(),
      status: "RECORDING",
    });

    const source = this.deps.getProducerSource?.(producerId);
    const isSoundboard = source === "soundboard";
    const warmupMs = isSoundboard ? 50 : RECORDING_WARMUP_MS;
    const postConnectMs = isSoundboard ? 50 : 200;
    await new Promise((r) => setTimeout(r, warmupMs));
    await plainTransport.connect({
      ip: "127.0.0.1",
      port: rtpPort,
      rtcpPort,
    });
    await new Promise((r) => setTimeout(r, postConnectMs));
    await consumer.resume();

    const filePathRelative = join("recordings", recordingDirName, `segment_${segmentId}.mp3`);

    const now = Date.now();
    const activeSegment: ActiveSegment = {
      segmentId,
      producerId,
      consumer,
      plainTransport,
      recorder,
      ffmpeg,
      filePathRelative,
      startedAt: now,
      lastPacketCount: 0,
      lastPacketAtMs: now,
      ...(source ? { source } : {}),
    };

    const finalize = (reason: string) => this.finalizeProducerStream(roomId, state, producerId, reason);
    consumer.on("producerclose", () => finalize("left"));
    consumer.on("producerpause", () => finalize("paused"));
    producer.on("transportclose", () => finalize("transport closed"));

    return activeSegment;
  }

  finalizeProducerStream(roomId: string, state: RecordingState, producerId: string, _reason: string): void {
    this.finalizeProducerStreamAsync(roomId, state, producerId).catch(() => {
      /* log handled inside */
    });
  }

  async finalizeProducerStreamAsync(
    roomId: string,
    state: RecordingState,
    producerId: string,
  ): Promise<void> {
    const rec = this.deps.recordingByRoom.get(roomId);
    if (!rec || rec !== state) return;

    const seg = state.activeSegmentsByProducerId.get(producerId);
    if (!seg) return;

    state.finalizedProducerIds.add(producerId);
    state.activeSegmentsByProducerId.delete(producerId);

    // Delay to let in-flight RTP reach FFmpeg before we close (avoids losing last ~1s).
    const flushMs = Number(process.env.FINALIZE_RTP_FLUSH_MS) || 1200;
    await new Promise((r) => setTimeout(r, flushMs));

    try {
      seg.consumer.close();
    } catch {
      /* ignore */
    }
    try {
      seg.plainTransport.close();
    } catch {
      /* ignore */
    }

    const sigkill = setTimeout(() => {
      try {
        seg.ffmpeg.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 15000);
    const result = await seg.recorder.stop(15000);
    clearTimeout(sigkill);
    if (this.deps.recordingByRoom.get(roomId) !== state) return;
    const endMs = Date.now() - state.recordingStartedAt;
    if (result.success && result.filePath) {
      const volume = seg.source === "soundboard" ? (this.deps.getSoundboardVolumeForSegment?.(roomId, producerId) ?? 1) : undefined;
      state.finalizedSegments.push({
        segmentId: seg.segmentId,
        producerId,
        filePathRelative: result.filePath,
        startedAt: seg.startedAt,
        ...(seg.source ? { source: seg.source } : {}),
        ...(volume !== undefined ? { volume } : {}),
      });
      appendSegmentLog(state.jsonlPath, {
        segmentId: seg.segmentId,
        producerId,
        status: "FINALIZED",
        endMs,
        filePath: result.filePath,
      });
    } else {
      appendSegmentLog(state.jsonlPath, {
        segmentId: seg.segmentId,
        producerId,
        status: "INTERRUPTED",
        endMs,
      });
    }
  }

  /**
   * Run amix on all finalized MP3 segments to produce final WAV.
   */
  async runAmixAndDeliver(
    state: RecordingState,
    finalPath: string,
    doCallback: (fileOk: boolean, tracksManifest?: object, perTrackFilePaths?: string[]) => void,
    events?: Array<{ event: string; assetId?: string; clientTimestampMs?: number; durationSec?: number }>,
    recordingEndedAtMs?: number,
  ): Promise<void> {
    const allSegments = [...state.finalizedSegments];
    if (allSegments.length === 0) {
      doCallback(false);
      return;
    }

    const epochMs = state.recordingEpochMs ?? state.recordingStartedAt;
    const endMs = typeof recordingEndedAtMs === "number" ? recordingEndedAtMs : Date.now();
    const dataDir = this.deps.recordingDataDir;
    mkdirSync(dirname(finalPath), { recursive: true });

    const segmentsOut = allSegments.map((s) => {
      const source = this.deps.getProducerSource?.(s.producerId);
      const participant = this.deps.getProducerParticipant?.(s.producerId);
      const soundboardAssetId = this.deps.getProducerSoundboardAsset?.(s.producerId);
      const seg: Record<string, unknown> = {
        segmentId: s.segmentId,
        producerId: s.producerId,
        participantId: participant?.participantId ?? null,
        startMs: s.startedAt - epochMs,
        endMs: epochMs ? endMs - epochMs : 0,
        filePath: s.filePathRelative,
        codec: "mp3",
      };
      if (participant?.participantName) seg.participantName = participant.participantName;
      if (source === "soundboard") seg.source = "soundboard";
      if (source === "soundboard" && soundboardAssetId) seg.soundboardAssetId = soundboardAssetId;
      if (s.volume != null && s.volume !== 1) seg.volume = s.volume;
      return seg;
    });
    const tracksManifest = {
      recordingEpochMs: epochMs,
      sessionStartedAtEpochMs: state.recordingStartedAt,
      episodeId: state.episodeId,
      podcastId: state.podcastId,
      segments: segmentsOut,
      ...(events && events.length > 0 ? { events } : {}),
    };
    const perTrackFilePaths = allSegments.map((s) => s.filePathRelative);

    if (allSegments.length === 1) {
      const only = allSegments[0]!;
      const srcPath = join(dataDir, only.filePathRelative);
      if (existsSync(srcPath) && statSync(srcPath).size > 0) {
        const vol = only.volume != null && only.volume !== 1 ? only.volume : 1;
        const volFilter = vol !== 1 ? ["-af", `volume=${vol}`] : [];
        const proc = spawn("ffmpeg", [
          "-loglevel",
          "warning",
          "-i",
          srcPath,
          ...volFilter,
          "-acodec",
          "pcm_s16le",
          "-ar",
          "48000",
          "-ac",
          "1",
          "-y",
          finalPath,
        ]);
        proc.on("close", (code) => {
          const fileOk = code === 0 && existsSync(finalPath) && statSync(finalPath).size > 0;
          doCallback(fileOk, tracksManifest, perTrackFilePaths);
          // Per-track file left for server to copy
        });
      } else {
        doCallback(false);
      }
      return;
    }

    const recordingDurationMs = endMs - epochMs;
    const filterParts: string[] = [];
    const inputArgs: string[] = [];
    let inputIdx = 0;
    const MIN_SEGMENT_BYTES = 1024; // Skip near-empty segments (stall/corrupt) that break amix
    for (const s of allSegments) {
      const fullPath = join(dataDir, s.filePathRelative);
      const size = existsSync(fullPath) ? statSync(fullPath).size : 0;
      if (size < MIN_SEGMENT_BYTES) continue;
      const delayMs = Math.max(0, Math.round(s.startedAt - epochMs));
      const padDurationMs = Math.max(0, recordingDurationMs - delayMs);
      const padDurationSec = (padDurationMs / 1000).toFixed(3);
      inputArgs.push("-i", fullPath);
      const volPart = s.volume != null && s.volume !== 1 ? `,volume=${s.volume}` : "";
      filterParts.push(
        `[${inputIdx}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${padDurationSec}${volPart}[a${inputIdx}]`,
      );
      inputIdx++;
    }

    if (inputIdx === 0) {
      doCallback(false);
      return;
    }

    const amixInputs = Array.from({ length: inputIdx }, (_, i) => `[a${i}]`).join("");
    const filterComplex = filterParts.join(";") + ";" + `${amixInputs}amix=inputs=${inputIdx}:duration=longest[aout]`;
    const mixFf = spawn(
      "ffmpeg",
      [
        "-loglevel",
        "warning",
        ...inputArgs,
        "-filter_complex",
        filterComplex,
        "-map",
        "[aout]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-y",
        finalPath,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    mixFf.on("close", () => {
      const fileOk = existsSync(finalPath) && statSync(finalPath).size > 0;
      doCallback(fileOk, tracksManifest, perTrackFilePaths);
      // Per-track files are left for server to copy; server deletes after copy
    });
  }
}
