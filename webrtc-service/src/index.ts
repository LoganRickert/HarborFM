import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import * as mediasoup from "mediasoup";
import { nanoid } from "nanoid";
import { existsSync, mkdirSync, statSync } from "fs";
import { spawn, type ChildProcess } from "child_process";
import { dirname, join } from "path";

type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type PlainTransport = mediasoup.types.PlainTransport;
type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;

const PORT = Number(process.env.PORT) || 3002;
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

type ActiveRecording = RecordingMeta & {
  ffmpeg: ChildProcess;
  plainTransports: PlainTransport[];
  consumers: Consumer[];
  checkStorageInterval?: ReturnType<typeof setInterval>;
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
  const allProducerIds = Array.from(room.producers.values()).map((p) => ({ id: p.id, kind: p.kind }));
  console.log("[webrtc] POST /start-recording roomId=%s segmentId=%s totalProducers=%d audioProducers=%d producers=%j",
    roomId, segmentId, room.producers.size, audioProducers.length, allProducerIds);
  if (audioProducers.length === 0) {
    console.log("[webrtc] POST /start-recording roomId=%s rejected: no audio producer", roomId);
    return reply.status(400).send({ error: "No audio producer in room" });
  }

  let allProducersNoPackets = true;
  let anyProducerPaused = false;
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
      if (bytesReceived > 0 || packetsReceived > 0) allProducersNoPackets = false;
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

    console.log("[webrtc] start-recording roomId=%s creating %d consumers for FFmpeg", roomId, audioProducers.length);
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
      console.log("[webrtc] start-recording roomId=%s consumer %d producerId=%s rtpPort=%d", roomId, i, audioProducers[i]!.id, rtpPort);
    }

    const filePath = join(RECORDING_DATA_DIR, filePathRelative);
    console.log("[webrtc] start-recording roomId=%s output filePath=%s", roomId, filePath);
    mkdirSync(dirname(filePath), { recursive: true });

    const sdp = createMultiAudioSdp(sdpSpecs);
    const numInputs = consumers.length;

    const ffmpegArgs: string[] = [
      "-loglevel", "warning",
      "-protocol_whitelist", "pipe,udp,rtp",
      "-reorder_queue_size", "500",
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
    console.log("[webrtc] start-recording roomId=%s spawning FFmpeg numInputs=%d", roomId, numInputs);
    const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
    ffmpeg.stdin?.write(sdp);
    ffmpeg.stdin?.end();
    console.log("[webrtc] start-recording roomId=%s FFmpeg SDP:\n%s", roomId, sdp);
    ffmpeg.on("error", (err) => request.log.error({ err }, "FFmpeg error"));
    ffmpeg.on("close", (code, signal) => {
      request.log.info({ code, signal }, "FFmpeg exited");
      console.log("[webrtc] FFmpeg exited roomId=%s code=%s signal=%s", roomId, code, signal);
    });
    ffmpeg.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        request.log.info({ ffmpeg: line }, "FFmpeg stderr");
        console.log("[webrtc] FFmpeg roomId=%s: %s", roomId, line);
      }
    });

    await new Promise((r) => setTimeout(r, 1000));
    console.log("[webrtc] start-recording roomId=%s connecting PlainTransports to FFmpeg", roomId);
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
    console.log("[webrtc] start-recording roomId=%s resuming %d consumers", roomId, consumers.length);
    for (const c of consumers) await c.resume();

    const secret = meta.recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
    let checkStorageInterval: ReturnType<typeof setInterval> | undefined;
    if (MAIN_APP_URL && secret && meta.sessionId) {
      checkStorageInterval = setInterval(async () => {
        const state = recordingByRoom.get(roomId);
        if (!state) return;
        try {
          const size = existsSync(filePath) ? statSync(filePath).size : 0;
          const res = await fetch(`${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-check-storage`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
            body: JSON.stringify({ sessionId: meta.sessionId, bytesRecordedSoFar: size }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { stop?: boolean; error?: string };
          if (data.stop && data.error) {
            console.log("[webrtc] Storage limit reached roomId=%s bytesRecorded=%d stopping", roomId, size);
            if (state.checkStorageInterval) clearInterval(state.checkStorageInterval);
            recordingByRoom.delete(roomId);
            for (const c of state.consumers) try { c.close(); } catch { /* ignore */ }
            for (const t of state.plainTransports) try { t.close(); } catch { /* ignore */ }
            state.ffmpeg.kill("SIGINT");
            await fetch(`${MAIN_APP_URL.replace(/\/$/, "")}/api/call/internal/recording-error`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Recording-Secret": secret },
              body: JSON.stringify({ sessionId: meta.sessionId, error: data.error }),
            });
            console.log("[webrtc] Recording roomId=%s stopped: storage limit", roomId);
          }
        } catch (e) {
          request.log.warn({ err: e }, "recording-check-storage failed");
        }
      }, 20000);
    }

    const activeRecording: ActiveRecording = { ...meta, ffmpeg, plainTransports, consumers, checkStorageInterval };
    recordingByRoom.set(roomId, activeRecording);
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
  console.log("[webrtc] POST /stop-recording roomId=%s hadState=%s filePath=%s", roomId, !!state, state?.filePathRelative ?? "n/a");
  if (!state) return reply.send({ ok: true });
  if (state.checkStorageInterval) clearInterval(state.checkStorageInterval);

  let callbackFired = false;
  const doCallback = (fileOk: boolean) => {
    if (callbackFired) return;
    callbackFired = true;
    const secret = state.recordingCallbackSecret?.trim() || process.env.RECORDING_CALLBACK_SECRET?.trim() || "";
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

  console.log("[webrtc] stop-recording roomId=%s closing %d consumers, %d transports, sending SIGINT to FFmpeg", roomId, state.consumers.length, state.plainTransports.length);
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
    console.log("[webrtc] stop-recording roomId=%s FFmpeg did not exit in 5s, sending SIGKILL", roomId);
    state.ffmpeg.kill("SIGKILL");
  }, 5000);
  state.ffmpeg.once("close", () => {
    clearTimeout(exitTimeout);
    const filePath = join(RECORDING_DATA_DIR, state.filePathRelative);
    const exists = existsSync(filePath);
    const size = exists ? statSync(filePath).size : 0;
    const fileOk = exists && size > 0;
    if (!fileOk) {
      console.log("[webrtc] stop-recording roomId=%s FFmpeg exited but file missing or empty path=%s exists=%s size=%d", roomId, filePath, exists, size);
    }
    doCallback(fileOk);
  });

  return reply.send({ ok: true });
});

const socketRooms = new Map<unknown, string>();
const socketTransports = new Map<unknown, WebRtcTransport>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wsHandler = (socket: any, req: any) => {
  const url = new URL(req.url ?? "", `http://${req.headers?.host ?? "localhost"}`);
  const roomId = url.searchParams.get("roomId");
  const wsUrl = req.url ?? "?";
  if (!roomId) {
    console.log("[webrtc] WS rejected: no roomId url=%s", wsUrl);
    socket.close();
    return;
  }
  const room = getRoom(roomId);
  if (!room) {
    console.log("[webrtc] WS rejected: room not found roomId=%s url=%s", roomId, wsUrl);
    socket.close();
    return;
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
        const { transportId, kind, rtpParameters } = msg as unknown as { transportId: string; kind: mediasoup.types.MediaKind; rtpParameters: mediasoup.types.RtpParameters };
        const transport = roomState.transports.get(transportId);
        if (!transport) {
          console.log("[webrtc] WS roomId=%s produce FAILED transportId=%s not found (transports=%j)", roomId, transportId, Array.from(roomState.transports.keys()));
          socket.send(JSON.stringify({ type: "error", error: "Transport not found" }));
          return;
        }
        const producer = await transport.produce({ kind, rtpParameters });
        roomState.producers.set(producer.id, producer);
        producer.on("@close", () => {
          roomState.producers.delete(producer.id);
          console.log("[webrtc] WS roomId=%s producer closed id=%s producersRemaining=%d", roomId, producer.id, roomState.producers.size);
        });
        const codec = rtpParameters.codecs?.[0]?.mimeType ?? "?";
        console.log("[webrtc] WS roomId=%s produce kind=%s id=%s transportId=%s codec=%s totalProducers=%d",
          roomId, kind, producer.id, transportId, codec, roomState.producers.size);
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
        console.log("[webrtc] WS roomId=%s consume producerId=%s consumerId=%s", roomId, producerId, consumer.id);
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

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log("[webrtc] Service listening on port %d", PORT);
console.log("[webrtc] Config RTC_MIN_PORT=%d RTC_MAX_PORT=%d MEDIASOUP_ANNOUNCED_IP=%s RECORDING_DATA_DIR=%s MAIN_APP_URL=%s DATA_DIR=%s",
  RTC_MIN_PORT, RTC_MAX_PORT, ANNOUNCED_IP ?? "(none)", RECORDING_DATA_DIR, MAIN_APP_URL || "(none)", process.env.DATA_DIR ?? "(none)");
