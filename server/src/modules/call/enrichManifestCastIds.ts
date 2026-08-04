/**
 * Stamp castId onto tracks_manifest segments from the live call session.
 * Prefer existing segment.castId (from associateProducer); fill gaps from
 * session participants matched by participantId.
 */
export function enrichManifestCastIds(
  tracksManifest: unknown,
  participants: Array<{ id: string; castId?: string }>,
): unknown {
  if (!tracksManifest || typeof tracksManifest !== "object") return tracksManifest;
  const manifest = tracksManifest as { segments?: unknown };
  if (!Array.isArray(manifest.segments)) return tracksManifest;

  const castByParticipantId = new Map<string, string>();
  for (const p of participants) {
    if (p.castId && p.id) castByParticipantId.set(p.id, p.castId);
  }
  if (castByParticipantId.size === 0) {
    // Still normalize: keep any castId already on segments.
    return tracksManifest;
  }

  const segments = manifest.segments.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const seg = { ...(raw as Record<string, unknown>) };
    const existing =
      typeof seg.castId === "string" && seg.castId.trim()
        ? seg.castId.trim()
        : null;
    if (existing) {
      seg.castId = existing;
      return seg;
    }
    const pid =
      typeof seg.participantId === "string" ? seg.participantId : null;
    if (!pid) return seg;
    const castId = castByParticipantId.get(pid);
    if (castId) seg.castId = castId;
    return seg;
  });

  return { ...manifest, segments };
}
