import { existsSync } from "fs";
import { join } from "path";
import { assertResolvedPathUnder, getDataDir } from "./paths.js";
import { Reader } from "@maxmind/geoip2-node";

const GEOIP_CITY_FILENAME = "GeoLite2-City.mmdb";
const GEOIP_COUNTRY_FILENAME = "GeoLite2-Country.mmdb";

let cityReader: Awaited<ReturnType<typeof Reader.open>> | null = null;
let countryReader: Awaited<ReturnType<typeof Reader.open>> | null = null;
let readerInit: Promise<void> | null = null;

/**
 * Check whether GeoLite2 database files exist in the data directory.
 */
export function checkGeoLiteDatabases(): { city: boolean; country: boolean } {
  const dataDir = getDataDir();
  const cityPath = join(dataDir, GEOIP_CITY_FILENAME);
  const countryPath = join(dataDir, GEOIP_COUNTRY_FILENAME);
  try {
    assertResolvedPathUnder(cityPath, dataDir);
    assertResolvedPathUnder(countryPath, dataDir);
  } catch {
    return { city: false, country: false };
  }
  return {
    city: existsSync(cityPath),
    country: existsSync(countryPath),
  };
}

/**
 * Clear cached GeoIP readers so the next lookup will reopen database files.
 * Call after running geoipupdate to pick up new databases.
 */
export function refreshGeoLiteReaders(): void {
  cityReader = null;
  countryReader = null;
  readerInit = null;
}

async function initReaders(): Promise<void> {
  if (readerInit) return readerInit;
  readerInit = (async () => {
    const dataDir = getDataDir();
    const cityPath = join(dataDir, GEOIP_CITY_FILENAME);
    const countryPath = join(dataDir, GEOIP_COUNTRY_FILENAME);
    assertResolvedPathUnder(cityPath, dataDir);
    assertResolvedPathUnder(countryPath, dataDir);

    const options = { watchForUpdates: true };

    if (existsSync(cityPath)) {
      try {
        cityReader = await Reader.open(cityPath, options);
      } catch {
        // ignore
      }
    }

    if (!cityReader && existsSync(countryPath)) {
      try {
        countryReader = await Reader.open(countryPath, options);
      } catch {
        // ignore
      }
    }
  })();
  return readerInit;
}

/**
 * Get a human-readable location string for an IP (e.g. "London, England, United Kingdom" or "United States").
 * Uses GeoLite2-City if present, otherwise GeoLite2-Country, from the data directory.
 * Returns null if no database is available or the IP cannot be resolved.
 */
export async function getLocationForIp(ip: string): Promise<string | null> {
  await initReaders();

  if (cityReader) {
    try {
      const res = cityReader.city(ip);
      const countryName = res.country?.names?.en ?? res.country?.isoCode ?? "";
      const cityName = res.city?.names?.en;
      const regionName = res.subdivisions?.[0]?.names?.en;
      const parts = [cityName, regionName, countryName].filter(Boolean);
      if (parts.length > 0) return parts.join(", ");
    } catch {
      // IP not in DB or invalid
    }
  }

  if (countryReader) {
    try {
      const res = countryReader.country(ip);
      const countryName = res.country?.names?.en ?? res.country?.isoCode ?? "";
      if (countryName) return countryName;
    } catch {
      // IP not in DB or invalid
    }
  }
  return null;
}
