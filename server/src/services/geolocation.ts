import { existsSync } from 'fs';
import { join } from 'path';
import { assertResolvedPathUnder, getDataDir } from './paths.js';
import { Reader } from '@maxmind/geoip2-node';

let cityReader: Awaited<ReturnType<typeof Reader.open>> | null = null;
let countryReader: Awaited<ReturnType<typeof Reader.open>> | null = null;
let readerInit: Promise<void> | null = null;

async function initReaders(): Promise<void> {
  if (readerInit) return readerInit;
  readerInit = (async () => {
    const dataDir = getDataDir();
    const cityPath = join(dataDir, 'GeoLite2-City.mmdb');
    const countryPath = join(dataDir, 'GeoLite2-Country.mmdb');
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
      const countryName = res.country?.names?.en ?? res.country?.isoCode ?? '';
      const cityName = res.city?.names?.en;
      const regionName = res.subdivisions?.[0]?.names?.en;
      const parts = [cityName, regionName, countryName].filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    } catch {
      // IP not in DB or invalid
    }
  }
  
  if (countryReader) {
    try {
      const res = countryReader.country(ip);
      const countryName = res.country?.names?.en ?? res.country?.isoCode ?? '';
      if (countryName) return countryName;
    } catch {
      // IP not in DB or invalid
    }
  }
  return null;
}
