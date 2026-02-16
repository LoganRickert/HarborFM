import * as mediasoup from "mediasoup";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { nanoid } from "nanoid";
import {
  getRoom,
  producerSourceMapRef,
  producerParticipantMapRef,
  producerSoundboardAssetMapRef,
  soundboardVolumeByRoomRef,
  soundboardVolumeAtStopRef,
  soundboardByRoom,
} from "../room.js";
import {
  ANNOUNCED_IP,
  MAIN_APP_URL,
  RECORDING_DATA_DIR,
  MAX_TRANSPORTS_PER_ROOM,
  MAX_PRODUCERS_PER_ROOM,
} from "../config.js";
import { assertSafeId, sanitizeParticipantName } from "../validation.js";

function getClientIpFromRequest(req: { socket?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function reportConnectionFailure(ip: string): void {
  const url = MAIN_APP_URL?.replace(/\/$/, "");
  const secret = process.env.RECORDING_CALLBACK_SECRET?.trim();
  if (!url || !secret) return;
  fetch(`${url}/api/call/internal/webrtc-connection-failed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
    body: JSON.stringify({ ip }),
  }).catch((err) => console.warn("[webrtc] Failed to report connection failure:", err));
}

/** Max WebSocket message size (bytes) to prevent DoS via oversized JSON. */
const WS_MAX_MESSAGE_BYTES = 256 * 1024;

type WebRtcTransport = mediasoup.types.WebRtcTransport;

const socketRooms = new Map<unknown, string>();
const socketTransports = new Map<unknown, WebRtcTransport>();
const socketToIsHost = new Map<unknown, boolean>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wsHandler = async (socket: any, req: any) => {
  const url = new URL(req.url ?? "", `http://${req.headers?.host ?? "localhost"}`);
  const roomId = url.searchParams.get("roomId");
  const clientIp = getClientIpFromRequest(req);

  if (!roomId) {
    reportConnectionFailure(clientIp);
    socket.close();
    return;
  }
  try {
    assertSafeId(roomId, "roomId");
  } catch {
    reportConnectionFailure(clientIp);
    socket.close();
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    reportConnectionFailure(clientIp);
    socket.close();
    return;
  }

  socketRooms.set(socket, roomId);

  socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (data.length > WS_MAX_MESSAGE_BYTES) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    const type = (msg as { type: string }).type;
    const roomState = getRoom(roomId);
    if (!roomState) return;

    try {
      if (type === "setHostToken") {
        const { hostToken: token } = msg as { hostToken?: string };
        const roomHostToken = roomState.hostToken;
        if (
          typeof token === "string" &&
          roomHostToken &&
          token.trim() === roomHostToken
        ) {
          socketToIsHost.set(socket, true);
        }
        return;
      }

      if (type === "getRouterRtpCapabilities") {
        socket.send(
          JSON.stringify({ type: "routerRtpCapabilities", rtpCapabilities: roomState.router.rtpCapabilities })
        );
        return;
      }

      if (type === "createWebRtcTransport") {
        if (roomState.transports.size >= MAX_TRANSPORTS_PER_ROOM) {
          socket.send(JSON.stringify({ type: "error", error: "Too many transports in room" }));
          return;
        }
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
        });
        socket.send(
          JSON.stringify({
            type: "webRtcTransportCreated",
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          })
        );
        return;
      }

      if (type === "connectWebRtcTransport") {
        const { transportId, dtlsParameters } = msg as unknown as {
          transportId: string;
          dtlsParameters: mediasoup.types.DtlsParameters;
        };
        const ownTransport = socketTransports.get(socket);
        const transport = roomState.transports.get(transportId);
        if (!ownTransport || ownTransport.id !== transportId || !transport) {
          socket.send(JSON.stringify({ type: "error", error: "Transport not found or access denied" }));
          return;
        }
        await transport.connect({ dtlsParameters });
        socket.send(JSON.stringify({ type: "webRtcTransportConnected" }));
        return;
      }

      if (type === "produce") {
        if (roomState.producers.size >= MAX_PRODUCERS_PER_ROOM) {
          socket.send(JSON.stringify({ type: "error", error: "Too many producers in room" }));
          return;
        }
        const { transportId, kind, rtpParameters, source } = msg as unknown as {
          transportId: string;
          kind: mediasoup.types.MediaKind;
          rtpParameters: mediasoup.types.RtpParameters;
          source?: string;
        };
        const ownTransport = socketTransports.get(socket);
        const transport = roomState.transports.get(transportId);
        if (!ownTransport || ownTransport.id !== transportId || !transport) {
          socket.send(JSON.stringify({ type: "error", error: "Transport not found or access denied" }));
          return;
        }
        const producer = await transport.produce({ kind, rtpParameters });
        roomState.producers.set(producer.id, producer);
        if (source) producerSourceMapRef.set(producer.id, source);
        producer.on("@close", () => {
          roomState.producers.delete(producer.id);
          producerSourceMapRef.delete(producer.id);
          producerParticipantMapRef.delete(producer.id);
        });
        socket.send(JSON.stringify({ type: "produced", id: producer.id, kind: producer.kind }));
        for (const [s, r] of socketRooms.entries()) {
          if (r === roomId && s !== socket && (s as { readyState?: number }).readyState === 1) {
            (s as { send: (d: string) => void }).send(JSON.stringify({ type: "newProducer", producerId: producer.id }));
          }
        }
        return;
      }

      if (type === "consume") {
        const { transportId, producerId, rtpCapabilities } = msg as unknown as {
          transportId: string;
          producerId: string;
          rtpCapabilities: mediasoup.types.RtpCapabilities;
        };
        const ownTransport = socketTransports.get(socket);
        const transport = roomState.transports.get(transportId);
        const producer = roomState.producers.get(producerId);
        if (!ownTransport || ownTransport.id !== transportId || !transport || !producer) {
          socket.send(JSON.stringify({ type: "error", error: "Transport or producer not found" }));
          return;
        }
        if (!roomState.router.canConsume({ producerId, rtpCapabilities })) {
          socket.send(JSON.stringify({ type: "error", error: "Cannot consume" }));
          return;
        }
        const consumer = await transport.consume({ producerId, rtpCapabilities });
        const producerSource = producerSourceMapRef.get(producerId);
        socket.send(
          JSON.stringify({
            type: "consumed",
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            ...(producerSource ? { source: producerSource } : {}),
          })
        );
        return;
      }

      if (type === "soundboardVolume") {
        if (!socketToIsHost.get(socket)) {
          socket.send(JSON.stringify({ type: "error", error: "Host only" }));
          return;
        }
        const { volume } = msg as { volume?: number };
        if (typeof volume === "number") {
          const v = Math.max(0, Math.min(1, volume));
          soundboardVolumeByRoomRef.set(roomId, v);
        }
        return;
      }

      if (type === "associateProducer") {
        const { producerId, participantId, participantName } = msg as {
          producerId?: string;
          participantId?: string;
          participantName?: string;
        };
        if (!producerId || !participantId || typeof participantName !== "string") return;
        try {
          assertSafeId(participantId, "participantId");
        } catch {
          return;
        }
        const producer = roomState.producers.get(producerId);
        if (!producer) return;
        const safeName = sanitizeParticipantName(participantName);
        producerParticipantMapRef.set(producerId, { participantId, participantName: safeName });
        return;
      }

      if (type === "playSoundboard") {
        if (!socketToIsHost.get(socket)) {
          socket.send(JSON.stringify({ type: "error", error: "Host only" }));
          return;
        }
        if (roomState.producers.size >= MAX_PRODUCERS_PER_ROOM) {
          socket.send(JSON.stringify({ type: "error", error: "Too many producers in room" }));
          return;
        }
        const { assetId, startTimeSec } = msg as { assetId?: string; startTimeSec?: number };
        if (!assetId) {
          socket.send(JSON.stringify({ type: "soundboardError", error: "Asset ID required" }));
          return;
        }
        try {
          assertSafeId(assetId, "assetId");
        } catch {
          socket.send(JSON.stringify({ type: "soundboardError", error: "Invalid asset ID" }));
          return;
        }
        const secret = process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
        if (!MAIN_APP_URL || !secret) {
          socket.send(JSON.stringify({ type: "soundboardError", error: "Soundboard not configured" }));
          return;
        }
        (async () => {
          try {
            const existing = soundboardByRoom.get(roomId);
            if (existing) {
              soundboardVolumeAtStopRef.set(existing.producer.id, soundboardVolumeByRoomRef.get(roomId) ?? 1);
              try {
                existing.ffmpeg.kill("SIGINT");
              } catch { /* ignore */ }
              try {
                existing.producer.close();
              } catch { /* ignore */ }
              try {
                existing.transport.close();
              } catch { /* ignore */ }
              try {
                if (existsSync(existing.tempPath)) unlinkSync(existing.tempPath);
              } catch { /* ignore */ }
              soundboardByRoom.delete(roomId);
            }
            const url = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/library-stream?assetId=${encodeURIComponent(assetId)}&sessionId=${encodeURIComponent(roomId)}`;
            const res = await fetch(url, { headers: { "X-Recording-Secret": secret } });
            if (!res.ok) {
              const errText = await res.text();
              console.warn("[webrtc] library-stream fetch failed:", res.status, errText);
              let errMsg = "Asset not available";
              if (res.status === 401) {
                errMsg = "Soundboard access denied. Ensure RECORDING_CALLBACK_SECRET matches in both the main app and webrtc service.";
              } else {
                try {
                  const parsed = JSON.parse(errText) as { error?: string };
                  if (parsed?.error) errMsg = parsed.error;
                } catch {
                  /* use default */
                }
              }
              socket.send(JSON.stringify({ type: "soundboardError", error: errMsg }));
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
            producerSourceMapRef.set(producer.id, "soundboard");
            producerSoundboardAssetMapRef.set(producer.id, assetId);
            producer.on("@close", () => {
              producerSourceMapRef.delete(producer.id);
              producerSoundboardAssetMapRef.delete(producer.id);
            });
            const port = plainTransport.tuple.localPort;
            if (!port) {
              try {
                producer.close();
              } catch { /* ignore */ }
              try {
                plainTransport.close();
              } catch { /* ignore */ }
              try {
                unlinkSync(tempPath);
              } catch { /* ignore */ }
              socket.send(JSON.stringify({ type: "soundboardError", error: "PlainTransport port not available" }));
              return;
            }
            const ffmpegArgs = [
              "-loglevel",
              "warning",
              ...(typeof startTimeSec === "number" && startTimeSec > 0 ? ["-ss", String(startTimeSec)] : []),
              "-re",
              "-i",
              tempPath,
              "-map",
              "0:a:0",
              "-acodec",
              "libopus",
              "-ab",
              "128k",
              "-ac",
              "2",
              "-ar",
              "48000",
              "-f",
              "tee",
              `[select=a:f=rtp:ssrc=${ssrc}:payload_type=${payloadType}]rtp://127.0.0.1:${port}`,
            ];
            const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
            ffmpeg.on("close", () => {
              const entry = soundboardByRoom.get(roomId);
              if (entry && entry.producer.id === producer.id) {
                try {
                  entry.producer.close();
                } catch { /* ignore */ }
                try {
                  entry.transport.close();
                } catch { /* ignore */ }
                try {
                  if (existsSync(entry.tempPath)) unlinkSync(entry.tempPath);
                } catch { /* ignore */ }
                soundboardByRoom.delete(roomId);
                for (const [s, r] of socketRooms.entries()) {
                  if (r === roomId && (s as { readyState?: number }).readyState === 1) {
                    (s as { send: (d: string) => void }).send(JSON.stringify({ type: "soundboardStopped" }));
                  }
                }
              } else {
                try {
                  if (existsSync(tempPath)) unlinkSync(tempPath);
                } catch { /* ignore */ }
              }
            });
            soundboardByRoom.set(roomId, { producer, transport: plainTransport, ffmpeg, tempPath });
            roomState.producers.set(producer.id, producer);
            plainTransport.on("@close", () => {
              roomState.producers.delete(producer.id);
              soundboardByRoom.delete(roomId);
            });
            socket.send(JSON.stringify({ type: "soundboardPlaying", producerId: producer.id }));
            for (const [s, r] of socketRooms.entries()) {
              if (r === roomId && (s as { readyState?: number }).readyState === 1) {
                (s as { send: (d: string) => void }).send(JSON.stringify({ type: "newProducer", producerId: producer.id }));
              }
            }
          } catch (err) {
            console.warn("[webrtc] playSoundboard failed:", err);
            socket.send(JSON.stringify({ type: "soundboardError", error: "Soundboard playback failed" }));
          }
        })();
        return;
      }

      if (type === "stopSoundboard") {
        if (!socketToIsHost.get(socket)) {
          socket.send(JSON.stringify({ type: "error", error: "Host only" }));
          return;
        }
        const existing = soundboardByRoom.get(roomId);
        if (existing) {
          soundboardVolumeAtStopRef.set(existing.producer.id, soundboardVolumeByRoomRef.get(roomId) ?? 1);
          try {
            existing.ffmpeg.kill("SIGINT");
          } catch { /* ignore */ }
          try {
            existing.producer.close();
          } catch { /* ignore */ }
          try {
            existing.transport.close();
          } catch { /* ignore */ }
          try {
            if (existsSync(existing.tempPath)) unlinkSync(existing.tempPath);
          } catch { /* ignore */ }
          soundboardByRoom.delete(roomId);
        }
        socket.send(JSON.stringify({ type: "soundboardStopped" }));
        return;
      }

      if (type === "getProducers") {
        const ids = Array.from(roomState.producers.keys());
        socket.send(JSON.stringify({ type: "producers", producerIds: ids }));
        return;
      }
    } catch (err) {
      console.warn("[webrtc] WebSocket message handler error:", err);
      socket.send(JSON.stringify({ type: "error", error: "An error occurred" }));
    }
  });

  socket.on("close", () => {
    const roomState = getRoom(roomId);
    const transport = socketTransports.get(socket);
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
    socketToIsHost.delete(socket);
  });
};
