import { nanoid } from "nanoid";
import {
  HARBORFM_OFFICIAL_THEME_CATALOG_URL,
  themeCatalogDestinationSchema,
  type ThemeCatalogDestination,
} from "@harborfm/shared";
import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { themeCatalogDestinations } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function urlsMatch(a: string, b: string): boolean {
  return normalizeUrl(a).toLowerCase() === normalizeUrl(b).toLowerCase();
}

function rowToDestination(row: {
  id: string;
  name: string;
  url: string;
}): ThemeCatalogDestination {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
  };
}

export function listThemeCatalogDestinations(): ThemeCatalogDestination[] {
  return drizzleDb
    .select({
      id: themeCatalogDestinations.id,
      name: themeCatalogDestinations.name,
      url: themeCatalogDestinations.url,
    })
    .from(themeCatalogDestinations)
    .all()
    .map(rowToDestination)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getThemeCatalogDestination(
  id: string,
): ThemeCatalogDestination | null {
  const row = drizzleDb
    .select({
      id: themeCatalogDestinations.id,
      name: themeCatalogDestinations.name,
      url: themeCatalogDestinations.url,
    })
    .from(themeCatalogDestinations)
    .where(eq(themeCatalogDestinations.id, id))
    .limit(1)
    .get();
  return row ? rowToDestination(row) : null;
}

export function hasOfficialThemeCatalogDestination(): boolean {
  return listThemeCatalogDestinations().some((d) =>
    urlsMatch(d.url, HARBORFM_OFFICIAL_THEME_CATALOG_URL),
  );
}

export function addThemeCatalogDestination(input: {
  name: string;
  url: string;
}): ThemeCatalogDestination {
  const url = input.url.trim();
  const name = input.name.trim();
  const existing = listThemeCatalogDestinations();
  if (existing.some((d) => urlsMatch(d.url, url))) {
    throw new Error("That catalog destination is already added");
  }

  const destination: ThemeCatalogDestination = {
    id: nanoid(),
    name,
    url,
  };
  const check = themeCatalogDestinationSchema.safeParse(destination);
  if (!check.success) {
    throw new Error(check.error.issues[0]?.message ?? "Invalid destination");
  }

  const now = sqlNow();
  try {
    drizzleDb
      .insert(themeCatalogDestinations)
      .values({
        id: check.data.id,
        name: check.data.name,
        url: check.data.url,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|UNIQUE/i.test(message)) {
      throw new Error("That catalog destination is already added");
    }
    throw err;
  }
  return check.data;
}

export function removeThemeCatalogDestination(id: string): boolean {
  const existing = getThemeCatalogDestination(id);
  if (!existing) return false;
  drizzleDb
    .delete(themeCatalogDestinations)
    .where(eq(themeCatalogDestinations.id, id))
    .run();
  return true;
}

export { HARBORFM_OFFICIAL_THEME_CATALOG_URL };
