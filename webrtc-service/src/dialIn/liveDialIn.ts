/**
 * Live Telnyx dial-in bridge: provider media WS ↔ mediasoup PlainTransport Opus
 * producer + mix-minus room audio back to the phone.
 *
 * Wire format (codec + sample rate) is taken from Telnyx's `start.media_format`
 * so 8 kHz PSTN and 16 kHz L16 (or other providers) both work without hardcoding.
 */

import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import type { Consumer, PlainTransport, Producer } from "mediasoup/types";
import { nanoid } from "nanoid";
import {
  getRecordPortOffsetAndIncrement,
  getRoom,
  producerParticipantMapRef,
  producerSourceMapRef,
  type RoomState,
} from "../room.js";
import {
  MAX_PRODUCERS_PER_ROOM,
  RECORDING_DATA_DIR,
  RECORD_PORT_STRIDE,
} from "../config.js";
import { broadcastToRoom } from "../ws/roomBroadcast.js";
import { assertSafeId, sanitizeParticipantName } from "../validation.js";
import type { DialInMediaTokenPayload } from "./mediaToken.js";

const MIX_REFRESH_MS = 5000;
const OUTBOUND_PORT_BASE = 52000;
const ALLOWED_RATES = new Set([8000, 16000, 24000, 48000]);

type WsLike = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

/** Negotiated Telnyx (or compatible) wire format for media frames. */
export type TelnyxWireFormat = {
  encoding: "PCMU" | "PCMA" | "L16";
  sampleRate: number;
  channels: number;
  /** Bytes per 20 ms frame. */
  frameBytes: number;
  /** FFmpeg raw demux/mux name for pipe I/O. */
  ffmpegRawFormat: string;
  silenceFill: number;
};

export type LiveDialInState = {
  dialInId: string;
  roomId: string;
  participantId: string;
  participantName: string;
  callControlId: string;
  producer: Producer;
  inboundTransport: PlainTransport;
  inboundFfmpeg: ChildProcess;
  socket: WsLike;
  format: TelnyxWireFormat;
  muted: boolean;
  outbound: OutboundMix | null;
  mixTimer: ReturnType<typeof setInterval> | null;
  silenceTimer: ReturnType<typeof setInterval> | null;
  closing: boolean;
};

type OutboundMix = {
  ffmpeg: ChildProcess;
  transports: PlainTransport[];
  consumers: Consumer[];
  producerIds: string[];
  sdpPaths: string[];
  stdoutBuf: Buffer;
  /** Pending PCMU/L16 frames; paced out at 20 ms so Telnyx does not queue bursts. */
  sendQueue: Buffer[];
  paceTimer: ReturnType<typeof setInterval> | null;
};

const dialInsById = new Map<string, LiveDialInState>();
const dialInsByParticipant = new Map<string, string>();
const dialInsByRoom = new Map<string, Set<string>>();

function trackInRoom(roomId: string, dialInId: string): void {
  let set = dialInsByRoom.get(roomId);
  if (!set) {
    set = new Set();
    dialInsByRoom.set(roomId, set);
  }
  set.add(dialInId);
}

function untrackFromRoom(roomId: string, dialInId: string): void {
  const set = dialInsByRoom.get(roomId);
  if (!set) return;
  set.delete(dialInId);
  if (set.size === 0) dialInsByRoom.delete(roomId);
}

/**
 * Map Telnyx `start.media_format` (or equivalent) to FFmpeg pipe settings.
 * Falls back to PCMU 8 kHz (PSTN default) when the frame is missing/unknown.
 */
export function resolveTelnyxWireFormat(raw?: {
  encoding?: string;
  sample_rate?: number | string;
  channels?: number | string;
}): TelnyxWireFormat {
  const enc = String(raw?.encoding ?? "PCMU")
    .trim()
    .toUpperCase();
  let sampleRate = Number(raw?.sample_rate);
  if (!ALLOWED_RATES.has(sampleRate)) {
    sampleRate = enc === "L16" || enc === "LINEAR16" ? 16000 : 8000;
  }
  let channels = Number(raw?.channels);
  if (!Number.isFinite(channels) || channels < 1) channels = 1;
  channels = Math.min(2, Math.floor(channels));

  if (enc === "L16" || enc === "LINEAR16" || enc === "PCM") {
    return {
      encoding: "L16",
      sampleRate,
      channels,
      frameBytes: (sampleRate / 50) * 2 * channels,
      // Telnyx WS L16 is little-endian (not RFC 3551 network-order BE).
      ffmpegRawFormat: "s16le",
      silenceFill: 0,
    };
  }
  if (enc === "PCMA" || enc === "ALAW") {
    return {
      encoding: "PCMA",
      sampleRate,
      channels: 1,
      frameBytes: sampleRate / 50,
      ffmpegRawFormat: "alaw",
      silenceFill: 0xd5,
    };
  }
  return {
    encoding: "PCMU",
    sampleRate,
    channels: 1,
    frameBytes: sampleRate / 50,
    ffmpegRawFormat: "mulaw",
    silenceFill: 0xff,
  };
}

function createOpusSdp(rtpPort: number, rtcpPort: number, payloadType: number): string {
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=-",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
    `m=audio ${rtpPort} RTP/AVP ${payloadType}`,
    `a=rtcp:${rtcpPort}`,
    `a=rtpmap:${payloadType} opus/48000/2`,
    "a=sendonly",
    "",
  ].join("\n");
}

function stopOutbound(out: OutboundMix | null): void {
  if (!out) return;
  if (out.paceTimer) {
    clearInterval(out.paceTimer);
    out.paceTimer = null;
  }
  out.sendQueue.length = 0;
  try {
    out.ffmpeg.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  for (const c of out.consumers) {
    try {
      c.close();
    } catch {
      /* ignore */
    }
  }
  for (const t of out.transports) {
    try {
      t.close();
    } catch {
      /* ignore */
    }
  }
  for (const p of out.sdpPaths) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function stopLiveDialIn(state: LiveDialInState): void {
  if (state.closing) return;
  state.closing = true;
  if (state.mixTimer) {
    clearInterval(state.mixTimer);
    state.mixTimer = null;
  }
  if (state.silenceTimer) {
    clearInterval(state.silenceTimer);
    state.silenceTimer = null;
  }
  stopOutbound(state.outbound);
  state.outbound = null;
  try {
    state.inboundFfmpeg.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    state.inboundFfmpeg.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    state.producer.close();
  } catch {
    /* ignore */
  }
  try {
    state.inboundTransport.close();
  } catch {
    /* ignore */
  }
  try {
    if (state.socket.readyState === 1) state.socket.close();
  } catch {
    /* ignore */
  }
  producerSourceMapRef.delete(state.producer.id);
  producerParticipantMapRef.delete(state.producer.id);
  const room = getRoom(state.roomId);
  room?.producers.delete(state.producer.id);
  dialInsById.delete(state.dialInId);
  dialInsByParticipant.delete(state.participantId);
  untrackFromRoom(state.roomId, state.dialInId);
}

export function getLiveDialIn(dialInId: string): LiveDialInState | undefined {
  return dialInsById.get(dialInId);
}

export function getLiveDialInByParticipant(
  participantId: string,
): LiveDialInState | undefined {
  const id = dialInsByParticipant.get(participantId);
  return id ? dialInsById.get(id) : undefined;
}

export function leaveLiveDialIn(dialInId: string): boolean {
  const state = dialInsById.get(dialInId);
  if (!state) return false;
  const producerId = state.producer.id;
  const roomId = state.roomId;
  stopLiveDialIn(state);
  broadcastToRoom(roomId, { type: "producerClosed", producerId });
  return true;
}

export function leaveLiveDialInByParticipant(participantId: string): boolean {
  const dialInId = dialInsByParticipant.get(participantId);
  if (!dialInId) return false;
  return leaveLiveDialIn(dialInId);
}

export function leaveAllLiveDialInsInRoom(roomId: string): number {
  const set = dialInsByRoom.get(roomId);
  if (!set || set.size === 0) return 0;
  const ids = [...set];
  let n = 0;
  for (const id of ids) {
    if (leaveLiveDialIn(id)) n++;
  }
  return n;
}

export function setLiveDialInMuted(participantId: string, muted: boolean): boolean {
  const state = getLiveDialInByParticipant(participantId);
  if (!state) return false;
  state.muted = muted;
  try {
    if (muted) {
      if (!state.producer.paused) void state.producer.pause();
    } else if (state.producer.paused) {
      void state.producer.resume();
    }
    return true;
  } catch {
    return false;
  }
}

function sendMediaFrame(socket: WsLike, pcm: Buffer): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(
      JSON.stringify({
        event: "media",
        media: { payload: pcm.toString("base64") },
      }),
    );
  } catch {
    /* ignore */
  }
}

function silenceFrame(format: TelnyxWireFormat): Buffer {
  return Buffer.alloc(format.frameBytes, format.silenceFill);
}

async function buildOutboundMix(
  room: RoomState,
  excludeProducerId: string,
  format: TelnyxWireFormat,
): Promise<OutboundMix | null> {
  const otherIds = [...room.producers.entries()]
    .filter(([id, p]) => id !== excludeProducerId && p.kind === "audio")
    .map(([id]) => id);
  if (otherIds.length === 0) return null;

  const routerCodec = room.router.rtpCapabilities.codecs?.find(
    (c: { kind?: string }) => c.kind === "audio",
  );
  const rtpCapabilities = {
    codecs: routerCodec ? [routerCodec] : [],
    headerExtensions: room.router.rtpCapabilities.headerExtensions ?? [],
  };

  const transports: PlainTransport[] = [];
  const consumers: Consumer[] = [];
  const sdpPaths: string[] = [];
  const ports: { rtpPort: number; rtcpPort: number }[] = [];
  const tempDir = join(RECORDING_DATA_DIR, "dial-in-temp");
  mkdirSync(tempDir, { recursive: true });

  try {
    for (const producerId of otherIds) {
      const portIdx = getRecordPortOffsetAndIncrement(RECORD_PORT_STRIDE);
      const rtpPort = OUTBOUND_PORT_BASE + (portIdx % 2000) * 4;
      const rtcpPort = rtpPort + 1;

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
      const sdpPath = join(tempDir, `mix_${nanoid(8)}.sdp`);
      writeFileSync(sdpPath, createOpusSdp(rtpPort, rtcpPort, payloadType), "utf8");

      transports.push(plainTransport);
      consumers.push(consumer);
      sdpPaths.push(sdpPath);
      ports.push({ rtpPort, rtcpPort });
    }

    if (consumers.length === 0) return null;

    const n = consumers.length;
    const layout = format.channels === 2 ? "stereo" : "mono";
    const filter =
      n === 1
        ? `[0:a]aresample=${format.sampleRate},aformat=sample_fmts=s16:channel_layouts=${layout}[out]`
        : `${Array.from({ length: n }, (_, i) => `[${i}:a]`).join("")}amix=inputs=${n}:duration=longest:dropout_transition=0,aresample=${format.sampleRate},aformat=sample_fmts=s16:channel_layouts=${layout}[out]`;

    const inputArgs: string[] = [];
    for (const sdpPath of sdpPaths) {
      inputArgs.push(
        "-fflags",
        "nobuffer+discardcorrupt",
        "-flags",
        "low_delay",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-protocol_whitelist",
        "file,udp,rtp",
        "-reorder_queue_size",
        "0",
        "-f",
        "sdp",
        "-i",
        sdpPath,
      );
    }

    const args = [
      "-loglevel",
      "warning",
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-f",
      format.ffmpegRawFormat,
      "-ar",
      String(format.sampleRate),
      "-ac",
      String(format.channels),
      "pipe:1",
    ];

    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    ffmpeg.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 1500) stderr = stderr.slice(-1500);
    });

    // Match recording path: let FFmpeg bind, then connect PlainTransport RTP.
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < consumers.length; i++) {
      const { rtpPort, rtcpPort } = ports[i]!;
      await transports[i]!.connect({
        ip: "127.0.0.1",
        port: rtpPort,
        rtcpPort,
      });
      await consumers[i]!.resume();
    }

    const mix: OutboundMix = {
      ffmpeg,
      transports,
      consumers,
      producerIds: [...otherIds],
      sdpPaths,
      stdoutBuf: Buffer.alloc(0),
      sendQueue: [],
      paceTimer: null,
    };

    ffmpeg.on("exit", (code) => {
      if (code && code !== 0 && stderr) {
        console.warn("[dial-in live] outbound ffmpeg exited:", code, stderr.trim());
      }
    });

    return mix;
  } catch (err) {
    for (const c of consumers) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    for (const t of transports) {
      try {
        t.close();
      } catch {
        /* ignore */
      }
    }
    for (const p of sdpPaths) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    console.warn("[dial-in live] outbound mix failed:", err);
    return null;
  }
}

function attachOutboundReader(state: LiveDialInState): void {
  const out = state.outbound;
  if (!out?.ffmpeg.stdout) return;
  const frameBytes = state.format.frameBytes;
  /** Keep at most ~100 ms queued; drop older frames to stay live. */
  const maxQueuedFrames = 5;
  out.ffmpeg.stdout.removeAllListeners("data");
  out.stdoutBuf = Buffer.alloc(0);
  out.sendQueue = [];
  if (out.paceTimer) {
    clearInterval(out.paceTimer);
    out.paceTimer = null;
  }

  out.ffmpeg.stdout.on("data", (chunk: Buffer) => {
    if (state.closing || state.muted) return;
    out.stdoutBuf = Buffer.concat([out.stdoutBuf, chunk]);
    while (out.stdoutBuf.length >= frameBytes) {
      const frame = Buffer.from(out.stdoutBuf.subarray(0, frameBytes));
      out.stdoutBuf = out.stdoutBuf.subarray(frameBytes);
      out.sendQueue.push(frame);
      while (out.sendQueue.length > maxQueuedFrames) {
        out.sendQueue.shift();
      }
    }
  });

  out.paceTimer = setInterval(() => {
    if (state.closing || state.muted || !state.outbound) return;
    const frame = out.sendQueue.shift();
    if (frame) sendMediaFrame(state.socket, frame);
  }, 20);
}

async function refreshOutboundMix(state: LiveDialInState): Promise<void> {
  if (state.closing) return;
  const room = getRoom(state.roomId);
  if (!room) return;

  const wanted = [...room.producers.entries()]
    .filter(([id, p]) => id !== state.producer.id && p.kind === "audio")
    .map(([id]) => id)
    .sort()
    .join(",");
  const current = (state.outbound?.producerIds ?? []).slice().sort().join(",");
  if (wanted === current && state.outbound) return;

  stopOutbound(state.outbound);
  state.outbound = null;
  if (!wanted) return;

  const mix = await buildOutboundMix(room, state.producer.id, state.format);
  if (!mix || state.closing) {
    stopOutbound(mix);
    return;
  }
  state.outbound = mix;
  attachOutboundReader(state);
}

async function startBridgeAfterFormat(
  socket: WsLike,
  token: DialInMediaTokenPayload,
  format: TelnyxWireFormat,
  earlyMedia: Buffer[],
): Promise<void> {
  const roomId = token.roomId.trim();
  const participantId = token.participantId.trim();
  const participantName =
    sanitizeParticipantName(token.participantName) || "Phone Guest";
  const dialInId = token.dialInId.trim() || participantId;

  const existing = dialInsByParticipant.get(participantId);
  if (existing) {
    leaveLiveDialIn(existing);
  }

  const room = getRoom(roomId);
  if (!room) {
    socket.close(1011, "Room not found");
    return;
  }
  if (room.producers.size >= MAX_PRODUCERS_PER_ROOM) {
    socket.close(1013, "Too many producers");
    return;
  }

  console.info(
    `[dial-in live] wire format ${format.encoding} ${format.sampleRate}Hz ${format.channels}ch (${format.ffmpegRawFormat})`,
  );

  const plainTransport = await room.router.createPlainTransport({
    listenIp: { ip: "127.0.0.1" },
    rtcpMux: true,
    comedia: true,
  });
  const ssrc = 100000000 + Math.floor(Math.random() * 800000000);
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

  const port = plainTransport.tuple.localPort;
  if (!port) {
    try {
      producer.close();
    } catch {
      /* ignore */
    }
    try {
      plainTransport.close();
    } catch {
      /* ignore */
    }
    socket.close(1011, "PlainTransport port not available");
    return;
  }

  const ffmpegArgs = [
    "-loglevel",
    "warning",
    "-f",
    format.ffmpegRawFormat,
    "-ar",
    String(format.sampleRate),
    "-ac",
    String(format.channels),
    "-i",
    "pipe:0",
    "-map",
    "0:a:0",
    "-acodec",
    "libopus",
    "-ab",
    "64k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-application",
    "voip",
    "-f",
    "tee",
    `[select=a:f=rtp:ssrc=${ssrc}:payload_type=${payloadType}]rtp://127.0.0.1:${port}`,
  ];

  const inboundFfmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "ignore", "pipe"],
  });
  inboundFfmpeg.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("error") || text.includes("Error")) {
      console.warn("[dial-in live] inbound ffmpeg:", text.trim().slice(0, 400));
    }
  });

  const state: LiveDialInState = {
    dialInId,
    roomId,
    participantId,
    participantName,
    callControlId: token.callControlId,
    producer,
    inboundTransport: plainTransport,
    inboundFfmpeg,
    socket,
    format,
    muted: false,
    outbound: null,
    mixTimer: null,
    silenceTimer: null,
    closing: false,
  };

  producerSourceMapRef.set(producer.id, "phone");
  producerParticipantMapRef.set(producer.id, { participantId, participantName });
  room.producers.set(producer.id, producer);

  producer.on("@close", () => {
    room.producers.delete(producer.id);
    producerSourceMapRef.delete(producer.id);
    producerParticipantMapRef.delete(producer.id);
  });
  plainTransport.on("@close", () => {
    room.producers.delete(producer.id);
  });
  inboundFfmpeg.on("close", () => {
    if (dialInsById.get(dialInId) === state) {
      stopLiveDialIn(state);
      broadcastToRoom(roomId, { type: "producerClosed", producerId: producer.id });
    }
  });

  dialInsById.set(dialInId, state);
  dialInsByParticipant.set(participantId, dialInId);
  trackInRoom(roomId, dialInId);

  broadcastToRoom(roomId, { type: "newProducer", producerId: producer.id });
  broadcastToRoom(roomId, {
    type: "producerParticipant",
    producerId: producer.id,
    participantId,
    participantName,
  });

  for (const chunk of earlyMedia) {
    try {
      if (inboundFfmpeg.stdin?.writable) inboundFfmpeg.stdin.write(chunk);
    } catch {
      /* ignore */
    }
  }

  void refreshOutboundMix(state);
  state.mixTimer = setInterval(() => {
    void refreshOutboundMix(state);
  }, MIX_REFRESH_MS);

  state.silenceTimer = setInterval(() => {
    if (state.closing) return;
    if (state.muted || !state.outbound) {
      sendMediaFrame(state.socket, silenceFrame(format));
    }
  }, 20);
}

/**
 * Handle inbound Telnyx media WebSocket for a validated dial-in token.
 * Waits for `start.media_format` before opening the Opus bridge.
 */
export async function attachLiveDialInMedia(
  socket: WsLike,
  token: DialInMediaTokenPayload,
): Promise<void> {
  const roomId = token.roomId.trim();
  const participantId = token.participantId.trim();
  assertSafeId(roomId, "roomId");
  assertSafeId(participantId, "participantId");
  const dialInId = token.dialInId.trim() || participantId;

  if (!getRoom(roomId)) {
    socket.close(1011, "Room not found");
    return;
  }

  let started = false;
  const earlyMedia: Buffer[] = [];
  const EARLY_MEDIA_MAX = 50;

  const onMediaPayload = (b64: string, track?: string) => {
    if (track === "outbound") return;
    const pcm = Buffer.from(b64, "base64");
    if (pcm.length === 0) return;
    if (!started) {
      if (earlyMedia.length < EARLY_MEDIA_MAX) earlyMedia.push(pcm);
      return;
    }
    const state = dialInsById.get(dialInId);
    if (!state || state.closing || state.muted) return;
    try {
      if (state.inboundFfmpeg.stdin?.writable) state.inboundFfmpeg.stdin.write(pcm);
    } catch {
      /* ignore */
    }
  };

  socket.on("message", (...args: unknown[]) => {
    const data = args[0];
    let msg: {
      event?: string;
      media?: { payload?: string; track?: string };
      start?: {
        media_format?: {
          encoding?: string;
          sample_rate?: number | string;
          channels?: number | string;
        };
      };
    };
    try {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data ?? "");
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    const event = msg.event;
    if (event === "connected") return;
    if (event === "start") {
      if (started) return;
      started = true;
      const format = resolveTelnyxWireFormat(msg.start?.media_format);
      void startBridgeAfterFormat(socket, token, format, earlyMedia).catch((err) => {
        console.warn("[dial-in live] bridge start failed:", err);
        try {
          socket.close(1011, "Dial-in media failed");
        } catch {
          /* ignore */
        }
      });
      return;
    }
    if (event === "stop") {
      leaveLiveDialIn(dialInId);
      return;
    }
    if (event !== "media") return;
    const b64 = msg.media?.payload;
    if (typeof b64 !== "string" || !b64) return;
    onMediaPayload(b64, msg.media?.track);
  });

  socket.on("close", () => {
    leaveLiveDialIn(dialInId);
  });
  socket.on("error", () => {
    leaveLiveDialIn(dialInId);
  });

  // If the provider never sends `start`, fall back after a short wait so the
  // call is not stuck silent (PSTN-safe PCMU 8 kHz default).
  setTimeout(() => {
    if (started || socket.readyState !== 1) return;
    started = true;
    console.warn("[dial-in live] no start frame; falling back to PCMU 8 kHz");
    void startBridgeAfterFormat(
      socket,
      token,
      resolveTelnyxWireFormat({ encoding: "PCMU", sample_rate: 8000, channels: 1 }),
      earlyMedia,
    ).catch((err) => {
      console.warn("[dial-in live] bridge fallback failed:", err);
    });
  }, 3000);
}
