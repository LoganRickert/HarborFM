import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import * as mediasoup from "mediasoup";
import { nanoid } from "nanoid";
import { mkdirSync } from "fs";
import { spawn, type ChildProcess } from "child_process";
import { dirname, join } from "path";

type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type PlainTransport = mediasoup.types.PlainTransport;
type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;

const PORT = Number(process.env.PORT) || 3002;
const RTC_MIN_PORT = Number(process.env.RTC_MIN_PORT) || 40000;
const RTC_MAX_PORT = Number(process.env.RTC_MAX_PORT) || 40100;
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

type ActiveRecording = RecordingMeta & {
  ffmpeg: ChildProcess;
  plainTransports: PlainTransport[];
  consumers: Consumer[];
};

const RECORDING_DATA_DIR = process.env.RECORDING_DATA_DIR?.trim() || process.env.DATA_DIR?.trim() || "/data";
const RECORD_PORT_BASE = 50000;

const rooms = new Map<string, RoomState>();
let worker: mediasoup.types.Worker | null = null;
const recordingByRoom = new Map<string, ActiveRecording>();

const MAIN_APP_URL = process.env.MAIN_APP_URL?.trim() || "";

type StreamSpec = { rtpPort: number; rtcpPort: number; payloadType: number };

function createMultiAudioSdp(specs: StreamSpec[]): string {
  const parts = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=-",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
  ];
  for (const s of specs) {
    parts.push(`m=audio ${s.rtpPort} RTP/AVP ${s.payloadType}`);
    parts.push(`a=rtcp:${s.rtcpPort}`);
    parts.push(`a=rtpmap:${s.payloadType} opus/48000/2`);
    parts.push("a=sendonly");
  }
  return parts.join("\n") + "\n";
}

async function getWorker(): Promise<mediasoup.types.Worker> {
  if (worker) return worker;
  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: RTC_MIN_PORT,
    rtcMaxPort: RTC_MAX_PORT,
  });
  worker.on("died", () => { worker = null; });
  return worker;
}

function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId);
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
    return reply.send({ roomId, rtpCapabilities: room.router.rtpCapabilities });
  }
  const w = await getWorker();
  const router = await w.createRouter({
    mediaCodecs: [
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    ],
  });
  router.on("workerclose", () => rooms.delete(roomId));
  rooms.set(roomId, { router, transports: new Map(), producers: new Map() });
  return reply.send({ roomId, rtpCapabilities: router.rtpCapabilities });
});

app.post<{
  Body: RecordingMeta & { roomId: string; filePathRelative?: string; filePath?: string };
}>("/start-recording", async (request, reply) => {
  const body = (request.body ?? {}) as RecordingMeta & {
    roomId: string;
    filePathRelative?: string;
    filePath?: string;
    recordingCallbackSecret?: string;
  };
  const filePathRelative = body.filePathRelative ?? body.filePath;
  const { roomId, segmentId, episodeId, podcastId, name, sessionId, recordingCallbackSecret } = body;

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

  const audioProducers = Array.from(room.producers.values()).filter((p) => p.kind === "audio");
  console.log("[webrtc] POST /start-recording roomId=%s totalProducers=%d audioProducers=%d", roomId, room.producers.size, audioProducers.length);
  if (audioProducers.length === 0) {
    console.log("[webrtc] POST /start-recording roomId=%s rejected: no audio producer", roomId);
    return reply.status(400).send({ error: "No audio producer in room" });
  }

  const secret = recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || null;
  const meta: RecordingMeta = { filePathRelative, segmentId, episodeId, podcastId, name: name ?? null, sessionId: sessionId ?? null, recordingCallbackSecret: secret };

  try {
    const routerCodec = room.router.rtpCapabilities.codecs?.find((c) => c.kind === "audio");
    const rtpCapabilities = {
      codecs: routerCodec ? [routerCodec] : [],
      headerExtensions: room.router.rtpCapabilities.headerExtensions ?? [],
    };

    const plainTransports: PlainTransport[] = [];
    const consumers: Consumer[] = [];
    const sdpSpecs: StreamSpec[] = [];

    for (let i = 0; i < audioProducers.length; i++) {
      const rtpPort = RECORD_PORT_BASE + i * 4;
      const rtcpPort = RECORD_PORT_BASE + i * 4 + 1;

      const plainTransport = await room.router.createPlainTransport({
        listenIp: { ip: "127.0.0.1" },
        rtcpMux: false,
        comedia: false,
      });
      const consumer = await plainTransport.consume({
        producerId: audioProducers[i]!.id,
        rtpCapabilities,
        paused: true,
      });
      const payloadType = consumer.rtpParameters.codecs?.[0]?.payloadType ?? 111;

      plainTransports.push(plainTransport);
      consumers.push(consumer);
      sdpSpecs.push({ rtpPort, rtcpPort, payloadType });
    }

    const filePath = join(RECORDING_DATA_DIR, filePathRelative);
    mkdirSync(dirname(filePath), { recursive: true });

    const sdp = createMultiAudioSdp(sdpSpecs);
    const numInputs = consumers.length;

    const ffmpegArgs: string[] = [
      "-loglevel", "warning",
      "-protocol_whitelist", "pipe,udp,rtp",
      "-f", "sdp", "-i", "pipe:0",
    ];
    if (numInputs === 1) {
      ffmpegArgs.push("-map", "0:a:0", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "1");
    } else {
      const filterInputs = Array.from({ length: numInputs }, (_, i) => `[0:a:${i}]`).join("");
      ffmpegArgs.push(
        "-filter_complex",
        `${filterInputs}amix=inputs=${numInputs}:duration=longest[aout]`,
        "-map", "[aout]",
        "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "1",
      );
    }
    ffmpegArgs.push("-y", filePath);
    const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
    ffmpeg.stdin?.write(sdp);
    ffmpeg.stdin?.end();
    ffmpeg.on("error", (err) => request.log.error({ err }, "FFmpeg error"));
    ffmpeg.on("close", (code) => request.log.info({ code }, "FFmpeg exited"));

    await new Promise((r) => setTimeout(r, 500));
    for (let i = 0; i < plainTransports.length; i++) {
      const t = plainTransports[i]!;
      const spec = sdpSpecs[i]!;
      await t.connect({
        ip: "127.0.0.1",
        port: spec.rtpPort,
        rtcpPort: spec.rtcpPort,
      });
    }
    await new Promise((r) => setTimeout(r, 200));
    for (const c of consumers) await c.resume();

    recordingByRoom.set(roomId, { ...meta, ffmpeg, plainTransports, consumers });
    console.log("[webrtc] POST /start-recording roomId=%s started ok", roomId);
    return reply.send({ ok: true });
  } catch (err) {
    request.log.error({ err }, "Failed to start recording");
    return reply.status(500).send({ error: "Failed to start recording" });
  }
});

app.post<{ Body: { roomId: string } }>("/stop-recording", async (request, reply) => {
  const body = request.body as { roomId: string };
  const { roomId } = body;
  if (!roomId) return reply.status(400).send({ error: "roomId required" });
  const state = recordingByRoom.get(roomId);
  recordingByRoom.delete(roomId);
  console.log("[webrtc] POST /stop-recording roomId=%s hadState=%s", roomId, !!state);
  if (!state) return reply.send({ ok: true });

  let callbackFired = false;
  const doCallback = () => {
    if (callbackFired) return;
    callbackFired = true;
    const secret = state.recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
    if (MAIN_APP_URL && secret) {
      const callbackUrl = `${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-segment`;
      request.log.info({ callbackUrl, filePath: state.filePathRelative }, "Firing recording callback");
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
        body: JSON.stringify({
          filePath: state.filePathRelative,
          segmentId: state.segmentId,
          episodeId: state.episodeId,
          podcastId: state.podcastId,
          name: state.name,
          sessionId: state.sessionId,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            request.log.info({ status: res.status }, "Recording callback succeeded");
          } else {
            const body = await res.text();
            request.log.warn({ status: res.status, body }, "Recording callback failed");
          }
        })
        .catch((err) => request.log.error({ err }, "Recording callback failed"));
    }
  };

  for (const c of state.consumers) {
    try {
      c.close();
    } catch (e) {
      request.log.warn({ err: e }, "Error closing consumer");
    }
  }
  for (const t of state.plainTransports) {
    try {
      t.close();
    } catch (e) {
      request.log.warn({ err: e }, "Error closing plain transport");
    }
  }
  state.ffmpeg.kill("SIGINT");
  const exitTimeout = setTimeout(() => {
    state.ffmpeg.kill("SIGKILL");
    doCallback();
  }, 5000);
  state.ffmpeg.once("close", () => {
    clearTimeout(exitTimeout);
    doCallback();
  });

  return reply.send({ ok: true });
});

const socketRooms = new Map<unknown, string>();
const socketTransports = new Map<unknown, WebRtcTransport>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wsHandler = (socket: any, req: any) => {
  const url = new URL(req.url ?? "", `http://${req.headers?.host ?? "localhost"}`);
  const roomId = url.searchParams.get("roomId");
  if (!roomId) { console.log("[webrtc] WS rejected: no roomId"); socket.close(); return; }
  const room = getRoom(roomId);
  if (!room) { console.log("[webrtc] WS rejected: room not found", roomId); socket.close(); return; }
  socketRooms.set(socket, roomId);
  console.log("[webrtc] WS connected roomId=%s producers=%d", roomId, room.producers.size);

  socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch { return; }
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    const type = (msg as { type: string }).type;
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
        });
        console.log("[webrtc] WS roomId=%s createWebRtcTransport id=%s", roomId, transport.id);
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
          socket.send(JSON.stringify({ type: "error", error: "Transport not found" }));
          return;
        }
        await transport.connect({ dtlsParameters });
        console.log("[webrtc] WS roomId=%s connectWebRtcTransport transportId=%s", roomId, (msg as { transportId?: string }).transportId);
        socket.send(JSON.stringify({ type: "webRtcTransportConnected" }));
        return;
      }
      if (type === "produce") {
        const { transportId, kind, rtpParameters } = msg as unknown as { transportId: string; kind: mediasoup.types.MediaKind; rtpParameters: mediasoup.types.RtpParameters };
        const transport = roomState.transports.get(transportId);
        if (!transport) {
          socket.send(JSON.stringify({ type: "error", error: "Transport not found" }));
          return;
        }
        const producer = await transport.produce({ kind, rtpParameters });
        roomState.producers.set(producer.id, producer);
        producer.on("@close", () => roomState.producers.delete(producer.id));
        console.log("[webrtc] WS roomId=%s produce kind=%s id=%s totalProducers=%d", roomId, kind, producer.id, roomState.producers.size);
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
          socket.send(JSON.stringify({ type: "error", error: "Transport or producer not found" }));
          return;
        }
        if (!roomState.router.canConsume({ producerId, rtpCapabilities })) {
          socket.send(JSON.stringify({ type: "error", error: "Cannot consume" }));
          return;
        }
        const consumer = await transport.consume({ producerId, rtpCapabilities });
        socket.send(JSON.stringify({
          type: "consumed",
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        }));
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
    if (transport && roomState) roomState.transports.delete(transport.id);
    socketTransports.delete(socket);
    socketRooms.delete(socket);
  });
};

app.get("/ws", { websocket: true }, wsHandler);
app.get("/webrtc-ws/ws", { websocket: true }, wsHandler);

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`WebRTC service listening on port ${PORT}`);
