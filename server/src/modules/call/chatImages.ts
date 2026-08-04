import { existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { loadImage } from "canvas";
import {
  API_PREFIX,
  CALL_CHAT_IMAGE_MAX_BYTES,
  CALL_CHAT_IMAGE_MAX_SIDE,
  DATA_DIR,
} from "../../config.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  assertSafeId,
  ensureDir,
} from "../../services/paths.js";
import { imageExtFromMagic } from "../../utils/artwork.js";

const SAFE_IMAGE_ID = /^[a-zA-Z0-9_-]+$/;

export function callChatImagesDir(sessionId: string): string {
  assertSafeId(sessionId, "sessionId");
  const dir = join(DATA_DIR, "call-chat", sessionId);
  ensureDir(dir);
  return dir;
}

export function callChatImageAbsolutePath(
  sessionId: string,
  imageId: string,
): string {
  assertSafeId(sessionId, "sessionId");
  if (!SAFE_IMAGE_ID.test(imageId)) {
    throw new Error("Invalid imageId");
  }
  return join(callChatImagesDir(sessionId), `${imageId}.jpg`);
}

export function callChatImageExists(
  sessionId: string,
  imageId: string,
): boolean {
  try {
    const abs = callChatImageAbsolutePath(sessionId, imageId);
    const dir = callChatImagesDir(sessionId);
    const safe = assertPathUnder(abs, dir);
    return existsSync(safe);
  } catch {
    return false;
  }
}

/** Relative API URL with join token so guests can load without cookies. */
export function callChatImageUrl(
  sessionId: string,
  imageId: string,
  token: string,
): string {
  return `/${API_PREFIX}/call/chat-images/${encodeURIComponent(sessionId)}/${encodeURIComponent(imageId)}?token=${encodeURIComponent(token)}`;
}

export async function validateAndStoreCallChatImage(opts: {
  sessionId: string;
  buffer: Buffer;
  mimetype: string;
}): Promise<{ id: string } | { error: string }> {
  const { sessionId, buffer, mimetype } = opts;
  if (!mimetype.startsWith("image/")) {
    return { error: "Not an image" };
  }
  if (buffer.length > CALL_CHAT_IMAGE_MAX_BYTES) {
    return { error: "Image too large (max 1MB)" };
  }
  const magicExt = imageExtFromMagic(buffer);
  if (magicExt !== "jpg") {
    return { error: "Image must be JPEG" };
  }
  if (!(mimetype.includes("jpeg") || mimetype.includes("jpg"))) {
    return { error: "Image content does not match type" };
  }

  try {
    const img = await loadImage(buffer);
    if (
      img.width > CALL_CHAT_IMAGE_MAX_SIDE ||
      img.height > CALL_CHAT_IMAGE_MAX_SIDE
    ) {
      return {
        error: `Image dimensions too large (max ${CALL_CHAT_IMAGE_MAX_SIDE}px per side)`,
      };
    }
  } catch {
    return { error: "Could not read image" };
  }

  const id = nanoid();
  const dir = callChatImagesDir(sessionId);
  const destPath = join(dir, `${id}.jpg`);
  assertResolvedPathUnder(destPath, dir);
  writeFileSync(destPath, buffer);
  return { id };
}

/** Remove all chat images for a session (call end). Safe if dir missing. */
export function deleteCallChatImagesForSession(sessionId: string): void {
  const trimmed = sessionId?.trim();
  if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
  const dir = join(DATA_DIR, "call-chat", trimmed);
  try {
    if (!existsSync(dir)) return;
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error("[callChat] failed to delete images for session", trimmed, err);
  }
}
