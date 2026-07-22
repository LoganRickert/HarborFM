import type { ChildProcess } from "child_process";
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { PlainTransport, Producer } from "mediasoup/types";
import { nanoid } from "nanoid";
import { broadcastToRoom } from "../ws/roomBroadcast.js";
import {
  getRoom,
  producerParticipantMapRef,
  producerSourceMapRef,
} from "../room.js";
import { MAX_PRODUCERS_PER_ROOM, RECORDING_DATA_DIR } from "../config.js";
import { assertSafeId, sanitizeParticipantName } from "../validation.js";

export type FakeDialInState = {
  dialInId: string;
  roomId: string;
  participantId: string;
  participantName: string;
  producer: Producer;
  transport: PlainTransport;
  ffmpeg: ChildProcess;
  tempPath?: string;
};

const dialInsById = new Map<string, FakeDialInState>();
const dialInsByParticipant = new Map<string, string>(); // participantId -> dialInId
const dialInsByRoom = new Map<string, Set<string>>(); // roomId -> dialInIds

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

function stopFakeDialIn(state: FakeDialInState): void {
  try {
    state.ffmpeg.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    state.producer.close();
  } catch {
    /* ignore */
  }
  try {
    state.transport.close();
  } catch {
    /* ignore */
  }
  if (state.tempPath) {
    try {
      if (existsSync(state.tempPath)) unlinkSync(state.tempPath);
    } catch {
      /* ignore */
    }
  }
  producerSourceMapRef.delete(state.producer.id);
  producerParticipantMapRef.delete(state.producer.id);
  const room = getRoom(state.roomId);
  room?.producers.delete(state.producer.id);
  dialInsById.delete(state.dialInId);
  dialInsByParticipant.delete(state.participantId);
  untrackFromRoom(state.roomId, state.dialInId);
}

export function getFakeDialIn(dialInId: string): FakeDialInState | undefined {
  return dialInsById.get(dialInId);
}

export function getFakeDialInByParticipant(participantId: string): FakeDialInState | undefined {
  const id = dialInsByParticipant.get(participantId);
  return id ? dialInsById.get(id) : undefined;
}

export function leaveFakeDialIn(dialInId: string): boolean {
  const state = dialInsById.get(dialInId);
  if (!state) return false;
  const producerId = state.producer.id;
  const roomId = state.roomId;
  stopFakeDialIn(state);
  broadcastToRoom(roomId, { type: "producerClosed", producerId });
  return true;
}

export function leaveFakeDialInByParticipant(participantId: string): boolean {
  const dialInId = dialInsByParticipant.get(participantId);
  if (!dialInId) return false;
  return leaveFakeDialIn(dialInId);
}

/** Pause or resume the phone producer's audio (host mute). */
export function setFakeDialInMuted(participantId: string, muted: boolean): boolean {
  const state = getFakeDialInByParticipant(participantId);
  if (!state) return false;
  try {
    if (muted) {
      if (!state.producer.paused) state.producer.pause();
    } else if (state.producer.paused) {
      state.producer.resume();
    }
    return true;
  } catch {
    return false;
  }
}

/** Tear down all fake dial-ins in a room (call end). */
export function leaveAllFakeDialInsInRoom(roomId: string): number {
  const set = dialInsByRoom.get(roomId);
  if (!set || set.size === 0) return 0;
  const ids = [...set];
  let n = 0;
  for (const id of ids) {
    if (leaveFakeDialIn(id)) n++;
  }
  return n;
}

export type JoinFakeDialInOptions = {
  roomId: string;
  participantId: string;
  participantName: string;
  /** Optional WAV/PCM file; otherwise a continuous sine tone is generated. */
  audioPath?: string;
  /** Tone frequency when no audioPath. Default 880. */
  toneHz?: number;
};

async function waitForProducerPackets(producer: Producer, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stats = await producer.getStats();
      const packets = (stats as Array<{ packetCount?: number }>).reduce(
        (sum, s) => sum + (s.packetCount ?? 0),
        0,
      );
      const bytes = (stats as Array<{ byteCount?: number }>).reduce(
        (sum, s) => sum + (s.byteCount ?? 0),
        0,
      );
      if (packets > 0 || bytes > 0) return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Inject a fake phone caller into a mediasoup room as a PlainTransport Opus producer.
 * Source is labeled "phone" so recording keeps a separate multitrack segment.
 */
export async function joinFakeDialIn(
  opts: JoinFakeDialInOptions,
): Promise<{ dialInId: string; producerId: string }> {
  const roomId = opts.roomId.trim();
  const participantId = opts.participantId.trim();
  assertSafeId(roomId, "roomId");
  assertSafeId(participantId, "participantId");
  const participantName = sanitizeParticipantName(opts.participantName) || "Phone Guest";

  const existing = dialInsByParticipant.get(participantId);
  if (existing) {
    leaveFakeDialIn(existing);
  }

  const room = getRoom(roomId);
  if (!room) {
    throw Object.assign(new Error("Room not found"), { statusCode: 404 });
  }
  if (room.producers.size >= MAX_PRODUCERS_PER_ROOM) {
    throw Object.assign(new Error("Too many producers"), { statusCode: 503 });
  }

  const toneHz = typeof opts.toneHz === "number" && opts.toneHz > 0 ? opts.toneHz : 880;
  let audioPath = opts.audioPath?.trim();
  let tempPath: string | undefined;
  if (!audioPath || !existsSync(audioPath)) {
    const tempDir = join(RECORDING_DATA_DIR, "dial-in-temp");
    mkdirSync(tempDir, { recursive: true });
    tempPath = join(tempDir, `phone_${nanoid(10)}.wav`);
    const gen = spawnSync(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${toneHz}:sample_rate=48000:duration=5`,
        "-ac",
        "2",
        "-ar",
        "48000",
        "-y",
        tempPath,
      ],
      { encoding: "utf8" },
    );
    if (gen.status !== 0 || !existsSync(tempPath)) {
      throw Object.assign(
        new Error(`Failed to generate dial-in tone: ${gen.stderr || "unknown"}`),
        { statusCode: 500 },
      );
    }
    audioPath = tempPath;
  }

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
    if (tempPath && existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
    throw Object.assign(new Error("PlainTransport port not available"), { statusCode: 500 });
  }

  const ffmpegArgs = [
    "-loglevel",
    "warning",
    "-re",
    "-stream_loop",
    "-1",
    "-i",
    audioPath,
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
    "-f",
    "tee",
    `[select=a:f=rtp:ssrc=${ssrc}:payload_type=${payloadType}]rtp://127.0.0.1:${port}`,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
  let ffmpegErr = "";
  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    ffmpegErr += chunk.toString();
    if (ffmpegErr.length > 2000) ffmpegErr = ffmpegErr.slice(-2000);
  });

  const dialInId = nanoid(12);

  const state: FakeDialInState = {
    dialInId,
    roomId,
    participantId,
    participantName,
    producer,
    transport: plainTransport,
    ffmpeg,
    tempPath,
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
  ffmpeg.on("close", () => {
    if (dialInsById.get(dialInId) === state) {
      stopFakeDialIn(state);
      broadcastToRoom(roomId, { type: "producerClosed", producerId: producer.id });
    }
  });

  dialInsById.set(dialInId, state);
  dialInsByParticipant.set(participantId, dialInId);
  trackInRoom(roomId, dialInId);

  const gotPackets = await waitForProducerPackets(producer, 5000);
  if (!gotPackets) {
    stopFakeDialIn(state);
    throw Object.assign(
      new Error(`Fake dial-in produced no RTP packets${ffmpegErr ? `: ${ffmpegErr.trim()}` : ""}`),
      { statusCode: 502 },
    );
  }

  broadcastToRoom(roomId, { type: "newProducer", producerId: producer.id });
  broadcastToRoom(roomId, {
    type: "producerParticipant",
    producerId: producer.id,
    participantId,
    participantName,
  });

  return { dialInId, producerId: producer.id };
}
