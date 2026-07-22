import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Rss, LayoutGrid, ListMusic, Ear, MapPinned, Smartphone, FileSpreadsheet, FileText, FileJson, Download } from 'lucide-react';
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
  resolveAnalyticsDateRange,
} from '../utils/podcastAnalyticsExport';
import styles from './PodcastAnalytics.module.css';

const COLORS = {
  human: 'var(--accent)',
  bot: '#e6a030',
  feed: '#0dcaf0',
  requests: '#0d6efd',
  listens: '#198754',
};
const PIE_COLORS = ['#0dcaf0', '#0d6efd', '#198754', '#e6a030', '#6f42c1', '#fd7e14', '#6c757d'];

/** Bar charts only: avoids cramped Y-axis labels when a show has many episodes. */
const EPISODE_BAR_CHART_MAX = 8;

function truncateEpisodeAxisTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, Math.max(0, maxLen - 1)) + '…';
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

function episodeTotals(analytics: PodcastAnalytics) {
  const byEpisode: Record<
    string,
    { requestsBot: number; requestsHuman: number; listensBot: number; listensHuman: number }
  > = {};
  for (const e of analytics.episodes) {
    byEpisode[e.id] = { requestsBot: 0, requestsHuman: 0, listensBot: 0, listensHuman: 0 };
  }
  for (const row of analytics.episodeDaily) {
    const cur = byEpisode[row.episodeId];
    if (cur) {
      cur.requestsBot += row.botCount;
      cur.requestsHuman += row.humanCount;
    }
  }
  for (const row of analytics.episodeListensDaily) {
    const cur = byEpisode[row.episodeId];
    if (cur) {
      cur.listensBot += row.botCount;
      cur.listensHuman += row.humanCount;
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
    .map(([location, counts]) => ({ location, ...counts, total: counts.bot + counts.human }))
    .sort((a, b) => b.total - a.total);
}

function sourceTotals(analytics: PodcastAnalytics) {
  const bySource: Record<string, { bot: number; human: number }> = {};
  for (const row of analytics.episodeListensDaily) {
    const cur = bySource[row.source] ?? { bot: 0, human: 0 };
    cur.bot += row.botCount;
    cur.human += row.humanCount;
    bySource[row.source] = cur;
  }
  return Object.entries(bySource)
    .map(([source, counts]) => ({ source, ...counts, total: counts.bot + counts.human }))
    .sort((a, b) => b.total - a.total);
}

function formatShortDate(iso: string) {
  // Calendar day label (server-local YYYY-MM-DD).
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function tooltipLabelFormatter(label: unknown): string {
  if (typeof label === 'string') return formatShortDate(label);
  return String(label ?? '');
}

type TimeViewType = 'line' | 'area' | 'bar' | 'table';
type LocationsViewType = 'pie' | 'bar' | 'table';
type SourceViewType = 'pie' | 'table';
type EpisodesViewType = 'bar' | 'table';

const axisProps = {
  tick: { fill: 'var(--text-muted)' as const, fontSize: 11 },
  axisLine: { stroke: 'var(--border)' as const },
  tickLine: { stroke: 'var(--border)' as const },
};
const tooltipContentStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 };

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
  const [overviewView, setOverviewView] = useState<TimeViewType>('line');
  const [feedView, setFeedView] = useState<TimeViewType>('line');
  const [episodesView, setEpisodesView] = useState<EpisodesViewType>('bar');
  const [listensView, setListensView] = useState<EpisodesViewType>('bar');
  const [locationsView, setLocationsView] = useState<LocationsViewType>('pie');
  const [sourceView, setSourceView] = useState<SourceViewType>('pie');
  const [narrow, setNarrow] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const chartMargin = narrow ? { top: 8, right: 4, left: 0, bottom: 8 } : { top: 8, right: 8, left: 8, bottom: 8 };
  const verticalYAxisWidth = narrow ? 72 : 120;

  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['podcast-analytics', id],
    queryFn: () => getPodcastAnalytics(id!),
    enabled: !!id,
  });

  const episodeTotalsMap = useMemo(
    () => (analytics ? episodeTotals(analytics) : {}),
    [analytics]
  );
  const locationTotalsList = useMemo(
    () => (analytics ? locationTotals(analytics) : []),
    [analytics]
  );
  const sourceTotalsList = useMemo(
    () => (analytics ? sourceTotals(analytics) : []),
    [analytics]
  );

  const overviewData = useMemo(() => {
    if (!analytics) return [];
    // Overview defaults to listener (human_count) totals so crawler RSS polls do not dominate.
    const byDate: Record<string, { statDate: string; feed: number; requests: number; listens: number }> = {};
    for (const row of analytics.rssDaily) {
      const d = row.statDate;
      if (!byDate[d]) byDate[d] = { statDate: d, feed: 0, requests: 0, listens: 0 };
      byDate[d].feed += row.humanCount;
    }
    for (const row of analytics.episodeDaily) {
      const d = row.statDate;
      if (!byDate[d]) byDate[d] = { statDate: d, feed: 0, requests: 0, listens: 0 };
      byDate[d].requests += row.humanCount;
    }
    for (const row of analytics.episodeListensDaily) {
      const d = row.statDate;
      if (!byDate[d]) byDate[d] = { statDate: d, feed: 0, requests: 0, listens: 0 };
      byDate[d].listens += row.humanCount;
    }
    return Object.values(byDate).sort((a, b) => a.statDate.localeCompare(b.statDate));
  }, [analytics]);

  const feedData = useMemo(() => {
    if (!analytics) return [];
    const byDate: Record<string, { human: number; bot: number }> = {};
    for (const row of analytics.rssDaily) {
      const d = row.statDate;
      if (!byDate[d]) byDate[d] = { human: 0, bot: 0 };
      byDate[d].human += row.humanCount;
      byDate[d].bot += row.botCount;
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([statDate, { human, bot }]) => ({
        statDate,
        Listeners: human,
        Crawlers: bot,
        total: human + bot,
      }));
  }, [analytics]);

  const episodeBarData = useMemo(() => {
    if (!analytics) return [];
    return analytics.episodes
      .map((ep) => {
        const tot = episodeTotalsMap[ep.id] ?? { requestsHuman: 0, requestsBot: 0, listensHuman: 0, listensBot: 0 };
        return {
          id: ep.id,
          name: truncateEpisodeAxisTitle(ep.title, narrow ? 28 : 36),
          fullName: ep.title,
          requests: tot.requestsHuman + tot.requestsBot,
          Listeners: tot.requestsHuman,
          Crawlers: tot.requestsBot,
        };
      })
      .sort((a, b) => b.requests - a.requests);
  }, [analytics, episodeTotalsMap, narrow]);

  const listensBarData = useMemo(() => {
    if (!analytics) return [];
    return analytics.episodes
      .map((ep) => {
        const tot = episodeTotalsMap[ep.id] ?? { requestsHuman: 0, requestsBot: 0, listensHuman: 0, listensBot: 0 };
        return {
          id: ep.id,
          name: truncateEpisodeAxisTitle(ep.title, narrow ? 28 : 36),
          fullName: ep.title,
          listens: tot.listensHuman + tot.listensBot,
          Listeners: tot.listensHuman,
          Crawlers: tot.listensBot,
        };
      })
      .sort((a, b) => b.listens - a.listens);
  }, [analytics, episodeTotalsMap, narrow]);

  const newestEpisodeIdSet = useMemo(() => {
    if (!analytics) return new Set<string>();
    return new Set(analytics.episodes.slice(0, EPISODE_BAR_CHART_MAX).map((e) => e.id));
  }, [analytics]);

  const episodeBarChartData = useMemo(
    () => episodeBarData.filter((row) => newestEpisodeIdSet.has(row.id)).sort((a, b) => b.requests - a.requests),
    [episodeBarData, newestEpisodeIdSet]
  );

  const listensBarChartData = useMemo(
    () => listensBarData.filter((row) => newestEpisodeIdSet.has(row.id)).sort((a, b) => b.listens - a.listens),
    [listensBarData, newestEpisodeIdSet]
  );

  const episodeChartMargin = useMemo(
    () =>
      narrow
        ? { top: 8, right: 8, left: 4, bottom: 8 }
        : { top: 8, right: 12, left: 16, bottom: 8 },
    [narrow]
  );

  const episodeYAxisWidth = narrow ? 108 : 172;

  const locationPieData = useMemo(() => {
    return locationTotalsList.map((row) => ({ name: row.location, value: row.total }));
  }, [locationTotalsList]);

  const sourcePieData = useMemo(() => {
    return sourceTotalsList.map((row) => ({ name: row.source, value: row.total }));
  }, [sourceTotalsList]);

  const hasAnyData =
    overviewData.length > 0 ||
    feedData.length > 0 ||
    episodeBarData.some((d) => d.requests > 0) ||
    listensBarData.some((d) => d.listens > 0) ||
    locationPieData.length > 0 ||
    sourcePieData.length > 0;

  if (!id) return null;
  if (podcastLoading || !podcast) return <FullPageLoading />;
  if (analyticsLoading && !analytics) return <FullPageLoading />;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast.title, href: `/podcasts/${id}`, mobileLabel: 'Podcast' },
    { label: 'Analytics' },
  ];

  const rssTotal = analytics ? sumRss(analytics) : { bot: 0, human: 0, total: 0 };

  const renderTimeChart = (
    data: Array<{ statDate: string; [key: string]: string | number }>,
    series: { key: string; name: string; color: string }[],
    viewType: TimeViewType
  ) => {
    const common = { data, margin: chartMargin };
    if (viewType === 'line') {
      return (
        <LineChart {...common}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
          <Tooltip contentStyle={tooltipContentStyle} labelFormatter={tooltipLabelFormatter} />
          <Legend />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
      );
    }
    if (viewType === 'area') {
      return (
        <AreaChart {...common}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
          <Tooltip contentStyle={tooltipContentStyle} labelFormatter={tooltipLabelFormatter} />
          <Legend />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stackId="1" stroke={s.color} fill={s.color} fillOpacity={0.5} strokeWidth={2} />
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
          <Tooltip contentStyle={tooltipContentStyle} labelFormatter={tooltipLabelFormatter} />
          <Legend />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} stackId="1" />
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
          See how your show is doing over the last 2 weeks: feed check-ins, episode plays, and where listeners are from.
        </p>
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
                  resolveAnalyticsDateRange(analytics),
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
                  resolveAnalyticsDateRange(analytics),
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
                  resolveAnalyticsDateRange(analytics),
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
          <p className={styles.empty}>No data in the last 2 weeks.</p>
        </div>
      )}

      {hasAnyData && (
        <>
          {/* Overview card */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <LayoutGrid size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Overview
            </h2>
            <CardTabs
              options={['line', 'area', 'bar', 'table'] as const}
              value={overviewView}
              onChange={setOverviewView}
              labels={{ line: 'Line', area: 'Area', bar: 'Bar', table: 'Table' }}
            />
            {overviewView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.tableEqualColumns}`}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className={styles.num}>Feed Check-Ins</th>
                      <th className={styles.num}>Episode Requests</th>
                      <th className={styles.num}>Listens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...overviewData].reverse().map((row) => (
                      <tr key={row.statDate}>
                        <td>{formatShortDate(row.statDate)}</td>
                        <td className={styles.num}>{row.feed}</td>
                        <td className={styles.num}>{row.requests}</td>
                        <td className={styles.num}>{row.listens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : overviewData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No data in the last 2 weeks.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {overviewView === 'line' ? (
                    <LineChart data={overviewData} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
                      <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
                      <Tooltip contentStyle={tooltipContentStyle} labelFormatter={tooltipLabelFormatter} />
                      <Legend />
                      <Line type="monotone" dataKey="feed" name="Feed Check-Ins" stroke={COLORS.feed} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="requests" name="Episode Requests" stroke={COLORS.requests} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="listens" name="Listens" stroke={COLORS.listens} strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  ) : overviewView === 'area' ? (
                    <AreaChart data={overviewData} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
                      <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
                      <Tooltip contentStyle={tooltipContentStyle} labelFormatter={tooltipLabelFormatter} />
                      <Legend />
                      <Area type="monotone" dataKey="feed" name="Feed Check-Ins" stackId="1" stroke={COLORS.feed} fill={COLORS.feed} fillOpacity={0.5} strokeWidth={2} />
                      <Area type="monotone" dataKey="requests" name="Episode Requests" stackId="1" stroke={COLORS.requests} fill={COLORS.requests} fillOpacity={0.5} strokeWidth={2} />
                      <Area type="monotone" dataKey="listens" name="Listens" stackId="1" stroke={COLORS.listens} fill={COLORS.listens} fillOpacity={0.5} strokeWidth={2} />
                    </AreaChart>
                  ) : (
                    <BarChart data={overviewData} margin={chartMargin} barCategoryGap="10%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="statDate" tickFormatter={formatShortDate} {...axisProps} />
                      <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} {...axisProps} />
                      <Tooltip contentStyle={tooltipContentStyle} labelFormatter={tooltipLabelFormatter} />
                      <Legend />
                      <Bar dataKey="feed" name="Feed Check-Ins" fill={COLORS.feed} radius={[4, 4, 0, 0]} stackId="1" />
                      <Bar dataKey="requests" name="Episode Requests" fill={COLORS.requests} radius={[4, 4, 0, 0]} stackId="1" />
                      <Bar dataKey="listens" name="Listens" fill={COLORS.listens} radius={[4, 4, 0, 0]} stackId="1" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              <strong>Feed Check-Ins:</strong> Listener feed fetches (directory crawlers are excluded from this overview).{' '}
              <strong>Episode Requests:</strong> Full-file or ≥250 KB audio requests from listeners (tiny metadata probes are excluded).{' '}
              <strong>Listens:</strong> Unique listener downloads of 250 KB or more (at most one per client per episode per day).
            </p>
          </div>

          {/* Feed card */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Rss size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Feed Check-Ins
            </h2>
            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.total}</span> <span className={styles.summaryLabel}>Total</span>
              </span>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.human}</span> <span className={styles.summaryLabel}>Listeners</span>
              </span>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.bot}</span> <span className={styles.summaryLabel}>Crawlers</span>
              </span>
            </div>
            <CardTabs
              options={['line', 'area', 'bar', 'table'] as const}
              value={feedView}
              onChange={setFeedView}
              labels={{ line: 'Line', area: 'Area', bar: 'Bar', table: 'Table' }}
            />
            {feedView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.tableEqualColumns}`}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className={styles.num}>Listeners</th>
                      <th className={styles.num}>Crawlers</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...feedData].reverse().map((row) => (
                      <tr key={row.statDate}>
                        <td>{formatShortDate(row.statDate)}</td>
                        <td className={styles.num}>{row.Listeners}</td>
                        <td className={styles.num}>{row.Crawlers}</td>
                        <td className={styles.num}>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : feedData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No data in the last 2 weeks.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {renderTimeChart(feedData, [{ key: 'Listeners', name: 'Listeners', color: COLORS.human }, { key: 'Crawlers', name: 'Crawlers', color: COLORS.bot }], feedView)}
                </ResponsiveContainer>
              </div>
            )}
            <p className={styles.cardFooter}>
              Directory polls (Spotify, Amazon Music, Podbean, etc.) appear under Crawlers. They check for new episodes and are not downloads.
            </p>
          </div>

          {/* Episodes card */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <ListMusic size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Episode Requests
            </h2>
            <CardTabs
              options={['bar', 'table'] as const}
              value={episodesView}
              onChange={setEpisodesView}
              labels={{ bar: 'Bar', table: 'Table' }}
            />
            {episodesView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Episode</th>
                      <th className={styles.num}>Listeners</th>
                      <th className={styles.num}>Crawlers</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {episodeBarData.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link to={`/episodes/${row.id}`} className={styles.episodeLink}>
                            {row.fullName}
                          </Link>
                        </td>
                        <td className={styles.num}>{row.Listeners}</td>
                        <td className={styles.num}>{row.Crawlers}</td>
                        <td className={styles.num}>{row.requests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : episodeBarChartData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No episode data in the last 2 weeks.</p>
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
                      formatter={(value: number | undefined) => [value ?? 0, '']}
                      labelFormatter={(_: unknown, payload: readonly unknown[]) =>
                        (payload?.[0] as { payload?: { fullName?: string } } | undefined)?.payload?.fullName ?? ''
                      }
                    />
                    <Legend />
                    <Bar dataKey="Listeners" name="Listeners" fill={COLORS.human} radius={[0, 4, 4, 0]} stackId="1" />
                    <Bar dataKey="Crawlers" name="Crawlers" fill={COLORS.bot} radius={[0, 4, 4, 0]} stackId="1" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {episodesView === 'bar' && episodeBarData.length > EPISODE_BAR_CHART_MAX && (
              <p className={styles.cardFooter}>Bar chart shows your {EPISODE_BAR_CHART_MAX} most recent episodes (see the table for all).</p>
            )}
          </div>

          {/* Listens card */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Ear size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Listens
            </h2>
            <CardTabs options={['bar', 'table'] as const} value={listensView} onChange={setListensView} labels={{ bar: 'Bar', table: 'Table' }} />
            {listensView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Episode</th>
                      <th className={styles.num}>Listeners</th>
                      <th className={styles.num}>Crawlers</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listensBarData.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link to={`/episodes/${row.id}`} className={styles.episodeLink}>
                            {row.fullName}
                          </Link>
                        </td>
                        <td className={styles.num}>{row.Listeners}</td>
                        <td className={styles.num}>{row.Crawlers}</td>
                        <td className={styles.num}>{row.listens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : listensBarChartData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No listen data in the last 2 weeks.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer
                  width="100%"
                  height={Math.min(420, Math.max(260, 52 + listensBarChartData.length * 44))}
                >
                  <BarChart data={listensBarChartData} layout="vertical" margin={episodeChartMargin} barCategoryGap="12%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="name" width={episodeYAxisWidth} {...axisProps} tickLine={false} />
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      formatter={(value: number | undefined) => [value ?? 0, '']}
                      labelFormatter={(_: unknown, payload: readonly unknown[]) =>
                        (payload?.[0] as { payload?: { fullName?: string } } | undefined)?.payload?.fullName ?? ''
                      }
                    />
                    <Legend />
                    <Bar dataKey="Listeners" name="Listeners" fill={COLORS.human} radius={[0, 4, 4, 0]} stackId="1" />
                    <Bar dataKey="Crawlers" name="Crawlers" fill={COLORS.bot} radius={[0, 4, 4, 0]} stackId="1" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {listensView === 'bar' && listensBarData.length > EPISODE_BAR_CHART_MAX && (
              <p className={styles.cardFooter}>Bar chart shows your {EPISODE_BAR_CHART_MAX} most recent episodes (see the table for all).</p>
            )}
          </div>

          {/* Locations card */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <MapPinned size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Requests by Location
            </h2>
            <CardTabs
              options={['pie', 'bar', 'table'] as const}
              value={locationsView}
              onChange={setLocationsView}
              labels={{ pie: 'Pie', bar: 'Bar', table: 'Table' }}
            />
            {locationsView === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th className={styles.num}>Listeners</th>
                      <th className={styles.num}>Crawlers</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationTotalsList.map((row) => (
                      <tr key={row.location}>
                        <td>{row.location}</td>
                        <td className={styles.num}>{row.human}</td>
                        <td className={styles.num}>{row.bot}</td>
                        <td className={styles.num}>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : locationPieData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No location data in the last 2 weeks.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {locationsView === 'pie' ? (
                    <PieChart>
                      <Pie
                        data={locationPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      >
                        {locationPieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipContentStyle} formatter={(value: number | undefined) => [value ?? 0, 'Requests']} />
                    </PieChart>
                  ) : (
                    <BarChart data={locationTotalsList} layout="vertical" margin={chartMargin} barCategoryGap="8%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="location" width={verticalYAxisWidth} {...axisProps} tickLine={false} />
                      <Tooltip contentStyle={tooltipContentStyle} />
                      <Bar dataKey="total" name="Requests" fill={COLORS.requests} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* By source (app) card */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <Smartphone size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Listens by Source
            </h2>
            <p className={styles.sectionSub}>
              Where listens came from (e.g. Apple Podcasts, Spotify, other apps). Based on app User-Agent.
            </p>
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
                      <th>Source</th>
                      <th className={styles.num}>Listeners</th>
                      <th className={styles.num}>Crawlers</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceTotalsList.map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td className={styles.num}>{row.human}</td>
                        <td className={styles.num}>{row.bot}</td>
                        <td className={styles.num}>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : sourcePieData.length === 0 ? (
              <div className={styles.chartContainer}>
                <p className={styles.empty}>No source data in the last 2 weeks.</p>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={sourcePieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {sourcePieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipContentStyle} formatter={(value: number | undefined) => [value ?? 0, 'Listens']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
