import type { FastifyInstance } from "fastify";
import type { Producer } from "mediasoup/types";
import { existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import type { ChildProcess } from "child_process";
import type { RecordingManager } from "../recording/RecordingManager.js";
import type { RecordingMeta } from "../recording/recordingTypes.js";
import { appendSegmentLog } from "../recording/segmentMetadata.js";
import {
  getRoom,
  getProducerIdsOnConnectedTransports,
  getTransportForProducer,
  getRecordPortOffsetAndIncrement,
  recordingByRoom,
} from "../room.js";
import {
  RECORDING_DATA_DIR,
  RECORD_PORT_BASE,
  RECORD_PORT_STRIDE,
  MAIN_APP_URL,
  RTC_MIN_PORT,
  RTC_MAX_PORT,
  ANNOUNCED_IP,
  formatDateTimeForFolder,
} from "../config.js";

/** In-flight start-recording per room, so stop-recording waits for setup to finish (race fix). */
const startRecordingByRoom = new Map<string, { resolve: () => void; promise: Promise<void> }>();

function sendProgress(
  request: { log: { error: (o: object, msg: string) => void } },
  state: { sessionId?: string | null },
  secret: string,
  stage: string,
  message?: string
): void {
  if (!MAIN_APP_URL || !secret || !state.sessionId) return;
  const url = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-progress`;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
    body: JSON.stringify({ sessionId: state.sessionId, stage, message }),
  }).catch((err) => request.log.error({ err, stage }, "recording-progress failed"));
}

function ffmpegStderrLogger(
  ffmpeg: ChildProcess,
  producerId: string,
  log: { info: (o: object, msg: string) => void }
): void {
  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      log.info({ ffmpeg: line, producerId }, "FFmpeg stderr");
    }
  });
}

export function registerRecordingRoutes(
  app: FastifyInstance,
  recordingManager: RecordingManager,
  finalizeProducerStream: (
    roomId: string,
    state: import("../recording/RecordingManager.js").RecordingState,
    producerId: string,
    reason: string
  ) => void
): void {
  app.post<{
    Body: RecordingMeta & {
      roomId: string;
      filePathRelative?: string;
      filePath?: string;
      clientEpochMs?: number;
    };
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
        "start-recording validation failed"
      );
      return reply.status(400).send({ error: "Missing required fields", missing });
    }

    const room = getRoom(roomId);
    if (!room) return reply.status(404).send({ error: "Room not found" });

    const existingForEpisode = Array.from(recordingByRoom.values()).find((s) => s.episodeId === episodeId);
    if (existingForEpisode) {
      request.log.warn({ roomId, episodeId }, "Recording already in progress for episode");
      return reply.status(409).send({ error: "A recording is already in progress for this episode." });
    }

    const audioProducers = Array.from(room.producers.values()).filter((p) => p.kind === "audio");
    const unpausedAudioProducers = audioProducers.filter((p) => !p.paused);

    if (audioProducers.length === 0) {
      return reply.status(400).send({ error: "No audio producer in room" });
    }
    if (unpausedAudioProducers.length === 0) {
      return reply.status(400).send({ error: "All audio producers are paused" });
    }

    let allProducersNoPackets = true;
    let anyProducerPaused = false;
    const producerIdsWithPackets = new Set<string>();
    for (const producer of audioProducers) {
      try {
        const stats = await producer.getStats();
        const bytesReceived = (stats as Array<{ byteCount?: number }>).reduce(
          (sum, s) => sum + (s.byteCount ?? 0),
          0
        );
        const packetsReceived = (stats as Array<{ packetCount?: number }>).reduce(
          (sum, s) => sum + (s.packetCount ?? 0),
          0
        );
        if (bytesReceived > 0 || packetsReceived > 0) {
          allProducersNoPackets = false;
          producerIdsWithPackets.add(producer.id);
        }
        if (producer.paused) anyProducerPaused = true;
        if (bytesReceived === 0 && packetsReceived === 0) {
          console.warn(
            "[webrtc] Producer %s has received no packets (check MEDIASOUP_ANNOUNCED_IP=%s UDP %d-%d)",
            producer.id,
            ANNOUNCED_IP ?? "unset",
            RTC_MIN_PORT,
            RTC_MAX_PORT
          );
        }
      } catch (e) {
        request.log.warn({ err: e, producerId: producer.id }, "Could not get producer stats");
      }
    }

    if (allProducersNoPackets) {
      console.warn(
        "[webrtc] No producer has received RTP packets (ICE/connectivity) roomId=%s ANNOUNCED_IP=%s RTC_PORTS=%d-%d",
        roomId,
        ANNOUNCED_IP ?? "unset",
        RTC_MIN_PORT,
        RTC_MAX_PORT
      );
      return reply.status(400).send({
        error:
          "No audio received from any participant. Ensure UDP ports " +
          RTC_MIN_PORT +
          "-" +
          RTC_MAX_PORT +
          " are both open and reachable. If behind NAT, set MEDIASOUP_ANNOUNCED_IP to your server's public IP.",
      });
    }
    if (anyProducerPaused && audioProducers.every((p) => p.paused)) {
      return reply.status(400).send({ error: "Unmute your microphone before recording." });
    }

    const producerIdsOnConnectedTransports = await getProducerIdsOnConnectedTransports(room);
    const recordableProducers = unpausedAudioProducers.filter(
      (p) => producerIdsWithPackets.has(p.id) && producerIdsOnConnectedTransports.has(p.id)
    );
    if (recordableProducers.length === 0) {
      request.log.warn(
        {
          roomId,
          producerIdsWithPackets: Array.from(producerIdsWithPackets),
          onConnected: Array.from(producerIdsOnConnectedTransports),
          unpausedIds: unpausedAudioProducers.map((p) => p.id),
        },
        "No unpaused producer has RTP on connected transport"
      );
      return reply.status(400).send({
        error:
          "No audio received from unmuted participants. Wait for the call to connect before recording.",
      });
    }

    const secret =
      recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || null;
    const meta: RecordingMeta = {
      filePathRelative,
      segmentId,
      episodeId,
      podcastId,
      name: name ?? null,
      sessionId: sessionId ?? null,
      recordingCallbackSecret: secret,
    };

    let resolveStartRecording: (() => void) | null = null;
    const startRecordingPromise = new Promise<void>((r) => {
      resolveStartRecording = r;
    });
    startRecordingByRoom.set(roomId, { resolve: resolveStartRecording!, promise: startRecordingPromise });

    try {
      const portOffset = getRecordPortOffsetAndIncrement(RECORD_PORT_STRIDE);
      const portBase = RECORD_PORT_BASE + portOffset;
      const recordingStartedAt = Date.now();
      const recordingEpochMs =
        typeof clientEpochMs === "number" ? clientEpochMs : recordingStartedAt;
      const recordingDirName = `${formatDateTimeForFolder()}_${episodeId}`;
      const episodeDir = join(RECORDING_DATA_DIR, "recordings", recordingDirName);
      const jsonlPath = join(episodeDir, "segments.jsonl");
      mkdirSync(episodeDir, { recursive: true });

      const activeSegmentsByProducerId = new Map<
        string,
        import("../recording/RecordingManager.js").ActiveSegment
      >();
      const finalizedSegments: import("../recording/RecordingManager.js").FinalizedSegmentInfo[] = [];
      const finalizedProducerIds = new Set<string>();

      const state: import("../recording/RecordingManager.js").RecordingState = {
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

      for (const producer of recordableProducers) {
        const seg = await recordingManager.addProducerToRecording(roomId, room, state, producer);
        if (seg) {
          activeSegmentsByProducerId.set(producer.id, seg);
          ffmpegStderrLogger(seg.ffmpeg, producer.id, request.log);
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
            const res = await fetch(
              `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-check-storage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Recording-Secret": secretStr },
                body: JSON.stringify({ sessionId: meta.sessionId, bytesRecordedSoFar: size }),
              }
            );
            if (!res.ok) return;
            const data = (await res.json()) as { stop?: boolean; error?: string };
            if (data.stop && data.error) {
              console.warn("[webrtc] Storage limit reached roomId=%s bytesRecorded=%d stopping", roomId, size);
              recordingByRoom.delete(roomId);
              if (rec.checkStorageInterval) clearInterval(rec.checkStorageInterval);
              if (rec.producerCheckInterval) clearInterval(rec.producerCheckInterval);
              for (const seg of rec.activeSegmentsByProducerId.values()) {
                try {
                  seg.consumer.close();
                } catch { /* ignore */ }
                try {
                  seg.plainTransport.close();
                } catch { /* ignore */ }
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

        const now = Date.now();
        for (const [producerId, seg] of rec.activeSegmentsByProducerId) {
          try {
            const stats = await seg.consumer.getStats();
            const packetCount = (stats as Array<{ packetCount?: number }>).reduce(
              (sum, s) => sum + (s.packetCount ?? 0),
              0
            );
            if (packetCount > seg.lastPacketCount) {
              seg.lastPacketCount = packetCount;
              seg.lastPacketAtMs = now;
            }
            if (now - seg.lastPacketAtMs >= STALL_THRESHOLD_MS && now - seg.startedAt > 5000) {
              const producerStillInRoom = roomState.producers.has(producerId);
              if (!producerStillInRoom) {
                // producer closed
              } else {
                request.log.warn(
                  { roomId, episodeId: rec.episodeId, producerId, segmentId: seg.segmentId },
                  "Recording segment stall detected"
                );
                appendSegmentLog(rec.jsonlPath, {
                  segmentId: seg.segmentId,
                  producerId,
                  status: "DEGRADED",
                });
              }
              finalizedThisTick.add(producerId);
              finalizeProducerStream(roomId, rec, producerId, producerStillInRoom ? "stall" : "producer closed");
            }
          } catch (e) {
            request.log.warn({ err: e, producerId }, "segment watchdog getStats failed");
          }
        }

        const toFinalize: string[] = [];
        for (const [producerId] of rec.activeSegmentsByProducerId) {
          const transport = await getTransportForProducer(roomState, producerId);
          if (!transport) continue;
          if (transport.iceState !== "completed" || transport.dtlsState !== "connected") {
            console.warn(
              "[webrtc] Transport disconnected roomId=%s producerId=%s iceState=%s dtlsState=%s",
              roomId,
              producerId,
              transport.iceState,
              transport.dtlsState
            );
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
        for (const id of rec.finalizedProducerIds) currentIds.add(id);

        const allAudio = Array.from(roomState.producers.values()).filter((p) => p.kind === "audio");
        const newUnpaused = allAudio.filter((p) => !p.paused && !currentIds.has(p.id));
        const onConnectedTransports = await getProducerIdsOnConnectedTransports(roomState);
        const withPackets: Producer[] = [];
        for (const producer of newUnpaused) {
          if (!onConnectedTransports.has(producer.id)) continue;
          try {
            const stats = await producer.getStats();
            const bytesReceived = (stats as Array<{ byteCount?: number }>).reduce(
              (sum, s) => sum + (s.byteCount ?? 0),
              0
            );
            const packetsReceived = (stats as Array<{ packetCount?: number }>).reduce(
              (sum, s) => sum + (s.packetCount ?? 0),
              0
            );
            if (bytesReceived > 0 || packetsReceived > 0) withPackets.push(producer);
          } catch { /* ignore */ }
        }
        for (const producer of withPackets) {
          recordingManager
            .addProducerToRecording(roomId, roomState, rec, producer)
            .then((seg) => {
              if (seg && recordingByRoom.get(roomId) === state) {
                rec.activeSegmentsByProducerId.set(producer.id, seg);
                ffmpegStderrLogger(seg.ffmpeg, producer.id, request.log);
              }
            })
            .catch((err) => {
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

      return reply.send({ ok: true, recordingEpochMs });
    } catch (err) {
      request.log.error({ err }, "Failed to start recording");
      return reply.status(500).send({ error: "Failed to start recording" });
    } finally {
      const entry = startRecordingByRoom.get(roomId);
      if (entry) {
        entry.resolve();
        startRecordingByRoom.delete(roomId);
      }
    }
  });

  app.post<{
    Body: {
      roomId: string;
      events?: Array<{
        event: string;
        assetId?: string;
        clientTimestampMs?: number;
        durationSec?: number;
      }>;
      recordingEndedAtMs?: number;
    };
  }>("/stop-recording", async (request, reply) => {
    const body = request.body as {
      roomId: string;
      events?: Array<{
        event: string;
        assetId?: string;
        clientTimestampMs?: number;
        durationSec?: number;
      }>;
      recordingEndedAtMs?: number;
    };
    const { roomId, events, recordingEndedAtMs } = body;
    if (!roomId) return reply.status(400).send({ error: "roomId required" });

    const inFlight = startRecordingByRoom.get(roomId);
    if (inFlight) {
      await Promise.race([inFlight.promise, new Promise((r) => setTimeout(r, 5000))]);
      startRecordingByRoom.delete(roomId);
    }

    const state = recordingByRoom.get(roomId);
    if (!state) return reply.send({ ok: true });

    if (state.checkStorageInterval) clearInterval(state.checkStorageInterval);
    if (state.producerCheckInterval) clearInterval(state.producerCheckInterval);
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);

    const secret =
      state.recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
    const doCallback = (fileOk: boolean, tracksManifest?: object, perTrackFilePaths?: string[]) => {
      if (!MAIN_APP_URL || !secret) return;

      if (!fileOk) {
        console.warn(
          "[webrtc] Recording file missing or empty roomId=%s segmentId=%s notifying recording-error",
          roomId,
          state.segmentId
        );
        fetch(`${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
          body: JSON.stringify({
            sessionId: state.sessionId,
            error:
              "Recording produced no audio. The recording may have been stopped before any audio was captured.",
          }),
        }).catch((err) => request.log.error({ err }, "recording-error callback failed"));
        return;
      }

      const callbackUrl = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-segment`;
      request.log.info({ callbackUrl, filePath: state.filePathRelative }, "Firing recording callback");
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
          } else {
            const bodyText = await res.text();
            request.log.warn({ status: res.status, body: bodyText }, "Recording callback failed");
            console.warn(
              "[webrtc] Recording callback FAILED roomId=%s segmentId=%s status=%d body=%s",
              roomId,
              state.segmentId,
              res.status,
              bodyText
            );
          }
        })
        .catch((err) => {
          request.log.error({ err }, "Recording callback failed");
          console.warn("[webrtc] Recording callback ERROR roomId=%s segmentId=%s %s", roomId, state.segmentId, err);
        });
    };

    const activeProducerIds = Array.from(state.activeSegmentsByProducerId.keys());
    sendProgress(request, state, secret, "finalizing", "Finalizing audio streams from participants");
    Promise.all(
      activeProducerIds.map((producerId) =>
        recordingManager.finalizeProducerStreamAsync(roomId, state, producerId)
      )
    ).then(() => {
      sendProgress(request, state, secret, "mixing", "Mixing audio and preparing final file");
      recordingByRoom.delete(roomId);
      const finalPath = join(RECORDING_DATA_DIR, state.filePathRelative);
      recordingManager.runAmixAndDeliver(
        state,
        finalPath,
        doCallback,
        Array.isArray(events) ? events : undefined,
        typeof recordingEndedAtMs === "number" ? recordingEndedAtMs : undefined
      );
    });

    return reply.send({ ok: true });
  });
}
