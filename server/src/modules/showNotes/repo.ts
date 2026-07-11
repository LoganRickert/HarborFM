import { asc, eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodeShowNotesItems, episodes } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import type { ShowNotesItem } from "@harborfm/shared";

export type ShowNotesRow = {
  id: string;
  episodeId: string;
  position: number;
  text: string;
  durationMin: number | null;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
};

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

export function listUncheckedItemsForGuest(episodeId: string): ShowNotesItem[] {
  return listItemsForEpisode(episodeId).filter((i) => !i.checked);
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
): ShowNotesItem {
  const now = sqlNow();
  drizzleDb
    .insert(episodeShowNotesItems)
    .values({
      id,
      episodeId,
      position,
      text,
      durationMin: null,
      checked: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return {
    id,
    text,
    durationMin: null,
    checked: false,
    position,
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
  patch: { text?: string; durationMin?: number | null; checked?: boolean },
): ShowNotesItem | undefined {
  const existing = getItemById(episodeId, itemId);
  if (!existing || existing.episodeId !== episodeId) return undefined;
  const setValues: Record<string, unknown> = { updatedAt: sqlNow() };
  if (patch.text !== undefined) setValues.text = patch.text;
  if (patch.durationMin !== undefined) setValues.durationMin = patch.durationMin;
  if (patch.checked !== undefined) setValues.checked = patch.checked;
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
