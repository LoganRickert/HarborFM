import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Rss,
  LayoutGrid,
  ListMusic,
  MapPinned,
  Smartphone,
  FileSpreadsheet,
  FileText,
  FileJson,
  Download,
  Activity,
  ChevronDown,
  Clock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { getPodcast, getPodcastAnalytics, type PodcastAnalytics } from '../api/podcasts';
import { FullPageLoading } from '../components/Loading';
import { Breadcrumb } from '../components/Breadcrumb';
import {
  downloadAnalyticsCsv,
  downloadAnalyticsExcel,
  downloadAnalyticsJson,
} from '../utils/podcastAnalyticsExport';
import { formatHourLabel, serverLocalToBrowserHour } from '../utils/analyticsHourTimezone';
import styles from './PodcastAnalytics.module.css';

const COLORS = {
  human: 'var(--accent)',
  bot: '#e6a030',
  downloads: '#198754',
  fetches: '#0d6efd',
  feed: '#0dcaf0',
};
const PIE_COLORS = ['#1DB954', '#FC3C44', '#0d6efd', '#6c757d', '#e6a030', '#6f42c1'];
const RETENTION_LINE_COLORS = ['#198754', '#0d6efd', '#e6a030', '#6f42c1', '#fd7e14', '#0dcaf0', '#d63384', '#20c997'];

/** Default episode multi-select: newest published episodes. */
const DEFAULT_SELECTED_EPISODES = 5;
const RETENTION_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

function localDateYYYYMMDD(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive local window of `days` days ending today. */
function lastNLocalDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
  return { startDate: localDateYYYYMMDD(start), endDate: localDateYYYYMMDD(end) };
}

/** Every local calendar day from startDate through endDate inclusive (YYYY-MM-DD). */
function eachLocalDateInclusive(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return [];
  const out: string[] = [];
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  if (cur > end) return [];
  while (cur <= end) {
    out.push(localDateYYYYMMDD(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function filterAnalyticsByEpisodes(
  analytics: PodcastAnalytics,
  selectedIds: Set<string>,
): PodcastAnalytics {
  const episodes = analytics.episodes.filter((e) => selectedIds.has(e.id));
  const episodeDaily = analytics.episodeDaily.filter((r) => selectedIds.has(r.episodeId));
  const episodeLocationDaily = analytics.episodeLocationDaily.filter((r) =>
    selectedIds.has(r.episodeId),
  );
  const episodeListensDaily = analytics.episodeListensDaily.filter((r) =>
    selectedIds.has(r.episodeId),
  );
  const episodeListensHourly = analytics.episodeListensHourly.filter((r) =>
    selectedIds.has(r.episodeId),
  );
  const uniqueListenersByEpisode = analytics.uniqueListenersByEpisode.filter((r) =>
    selectedIds.has(r.episodeId),
  );
  const retentionByEpisode = analytics.retentionByEpisode.filter((r) =>
    selectedIds.has(r.episodeId),
  );
  const uniqueListeners = uniqueListenersByEpisode.reduce(
    (sum, r) => sum + r.uniqueListeners,
    0,
  );
  return {
    ...analytics,
    episodes,
    episodeDaily,
    episodeLocationDaily,
    episodeListensDaily,
    episodeListensHourly,
    uniqueListenersByEpisode,
    retentionByEpisode,
    uniqueListeners,
  };
}

function truncateEpisodeAxisTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, Math.max(0, maxLen - 3)) + '...';
}

function bucketAppSource(source: string): string {
  if (source === 'Spotify') return 'Spotify';
  if (source === 'Apple Podcasts') return 'Apple Podcasts';
  if (source === 'Website') return 'Website';
  return 'Other';
}

function sumRss(analytics: PodcastAnalytics) {
  let bot = 0;
  let human = 0;
  for (const row of analytics.rssDaily) {
    bot += row.botCount;
    human += row.humanCount;
  }
  return { bot, human, total: bot + human };
}

function sumDownloads(analytics: PodcastAnalytics) {
  let human = 0;
  for (const row of analytics.episodeListensDaily) human += row.humanCount;
  return human;
}

function episodeTotals(analytics: PodcastAnalytics) {
  const byEpisode: Record<
    string,
    { fetchesHuman: number; fetchesBot: number; downloadsHuman: number; downloadsBot: number }
  > = {};
  for (const e of analytics.episodes) {
    byEpisode[e.id] = { fetchesHuman: 0, fetchesBot: 0, downloadsHuman: 0, downloadsBot: 0 };
  }
  for (const row of analytics.episodeDaily) {
    const cur = byEpisode[row.episodeId];
    if (cur) {
      cur.fetchesBot += row.botCount;
      cur.fetchesHuman += row.humanCount;
    }
  }
  for (const row of analytics.episodeListensDaily) {
    const cur = byEpisode[row.episodeId];
    if (cur) {
      cur.downloadsBot += row.botCount;
      cur.downloadsHuman += row.humanCount;
    }
  }
  return byEpisode;
}

function locationTotals(analytics: PodcastAnalytics) {
  const byLocation: Record<string, { bot: number; human: number }> = {};
  for (const row of analytics.episodeLocationDaily) {
    const cur = byLocation[row.location] ?? { bot: 0, human: 0 };
    cur.bot += row.botCount;
    cur.human += row.humanCount;
    byLocation[row.location] = cur;
  }
  return Object.entries(byLocation)
    .map(([location, counts]) => ({ location, ...counts, total: counts.human }))
    .filter((r) => r.human > 0)
    .sort((a, b) => b.human - a.human);
}

/** Last comma-separated segment, e.g. "Dayton, Ohio, United States" → "United States". */
function countryFromLocation(location: string): string {
  const parts = location
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || location;
}

function countryTotals(
  locations: Array<{ location: string; bot: number; human: number; total: number }>,
) {
  const byCountry: Record<string, { bot: number; human: number }> = {};
  for (const row of locations) {
    const country = countryFromLocation(row.location);
    const cur = byCountry[country] ?? { bot: 0, human: 0 };
    cur.bot += row.bot;
    cur.human += row.human;
    byCountry[country] = cur;
  }
  return Object.entries(byCountry)
    .map(([location, counts]) => ({ location, ...counts, total: counts.human }))
    .filter((r) => r.human > 0)
    .sort((a, b) => b.human - a.human);
}

/** Keep top N rows; roll the rest into Other. */
function topWithOther(
  rows: Array<{ location: string; bot: number; human: number; total: number }>,
  limit: number,
) {
  if (rows.length <= limit) return rows;
  const top = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const other = rest.reduce(
    (acc, r) => {
      acc.bot += r.bot;
      acc.human += r.human;
      return acc;
    },
    { bot: 0, human: 0 },
  );
  if (other.human <= 0 && other.bot <= 0) return top;
  return [
    ...top,
    { location: 'Other', bot: other.bot, human: other.human, total: other.human },
  ];
}

const LOCATION_PIE_TOP = 6;
const LOCATION_BAR_TOP = 12;

/** Apps pie: human Downloads bucketed to Spotify / Apple / Website / Other. */
function appDownloadTotals(analytics: PodcastAnalytics) {
  const byApp: Record<string, number> = {
    Spotify: 0,
    'Apple Podcasts': 0,
    Website: 0,
    Other: 0,
  };
  for (const row of analytics.episodeListensDaily) {
    byApp[bucketAppSource(row.source)] += row.humanCount;
  }
  return Object.entries(byApp)
    .map(([source, human]) => ({ source, human, total: human }))
    .filter((r) => r.human > 0)
    .sort((a, b) => b.human - a.human);
}

function formatShortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function tooltipLabelFormatter(label: unknown): string {
  if (typeof label === 'string') return formatShortDate(label);
  return String(label ?? '');
}

type TimeViewType = 'area' | 'bar' | 'table';
type OverviewViewType = TimeViewType;
type LocationsViewType = 'pie' | 'bar' | 'table';
type SourceViewType = 'pie' | 'table';
type HourOfDayViewType = 'area' | 'table';
type RetentionViewType = 'line' | 'table';
type EpisodeEngagementTab = 'downloads' | 'fetches' | 'comparison' | 'table';

const axisProps = {
  tick: { fill: 'var(--text-muted)' as const, fontSize: 11 },
  axisLine: { stroke: 'var(--border)' as const },
  tickLine: { stroke: 'var(--border)' as const },
};
const tooltipContentStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
};
const tooltipItemStyle = { color: 'var(--text)' };
const tooltipLabelStyle = { color: 'var(--text)' };

function CardTabs<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className={styles.analyticsTabs} role="tablist">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          role="tab"
          aria-selected={value === opt}
          className={value === opt ? styles.analyticsTabActive : styles.analyticsTab}
          onClick={() => onChange(opt)}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

export function PodcastAnalytics() {
  const { id } = useParams<{ id: string }>();
  const defaultRange = useMemo(() => lastNLocalDateRange(14), []);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<string[]>([]);
  const [episodesInitializedFor, setEpisodesInitializedFor] = useState<string | null>(null);
  const [episodeMenuOpen, setEpisodeMenuOpen] = useState(false);
  const episodeMenuRef = useRef<HTMLDivElement>(null);
  const [overviewView, setOverviewView] = useState<OverviewViewType>('area');
  const [feedView, setFeedView] = useState<OverviewViewType>('area');
  const [hourOfDayView, setHourOfDayView] = useState<HourOfDayViewType>('area');
  const [retentionView, setRetentionView] = useState<RetentionViewType>('line');
  const [showFeedCrawlers, setShowFeedCrawlers] = useState(false);
  const [engagementTab, setEngagementTab] = useState<EpisodeEngagementTab>('downloads');
  const [locationsView, setLocationsView] = useState<LocationsViewType>('bar');
  const [sourceView, setSourceView] = useState<SourceViewType>('pie');
  const [narrow, setNarrow] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  /** When true, End date tracks the viewer's local "today" across midnight. */
  const endPinnedToTodayRef = useRef(true);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Keep End on the viewer's local today when the range was opened (or set) as "through today".
  useEffect(() => {
    const syncEndToToday = () => {
      if (!endPinnedToTodayRef.current) return;
      const today = localDateYYYYMMDD();
      setEndDate((prev) => (prev === today ? prev : today));
    };
    syncEndToToday();
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncEndToToday();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', syncEndToToday);
    const id = window.setInterval(syncEndToToday, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', syncEndToToday);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!episodeMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (episodeMenuRef.current && !episodeMenuRef.current.contains(e.target as Node)) {
        setEpisodeMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEpisodeMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [episodeMenuOpen]);

  const chartMargin = narrow ? { top: 8, right: 4, left: 0, bottom: 8 } : { top: 8, right: 8, left: 8, bottom: 8 };
  const verticalYAxisWidth = narrow ? 72 : 120;

  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['podcast-analytics', id, startDate, endDate],
    queryFn: () => getPodcastAnalytics(id!, { startDate, endDate }),
    enabled: !!id && !!startDate && !!endDate && startDate <= endDate,
  });

  useEffect(() => {
    if (!analytics || !id) return;
    if (episodesInitializedFor === id) return;
    setSelectedEpisodeIds(
      analytics.episodes.slice(0, DEFAULT_SELECTED_EPISODES).map((e) => e.id),
    );
    setEpisodesInitializedFor(id);
  }, [analytics, id, episodesInitializedFor]);

  useEffect(() => {
    if (!analytics || episodesInitializedFor !== id) return;
    setSelectedEpisodeIds((prev) => {
      const valid = new Set(analytics.episodes.map((e) => e.id));
      const next = prev.filter((eid) => valid.has(eid));
      if (next.length === prev.length) return prev;
      if (next.length > 0) return next;
      return analytics.episodes.slice(0, DEFAULT_SELECTED_EPISODES).map((e) => e.id);
    });
  }, [analytics, episodesInitializedFor, id]);

  const selectedEpisodeSet = useMemo(() => new Set(selectedEpisodeIds), [selectedEpisodeIds]);

  const viewAnalytics = useMemo(() => {
    if (!analytics) return null;
    return filterAnalyticsByEpisodes(analytics, selectedEpisodeSet);
  }, [analytics, selectedEpisodeSet]);

  const allEpisodes = analytics?.episodes ?? [];
  const dateRange = useMemo(() => ({ startDate, endDate }), [startDate, endDate]);

  const episodeTotalsMap = useMemo(
    () => (viewAnalytics ? episodeTotals(viewAnalytics) : {}),
    [viewAnalytics]
  );
  const locationTotalsList = useMemo(
    () => (viewAnalytics ? locationTotals(viewAnalytics) : []),
    [viewAnalytics]
  );
  const countryTotalsList = useMemo(
    () => countryTotals(locationTotalsList),
    [locationTotalsList]
  );
  const locationBarData = useMemo(
    () => topWithOther(countryTotalsList, LOCATION_BAR_TOP),
    [countryTotalsList]
  );
  const locationPieData = useMemo(() => {
    return topWithOther(countryTotalsList, LOCATION_PIE_TOP).map((row) => ({
      name: row.location,
      value: row.human,
    }));
  }, [countryTotalsList]);
  const appTotalsList = useMemo(
    () => (viewAnalytics ? appDownloadTotals(viewAnalytics) : []),
    [viewAnalytics]
  );

  const uniqueByEpisode = useMemo(() => {
    const m = new Map<string, number>();
    if (!viewAnalytics) return m;
    for (const row of viewAnalytics.uniqueListenersByEpisode) {
      m.set(row.episodeId, row.uniqueListeners);
    }
    return m;
  }, [viewAnalytics]);

  const downloadsTotal = viewAnalytics ? sumDownloads(viewAnalytics) : 0;
  const uniqueListeners = viewAnalytics?.uniqueListeners ?? 0;

  const overviewData = useMemo(() => {
    const dates = eachLocalDateInclusive(startDate, endDate);
    const byDate: Record<string, { statDate: string; downloads: number }> = {};
    for (const d of dates) byDate[d] = { statDate: d, downloads: 0 };
    if (viewAnalytics) {
      for (const row of viewAnalytics.episodeListensDaily) {
        const d = row.statDate;
        if (!byDate[d]) continue;
        byDate[d].downloads += row.humanCount;
      }
    }
    return dates.map((d) => byDate[d]!);
  }, [viewAnalytics, startDate, endDate]);

  const hourOfDayData = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: formatHourLabel(hour),
      downloads: 0,
    }));
    if (!viewAnalytics) return bins;
    const serverTz = viewAnalytics.statTimezone;
    for (const row of viewAnalytics.episodeListensHourly) {
      const browserHour = serverLocalToBrowserHour(row.statDate, row.statHour, serverTz);
      bins[browserHour]!.downloads += row.humanCount;
    }
    return bins;
  }, [viewAnalytics]);

  const feedData = useMemo(() => {
    const dates = eachLocalDateInclusive(startDate, endDate);
    const byDate: Record<string, { human: number; bot: number }> = {};
    for (const d of dates) byDate[d] = { human: 0, bot: 0 };
    if (analytics) {
      for (const row of analytics.rssDaily) {
        const d = row.statDate;
        if (!byDate[d]) continue;
        byDate[d].human += row.humanCount;
        byDate[d].bot += row.botCount;
      }
    }
    return dates.map((statDate) => {
      const { human, bot } = byDate[statDate]!;
      return {
        statDate,
        Listeners: human,
        Crawlers: bot,
        total: human + bot,
      };
    });
  }, [analytics, startDate, endDate]);

  const episodeEngagementData = useMemo(() => {
    if (!viewAnalytics) return [];
    return viewAnalytics.episodes
      .map((ep) => {
        const tot = episodeTotalsMap[ep.id] ?? {
          fetchesHuman: 0,
          fetchesBot: 0,
          downloadsHuman: 0,
          downloadsBot: 0,
        };
        return {
          id: ep.id,
          name: truncateEpisodeAxisTitle(ep.title, narrow ? 28 : 36),
          fullName: ep.title,
          Downloads: tot.downloadsHuman,
          'Unique listeners': uniqueByEpisode.get(ep.id) ?? 0,
          Fetches: tot.fetchesHuman,
          downloadsTotal: tot.downloadsHuman + tot.downloadsBot,
          fetchesTotal: tot.fetchesHuman + tot.fetchesBot,
        };
      })
      .sort((a, b) => b.Downloads - a.Downloads);
  }, [viewAnalytics, episodeTotalsMap, uniqueByEpisode, narrow]);

  const episodeBarChartData = useMemo(
    () => [...episodeEngagementData].sort((a, b) => b.Downloads - a.Downloads),
    [episodeEngagementData]
  );

  const episodeChartMargin = useMemo(
    () =>
      narrow
        ? { top: 8, right: 8, left: 4, bottom: 8 }
        : { top: 8, right: 12, left: 16, bottom: 8 },
    [narrow]
  );

  const episodeYAxisWidth = narrow ? 108 : 172;

  const appPieData = useMemo(() => {
    return appTotalsList.map((row) => ({ name: row.source, value: row.human }));
  }, [appTotalsList]);

  const retentionChartData = useMemo(() => {
    if (!viewAnalytics || viewAnalytics.retentionByEpisode.length === 0) return [];
    const titleById = new Map(viewAnalytics.episodes.map((e) => [e.id, e.title]));
    const series = viewAnalytics.retentionByEpisode;
    if (series.length === 0) return [];
    return RETENTION_BUCKETS.map((bucket) => {
      const point: Record<string, string | number> = { bucket: `${bucket}%` };
      for (const ep of series) {
        const title = truncateEpisodeAxisTitle(titleById.get(ep.episodeId) ?? ep.episodeId, 24);
        const b = ep.buckets.find((x) => x.bucket === bucket);
        point[title] = b?.pct ?? 0;
      }
      return point;
    });
  }, [viewAnalytics]);

  const retentionSeriesKeys = useMemo(() => {
    if (!viewAnalytics || !retentionChartData[0]) return [] as string[];
    return Object.keys(retentionChartData[0]).filter((k) => k !== 'bucket');
  }, [viewAnalytics, retentionChartData]);

  const retentionTableRows = useMemo(() => {
    if (!viewAnalytics) return [];
    const titleById = new Map(viewAnalytics.episodes.map((e) => [e.id, e.title]));
    return viewAnalytics.retentionByEpisode.map((ep) => {
      const pctByBucket = new Map(ep.buckets.map((b) => [b.bucket, b.pct]));
      return {
        episodeId: ep.episodeId,
        title: titleById.get(ep.episodeId) ?? ep.episodeId,
        buckets: RETENTION_BUCKETS.map((bucket) => pctByBucket.get(bucket) ?? 0),
      };
    });
  }, [viewAnalytics]);

  const hasAnyData =
    overviewData.some((d) => d.downloads > 0) ||
    feedData.length > 0 ||
    episodeEngagementData.some((d) => d.Downloads > 0 || d.Fetches > 0) ||
    locationPieData.length > 0 ||
    appPieData.length > 0 ||
    retentionSeriesKeys.length > 0;

  const toggleEpisode = (episodeId: string) => {
    setSelectedEpisodeIds((prev) =>
      prev.includes(episodeId) ? prev.filter((x) => x !== episodeId) : [...prev, episodeId],
    );
  };

  const selectAllEpisodes = () => {
    setSelectedEpisodeIds(allEpisodes.map((e) => e.id));
  };

  const selectNewestEpisodes = () => {
    setSelectedEpisodeIds(allEpisodes.slice(0, DEFAULT_SELECTED_EPISODES).map((e) => e.id));
  };

  const episodeFilterLabel =
    selectedEpisodeIds.length === 0
      ? 'No episodes'
      : selectedEpisodeIds.length === allEpisodes.length && allEpisodes.length > 0
        ? `All episodes (${allEpisodes.length})`
        : `${selectedEpisodeIds.length} episode${selectedEpisodeIds.length === 1 ? '' : 's'}`;

  if (!id) return null;
  if (podcastLoading || !podcast) return <FullPageLoading />;
  if (analyticsLoading && !analytics) return <FullPageLoading />;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast.title, href: `/podcasts/${id}`, mobileLabel: 'Podcast' },
    { label: 'Analytics' },
  ];

  const rssTotal = analytics ? sumRss(analytics) : { bot: 0, human: 0, total: 0 };
  const methodology = analytics?.methodology;

  const feedSeries = showFeedCrawlers
    ? [
        { key: 'Listeners', name: 'Listeners', color: COLORS.human },
        { key: 'Crawlers', name: 'Crawlers', color: COLORS.bot },
      ]
    : [{ key: 'Listeners', name: 'Listeners', color: COLORS.human }];

  const renderTimeChart = (
    data: Array<{ statDate: string; [key: string]: string | number }>,
    series: { key: string; name: string; color: string }[],
    viewType: TimeViewType
  ) => {
    const common = { data, margin: chartMargin };
    if (viewType === 'area') {
      return (
        <AreaChart {...common}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
          <Tooltip
            contentStyle={tooltipContentStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            labelFormatter={tooltipLabelFormatter}
          />
          <Legend />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId={showFeedCrawlers ? '1' : undefined}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.5}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      );
    }
    if (viewType === 'bar') {
      return (
        <BarChart {...common} barCategoryGap="10%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
          <Tooltip
            contentStyle={tooltipContentStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            labelFormatter={tooltipLabelFormatter}
          />
          <Legend />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.color}
              radius={[4, 4, 0, 0]}
              stackId={showFeedCrawlers ? '1' : undefined}
            />
          ))}
        </BarChart>
      );
    }
    return null;
  };

  return (
    <div className={styles.wrap}>
      <Breadcrumb items={breadcrumbItems} />

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>
            <BarChart3 size={24} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Analytics
          </h1>
        </div>
        <p className={styles.sectionSub}>
          Downloads and Unique listeners for the selected date range, plus apps, locations, and optional feed health.
        </p>
        <div className={styles.filterBar}>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Start</span>
            <input
              type="date"
              className={styles.filterInput}
              value={startDate}
              max={endDate}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setStartDate(next);
                if (next > endDate) {
                  setEndDate(next);
                  endPinnedToTodayRef.current = next === localDateYYYYMMDD();
                }
              }}
            />
          </label>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>End</span>
            <input
              type="date"
              className={styles.filterInput}
              value={endDate}
              min={startDate}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setEndDate(next);
                endPinnedToTodayRef.current = next === localDateYYYYMMDD();
                if (next < startDate) setStartDate(next);
              }}
            />
          </label>
          <div className={styles.filterField} ref={episodeMenuRef}>
            <span className={styles.filterLabel} id="analytics-episodes-label">
              Episodes
            </span>
            <button
              type="button"
              className={styles.episodeFilterBtn}
              aria-labelledby="analytics-episodes-label"
              aria-haspopup="listbox"
              aria-expanded={episodeMenuOpen}
              disabled={allEpisodes.length === 0}
              onClick={() => setEpisodeMenuOpen((open) => !open)}
            >
              <span className={styles.episodeFilterBtnText}>{episodeFilterLabel}</span>
              <ChevronDown size={16} strokeWidth={2} aria-hidden />
            </button>
            {episodeMenuOpen && (
              <div className={styles.episodeMenu} role="listbox" aria-multiselectable="true">
                <div className={styles.episodeMenuActions}>
                  <button type="button" className={styles.episodeMenuAction} onClick={selectAllEpisodes}>
                    Select all
                  </button>
                  <button type="button" className={styles.episodeMenuAction} onClick={selectNewestEpisodes}>
                    Newest {Math.min(DEFAULT_SELECTED_EPISODES, allEpisodes.length)}
                  </button>
                </div>
                <ul className={styles.episodeMenuList}>
                  {allEpisodes.map((ep) => {
                    const checked = selectedEpisodeSet.has(ep.id);
                    return (
                      <li key={ep.id}>
                        <label className={styles.episodeMenuOption}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEpisode(ep.id)}
                          />
                          <span>{ep.title}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.exportActions}>
          <h2 id="analytics-export-heading" className={styles.sectionTitle}>
            <Download size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Export
          </h2>
          <div className={styles.exportGroup} role="group" aria-labelledby="analytics-export-heading">
            <button
              type="button"
              className={styles.exportBtn}
              disabled={!analytics || exportingExcel}
              aria-label={exportingExcel ? 'Preparing Excel download' : 'Download Excel spreadsheet'}
              aria-busy={exportingExcel || undefined}
              onClick={() => {
                if (!analytics) return;
                setExportingExcel(true);
                void downloadAnalyticsExcel(
                  { id: podcast.id, title: podcast.title, slug: podcast.slug },
                  analytics,
                  dateRange,
                ).finally(() => setExportingExcel(false));
              }}
            >
              <FileSpreadsheet size={15} strokeWidth={2} aria-hidden />
              {exportingExcel ? 'Preparing...' : 'Excel'}
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              disabled={!analytics || exportingExcel}
              aria-label="Download CSV spreadsheet"
              onClick={() => {
                if (!analytics) return;
                downloadAnalyticsCsv(
                  { id: podcast.id, title: podcast.title, slug: podcast.slug },
                  analytics,
                  dateRange,
                );
              }}
            >
              <FileText size={15} strokeWidth={2} aria-hidden />
              CSV
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              disabled={!analytics || exportingExcel}
              aria-label="Download JSON data"
              onClick={() => {
                if (!analytics) return;
                downloadAnalyticsJson(
                  { id: podcast.id, title: podcast.title, slug: podcast.slug },
                  analytics,
                  dateRange,
                );
              }}
            >
              <FileJson size={15} strokeWidth={2} aria-hidden />
              JSON
            </button>
          </div>
        </div>
      </div>

      {!hasAnyData && (
        <div className={styles.card}>
          <p className={styles.empty}>No data in this date range.</p>
        </div>
      )}

      {hasAnyData && (
        <>
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <LayoutGrid size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Overview
            </h2>
            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{downloadsTotal}</span>{' '}
                <span className={styles.summaryLabel}>Downloads</span>
              </span>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{uniqueListeners}</span>{' '}
                <span className={styles.summaryLabel}>Unique listeners</span>
              </span>
            </div>
            <CardTabs
              options={['area', 'bar', 'table'] as const}
              value={overviewView}
              onChange={setOverviewView}
              labels={{ area: 'Area', bar: 'Bar', table: 'Table' }}
            />
            {overviewView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.tableEqualColumns}`}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className={styles.num}>Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...overviewData].reverse().map((row) => (
                      <tr key={row.statDate}>
                        <td>{formatShortDate(row.statDate)}</td>
                        <td className={styles.num}>{row.downloads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : overviewData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No downloads in this date range.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {renderTimeChart(
                    overviewData,
                    [{ key: 'downloads', name: 'Downloads', color: COLORS.downloads }],
                    overviewView
                  )}
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              {methodology?.downloads ??
                'Downloads are unique valid audio downloads of about one minute or more (250 KB), at most one per client per episode per day. Bots and tiny Range probes are excluded.'}{' '}
              {methodology?.uniqueListeners ??
                'Unique listeners are distinct clients with at least one Download in this date range.'}
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Clock size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Time of Day
            </h2>
            <CardTabs
              options={['area', 'table'] as const}
              value={hourOfDayView}
              onChange={setHourOfDayView}
              labels={{ area: 'Area', table: 'Table' }}
            />
            {hourOfDayView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.tableEqualColumns}`}>
                  <thead>
                    <tr>
                      <th>Hour</th>
                      <th className={styles.num}>Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourOfDayData.map((row) => (
                      <tr key={row.hour}>
                        <td>{row.label}</td>
                        <td className={styles.num}>{row.downloads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : hourOfDayData.every((d) => d.downloads === 0) ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No downloads by hour in this date range yet.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={hourOfDayData} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      interval={narrow ? 2 : 1}
                      {...axisProps}
                    />
                    <YAxis
                      tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
                      {...axisProps}
                    />
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Area
                      type="monotone"
                      dataKey="downloads"
                      name="Downloads"
                      stroke={COLORS.downloads}
                      fill={COLORS.downloads}
                      fillOpacity={0.5}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              {methodology?.downloadsByHour ??
                'Hours are shown in your local timezone.'}
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <ListMusic size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Episodes
            </h2>
            <CardTabs
              options={['downloads', 'fetches', 'comparison', 'table'] as const}
              value={engagementTab}
              onChange={setEngagementTab}
              labels={{
                downloads: 'Downloads',
                fetches: 'Raw fetches',
                comparison: 'Comparison',
                table: 'Table',
              }}
            />
            {engagementTab === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Episode</th>
                      <th className={styles.num}>Downloads</th>
                      <th className={styles.num}>Unique listeners</th>
                      <th className={styles.num}>Raw fetches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {episodeEngagementData.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link to={`/episodes/${row.id}`} className={styles.episodeLink}>
                            {row.fullName}
                          </Link>
                        </td>
                        <td className={styles.num}>{row.Downloads}</td>
                        <td className={styles.num}>{row['Unique listeners']}</td>
                        <td className={styles.num}>{row.Fetches}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : episodeBarChartData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No episode data in this date range.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer
                  width="100%"
                  height={Math.min(420, Math.max(260, 52 + episodeBarChartData.length * 44))}
                >
                  <BarChart data={episodeBarChartData} layout="vertical" margin={episodeChartMargin} barCategoryGap="12%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="name" width={episodeYAxisWidth} {...axisProps} tickLine={false} />
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Legend />
                    {engagementTab === 'downloads' && (
                      <>
                        <Bar dataKey="Downloads" name="Downloads" fill={COLORS.downloads} radius={[0, 4, 4, 0]} />
                        <Bar dataKey="Unique listeners" name="Unique listeners" fill={COLORS.human} radius={[0, 4, 4, 0]} />
                      </>
                    )}
                    {engagementTab === 'fetches' && (
                      <Bar dataKey="Fetches" name="Raw audio fetches" fill={COLORS.fetches} radius={[0, 4, 4, 0]} />
                    )}
                    {engagementTab === 'comparison' && (
                      <>
                        <Bar dataKey="Fetches" name="Raw fetches" fill={COLORS.fetches} radius={[0, 4, 4, 0]} />
                        <Bar dataKey="Downloads" name="Downloads" fill={COLORS.downloads} radius={[0, 4, 4, 0]} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              <strong>Downloads</strong> are unique filtered downloads (about one minute or more, at most one per client per episode per day).{' '}
              <strong>Unique listeners</strong> are distinct clients in this date range.{' '}
              <strong>Raw audio fetches</strong> count full-file or ≥250 KB requests before daily dedup.
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Smartphone size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Apps
            </h2>
            <CardTabs
              options={['pie', 'table'] as const}
              value={sourceView}
              onChange={setSourceView}
              labels={{ pie: 'Pie', table: 'Table' }}
            />
            {sourceView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>App</th>
                      <th className={styles.num}>Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appTotalsList.map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td className={styles.num}>{row.human}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : appPieData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No app data in this date range.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={appPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {appPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              Human Downloads by app: Spotify, Apple Podcasts, Website (HarborFM site/theme player), and Other.
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <MapPinned size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Locations
            </h2>
            <CardTabs
              options={['bar', 'pie', 'table'] as const}
              value={locationsView}
              onChange={setLocationsView}
              labels={{ bar: 'Bar', pie: 'Pie', table: 'Table' }}
            />
            {locationsView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th className={styles.num}>Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationTotalsList.map((row) => (
                      <tr key={row.location}>
                        <td>{row.location}</td>
                        <td className={styles.num}>{row.human}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : locationBarData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No location data in this date range.</p>
              </div>
            ) : locationsView === 'pie' ? (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={locationPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}>
                      {locationPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer
                  width="100%"
                  height={Math.min(360, Math.max(220, locationBarData.length * 36))}
                >
                  <BarChart
                    data={locationBarData.map((r) => ({
                      name: truncateEpisodeAxisTitle(r.location, narrow ? 16 : 22),
                      Downloads: r.human,
                    }))}
                    layout="vertical"
                    margin={episodeChartMargin}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="name" width={verticalYAxisWidth} {...axisProps} tickLine={false} />
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Bar dataKey="Downloads" fill={COLORS.downloads} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              Charts group Downloads by country. Table shows the full city-level breakdown when available.
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Rss size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Feed health
            </h2>
            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.human}</span>{' '}
                <span className={styles.summaryLabel}>Listeners</span>
              </span>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.bot}</span>{' '}
                <span className={styles.summaryLabel}>Crawlers</span>
              </span>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.total}</span>{' '}
                <span className={styles.summaryLabel}>Total</span>
              </span>
            </div>
            <label className={`toggle ${styles.toggleRow}`}>
              <input
                type="checkbox"
                checked={showFeedCrawlers}
                onChange={(e) => setShowFeedCrawlers(e.target.checked)}
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Show crawlers</span>
            </label>
            <CardTabs
              options={['area', 'bar', 'table'] as const}
              value={feedView}
              onChange={setFeedView}
              labels={{ area: 'Area', bar: 'Bar', table: 'Table' }}
            />
            {feedView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.tableEqualColumns}`}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className={styles.num}>Listeners</th>
                      {showFeedCrawlers && <th className={styles.num}>Crawlers</th>}
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...feedData].reverse().map((row) => (
                      <tr key={row.statDate}>
                        <td>{formatShortDate(row.statDate)}</td>
                        <td className={styles.num}>{row.Listeners}</td>
                        {showFeedCrawlers && <td className={styles.num}>{row.Crawlers}</td>}
                        <td className={styles.num}>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : feedData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No feed data in this date range.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {renderTimeChart(feedData, feedSeries, feedView)}
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              {methodology?.feedHealth ??
                'RSS feed fetches. Directory polls (Spotify, Amazon Music, Podbean, and similar) are invalid traffic for Downloads and are shown under Crawlers.'}
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Activity size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Retention
            </h2>
            <p className={styles.sectionSub}>
              How far listeners get in the episode on your HarborFM site or theme player.
            </p>
            <CardTabs
              options={['line', 'table'] as const}
              value={retentionView}
              onChange={setRetentionView}
              labels={{ line: 'Line', table: 'Table' }}
            />
            {retentionView === 'table' ? (
              retentionTableRows.length === 0 ? (
                <div className={styles.chartContainer}>
                  <p className={styles.empty}>
                    No website retention data yet. Curves appear after listeners play episodes on your HarborFM site or theme player.
                  </p>
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Episode</th>
                        {RETENTION_BUCKETS.map((bucket) => (
                          <th key={bucket} className={styles.num}>
                            {bucket}%
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {retentionTableRows.map((row) => (
                        <tr key={row.episodeId}>
                          <td>
                            <Link to={`/episodes/${row.episodeId}`} className={styles.episodeLink}>
                              {row.title}
                            </Link>
                          </td>
                          {row.buckets.map((pct, i) => (
                            <td key={RETENTION_BUCKETS[i]} className={styles.num}>
                              {pct}%
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : retentionSeriesKeys.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>
                  No website retention data yet. Curves appear after listeners play episodes on your HarborFM site or theme player.
                </p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={retentionChartData} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="bucket" {...axisProps} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} {...axisProps} />
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Legend />
                    {retentionSeriesKeys.map((key, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stroke={RETENTION_LINE_COLORS[i % RETENTION_LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              {methodology?.retention ??
                'Percent of website listeners still present at each 10% of the episode (client-confirmed playhead).'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
