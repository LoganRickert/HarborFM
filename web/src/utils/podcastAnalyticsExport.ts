import type { PodcastAnalytics } from '../api/podcasts';

export type AnalyticsDateRange = { startDate: string; endDate: string };

export type AnalyticsExportPodcast = {
  id: string;
  title: string;
  slug: string;
};

type LongRow = {
  table: string;
  date: string;
  episode_id: string;
  episode_title: string;
  location: string;
  source: string;
  listeners: number | '';
  crawlers: number | '';
};

const METRIC_DEFINITIONS = {
  downloads:
    'Unique valid audio downloads of about one minute or more (250 KB), at most one per client per episode per day. Bots and tiny Range probes are excluded from human Downloads.',
  uniqueListeners:
    'Distinct clients (IP + User-Agent + Accept-Language) with at least one Download in the selected date range.',
  feedHealth:
    'RSS feed fetches. Directory crawlers are invalid traffic for Downloads; shown separately under Feed health.',
  rawAudioFetches:
    'Full-file or 250 KB+ audio requests before daily dedup. Tiny probes are excluded.',
  downloadsByLocation: 'Human Downloads broken down by location (when available).',
  listeners: 'Human clients (human_count).',
  crawlers: 'Bots and directory crawlers (bot_count).',
  retention:
    'Website player playhead reach by decile on the HarborFM site or theme player.',
} as const;

const CSV_COLUMNS = [
  'table',
  'date',
  'episode_id',
  'episode_title',
  'location',
  'source',
  'listeners',
  'crawlers',
] as const;

function formatLocalDateYYYYMMDD(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive local-calendar window of `days` days ending today (browser timezone). */
function lastNLocalDateRange(days: number): AnalyticsDateRange {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
  return {
    startDate: formatLocalDateYYYYMMDD(start),
    endDate: formatLocalDateYYYYMMDD(end),
  };
}

function collectStatDates(analytics: PodcastAnalytics): string[] {
  const dates: string[] = [];
  for (const row of analytics.rssDaily) {
    if (row.statDate) dates.push(row.statDate);
  }
  for (const row of analytics.episodeDaily) {
    if (row.statDate) dates.push(row.statDate);
  }
  for (const row of analytics.episodeLocationDaily) {
    if (row.statDate) dates.push(row.statDate);
  }
  for (const row of analytics.episodeListensDaily) {
    if (row.statDate) dates.push(row.statDate);
  }
  return dates;
}

export function resolveAnalyticsDateRange(analytics: PodcastAnalytics): AnalyticsDateRange {
  const dates = collectStatDates(analytics);
  if (dates.length === 0) return lastNLocalDateRange(14);
  dates.sort((a, b) => a.localeCompare(b));
  return { startDate: dates[0]!, endDate: dates[dates.length - 1]! };
}

function safeFilenamePart(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'podcast';
}

export function buildAnalyticsExportFilename(
  podcast: AnalyticsExportPodcast,
  range: AnalyticsDateRange,
  extension: 'xlsx' | 'csv' | 'json',
): string {
  const base = safeFilenamePart(podcast.slug || podcast.title);
  return `${base}-analytics-${range.startDate}-to-${range.endDate}.${extension}`;
}

function episodeTitleMap(analytics: PodcastAnalytics): Map<string, string> {
  return new Map(analytics.episodes.map((ep) => [ep.id, ep.title]));
}

function buildOverviewRows(analytics: PodcastAnalytics): Array<{
  date: string;
  downloads: number;
  raw_fetches: number;
  feed_listeners: number;
}> {
  const byDate: Record<string, { feed: number; requests: number; downloads: number }> = {};
  for (const row of analytics.rssDaily) {
    const d = row.statDate;
    if (!byDate[d]) byDate[d] = { feed: 0, requests: 0, downloads: 0 };
    byDate[d].feed += row.humanCount;
  }
  for (const row of analytics.episodeDaily) {
    const d = row.statDate;
    if (!byDate[d]) byDate[d] = { feed: 0, requests: 0, downloads: 0 };
    byDate[d].requests += row.humanCount;
  }
  for (const row of analytics.episodeListensDaily) {
    const d = row.statDate;
    if (!byDate[d]) byDate[d] = { feed: 0, requests: 0, downloads: 0 };
    byDate[d].downloads += row.humanCount;
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      downloads: v.downloads,
      raw_fetches: v.requests,
      feed_listeners: v.feed,
    }));
}

function buildLongRows(
  analytics: PodcastAnalytics,
  podcast: AnalyticsExportPodcast,
  range: AnalyticsDateRange,
): LongRow[] {
  const titles = episodeTitleMap(analytics);
  const rows: LongRow[] = [];

  for (const [field, value] of Object.entries(buildExportMeta(podcast, range, analytics))) {
    rows.push({
      table: 'meta',
      date: field,
      episode_id: '',
      episode_title: '',
      location: '',
      source: value,
      listeners: '',
      crawlers: '',
    });
  }

  for (const ep of analytics.episodes) {
    rows.push({
      table: 'episodes',
      date: '',
      episode_id: ep.id,
      episode_title: ep.title,
      location: '',
      source: '',
      listeners: '',
      crawlers: '',
    });
  }

  for (const row of analytics.rssDaily) {
    rows.push({
      table: 'feed_health',
      date: row.statDate,
      episode_id: '',
      episode_title: '',
      location: '',
      source: row.source,
      listeners: row.humanCount,
      crawlers: row.botCount,
    });
  }

  for (const row of analytics.episodeDaily) {
    rows.push({
      table: 'raw_audio_fetches',
      date: row.statDate,
      episode_id: row.episodeId,
      episode_title: titles.get(row.episodeId) ?? '',
      location: '',
      source: row.source,
      listeners: row.humanCount,
      crawlers: row.botCount,
    });
  }

  for (const row of analytics.episodeListensDaily) {
    rows.push({
      table: 'downloads',
      date: row.statDate,
      episode_id: row.episodeId,
      episode_title: titles.get(row.episodeId) ?? '',
      location: '',
      source: row.source,
      listeners: row.humanCount,
      crawlers: row.botCount,
    });
  }

  for (const row of analytics.episodeLocationDaily) {
    rows.push({
      table: 'downloads_by_location',
      date: row.statDate,
      episode_id: row.episodeId,
      episode_title: titles.get(row.episodeId) ?? '',
      location: row.location,
      source: row.source,
      listeners: row.humanCount,
      crawlers: row.botCount,
    });
  }

  return rows;
}

function buildExportMeta(
  podcast: AnalyticsExportPodcast,
  range: AnalyticsDateRange,
  analytics?: PodcastAnalytics,
): Record<string, string> {
  return {
    podcastId: podcast.id,
    podcastTitle: podcast.title,
    podcastSlug: podcast.slug,
    startDate: range.startDate,
    endDate: range.endDate,
    exportedAt: new Date().toISOString(),
    uniqueListenersTotal: String(analytics?.uniqueListeners ?? 0),
    feedHealth: METRIC_DEFINITIONS.feedHealth,
    rawAudioFetches: METRIC_DEFINITIONS.rawAudioFetches,
    downloads: METRIC_DEFINITIONS.downloads,
    uniqueListeners: METRIC_DEFINITIONS.uniqueListeners,
    downloadsByLocation: METRIC_DEFINITIONS.downloadsByLocation,
    retention: METRIC_DEFINITIONS.retention,
    listeners: METRIC_DEFINITIONS.listeners,
    crawlers: METRIC_DEFINITIONS.crawlers,
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows: LongRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((col) => escapeCsvCell(row[col])).join(','),
    );
  }
  return lines.join('\n');
}

export function downloadAnalyticsJson(
  podcast: AnalyticsExportPodcast,
  analytics: PodcastAnalytics,
  range: AnalyticsDateRange = resolveAnalyticsDateRange(analytics),
): void {
  const payload = {
    meta: buildExportMeta(podcast, range, analytics),
    rssDaily: analytics.rssDaily,
    episodes: analytics.episodes,
    episodeDaily: analytics.episodeDaily,
    episodeLocationDaily: analytics.episodeLocationDaily,
    episodeListensDaily: analytics.episodeListensDaily,
    uniqueListeners: analytics.uniqueListeners,
    uniqueListenersByEpisode: analytics.uniqueListenersByEpisode,
    retentionByEpisode: analytics.retentionByEpisode,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, buildAnalyticsExportFilename(podcast, range, 'json'));
}

export function downloadAnalyticsCsv(
  podcast: AnalyticsExportPodcast,
  analytics: PodcastAnalytics,
  range: AnalyticsDateRange = resolveAnalyticsDateRange(analytics),
): void {
  const csv = rowsToCsv(buildLongRows(analytics, podcast, range));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, buildAnalyticsExportFilename(podcast, range, 'csv'));
}

export async function downloadAnalyticsExcel(
  podcast: AnalyticsExportPodcast,
  analytics: PodcastAnalytics,
  range: AnalyticsDateRange = resolveAnalyticsDateRange(analytics),
): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HarborFM';
  workbook.created = new Date();

  const meta = buildExportMeta(podcast, range, analytics);
  const metaSheet = workbook.addWorksheet('Meta');
  metaSheet.addRow(['Field', 'Value']);
  for (const [field, value] of Object.entries(meta)) {
    metaSheet.addRow([field, value]);
  }
  metaSheet.getColumn(1).width = 24;
  metaSheet.getColumn(2).width = 80;

  const episodesSheet = workbook.addWorksheet('Episodes');
  episodesSheet.addRow(['episode_id', 'title', 'slug']);
  for (const ep of analytics.episodes) {
    episodesSheet.addRow([ep.id, ep.title, ep.slug ?? '']);
  }
  episodesSheet.getColumn(1).width = 36;
  episodesSheet.getColumn(2).width = 40;
  episodesSheet.getColumn(3).width = 24;

  const overviewSheet = workbook.addWorksheet('Overview');
  overviewSheet.addRow(['date', 'downloads', 'raw_fetches', 'feed_listeners']);
  for (const row of buildOverviewRows(analytics)) {
    overviewSheet.addRow([row.date, row.downloads, row.raw_fetches, row.feed_listeners]);
  }
  overviewSheet.getColumn(1).width = 14;
  overviewSheet.getColumn(2).width = 14;
  overviewSheet.getColumn(3).width = 14;
  overviewSheet.getColumn(4).width = 14;

  const titles = episodeTitleMap(analytics);

  const feedSheet = workbook.addWorksheet('Feed health');
  feedSheet.addRow(['date', 'source', 'listeners', 'crawlers']);
  for (const row of analytics.rssDaily) {
    feedSheet.addRow([row.statDate, row.source, row.humanCount, row.botCount]);
  }
  feedSheet.getColumn(1).width = 14;
  feedSheet.getColumn(2).width = 24;
  feedSheet.getColumn(3).width = 12;
  feedSheet.getColumn(4).width = 12;

  const requestsSheet = workbook.addWorksheet('Raw audio fetches');
  requestsSheet.addRow(['date', 'episode_id', 'episode_title', 'source', 'listeners', 'crawlers']);
  for (const row of analytics.episodeDaily) {
    requestsSheet.addRow([
      row.statDate,
      row.episodeId,
      titles.get(row.episodeId) ?? '',
      row.source,
      row.humanCount,
      row.botCount,
    ]);
  }
  requestsSheet.getColumn(1).width = 14;
  requestsSheet.getColumn(2).width = 36;
  requestsSheet.getColumn(3).width = 40;
  requestsSheet.getColumn(4).width = 24;
  requestsSheet.getColumn(5).width = 12;
  requestsSheet.getColumn(6).width = 12;

  const listensSheet = workbook.addWorksheet('Downloads');
  listensSheet.addRow(['date', 'episode_id', 'episode_title', 'source', 'listeners', 'crawlers']);
  for (const row of analytics.episodeListensDaily) {
    listensSheet.addRow([
      row.statDate,
      row.episodeId,
      titles.get(row.episodeId) ?? '',
      row.source,
      row.humanCount,
      row.botCount,
    ]);
  }
  listensSheet.getColumn(1).width = 14;
  listensSheet.getColumn(2).width = 36;
  listensSheet.getColumn(3).width = 40;
  listensSheet.getColumn(4).width = 24;
  listensSheet.getColumn(5).width = 12;
  listensSheet.getColumn(6).width = 12;

  const locationSheet = workbook.addWorksheet('Downloads by location');
  locationSheet.addRow([
    'date',
    'episode_id',
    'episode_title',
    'location',
    'source',
    'listeners',
    'crawlers',
  ]);
  for (const row of analytics.episodeLocationDaily) {
    locationSheet.addRow([
      row.statDate,
      row.episodeId,
      titles.get(row.episodeId) ?? '',
      row.location,
      row.source,
      row.humanCount,
      row.botCount,
    ]);
  }
  locationSheet.getColumn(1).width = 14;
  locationSheet.getColumn(2).width = 36;
  locationSheet.getColumn(3).width = 40;
  locationSheet.getColumn(4).width = 28;
  locationSheet.getColumn(5).width = 24;
  locationSheet.getColumn(6).width = 12;
  locationSheet.getColumn(7).width = 12;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, buildAnalyticsExportFilename(podcast, range, 'xlsx'));
}
