import type { Producer } from "mediasoup/types";
import type { RecordingManager } from "./RecordingManager.js";
import { getRoom, recordingByRoom } from "../room.js";

let recordingManager: RecordingManager | null = null;

export function setRecordingManager(manager: RecordingManager): void {
  recordingManager = manager;
}

/**
 * If this room is currently recording, attach the producer immediately
 * (used for mid-call soundboard one-shots that would otherwise miss the 2.5s poll).
 */
export async function maybeAddProducerToActiveRecording(
  roomId: string,
  producer: Producer,
): Promise<void> {
  const manager = recordingManager;
  if (!manager) return;
  const rec = recordingByRoom.get(roomId);
  if (!rec) return;
  if (rec.activeSegmentsByProducerId.has(producer.id)) return;
  if (rec.leftProducerIds.has(producer.id)) return;
  const room = getRoom(roomId);
  if (!room) return;
  try {
    const seg = await manager.addProducerToRecording(
      roomId,
      room,
      rec,
      producer,
    );
    // Recording may have stopped while we were attaching.
    if (seg && recordingByRoom.get(roomId) === rec) {
      rec.activeSegmentsByProducerId.set(producer.id, seg);
      console.log(
        "[webrtc] Attached producer to active recording roomId=%s producerId=%s source=%s",
        roomId,
        producer.id,
        seg.source ?? "mic",
      );
    }
  } catch (err) {
    console.warn(
      "[webrtc] Failed to attach producer to active recording:",
      producer.id,
      err,
    );
  }
}
