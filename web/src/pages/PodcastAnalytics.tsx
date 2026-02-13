import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Rss, LayoutGrid, ListMusic, Ear, MapPinned } from 'lucide-react';
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
import styles from './PodcastAnalytics.module.css';

const COLORS = {
  human: 'var(--accent)',
  bot: '#e6a030',
  feed: '#0dcaf0',
  requests: '#0d6efd',
  listens: '#198754',
};
const PIE_COLORS = ['#0dcaf0', '#0d6efd', '#198754', '#e6a030', '#6f42c1', '#fd7e14', '#6c757d'];

function last14Days(): { start_date: string; end_date: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

function sumRss(analytics: PodcastAnalytics) {
  let bot = 0;
  let human = 0;
  for (const row of analytics.rss_daily) {
    bot += row.bot_count;
    human += row.human_count;
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
  for (const row of analytics.episode_daily) {
    const cur = byEpisode[row.episode_id];
    if (cur) {
      cur.requestsBot += row.bot_count;
      cur.requestsHuman += row.human_count;
    }
  }
  for (const row of analytics.episode_listens_daily) {
    const cur = byEpisode[row.episode_id];
    if (cur) {
      cur.listensBot += row.bot_count;
      cur.listensHuman += row.human_count;
    }
  }
  return byEpisode;
}

function locationTotals(analytics: PodcastAnalytics) {
  const byLocation: Record<string, { bot: number; human: number }> = {};
  for (const row of analytics.episode_location_daily) {
    const cur = byLocation[row.location] ?? { bot: 0, human: 0 };
    cur.bot += row.bot_count;
    cur.human += row.human_count;
    byLocation[row.location] = cur;
  }
  return Object.entries(byLocation)
    .map(([location, counts]) => ({ location, ...counts, total: counts.bot + counts.human }))
    .sort((a, b) => b.total - a.total);
}

function formatShortDate(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function tooltipLabelFormatter(label: unknown): string {
  if (typeof label === 'string') return formatShortDate(label);
  return String(label ?? '');
}

type TimeViewType = 'line' | 'area' | 'bar' | 'table';
type LocationsViewType = 'pie' | 'bar' | 'table';
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
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const chartMargin = narrow ? { top: 8, right: 4, left: 0, bottom: 8 } : { top: 8, right: 8, left: 8, bottom: 8 };
  const verticalYAxisWidth = narrow ? 72 : 120;

  const dateRange = useMemo(() => last14Days(), []);

  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['podcast-analytics', id, dateRange.start_date, dateRange.end_date],
    queryFn: () => getPodcastAnalytics(id!, dateRange),
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

  const overviewData = useMemo(() => {
    if (!analytics) return [];
    const byDate: Record<string, { stat_date: string; feed: number; requests: number; listens: number }> = {};
    for (const row of analytics.rss_daily) {
      byDate[row.stat_date] = { stat_date: row.stat_date, feed: row.human_count + row.bot_count, requests: 0, listens: 0 };
    }
    for (const row of analytics.episode_daily) {
      if (!byDate[row.stat_date]) byDate[row.stat_date] = { stat_date: row.stat_date, feed: 0, requests: 0, listens: 0 };
      byDate[row.stat_date].requests += row.human_count + row.bot_count;
    }
    for (const row of analytics.episode_listens_daily) {
      if (!byDate[row.stat_date]) byDate[row.stat_date] = { stat_date: row.stat_date, feed: 0, requests: 0, listens: 0 };
      byDate[row.stat_date].listens += row.human_count + row.bot_count;
    }
    return Object.values(byDate).sort((a, b) => a.stat_date.localeCompare(b.stat_date));
  }, [analytics]);

  const feedData = useMemo(() => {
    if (!analytics) return [];
    return [...analytics.rss_daily]
      .sort((a, b) => a.stat_date.localeCompare(b.stat_date))
      .map((row) => ({
        stat_date: row.stat_date,
        People: row.human_count,
        Apps: row.bot_count,
        total: row.human_count + row.bot_count,
      }));
  }, [analytics]);

  const episodeBarData = useMemo(() => {
    if (!analytics) return [];
    return analytics.episodes
      .map((ep) => {
        const tot = episodeTotalsMap[ep.id] ?? { requestsHuman: 0, requestsBot: 0, listensHuman: 0, listensBot: 0 };
        return {
          id: ep.id,
          name: ep.title.length > 30 ? ep.title.slice(0, 27) + '...' : ep.title,
          fullName: ep.title,
          requests: tot.requestsHuman + tot.requestsBot,
          People: tot.requestsHuman,
          Apps: tot.requestsBot,
        };
      })
      .sort((a, b) => b.requests - a.requests);
  }, [analytics, episodeTotalsMap]);

  const listensBarData = useMemo(() => {
    if (!analytics) return [];
    return analytics.episodes
      .map((ep) => {
        const tot = episodeTotalsMap[ep.id] ?? { requestsHuman: 0, requestsBot: 0, listensHuman: 0, listensBot: 0 };
        return {
          id: ep.id,
          name: ep.title.length > 30 ? ep.title.slice(0, 27) + '...' : ep.title,
          fullName: ep.title,
          listens: tot.listensHuman + tot.listensBot,
          People: tot.listensHuman,
          Apps: tot.listensBot,
        };
      })
      .sort((a, b) => b.listens - a.listens);
  }, [analytics, episodeTotalsMap]);

  const locationPieData = useMemo(() => {
    return locationTotalsList.map((row) => ({ name: row.location, value: row.total }));
  }, [locationTotalsList]);

  const hasAnyData =
    overviewData.length > 0 ||
    feedData.length > 0 ||
    episodeBarData.some((d) => d.requests > 0) ||
    listensBarData.some((d) => d.listens > 0) ||
    locationPieData.length > 0;

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
    data: Array<{ stat_date: string; [key: string]: string | number }>,
    series: { key: string; name: string; color: string }[],
    viewType: TimeViewType
  ) => {
    if (data.length === 0) return <p className={styles.empty}>No data in the last 2 weeks.</p>;
    const common = { data, margin: chartMargin };
    if (viewType === 'line') {
      return (
        <LineChart {...common}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="stat_date" tickFormatter={formatShortDate} {...axisProps} />
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
          <XAxis dataKey="stat_date" tickFormatter={formatShortDate} {...axisProps} />
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
          <XAxis dataKey="stat_date" tickFormatter={formatShortDate} {...axisProps} />
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
        <p className={styles.sectionSub}>
          Numbers include both people and automated apps (e.g. podcast players).
        </p>
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
                      <tr key={row.stat_date}>
                        <td>{formatShortDate(row.stat_date)}</td>
                        <td className={styles.num}>{row.feed}</td>
                        <td className={styles.num}>{row.requests}</td>
                        <td className={styles.num}>{row.listens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {overviewData.length === 0 ? (
                    <p className={styles.empty}>No data in the last 2 weeks.</p>
                  ) : overviewView === 'line' ? (
                    <LineChart data={overviewData} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="stat_date" tickFormatter={formatShortDate} {...axisProps} />
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
                      <XAxis dataKey="stat_date" tickFormatter={formatShortDate} {...axisProps} />
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
                      <XAxis dataKey="stat_date" tickFormatter={formatShortDate} {...axisProps} />
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
              <strong>Feed Check-Ins:</strong> Times your RSS feed was requested (e.g. by podcast apps checking for new episodes).{' '}
              <strong>Episode Requests:</strong> Times an episode audio file was requested.{' '}
              <strong>Listens:</strong> Plays of 250 KB or more (estimated listeners).
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
                <span className={styles.summaryCount}>{rssTotal.human}</span> <span className={styles.summaryLabel}>People</span>
              </span>
              <span className={styles.summaryItem}>
                <span className={styles.summaryCount}>{rssTotal.bot}</span> <span className={styles.summaryLabel}>Apps</span>
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
                      <th className={styles.num}>People</th>
                      <th className={styles.num}>Apps</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...feedData].reverse().map((row) => (
                      <tr key={row.stat_date}>
                        <td>{formatShortDate(row.stat_date)}</td>
                        <td className={styles.num}>{row.People}</td>
                        <td className={styles.num}>{row.Apps}</td>
                        <td className={styles.num}>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {renderTimeChart(feedData, [{ key: 'People', name: 'People', color: COLORS.human }, { key: 'Apps', name: 'Apps', color: COLORS.bot }], feedView)}
                </ResponsiveContainer>
              </div>
            )}
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
                      <th className={styles.num}>People</th>
                      <th className={styles.num}>Apps</th>
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
                        <td className={styles.num}>{row.People}</td>
                        <td className={styles.num}>{row.Apps}</td>
                        <td className={styles.num}>{row.requests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {episodeBarData.length === 0 ? (
                    <p className={styles.empty}>No episode data in the last 2 weeks.</p>
                  ) : (
                    <BarChart data={episodeBarData} layout="vertical" margin={chartMargin} barCategoryGap="8%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="name" width={verticalYAxisWidth} {...axisProps} tickLine={false} />
                      <Tooltip
                        contentStyle={tooltipContentStyle}
                        formatter={(value: number | undefined) => [value ?? 0, '']}
                        labelFormatter={(_: unknown, payload: readonly unknown[]) =>
                          (payload?.[0] as { payload?: { fullName?: string } } | undefined)?.payload?.fullName ?? ''
                        }
                      />
                      <Legend />
                      <Bar dataKey="People" name="People" fill={COLORS.human} radius={[0, 4, 4, 0]} stackId="1" />
                      <Bar dataKey="Apps" name="Apps" fill={COLORS.bot} radius={[0, 4, 4, 0]} stackId="1" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
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
                      <th className={styles.num}>People</th>
                      <th className={styles.num}>Apps</th>
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
                        <td className={styles.num}>{row.People}</td>
                        <td className={styles.num}>{row.Apps}</td>
                        <td className={styles.num}>{row.listens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {listensBarData.length === 0 ? (
                    <p className={styles.empty}>No listen data in the last 2 weeks.</p>
                  ) : (
                    <BarChart data={listensBarData} layout="vertical" margin={chartMargin} barCategoryGap="8%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="name" width={verticalYAxisWidth} {...axisProps} tickLine={false} />
                      <Tooltip
                        contentStyle={tooltipContentStyle}
                        formatter={(value: number | undefined) => [value ?? 0, '']}
                        labelFormatter={(_: unknown, payload: readonly unknown[]) =>
                          (payload?.[0] as { payload?: { fullName?: string } } | undefined)?.payload?.fullName ?? ''
                        }
                      />
                      <Legend />
                      <Bar dataKey="People" name="People" fill={COLORS.human} radius={[0, 4, 4, 0]} stackId="1" />
                      <Bar dataKey="Apps" name="Apps" fill={COLORS.bot} radius={[0, 4, 4, 0]} stackId="1" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
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
                      <th className={styles.num}>People</th>
                      <th className={styles.num}>Apps</th>
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
            ) : (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={300}>
                  {locationPieData.length === 0 ? (
                    <p className={styles.empty}>No location data in the last 2 weeks.</p>
                  ) : locationsView === 'pie' ? (
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
        </>
      )}
    </div>
  );
}
