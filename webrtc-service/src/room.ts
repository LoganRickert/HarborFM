import * as mediasoup from "mediasoup";
import { RTC_MIN_PORT, RTC_MAX_PORT, ANNOUNCED_IP } from "./config.js";

type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type Producer = mediasoup.types.Producer;

export type RoomState = {
  router: Router;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
};

export type RecordingState = import("./recording/RecordingManager.js").RecordingState;

const rooms = new Map<string, RoomState>();
const producerSourceMap = new Map<string, string>();
const producerParticipantMap = new Map<string, { participantId: string; participantName: string }>();
const producerSoundboardAssetMap = new Map<string, string>();
const soundboardVolumeByRoom = new Map<string, number>();
const soundboardVolumeAtStop = new Map<string, number>();
export type SoundboardState = {
  producer: mediasoup.types.Producer;
  transport: mediasoup.types.PlainTransport;
  ffmpeg: import("child_process").ChildProcess;
  tempPath: string;
};
export const soundboardByRoom = new Map<string, SoundboardState>();

let worker: mediasoup.types.Worker | null = null;
let recordPortOffsetCounter = 0;

export const roomsMap = rooms;
export const producerSourceMapRef = producerSourceMap;
export const producerParticipantMapRef = producerParticipantMap;
export const producerSoundboardAssetMapRef = producerSoundboardAssetMap;
export const soundboardVolumeByRoomRef = soundboardVolumeByRoom;
export const soundboardVolumeAtStopRef = soundboardVolumeAtStop;
export const recordingByRoom = new Map<string, RecordingState>();

export function getRecordPortOffsetAndIncrement(stride: number): number {
  return (recordPortOffsetCounter++ * stride) % 10000;
}

export async function getWorker(): Promise<mediasoup.types.Worker> {
  if (worker) return worker;
  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: RTC_MIN_PORT,
    rtcMaxPort: RTC_MAX_PORT,
  });
  worker.on("died", (err) => {
    console.warn("[webrtc] Worker died:", err);
    worker = null;
  });
  return worker;
}

export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId);
}

/** Producer IDs whose WebRtcTransport is connected (iceState=completed, dtlsState=connected).
 * Also includes server-side producers (e.g. soundboard on PlainTransport) - they are always "connected". */
export async function getProducerIdsOnConnectedTransports(room: RoomState): Promise<Set<string>> {
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
export async function getTransportForProducer(
  room: RoomState,
  producerId: string
): Promise<WebRtcTransport | null> {
  for (const transport of room.transports.values()) {
    try {
      const dump = await transport.dump();
      if ((dump.producerIds ?? []).includes(producerId)) return transport;
    } catch { /* ignore */ }
  }
  return null;
}

export function setRoom(roomId: string, state: RoomState): void {
  rooms.set(roomId, state);
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}
