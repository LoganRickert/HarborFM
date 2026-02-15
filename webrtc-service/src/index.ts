import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import * as mediasoup from "mediasoup";
import { nanoid } from "nanoid";
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { spawn, type ChildProcess } from "child_process";
import { dirname, join } from "path";
import { RecordingManager } from "./recording/RecordingManager.js";
import {
  recoverPartFiles,
  markInterruptedSegments,
  appendSegmentLog,
} from "./recording/segmentMetadata.js";

type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type Producer = mediasoup.types.Producer;

const PORT = Number(process.env.PORT) || 3002;

/** Format current local time as YYYYMMDD_HHMMSS for recording folder names (matches segments format). */
function formatDateTimeForFolder(): string {
  const d = new Date();
  const y = String(d.getFullYear());
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}${mo}${day}_${h}${min}${s}`;
}
const RTC_MIN_PORT = Number(process.env.RTC_MIN_PORT) || 40000;
const RTC_MAX_PORT = Number(process.env.RTC_MAX_PORT) || 40200;
const ANNOUNCED_IP = process.env.MEDIASOUP_ANNOUNCED_IP?.trim() || undefined;

type RoomState = {
  router: Router;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
};

type RecordingMeta = {
  filePathRelative: string;
  segmentId: string;
  episodeId: string;
  podcastId: string;
  name: string | null;
  sessionId: string | null;
  recordingCallbackSecret: string | null;
};

type RecordingState = RecordingMeta & {
  activeSegmentsByProducerId: Map<string, import("./recording/RecordingManager.js").ActiveSegment>;
  finalizedSegments: import("./recording/RecordingManager.js").FinalizedSegmentInfo[];
  finalizedProducerIds: Set<string>;
  recordingStartedAt: number;
  recordingEpochMs: number;
  portBase: number;
  nextPortIndex: number;
  sessionSegmentId: string;
  episodeDir: string;
  jsonlPath: string;
  checkStorageInterval?: ReturnType<typeof setInterval>;
  producerCheckInterval?: ReturnType<typeof setInterval>;
  heartbeatInterval?: ReturnType<typeof setInterval>;
};

const RECORDING_DATA_DIR = process.env.RECORDING_DATA_DIR?.trim() || process.env.DATA_DIR?.trim() || "/data";
const RECORD_PORT_BASE = 50000;
/** Stride to avoid port conflict when starting a new recording before the previous FFmpeg has released ports. */
const RECORD_PORT_STRIDE = 128;
let recordPortOffsetCounter = 0;

const rooms = new Map<string, RoomState>();
const producerSourceMap = new Map<string, string>(); // producerId -> "soundboard" | etc
const producerParticipantMap = new Map<string, { participantId: string; participantName: string }>();
const producerSoundboardAssetMap = new Map<string, string>(); // producerId -> assetId
const soundboardVolumeByRoom = new Map<string, number>(); // roomId -> 0..1, default 1
/** Volume when user stopped this soundboard producer (captured at stopSoundboard, not at recording stop) */
const soundboardVolumeAtStop = new Map<string, number>(); // producerId -> volume
type SoundboardState = {
  producer: mediasoup.types.Producer;
  transport: mediasoup.types.PlainTransport;
  ffmpeg: ChildProcess;
  tempPath: string;
};
const soundboardByRoom = new Map<string, SoundboardState>();
let worker: mediasoup.types.Worker | null = null;
const recordingByRoom = new Map<string, RecordingState>();

const MAIN_APP_URL = process.env.MAIN_APP_URL?.trim() || "";

const recordingManager = new RecordingManager({
  recordingDataDir: RECORDING_DATA_DIR,
  recordPortBase: RECORD_PORT_BASE,
  recordPortStride: RECORD_PORT_STRIDE,
  getRoom,
  recordingByRoom,
  mainAppUrl: MAIN_APP_URL,
  getProducerSource: (producerId) => producerSourceMap.get(producerId),
  getProducerParticipant: (producerId) => producerParticipantMap.get(producerId),
  getProducerSoundboardAsset: (producerId) => producerSoundboardAssetMap.get(producerId),
  getSoundboardVolumeForSegment: (roomId, producerId) => {
    const atStop = soundboardVolumeAtStop.get(producerId);
    if (atStop != null) {
      soundboardVolumeAtStop.delete(producerId);
      return atStop;
    }
    return soundboardVolumeByRoom.get(roomId) ?? 1;
  },
});

async function getWorker(): Promise<mediasoup.types.Worker> {
  if (worker) return worker;
  console.log("[webrtc] Creating mediasoup worker RTC_MIN_PORT=%d RTC_MAX_PORT=%d ANNOUNCED_IP=%s", RTC_MIN_PORT, RTC_MAX_PORT, ANNOUNCED_IP ?? "(none)");
  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: RTC_MIN_PORT,
    rtcMaxPort: RTC_MAX_PORT,
  });
  worker.on("died", (err) => {
    console.log("[webrtc] Worker died: %s", err);
    worker = null;
  });
  console.log("[webrtc] Worker created pid=%d", worker.pid);
  return worker;
}

function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId);
}

/** Producer IDs whose WebRtcTransport is connected (iceState=completed, dtlsState=connected).
 * Also includes server-side producers (e.g. soundboard on PlainTransport) - they are always "connected". */
async function getProducerIdsOnConnectedTransports(room: RoomState): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const transport of room.transports.values()) {
    if (transport.iceState === "completed" && transport.dtlsState === "connected") {
      try {
        const dump = await transport.dump();
        for (const pid of dump.producerIds ?? []) ids.add(pid);
      } catch { /* ignore */ }
    }
  }
  for (const pid of producerSourceMap.keys()) {
    if (room.producers.has(pid)) ids.add(pid);
  }
  return ids;
}

/** Find the WebRtcTransport that has the given producer. */
async function getTransportForProducer(room: RoomState, producerId: string): Promise<WebRtcTransport | null> {
  for (const transport of room.transports.values()) {
    try {
      const dump = await transport.dump();
      if ((dump.producerIds ?? []).includes(producerId)) return transport;
    } catch { /* ignore */ }
  }
  return null;
}

function finalizeProducerStream(
  roomId: string,
  state: RecordingState,
  producerId: string,
  reason: string,
): void {
  console.log("[webrtc] finalizeStream roomId=%s producerId=%s reason=%s", roomId, producerId, reason);
  recordingManager.finalizeProducerStream(roomId, state, producerId, reason);
}

const app = Fastify({ logger: true });
await app.register(fastifyWebsocket);

// Accept application/json (with or without charset) - use regex for robust matching
app.addContentTypeParser(/^application\/json\b/i, { parseAs: "string" }, (req, body, done) => {
  try {
    const str = (body as string) ?? "";
    done(null, str.trim() ? JSON.parse(str) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get("/health", async (_request, reply) => reply.send({ ok: true }));

app.post<{
  Body: { roomId?: string };
  Reply: { roomId: string; rtpCapabilities: mediasoup.types.RtpCapabilities };
}>("/room", async (request, reply) => {
  const body = request.body as { roomId?: string } | undefined;
  const roomId = body?.roomId ?? nanoid(10);
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId)!;
    const producerIds = Array.from(room.producers.keys());
    console.log("[webrtc] POST /room roomId=%s (existing) transports=%d producers=%d producerIds=%j",
      roomId, room.transports.size, room.producers.size, producerIds);
    return reply.send({ roomId, rtpCapabilities: room.router.rtpCapabilities });
  }
  console.log("[webrtc] POST /room creating new roomId=%s", roomId);
  const w = await getWorker();
  const router = await w.createRouter({
    mediaCodecs: [
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    ],
  });
  router.on("workerclose", () => {
    console.log("[webrtc] roomId=%s router closed (worker died)", roomId);
    rooms.delete(roomId);
  });
  rooms.set(roomId, { router, transports: new Map(), producers: new Map() });
  console.log("[webrtc] POST /room roomId=%s created routerId=%s", roomId, router.id);
  return reply.send({ roomId, rtpCapabilities: router.rtpCapabilities });
});

app.post<{
  Body: RecordingMeta & { roomId: string; filePathRelative?: string; filePath?: string; clientEpochMs?: number };
}>("/start-recording", async (request, reply) => {
  const body = (request.body ?? {}) as RecordingMeta & {
    roomId: string;
    filePathRelative?: string;
    filePath?: string;
    clientEpochMs?: number;
    recordingCallbackSecret?: string;
  };
  const filePathRelative = body.filePathRelative ?? body.filePath;
  const { roomId, segmentId, episodeId, podcastId, name, sessionId, recordingCallbackSecret } = body;
  const clientEpochMs = (body as { clientEpochMs?: number }).clientEpochMs;

  const missing: string[] = [];
  if (!roomId) missing.push("roomId");
  if (!filePathRelative) missing.push("filePathRelative");
  if (!segmentId) missing.push("segmentId");
  if (!episodeId) missing.push("episodeId");
  if (!podcastId) missing.push("podcastId");

  if (missing.length > 0) {
    request.log.warn(
      {
        body: { ...body, recordingCallbackSecret: "[redacted]" },
        missing,
        contentType: request.headers["content-type"],
      },
      "start-recording validation failed",
    );
    return reply.status(400).send({ error: "Missing required fields", missing });
  }
  const room = getRoom(roomId);
  if (!room) return reply.status(404).send({ error: "Room not found" });

  const existingForEpisode = Array.from(recordingByRoom.values()).find((s) => s.episodeId === episodeId);
  if (existingForEpisode) {
    console.log("[webrtc] POST /start-recording roomId=%s episodeId=%s rejected: recording already in progress", roomId, episodeId);
    return reply.status(409).send({ error: "A recording is already in progress for this episode." });
  }

  const audioProducers = Array.from(room.producers.values()).filter((p) => p.kind === "audio");
  const unpausedAudioProducers = audioProducers.filter((p) => !p.paused);
  const allProducerIds = Array.from(room.producers.values()).map((p) => ({ id: p.id, kind: p.kind, paused: p.paused }));
  console.log("[webrtc] POST /start-recording roomId=%s segmentId=%s totalProducers=%d audioProducers=%d unpaused=%d producers=%j",
    roomId, segmentId, room.producers.size, audioProducers.length, unpausedAudioProducers.length, allProducerIds);
  if (audioProducers.length === 0) {
    console.log("[webrtc] POST /start-recording roomId=%s rejected: no audio producer", roomId);
    return reply.status(400).send({ error: "No audio producer in room" });
  }
  if (unpausedAudioProducers.length === 0) {
    console.log("[webrtc] POST /start-recording roomId=%s rejected: all audio producers paused", roomId);
    return reply.status(400).send({ error: "All audio producers are paused" });
  }

  let allProducersNoPackets = true;
  let anyProducerPaused = false;
  const producerIdsWithPackets = new Set<string>();
  for (let i = 0; i < audioProducers.length; i++) {
    const producer = audioProducers[i]!;
    try {
      const stats = await producer.getStats();
      // mediasoup Producer stats use byteCount/packetCount (RtpStreamRecvStats), not bytesReceived/packetsReceived
      const bytesReceived = (stats as Array<{ byteCount?: number }>).reduce((sum, s) => sum + (s.byteCount ?? 0), 0);
      const packetsReceived = (stats as Array<{ packetCount?: number }>).reduce((sum, s) => sum + (s.packetCount ?? 0), 0);
      const paused = producer.paused;
      console.log("[webrtc] start-recording roomId=%s producer %d id=%s paused=%s byteCount=%d packetCount=%d statsLength=%d rawStats=%j",
        roomId, i, producer.id, paused, bytesReceived, packetsReceived, stats.length, stats);
      if (bytesReceived > 0 || packetsReceived > 0) {
        allProducersNoPackets = false;
        producerIdsWithPackets.add(producer.id);
      }
      if (paused) anyProducerPaused = true;
      if (bytesReceived === 0 && packetsReceived === 0) {
        console.log("[webrtc] start-recording roomId=%s WARNING producer %s has received no packets (check MEDIASOUP_ANNOUNCED_IP=%s UDP %d-%d)",
          roomId, producer.id, ANNOUNCED_IP ?? "unset", RTC_MIN_PORT, RTC_MAX_PORT);
        for (const wt of room.transports.values()) {
          try {
            const tStats = await wt.getStats();
            const iceTuple = (tStats as Array<{ iceState?: string; iceSelectedTuple?: unknown }>)[0]?.iceSelectedTuple;
            const iceState = (tStats as Array<{ iceState?: string }>)[0]?.iceState;
            console.log("[webrtc] start-recording roomId=%s transport %s iceState=%s iceSelectedTuple=%j bytesReceived=%s stats=%j",
              roomId, wt.id, iceState ?? "?", iceTuple ?? "?", (tStats as Array<{ bytesReceived?: number }>)[0]?.bytesReceived ?? "?", tStats);
          } catch (te) {
            console.log("[webrtc] start-recording roomId=%s transport %s getStats failed: %s", roomId, wt.id, te);
          }
        }
      }
      if (paused) {
        console.log("[webrtc] start-recording roomId=%s WARNING producer %s is paused (muted) - no audio will be recorded", roomId, producer.id);
      }
    } catch (e) {
      request.log.warn({ err: e, producerId: producer.id }, "Could not get producer stats");
      console.log("[webrtc] start-recording roomId=%s producer %s getStats threw: %s", roomId, producer.id, e);
    }
  }
  if (allProducersNoPackets) {
    console.log("[webrtc] start-recording roomId=%s rejected: no producer has received any RTP packets (ICE/connectivity issue) ANNOUNCED_IP=%s RTC_PORTS=%d-%d",
      roomId, ANNOUNCED_IP ?? "unset", RTC_MIN_PORT, RTC_MAX_PORT);
    return reply.status(400).send({
      error: "No audio received from any participant. Ensure UDP ports " + RTC_MIN_PORT + "-" + RTC_MAX_PORT + " are both open and reachable. If behind NAT, set MEDIASOUP_ANNOUNCED_IP to your server's public IP.",
    });
  }
  if (anyProducerPaused && audioProducers.every((p) => p.paused)) {
    console.log("[webrtc] start-recording roomId=%s rejected: all producers are muted", roomId);
    return reply.status(400).send({ error: "Unmute your microphone before recording." });
  }

  const producerIdsOnConnectedTransports = await getProducerIdsOnConnectedTransports(room);
  const recordableProducers = unpausedAudioProducers.filter(
    (p) => producerIdsWithPackets.has(p.id) && producerIdsOnConnectedTransports.has(p.id)
  );
  if (recordableProducers.length === 0) {
    console.log("[webrtc] start-recording roomId=%s rejected: no unpaused producer has received RTP on connected transport producerIdsWithPackets=%j onConnected=%j unpausedIds=%j",
      roomId, Array.from(producerIdsWithPackets), Array.from(producerIdsOnConnectedTransports), unpausedAudioProducers.map((p) => p.id));
    return reply.status(400).send({ error: "No audio received from unmuted participants. Wait for the call to connect before recording." });
  }
  const skippedNoPackets = unpausedAudioProducers.filter((p) => !producerIdsWithPackets.has(p.id));
  const skippedNotConnected = unpausedAudioProducers.filter((p) => producerIdsWithPackets.has(p.id) && !producerIdsOnConnectedTransports.has(p.id));
  for (const p of skippedNoPackets) {
    console.log("[webrtc] start-recording roomId=%s skipping producer %s (0 packets)", roomId, p.id);
  }
  for (const p of skippedNotConnected) {
    console.log("[webrtc] start-recording roomId=%s skipping producer %s (transport not connected: iceState/dtlsState)", roomId, p.id);
  }

  const secret = recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || null;
  const meta: RecordingMeta = { filePathRelative, segmentId, episodeId, podcastId, name: name ?? null, sessionId: sessionId ?? null, recordingCallbackSecret: secret };

  try {
    const portOffset = (recordPortOffsetCounter++ * RECORD_PORT_STRIDE) % 10000;
    const portBase = RECORD_PORT_BASE + portOffset;
    const recordingStartedAt = Date.now();
    const recordingEpochMs = typeof clientEpochMs === "number" ? clientEpochMs : recordingStartedAt;
    const recordingDirName = `${formatDateTimeForFolder()}_${episodeId}`;
    const episodeDir = join(RECORDING_DATA_DIR, "recordings", recordingDirName);
    const jsonlPath = join(episodeDir, "segments.jsonl");
    mkdirSync(episodeDir, { recursive: true });

    const activeSegmentsByProducerId = new Map<string, import("./recording/RecordingManager.js").ActiveSegment>();
    const finalizedSegments: import("./recording/RecordingManager.js").FinalizedSegmentInfo[] = [];
    const finalizedProducerIds = new Set<string>();

    const state: RecordingState = {
      ...meta,
      activeSegmentsByProducerId,
      finalizedSegments,
      finalizedProducerIds,
      recordingStartedAt,
      recordingEpochMs,
      portBase,
      nextPortIndex: 0,
      sessionSegmentId: segmentId,
      episodeDir,
      jsonlPath,
    };
    recordingByRoom.set(roomId, state);

    console.log("[webrtc] start-recording roomId=%s creating per-producer streams portBase=%d recordable=%d", roomId, portBase, recordableProducers.length);
    for (const producer of recordableProducers) {
      const seg = await recordingManager.addProducerToRecording(roomId, room, state, producer);
      if (seg) {
        activeSegmentsByProducerId.set(producer.id, seg);
        ffmpegStderrLogger(seg.ffmpeg, roomId, producer.id, request.log);
        console.log("[webrtc] start-recording roomId=%s added producer %s", roomId, producer.id);
      }
    }

    const secretStr = meta.recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
    let checkStorageInterval: ReturnType<typeof setInterval> | undefined;
    if (MAIN_APP_URL && secretStr && meta.sessionId) {
      checkStorageInterval = setInterval(async () => {
        const rec = recordingByRoom.get(roomId);
        if (!rec || rec !== state) return;
        try {
          let size = 0;
          for (const seg of rec.activeSegmentsByProducerId.values()) {
            const p = seg.recorder.getPartPath();
            if (existsSync(p)) size += statSync(p).size;
          }
          for (const fs of rec.finalizedSegments) {
            const p = join(RECORDING_DATA_DIR, fs.filePathRelative);
            if (existsSync(p)) size += statSync(p).size;
          }
          const res = await fetch(`${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-check-storage`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Recording-Secret": secretStr },
            body: JSON.stringify({ sessionId: meta.sessionId, bytesRecordedSoFar: size }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { stop?: boolean; error?: string };
          if (data.stop && data.error) {
            console.log("[webrtc] Storage limit reached roomId=%s bytesRecorded=%d stopping", roomId, size);
            recordingByRoom.delete(roomId);
            if (rec.checkStorageInterval) clearInterval(rec.checkStorageInterval);
            if (rec.producerCheckInterval) clearInterval(rec.producerCheckInterval);
            for (const seg of rec.activeSegmentsByProducerId.values()) {
              try { seg.consumer.close(); } catch { /* ignore */ }
              try { seg.plainTransport.close(); } catch { /* ignore */ }
              seg.ffmpeg.kill("SIGINT");
            }
            await fetch(`${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-error`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Recording-Secret": secretStr },
              body: JSON.stringify({ sessionId: meta.sessionId, error: data.error }),
            });
          }
        } catch (e) {
          request.log.warn({ err: e }, "recording-check-storage failed");
        }
      }, 20000);
    }

    const STALL_THRESHOLD_MS = 15000;
    const finalizedThisTick = new Set<string>();
    const producerCheckInterval = setInterval(async () => {
      const rec = recordingByRoom.get(roomId);
      if (!rec || rec !== state) return;
      const roomState = getRoom(roomId);
      if (!roomState) return;
      finalizedThisTick.clear();

      // Segment watchdog: detect stalls (no packets for STALL_THRESHOLD_MS)
      const now = Date.now();
      for (const [producerId, seg] of rec.activeSegmentsByProducerId) {
        try {
          const stats = await seg.consumer.getStats();
          const packetCount = (stats as Array<{ packetCount?: number }>).reduce((sum, s) => sum + (s.packetCount ?? 0), 0);
          if (packetCount > seg.lastPacketCount) {
            seg.lastPacketCount = packetCount;
            seg.lastPacketAtMs = now;
          }
          if (now - seg.lastPacketAtMs >= STALL_THRESHOLD_MS && now - seg.startedAt > 5000) {
            const producerStillInRoom = roomState.producers.has(producerId);
            const roomProducerIds = Array.from(roomState.producers.keys());
            console.log("[webrtc] segment watchdog STALL_CANDIDATE producerId=%s segmentId=%s producerStillInRoom=%s roomProducers=%j noPacketsMs=%d",
              producerId, seg.segmentId, producerStillInRoom, roomProducerIds, now - seg.lastPacketAtMs);
            // Finalize without sending recording-error. A stall (one producer stopped) is not fatal:
            // recording continues with remaining producers. Sending recording-error makes the client
            // set recording=false, so the user can't click Stop → we never get stop-recording →
            // no segments are ever written.
            if (!producerStillInRoom) {
              console.log("[webrtc] segment watchdog roomId=%s producerId=%s segmentId=%s producer closed, finalizing", roomId, producerId, seg.segmentId);
            } else {
              request.log.warn({ roomId, episodeId: rec.episodeId, producerId, segmentId: seg.segmentId }, "Recording segment stall detected");
              console.log("[webrtc] segment watchdog roomId=%s producerId=%s segmentId=%s STALL (no packets for %dms) - finalizing, recording continues", roomId, producerId, seg.segmentId, STALL_THRESHOLD_MS);
              appendSegmentLog(rec.jsonlPath, { segmentId: seg.segmentId, producerId, status: "DEGRADED" });
            }
            finalizedThisTick.add(producerId);
            finalizeProducerStream(roomId, rec, producerId, producerStillInRoom ? "stall" : "producer closed");
          }
        } catch (e) {
          request.log.warn({ err: e, producerId }, "segment watchdog getStats failed");
        }
      }

      // Health check: finalize streams whose transport has gone disconnected (ICE/DTLS)
      const toFinalize: string[] = [];
      for (const [producerId] of rec.activeSegmentsByProducerId) {
        const transport = await getTransportForProducer(roomState, producerId);
        if (!transport) continue; // producer may have been removed
        if (transport.iceState !== "completed" || transport.dtlsState !== "connected") {
          console.log("[webrtc] producerCheckInterval roomId=%s finalize producerId=%s (transport disconnected iceState=%s dtlsState=%s)",
            roomId, producerId, transport.iceState, transport.dtlsState);
          toFinalize.push(producerId);
        }
      }
      for (const producerId of toFinalize) {
        finalizedThisTick.add(producerId);
        finalizeProducerStream(roomId, rec, producerId, "transport disconnected");
      }

      const currentIds = new Set(rec.activeSegmentsByProducerId.keys());
      for (const fs of rec.finalizedSegments) currentIds.add(fs.producerId);
      for (const id of finalizedThisTick) currentIds.add(id);
      for (const id of rec.finalizedProducerIds) currentIds.add(id); // never re-add finalized producers
      if (finalizedThisTick.size > 0) {
        console.log("[webrtc] producerCheckInterval roomId=%s finalizedThisTick=%j finalizedProducerIds=%d (blocking re-add)",
          roomId, Array.from(finalizedThisTick), rec.finalizedProducerIds.size);
      }
      const allAudio = Array.from(roomState.producers.values()).filter((p) => p.kind === "audio");
      const newUnpaused = allAudio.filter((p) => !p.paused && !currentIds.has(p.id));
      const onConnectedTransports = await getProducerIdsOnConnectedTransports(roomState);
      const withPackets: Producer[] = [];
      for (const producer of newUnpaused) {
        if (!onConnectedTransports.has(producer.id)) {
          console.log("[webrtc] producerCheckInterval roomId=%s skip producerId=%s (transport not connected)", roomId, producer.id);
          continue;
        }
        try {
          const stats = await producer.getStats();
          const bytesReceived = (stats as Array<{ byteCount?: number }>).reduce((sum, s) => sum + (s.byteCount ?? 0), 0);
          const packetsReceived = (stats as Array<{ packetCount?: number }>).reduce((sum, s) => sum + (s.packetCount ?? 0), 0);
          if (bytesReceived > 0 || packetsReceived > 0) withPackets.push(producer);
          else console.log("[webrtc] producerCheckInterval roomId=%s skip producerId=%s (0 packets)", roomId, producer.id);
        } catch (e) {
          console.log("[webrtc] producerCheckInterval roomId=%s producerId=%s getStats failed: %s", roomId, producer.id, e);
        }
      }
      if (newUnpaused.length > 0 || withPackets.length > 0 || finalizedThisTick.size > 0) {
        const excludedByFinalized = allAudio.filter((p) => !p.paused && rec.finalizedProducerIds.has(p.id));
        console.log("[webrtc] producerCheckInterval roomId=%s active=%d finalized=%d finalizedIds=%d roomAudio=%d newUnpaused=%d withPackets=%d excludedByFinalized=%j currentIds=%j",
          roomId, rec.activeSegmentsByProducerId.size, rec.finalizedSegments.length, rec.finalizedProducerIds.size,
          allAudio.length, newUnpaused.length, withPackets.length,
          excludedByFinalized.map((p) => p.id), Array.from(currentIds));
      }
      for (const producer of withPackets) {
        console.log("[webrtc] producerCheckInterval roomId=%s adding late-joiner producerId=%s (not in finalizedProducerIds)",
          roomId, producer.id);
        recordingManager.addProducerToRecording(roomId, roomState, rec, producer)
          .then((seg) => {
            if (seg && recordingByRoom.get(roomId) === state) {
              rec.activeSegmentsByProducerId.set(producer.id, seg);
              ffmpegStderrLogger(seg.ffmpeg, roomId, producer.id, request.log);
              console.log("[webrtc] recording roomId=%s added late-joiner producer %s", roomId, producer.id);
            } else {
              console.log("[webrtc] producerCheckInterval roomId=%s late-joiner producerId=%s seg=%s stateMatch=%s", roomId, producer.id, !!seg, recordingByRoom.get(roomId) === state);
            }
          })
          .catch((err) => {
            console.log("[webrtc] producerCheckInterval roomId=%s addProducerToRecording FAILED producerId=%s: %s", roomId, producer.id, err);
            request.log.warn({ err, producerId: producer.id }, "addProducerToRecording failed");
          });
      }
    }, 2500);

    const heartbeatInterval = setInterval(() => {
      const rec = recordingByRoom.get(roomId);
      if (!rec || rec !== state) return;
      const now = Date.now();
      for (const seg of rec.activeSegmentsByProducerId.values()) {
        appendSegmentLog(rec.jsonlPath, {
          segmentId: seg.segmentId,
          producerId: seg.producerId,
          lastSeenMs: now - rec.recordingStartedAt,
          status: "RECORDING",
        });
      }
    }, 10000);
    state.heartbeatInterval = heartbeatInterval;
    state.checkStorageInterval = checkStorageInterval;
    state.producerCheckInterval = producerCheckInterval;

    console.log("[webrtc] POST /start-recording roomId=%s started ok streams=%d", roomId, activeSegmentsByProducerId.size);
    return reply.send({ ok: true, recordingEpochMs });
  } catch (err) {
    request.log.error({ err }, "Failed to start recording");
    return reply.status(500).send({ error: "Failed to start recording" });
  }
});

function ffmpegStderrLogger(
  ffmpeg: ChildProcess,
  roomId: string,
  producerId: string,
  log: { info: (o: object, msg: string) => void },
): void {
  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      log.info({ ffmpeg: line, producerId }, "FFmpeg stderr");
      console.log("[webrtc] FFmpeg roomId=%s producerId=%s: %s", roomId, producerId, line);
    }
  });
}

app.post<{ Body: { roomId: string; events?: Array<{ event: string; assetId?: string; clientTimestampMs?: number; durationSec?: number }>; recordingEndedAtMs?: number } }>("/stop-recording", async (request, reply) => {
  const body = request.body as { roomId: string; events?: Array<{ event: string; assetId?: string; clientTimestampMs?: number; durationSec?: number }>; recordingEndedAtMs?: number };
  const { roomId, events, recordingEndedAtMs } = body;
  if (!roomId) return reply.status(400).send({ error: "roomId required" });
  const state = recordingByRoom.get(roomId);
  // Don't delete yet - finalizeProducerStreamAsync needs state in map to push to finalizedSegments
  console.log("[webrtc] POST /stop-recording roomId=%s hadState=%s filePath=%s activeSegments=%d finalizedSegments=%d",
    roomId, !!state, state?.filePathRelative ?? "n/a", state?.activeSegmentsByProducerId.size ?? 0, state?.finalizedSegments.length ?? 0);
  if (!state) return reply.send({ ok: true });
  if (state.checkStorageInterval) clearInterval(state.checkStorageInterval);
  if (state.producerCheckInterval) clearInterval(state.producerCheckInterval);
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  for (const [pid, seg] of state.activeSegmentsByProducerId) {
    console.log("[webrtc] stop-recording roomId=%s activeSegment %s file=%s startedAt=%d", roomId, pid, seg.filePathRelative, seg.startedAt);
  }
  for (const fs of state.finalizedSegments) {
    console.log("[webrtc] stop-recording roomId=%s finalizedSegment %s file=%s startedAt=%d", roomId, fs.producerId, fs.filePathRelative, fs.startedAt);
  }

  const secret = state.recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
  const doCallback = (fileOk: boolean, tracksManifest?: object, perTrackFilePaths?: string[]) => {
    if (!MAIN_APP_URL || !secret) return;

    if (!fileOk) {
      const errorUrl = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-error`;
      console.log("[webrtc] Recording file missing or empty roomId=%s segmentId=%s notifying recording-error", roomId, state.segmentId);
      fetch(errorUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
        body: JSON.stringify({ sessionId: state.sessionId, error: "Recording produced no audio. The recording may have been stopped before any audio was captured." }),
      }).catch((err) => request.log.error({ err }, "recording-error callback failed"));
      return;
    }

    const callbackUrl = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-segment`;
    request.log.info({ callbackUrl, filePath: state.filePathRelative }, "Firing recording callback");
    console.log("[webrtc] Firing recording callback roomId=%s segmentId=%s filePath=%s", roomId, state.segmentId, state.filePathRelative);
    const bodyPayload: Record<string, unknown> = {
      filePath: state.filePathRelative,
      segmentId: state.segmentId,
      episodeId: state.episodeId,
      podcastId: state.podcastId,
      name: state.name,
      sessionId: state.sessionId,
    };
    if (tracksManifest) bodyPayload.tracksManifest = tracksManifest;
    if (perTrackFilePaths) bodyPayload.perTrackFilePaths = perTrackFilePaths;
    fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
      body: JSON.stringify(bodyPayload),
    })
      .then(async (res) => {
        if (res.ok) {
          request.log.info({ status: res.status }, "Recording callback succeeded");
          console.log("[webrtc] Recording callback roomId=%s segmentId=%s OK", roomId, state.segmentId);
        } else {
          const body = await res.text();
          request.log.warn({ status: res.status, body }, "Recording callback failed");
          console.log("[webrtc] Recording callback roomId=%s segmentId=%s FAILED status=%d body=%s", roomId, state.segmentId, res.status, body);
        }
      })
      .catch((err) => {
        request.log.error({ err }, "Recording callback failed");
        console.log("[webrtc] Recording callback roomId=%s segmentId=%s ERROR %s", roomId, state.segmentId, err);
      });
  };

  const activeProducerIds = Array.from(state.activeSegmentsByProducerId.keys());
  console.log("[webrtc] stop-recording roomId=%s finalizing %d active segments, already finalized=%d",
    roomId, activeProducerIds.length, state.finalizedSegments.length);

  Promise.all(
    activeProducerIds.map((producerId) =>
      recordingManager.finalizeProducerStreamAsync(roomId, state, producerId),
    ),
  ).then(() => {
    recordingByRoom.delete(roomId);
    const allSegments = [...state.finalizedSegments];
    console.log("[webrtc] stop-recording roomId=%s all segments finalized count=%d streams=%j",
      roomId, allSegments.length, allSegments.map((s) => ({ id: s.producerId, file: s.filePathRelative, size: existsSync(join(RECORDING_DATA_DIR, s.filePathRelative)) ? statSync(join(RECORDING_DATA_DIR, s.filePathRelative)).size : -1 })));
    const finalPath = join(RECORDING_DATA_DIR, state.filePathRelative);
    recordingManager.runAmixAndDeliver(
      state,
      finalPath,
      doCallback,
      Array.isArray(events) ? events : undefined,
      typeof recordingEndedAtMs === "number" ? recordingEndedAtMs : undefined,
    );
  });

  return reply.send({ ok: true });
});

const socketRooms = new Map<unknown, string>();
const socketTransports = new Map<unknown, WebRtcTransport>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wsHandler = async (socket: any, req: any) => {
  const url = new URL(req.url ?? "", `http://${req.headers?.host ?? "localhost"}`);
  const roomId = url.searchParams.get("roomId");
  const wsUrl = req.url ?? "?";
  if (!roomId) {
    console.log("[webrtc] WS rejected: no roomId url=%s", wsUrl);
    socket.close();
    return;
  }
  let room = getRoom(roomId);
  if (!room) {
    console.log("[webrtc] WS roomId=%s not found, creating on-demand (webrtc may have restarted)", roomId);
    try {
      const w = await getWorker();
      const router = await w.createRouter({
        mediaCodecs: [
          { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
        ],
      });
      router.on("workerclose", () => {
        console.log("[webrtc] roomId=%s router closed (worker died)", roomId);
        rooms.delete(roomId);
      });
      room = { router, transports: new Map(), producers: new Map() };
      rooms.set(roomId, room);
      console.log("[webrtc] WS roomId=%s created on-demand routerId=%s", roomId, router.id);
    } catch (err) {
      console.log("[webrtc] WS failed to create room roomId=%s: %s", roomId, err);
      socket.close();
      return;
    }
  }
  socketRooms.set(socket, roomId);
  const producerIds = Array.from(room.producers.keys());
  const transportIds = Array.from(room.transports.keys());
  console.log("[webrtc] WS connected roomId=%s transports=%d producers=%d transportIds=%j producerIds=%j",
    roomId, room.transports.size, room.producers.size, transportIds, producerIds);

  socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch { return; }
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    const type = (msg as { type: string }).type;
    console.log("[webrtc] WS message roomId=%s type=%s", roomId, type);
    const roomState = getRoom(roomId);
    if (!roomState) return;
    try {
      if (type === "getRouterRtpCapabilities") {
        console.log("[webrtc] WS roomId=%s getRouterRtpCapabilities", roomId);
        socket.send(JSON.stringify({ type: "routerRtpCapabilities", rtpCapabilities: roomState.router.rtpCapabilities }));
        return;
      }
      if (type === "createWebRtcTransport") {
        const transport = await roomState.router.createWebRtcTransport({
          listenIps: [{ ip: "0.0.0.0", announcedIp: ANNOUNCED_IP }],
          enableUdp: true,
          enableTcp: true,
        });
        roomState.transports.set(transport.id, transport);
        socketTransports.set(socket, transport);
        transport.on("@close", () => {
          roomState.transports.delete(transport.id);
          socketTransports.delete(socket);
          console.log("[webrtc] WS roomId=%s transport closed id=%s transportsRemaining=%d", roomId, transport.id, roomState.transports.size);
        });
        const iceCandidates = transport.iceCandidates ?? [];
        const iceSummary = iceCandidates.map((c) => `${c.protocol}:${c.address ?? "?"}:${c.port ?? "?"}`).join(" ");
        console.log("[webrtc] WS roomId=%s createWebRtcTransport id=%s announcedIp=%s iceCandidates=%d [%s]",
          roomId, transport.id, ANNOUNCED_IP ?? "(none)", iceCandidates.length, iceSummary);
        socket.send(JSON.stringify({
          type: "webRtcTransportCreated",
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        }));
        return;
      }
      if (type === "connectWebRtcTransport") {
        const { transportId, dtlsParameters } = msg as unknown as { transportId: string; dtlsParameters: mediasoup.types.DtlsParameters };
        const transport = roomState.transports.get(transportId);
        if (!transport) {
          console.log("[webrtc] WS roomId=%s connectWebRtcTransport FAILED transportId=%s not found (transports=%j)", roomId, transportId, Array.from(roomState.transports.keys()));
          socket.send(JSON.stringify({ type: "error", error: "Transport not found" }));
          return;
        }
        await transport.connect({ dtlsParameters });
        let dtlsState = "?";
        try {
          const st = await transport.getStats();
          dtlsState = (st as Array<{ dtlsState?: string }>)[0]?.dtlsState ?? "?";
        } catch { /* ignore */ }
        console.log("[webrtc] WS roomId=%s connectWebRtcTransport transportId=%s dtlsState=%s", roomId, (msg as { transportId?: string }).transportId, dtlsState);
        socket.send(JSON.stringify({ type: "webRtcTransportConnected" }));
        return;
      }
      if (type === "produce") {
        const { transportId, kind, rtpParameters, source } = msg as unknown as { transportId: string; kind: mediasoup.types.MediaKind; rtpParameters: mediasoup.types.RtpParameters; source?: string };
        const transport = roomState.transports.get(transportId);
        if (!transport) {
          console.log("[webrtc] WS roomId=%s produce FAILED transportId=%s not found (transports=%j)", roomId, transportId, Array.from(roomState.transports.keys()));
          socket.send(JSON.stringify({ type: "error", error: "Transport not found" }));
          return;
        }
        const producer = await transport.produce({ kind, rtpParameters });
        roomState.producers.set(producer.id, producer);
        if (source) producerSourceMap.set(producer.id, source);
        producer.on("@close", () => {
          roomState.producers.delete(producer.id);
          producerSourceMap.delete(producer.id);
          producerParticipantMap.delete(producer.id);
          console.log("[webrtc] producer @close roomId=%s producerId=%s producersRemaining=%d remaining=%j",
            roomId, producer.id, roomState.producers.size, Array.from(roomState.producers.keys()));
        });
        const codec = rtpParameters.codecs?.[0]?.mimeType ?? "?";
        console.log("[webrtc] WS roomId=%s produce kind=%s id=%s transportId=%s codec=%s totalProducers=%d source=%s",
          roomId, kind, producer.id, transportId, codec, roomState.producers.size, source ?? "(none)");
        socket.send(JSON.stringify({ type: "produced", id: producer.id, kind: producer.kind }));
        for (const [s, r] of socketRooms.entries()) {
          if (r === roomId && s !== socket && (s as { readyState?: number }).readyState === 1) {
            (s as { send: (d: string) => void }).send(JSON.stringify({ type: "newProducer", producerId: producer.id }));
          }
        }
        return;
      }
      if (type === "consume") {
        const { transportId, producerId, rtpCapabilities } = msg as unknown as { transportId: string; producerId: string; rtpCapabilities: mediasoup.types.RtpCapabilities };
        const transport = roomState.transports.get(transportId);
        const producer = roomState.producers.get(producerId);
        if (!transport || !producer) {
          console.log("[webrtc] WS roomId=%s consume FAILED transportId=%s producerId=%s transportFound=%s producerFound=%s",
            roomId, transportId, producerId, !!transport, !!producer);
          socket.send(JSON.stringify({ type: "error", error: "Transport or producer not found" }));
          return;
        }
        if (!roomState.router.canConsume({ producerId, rtpCapabilities })) {
          console.log("[webrtc] WS roomId=%s consume FAILED canConsume=false producerId=%s", roomId, producerId);
          socket.send(JSON.stringify({ type: "error", error: "Cannot consume" }));
          return;
        }
        const consumer = await transport.consume({ producerId, rtpCapabilities });
        const producerSource = producerSourceMap.get(producerId);
        console.log("[webrtc] WS roomId=%s consume producerId=%s consumerId=%s", roomId, producerId, consumer.id);
        socket.send(JSON.stringify({
          type: "consumed",
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          ...(producerSource ? { source: producerSource } : {}),
        }));
        return;
      }
      if (type === "soundboardVolume") {
        const { volume } = msg as { volume?: number };
        if (typeof volume === "number") {
          const v = Math.max(0, Math.min(1, volume));
          soundboardVolumeByRoom.set(roomId, v);
        }
        return;
      }
      if (type === "associateProducer") {
        const { producerId, participantId, participantName } = msg as { producerId?: string; participantId?: string; participantName?: string };
        if (!producerId || !participantId || typeof participantName !== "string") return;
        const producer = roomState.producers.get(producerId);
        if (!producer) return;
        producerParticipantMap.set(producerId, { participantId, participantName });
        return;
      }
      if (type === "playSoundboard") {
        const { assetId, startTimeSec } = msg as { assetId?: string; startTimeSec?: number };
        if (!assetId) {
          socket.send(JSON.stringify({ type: "error", error: "assetId required" }));
          return;
        }
        const secret = process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
        if (!MAIN_APP_URL || !secret) {
          socket.send(JSON.stringify({ type: "error", error: "Soundboard not configured" }));
          return;
        }
        (async () => {
          try {
            const existing = soundboardByRoom.get(roomId);
            if (existing) {
              soundboardVolumeAtStop.set(existing.producer.id, soundboardVolumeByRoom.get(roomId) ?? 1);
              try { existing.ffmpeg.kill("SIGINT"); } catch { /* ignore */ }
              try { existing.producer.close(); } catch { /* ignore */ }
              try { existing.transport.close(); } catch { /* ignore */ }
              try { if (existsSync(existing.tempPath)) unlinkSync(existing.tempPath); } catch { /* ignore */ }
              soundboardByRoom.delete(roomId);
            }
            const url = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/library-stream?assetId=${encodeURIComponent(assetId)}&sessionId=${encodeURIComponent(roomId)}`;
            const res = await fetch(url, { headers: { "X-Recording-Secret": secret } });
            if (!res.ok) {
              const err = await res.text();
              socket.send(JSON.stringify({ type: "error", error: err || `Fetch failed ${res.status}` }));
              return;
            }
            const buf = await res.arrayBuffer();
            const tempDir = join(RECORDING_DATA_DIR, "soundboard-temp");
            mkdirSync(tempDir, { recursive: true });
            const tempPath = join(tempDir, `sb_${nanoid(12)}.tmp`);
            writeFileSync(tempPath, Buffer.from(buf));
            const plainTransport = await roomState.router.createPlainTransport({
              listenIp: { ip: "127.0.0.1" },
              rtcpMux: true,
              comedia: true,
            });
            const ssrc = 11111111;
            const payloadType = 111;
            const producer = await plainTransport.produce({
              kind: "audio",
              rtpParameters: {
                codecs: [
                  {
                    mimeType: "audio/opus",
                    clockRate: 48000,
                    channels: 2,
                    payloadType,
                    parameters: { "sprop-stereo": 1 },
                    rtcpFeedback: [{ type: "transport-cc" }],
                  },
                ],
                encodings: [{ ssrc }],
              },
            });
            producerSourceMap.set(producer.id, "soundboard");
            producerSoundboardAssetMap.set(producer.id, assetId);
            producer.on("@close", () => {
              producerSourceMap.delete(producer.id);
              producerSoundboardAssetMap.delete(producer.id);
            });
            const port = plainTransport.tuple.localPort;
            if (!port) {
              try { producer.close(); } catch { /* ignore */ }
              try { plainTransport.close(); } catch { /* ignore */ }
              try { unlinkSync(tempPath); } catch { /* ignore */ }
              socket.send(JSON.stringify({ type: "error", error: "PlainTransport port not available" }));
              return;
            }
            const ffmpegArgs = [
              "-loglevel", "warning",
              ...(typeof startTimeSec === "number" && startTimeSec > 0 ? ["-ss", String(startTimeSec)] : []),
              "-re", "-i", tempPath,
              "-map", "0:a:0",
              "-acodec", "libopus", "-ab", "128k", "-ac", "2", "-ar", "48000",
              "-f", "tee",
              `[select=a:f=rtp:ssrc=${ssrc}:payload_type=${payloadType}]rtp://127.0.0.1:${port}`,
            ];
            const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
            ffmpeg.on("close", () => {
              const entry = soundboardByRoom.get(roomId);
              if (entry && entry.producer.id === producer.id) {
                try { entry.producer.close(); } catch { /* ignore */ }
                try { entry.transport.close(); } catch { /* ignore */ }
                try { if (existsSync(entry.tempPath)) unlinkSync(entry.tempPath); } catch { /* ignore */ }
                soundboardByRoom.delete(roomId);
                for (const [s, r] of socketRooms.entries()) {
                  if (r === roomId && (s as { readyState?: number }).readyState === 1) {
                    (s as { send: (d: string) => void }).send(JSON.stringify({ type: "soundboardStopped" }));
                  }
                }
              } else {
                try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* ignore */ }
              }
            });
            soundboardByRoom.set(roomId, { producer, transport: plainTransport, ffmpeg, tempPath });
            roomState.producers.set(producer.id, producer);
            plainTransport.on("@close", () => {
              roomState.producers.delete(producer.id);
              soundboardByRoom.delete(roomId);
            });
            console.log("[webrtc] WS roomId=%s playSoundboard assetId=%s producerId=%s", roomId, assetId, producer.id);
            socket.send(JSON.stringify({ type: "soundboardPlaying", producerId: producer.id }));
            for (const [s, r] of socketRooms.entries()) {
              if (r === roomId && (s as { readyState?: number }).readyState === 1) {
                (s as { send: (d: string) => void }).send(JSON.stringify({ type: "newProducer", producerId: producer.id }));
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log("[webrtc] playSoundboard roomId=%s error: %s", roomId, msg);
            socket.send(JSON.stringify({ type: "error", error: msg }));
          }
        })();
        return;
      }
      if (type === "stopSoundboard") {
        const existing = soundboardByRoom.get(roomId);
        if (existing) {
          soundboardVolumeAtStop.set(existing.producer.id, soundboardVolumeByRoom.get(roomId) ?? 1);
          try { existing.ffmpeg.kill("SIGINT"); } catch { /* ignore */ }
          try { existing.producer.close(); } catch { /* ignore */ }
          try { existing.transport.close(); } catch { /* ignore */ }
          try { if (existsSync(existing.tempPath)) unlinkSync(existing.tempPath); } catch { /* ignore */ }
          soundboardByRoom.delete(roomId);
          console.log("[webrtc] WS roomId=%s stopSoundboard producerId=%s", roomId, existing.producer.id);
        }
        socket.send(JSON.stringify({ type: "soundboardStopped" }));
        return;
      }
      if (type === "getProducers") {
        const ids = Array.from(roomState.producers.keys());
        console.log("[webrtc] WS roomId=%s getProducers count=%d ids=%s", roomId, ids.length, ids.join(",") || "none");
        socket.send(JSON.stringify({ type: "producers", producerIds: ids }));
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.log("[webrtc] WS roomId=%s error type=%s: %s", roomId, type, message);
      socket.send(JSON.stringify({ type: "error", error: message }));
    }
  });

  socket.on("close", () => {
    const roomState = getRoom(roomId);
    const transport = socketTransports.get(socket);
    const transportId = transport?.id ?? "none";
    const producerIdsRemaining = roomState ? Array.from(roomState.producers.keys()) : [];
    console.log("[webrtc] WS closed roomId=%s hadTransport=%s transportId=%s producersRemaining=%d producerIds=%j",
      roomId, !!transport, transportId, roomState?.producers.size ?? 0, producerIdsRemaining);
    if (transport) {
      try {
        transport.close();
      } catch (e) {
        console.warn("[webrtc] socket close: transport.close() failed", e);
      }
      if (roomState) roomState.transports.delete(transport.id);
    }
    socketTransports.delete(socket);
    socketRooms.delete(socket);
  });
};

app.get("/ws", { websocket: true }, wsHandler);
app.get("/webrtc-ws/ws", { websocket: true }, wsHandler);

// Crash recovery: recover .mp3.part files, mark INTERRUPTED segments
const recovered = recoverPartFiles(RECORDING_DATA_DIR);
if (recovered.length > 0) {
  console.log("[webrtc] Recovered %d part files on startup: %j", recovered.length, recovered);
}
markInterruptedSegments(RECORDING_DATA_DIR);

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log("[webrtc] Service listening on port %d", PORT);
console.log("[webrtc] Config RTC_MIN_PORT=%d RTC_MAX_PORT=%d MEDIASOUP_ANNOUNCED_IP=%s RECORDING_DATA_DIR=%s MAIN_APP_URL=%s DATA_DIR=%s",
  RTC_MIN_PORT, RTC_MAX_PORT, ANNOUNCED_IP ?? "(none)", RECORDING_DATA_DIR, MAIN_APP_URL || "(none)", process.env.DATA_DIR ?? "(none)");
