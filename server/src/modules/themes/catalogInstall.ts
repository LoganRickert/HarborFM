import type {
  ThemeCatalogInstallResponse,
  ThemeBuiltinUpdateResponse,
} from "@harborfm/shared";
import {
  fetchThemeCatalogDocument,
  fetchThemeZipFromUrl,
} from "./catalogFetch.js";
import {
  addThemeCatalogDestination,
  getThemeCatalogDestination,
  HARBORFM_OFFICIAL_THEME_CATALOG_URL,
  hasOfficialThemeCatalogDestination,
  listThemeCatalogDestinations,
  removeThemeCatalogDestination,
} from "./destinations.js";
import { ThemeImportError, importThemeZip } from "./importTheme.js";
import { getServerThemeDir } from "./paths.js";
import { readThemeManifest } from "./themePages.js";
import * as repo from "./repo.js";

function resolveDownloadUrl(downloadUrl: string, catalogUrl: string): string {
  try {
    return new URL(downloadUrl, catalogUrl).toString();
  } catch {
    throw new ThemeImportError("Catalog theme has an invalid downloadUrl", 400);
  }
}

export function listDestinationsForApi() {
  const destinations = listThemeCatalogDestinations();
  return {
    destinations,
    officialCatalogUrl: HARBORFM_OFFICIAL_THEME_CATALOG_URL,
    hasOfficial: hasOfficialThemeCatalogDestination(),
  };
}

export async function addDestinationFromUrl(input: { name: string; url: string }) {
  const trimmedUrl = input.url.trim();
  const trimmedName = input.name.trim();
  // Validate that the URL serves a usable catalog before saving.
  await fetchThemeCatalogDocument(trimmedUrl, { bypassCache: true });
  try {
    return addThemeCatalogDestination({
      name: trimmedName,
      url: trimmedUrl,
    });
  } catch (err) {
    throw new ThemeImportError(
      err instanceof Error ? err.message : "Failed to add destination",
      400,
    );
  }
}

export function deleteDestination(id: string): void {
  if (!removeThemeCatalogDestination(id)) {
    throw new ThemeImportError("Destination not found", 404);
  }
}

export async function browseDestinationCatalog(destinationId: string) {
  const destination = getThemeCatalogDestination(destinationId);
  if (!destination) {
    throw new ThemeImportError("Destination not found", 404);
  }
  const document = await fetchThemeCatalogDocument(destination.url);
  return {
    name: document.name,
    themes: document.themes,
  };
}

export async function installThemeFromCatalog(
  userId: string,
  input: { destinationId: string; packageId: string; scope: "user" | "server" },
): Promise<ThemeCatalogInstallResponse> {
  const destination = getThemeCatalogDestination(input.destinationId);
  if (!destination) {
    throw new ThemeImportError("Destination not found", 404);
  }

  if (input.scope === "server") {
    const existing =
      repo.getServerThemeById(input.packageId) ??
      repo.getServerThemeByPackageId(input.packageId);
    if (existing) {
      throw new ThemeImportError(
        `Server theme already exists: ${input.packageId}`,
        409,
      );
    }
  }

  const document = await fetchThemeCatalogDocument(destination.url);
  const entry = document.themes.find((t) => t.id === input.packageId);
  if (!entry) {
    throw new ThemeImportError("Theme not found in catalog", 404);
  }

  const zipUrl = resolveDownloadUrl(entry.downloadUrl, destination.url);
  const zipBuffer = await fetchThemeZipFromUrl(zipUrl);
  const result = importThemeZip(userId, zipBuffer, {
    scope: input.scope,
    catalogUrl: destination.url,
    allowServerOverwrite: false,
  });

  if (result.packageId !== input.packageId) {
    throw new ThemeImportError(
      "Downloaded theme package id does not match the catalog entry",
      400,
    );
  }

  return {
    id: result.id,
    packageId: result.packageId,
    name: result.name,
    version: result.version,
    scope: result.scope,
    updated: result.updated,
  };
}

export async function updateServerThemeFromCatalog(
  _userId: string,
  builtinId: string,
): Promise<ThemeBuiltinUpdateResponse> {
  const row =
    repo.getServerThemeById(builtinId) ?? repo.getServerThemeByPackageId(builtinId);
  if (!row) {
    throw new ThemeImportError("Theme not found", 404);
  }

  const root = getServerThemeDir(row.id);
  const manifest = readThemeManifest(root);
  if (!manifest) {
    throw new ThemeImportError("theme.json is missing or invalid", 400);
  }
  const catalogUrl = manifest.catalog?.trim();
  if (!catalogUrl) {
    throw new ThemeImportError(
      "This server theme has no catalog URL to check for updates",
      400,
    );
  }
  if (manifest.allowOverride === false) {
    throw new ThemeImportError(
      "This server theme was edited and cannot be overwritten from a catalog",
      409,
    );
  }

  const document = await fetchThemeCatalogDocument(catalogUrl, {
    bypassCache: true,
  });
  const entry = document.themes.find((t) => t.id === manifest.id);
  if (!entry) {
    throw new ThemeImportError("Theme not found in catalog", 404);
  }

  if (entry.version === manifest.version) {
    return {
      id: row.id,
      packageId: row.packageId,
      name: manifest.name,
      version: manifest.version,
      updated: false,
      message: `Already on version ${manifest.version}.`,
    };
  }

  const zipUrl = resolveDownloadUrl(entry.downloadUrl, catalogUrl);
  const zipBuffer = await fetchThemeZipFromUrl(zipUrl);
  // userId is unused for server-scope import; required by the shared import signature.
  const result = importThemeZip(_userId, zipBuffer, {
    scope: "server",
    catalogUrl,
    allowServerOverwrite: true,
  });

  return {
    id: result.id,
    packageId: result.packageId,
    name: result.name,
    version: result.version,
    updated: true,
  };
}
