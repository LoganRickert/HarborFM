import { asc, eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodeShowNotesItems, episodes } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import type { ShowNotesGuestTag, ShowNotesItem, ShowNotesTag } from "@harborfm/shared";

export type ShowNotesRow = {
  id: string;
  episodeId: string;
  position: number;
  text: string;
  durationMin: number | null;
  checked: boolean;
  tag: string;
  submittedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeTag(raw: string | null | undefined): ShowNotesTag {
  if (raw === "discuss" || raw === "avoid" || raw === "none") return raw;
  return "none";
}

export function normalizeSubmittedByKey(value: string): string {
  return value.trim().toLowerCase();
}

function rowToItem(row: ShowNotesRow): ShowNotesItem {
  const durationMin = row.durationMin;
  const validDuration =
    durationMin === 5 ||
    durationMin === 10 ||
    durationMin === 15 ||
    durationMin === 20 ||
    durationMin === 25 ||
    durationMin === 30
      ? durationMin
      : null;
  return {
    id: row.id,
    text: row.text,
    durationMin: validDuration,
    checked: row.checked,
    position: row.position,
    tag: normalizeTag(row.tag),
    submittedBy: row.submittedBy?.trim() ? row.submittedBy.trim() : null,
  };
}

export function getGuestVisible(episodeId: string): boolean {
  const row = drizzleDb
    .select({ guestVisible: episodes.showNotesGuestVisible })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .get();
  return row?.guestVisible === true;
}

export function setGuestVisible(episodeId: string, guestVisible: boolean): void {
  drizzleDb
    .update(episodes)
    .set({ showNotesGuestVisible: guestVisible, updatedAt: sqlNow() })
    .where(eq(episodes.id, episodeId))
    .run();
}

export function listItemsForEpisode(episodeId: string): ShowNotesItem[] {
  const rows = drizzleDb
    .select()
    .from(episodeShowNotesItems)
    .where(eq(episodeShowNotesItems.episodeId, episodeId))
    .orderBy(asc(episodeShowNotesItems.position), asc(episodeShowNotesItems.createdAt))
    .all() as ShowNotesRow[];
  return rows.map(rowToItem);
}

/** Run-of-show notes for in-call guests (unchecked, tag none only). */
export function listUncheckedItemsForGuest(episodeId: string): ShowNotesItem[] {
  return listItemsForEpisode(episodeId).filter((i) => !i.checked && i.tag === "none");
}

export function getShowNotesForEpisode(episodeId: string): {
  guestVisible: boolean;
  items: ShowNotesItem[];
} {
  return {
    guestVisible: getGuestVisible(episodeId),
    items: listItemsForEpisode(episodeId),
  };
}

export function getNextPosition(episodeId: string): number {
  const rows = drizzleDb
    .select({ position: episodeShowNotesItems.position })
    .from(episodeShowNotesItems)
    .where(eq(episodeShowNotesItems.episodeId, episodeId))
    .orderBy(asc(episodeShowNotesItems.position))
    .all();
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => r.position)) + 1;
}

export function insertItem(
  episodeId: string,
  id: string,
  text: string,
  position: number,
  opts?: {
    tag?: ShowNotesTag;
    submittedBy?: string | null;
    durationMin?: number | null;
    checked?: boolean;
  },
): ShowNotesItem {
  const now = sqlNow();
  const tag = opts?.tag ?? "none";
  const submittedBy =
    opts?.submittedBy != null && opts.submittedBy.trim()
      ? opts.submittedBy.trim()
      : null;
  const checked = opts?.checked ?? false;
  const rawDuration = opts?.durationMin ?? null;
  const durationMin =
    rawDuration === 5 ||
    rawDuration === 10 ||
    rawDuration === 15 ||
    rawDuration === 20 ||
    rawDuration === 25 ||
    rawDuration === 30
      ? rawDuration
      : null;
  drizzleDb
    .insert(episodeShowNotesItems)
    .values({
      id,
      episodeId,
      position,
      text,
      durationMin,
      checked,
      tag,
      submittedBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return {
    id,
    text,
    durationMin,
    checked,
    position,
    tag,
    submittedBy,
  };
}

export function getItemById(
  episodeId: string,
  itemId: string,
): ShowNotesRow | undefined {
  return drizzleDb
    .select()
    .from(episodeShowNotesItems)
    .where(eq(episodeShowNotesItems.id, itemId))
    .get() as ShowNotesRow | undefined;
}

export function updateItem(
  episodeId: string,
  itemId: string,
  patch: {
    text?: string;
    durationMin?: number | null;
    checked?: boolean;
    tag?: ShowNotesTag;
    submittedBy?: string | null;
  },
): ShowNotesItem | undefined {
  const existing = getItemById(episodeId, itemId);
  if (!existing || existing.episodeId !== episodeId) return undefined;
  const setValues: Record<string, unknown> = { updatedAt: sqlNow() };
  if (patch.text !== undefined) setValues.text = patch.text;
  if (patch.durationMin !== undefined) setValues.durationMin = patch.durationMin;
  if (patch.checked !== undefined) setValues.checked = patch.checked;
  if (patch.tag !== undefined) setValues.tag = patch.tag;
  if (patch.submittedBy !== undefined) {
    setValues.submittedBy =
      patch.submittedBy != null && patch.submittedBy.trim()
        ? patch.submittedBy.trim()
        : null;
  }
  drizzleDb
    .update(episodeShowNotesItems)
    .set(setValues as typeof episodeShowNotesItems.$inferInsert)
    .where(eq(episodeShowNotesItems.id, itemId))
    .run();
  const row = getItemById(episodeId, itemId);
  return row ? rowToItem(row) : undefined;
}

export function deleteItem(episodeId: string, itemId: string): boolean {
  const existing = getItemById(episodeId, itemId);
  if (!existing || existing.episodeId !== episodeId) return false;
  drizzleDb
    .delete(episodeShowNotesItems)
    .where(eq(episodeShowNotesItems.id, itemId))
    .run();
  return true;
}

export function reorderItems(episodeId: string, itemIds: string[]): ShowNotesItem[] {
  const current = listItemsForEpisode(episodeId);
  const currentIds = new Set(current.map((i) => i.id));
  if (itemIds.length !== current.length) {
    throw new Error("itemIds length mismatch");
  }
  for (const id of itemIds) {
    if (!currentIds.has(id)) throw new Error("invalid item id");
  }
  itemIds.forEach((id, position) => {
    drizzleDb
      .update(episodeShowNotesItems)
      .set({ position, updatedAt: sqlNow() })
      .where(eq(episodeShowNotesItems.id, id))
      .run();
  });
  return listItemsForEpisode(episodeId);
}

/**
 * Reorder only tag=none notes: assign the positions currently held by none
 * items to the new none order. Tagged rows keep their positions.
 */
export function reorderNotesItems(
  episodeId: string,
  noteItemIds: string[],
): ShowNotesItem[] {
  const current = listItemsForEpisode(episodeId);
  const notes = current.filter((i) => i.tag === "none");
  const noteIds = new Set(notes.map((i) => i.id));
  if (noteItemIds.length !== notes.length) {
    throw new Error("itemIds length mismatch");
  }
  for (const id of noteItemIds) {
    if (!noteIds.has(id)) throw new Error("invalid item id");
  }
  const slots = notes.map((i) => i.position).sort((a, b) => a - b);
  noteItemIds.forEach((id, idx) => {
    drizzleDb
      .update(episodeShowNotesItems)
      .set({ position: slots[idx]!, updatedAt: sqlNow() })
      .where(eq(episodeShowNotesItems.id, id))
      .run();
  });
  return listItemsForEpisode(episodeId);
}

/**
 * Guest-visible suggestions for a submitter: discuss/avoid, plus any of theirs
 * already promoted into Notes (tag none, submittedBy still set).
 */
export function listGuestTopicsForSubmitter(
  episodeId: string,
  submittedBy: string,
): ShowNotesItem[] {
  const key = normalizeSubmittedByKey(submittedBy);
  if (!key) return [];
  return listItemsForEpisode(episodeId).filter(
    (i) =>
      i.submittedBy != null &&
      normalizeSubmittedByKey(i.submittedBy) === key &&
      (i.tag === "discuss" || i.tag === "avoid" || i.tag === "none"),
  );
}

/** Promote a discuss suggestion into Notes (tag none) at the end of the list. */
export function promoteDiscussTopicToNotes(
  episodeId: string,
  itemId: string,
): ShowNotesItem | undefined {
  const existing = getItemById(episodeId, itemId);
  if (!existing || existing.episodeId !== episodeId) return undefined;
  if (normalizeTag(existing.tag) !== "discuss") return undefined;
  const position = getNextPosition(episodeId);
  drizzleDb
    .update(episodeShowNotesItems)
    .set({
      tag: "none",
      position,
      updatedAt: sqlNow(),
    })
    .where(eq(episodeShowNotesItems.id, itemId))
    .run();
  const row = getItemById(episodeId, itemId);
  return row ? rowToItem(row) : undefined;
}

export function insertGuestTopic(
  episodeId: string,
  id: string,
  text: string,
  tag: ShowNotesGuestTag,
  submittedBy: string,
): ShowNotesItem {
  const position = getNextPosition(episodeId);
  return insertItem(episodeId, id, text, position, { tag, submittedBy });
}

/**
 * Reorder a submitter's discuss/avoid items among the position slots they
 * currently occupy.
 */
export function reorderGuestTopicsForSubmitter(
  episodeId: string,
  submittedBy: string,
  itemIds: string[],
): ShowNotesItem[] {
  const mine = listGuestTopicsForSubmitter(episodeId, submittedBy);
  const mineIds = new Set(mine.map((i) => i.id));
  if (itemIds.length !== mine.length) {
    throw new Error("itemIds length mismatch");
  }
  for (const id of itemIds) {
    if (!mineIds.has(id)) throw new Error("invalid item id");
  }
  const slots = mine.map((i) => i.position).sort((a, b) => a - b);
  itemIds.forEach((id, idx) => {
    drizzleDb
      .update(episodeShowNotesItems)
      .set({ position: slots[idx]!, updatedAt: sqlNow() })
      .where(eq(episodeShowNotesItems.id, id))
      .run();
  });
  return listGuestTopicsForSubmitter(episodeId, submittedBy);
}

export function guestTopicOwnedBySubmitter(
  episodeId: string,
  itemId: string,
  submittedBy: string,
): ShowNotesItem | undefined {
  const item = listItemsForEpisode(episodeId).find((i) => i.id === itemId);
  if (!item) return undefined;
  if (item.tag !== "discuss" && item.tag !== "avoid" && item.tag !== "none") {
    return undefined;
  }
  if (!item.submittedBy) return undefined;
  if (normalizeSubmittedByKey(item.submittedBy) !== normalizeSubmittedByKey(submittedBy)) {
    return undefined;
  }
  return item;
}
