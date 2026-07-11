import { getAnyActiveSessionForEpisode } from "../../services/callSession.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { broadcastToSession } from "../call/shared.js";
import * as repo from "./repo.js";

/** Push show notes to episode collaborators and active call guests. */
export function broadcastShowNotesUpdate(episodeId: string): void {
  const { guestVisible, items } = repo.getShowNotesForEpisode(episodeId);
  broadcastToEpisode(episodeId, { type: "showNotesUpdated" });
  const session = getAnyActiveSessionForEpisode(episodeId);
  if (!session) return;
  const guestItems = guestVisible ? repo.listUncheckedItemsForGuest(episodeId) : [];
  broadcastToSession(session.sessionId, {
    type: "showNotesUpdated",
    guestVisible,
    showNotesItems: guestItems,
  });
}

export function getGuestCallShowNotesPayload(episodeId: string): {
  showNotesGuestVisible: boolean;
  showNotesItems: ReturnType<typeof repo.listUncheckedItemsForGuest>;
} {
  const guestVisible = repo.getGuestVisible(episodeId);
  return {
    showNotesGuestVisible: guestVisible,
    showNotesItems: guestVisible ? repo.listUncheckedItemsForGuest(episodeId) : [],
  };
}
