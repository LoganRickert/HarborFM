import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Rss, Headphones, MapPin } from 'lucide-react';
import { getPodcast, getPodcastAnalytics, type PodcastAnalytics } from '../api/podcasts';
import { FullPageLoading } from '../components/Loading';
import { Breadcrumb } from '../components/Breadcrumb';
import styles from './PodcastAnalytics.module.css';

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

export function PodcastAnalytics() {
  const { id } = useParams<{ id: string }>();
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

  if (!id) return null;
  if (podcastLoading || !podcast) return <FullPageLoading />;
  if (analyticsLoading && !analytics) return <FullPageLoading />;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast.title, href: `/podcasts/${id}`, mobileLabel: 'Podcast' },
    { label: 'Analytics' },
  ];

  const rssTotal = analytics ? sumRss(analytics) : { bot: 0, human: 0, total: 0 };
  const episodeTotalsMap = analytics ? episodeTotals(analytics) : {};
  const locationTotalsList = analytics ? locationTotals(analytics) : [];

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
          RSS feed hits, episode requests, and listens (≥250 KB) by day. Bot vs human is inferred from user agent.
          Location is only recorded for non-bot requests.
        </p>
      </div>

      {/* RSS feed requests */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>
          <Rss size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
          RSS feed requests
        </h2>
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{rssTotal.total}</span>
            <span className={styles.summaryLabel}>total</span>
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{rssTotal.human}</span>
            <span className={styles.summaryLabel}>human</span>
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{rssTotal.bot}</span>
            <span className={styles.summaryLabel}>bot</span>
          </span>
        </div>
        {analytics && analytics.rss_daily.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className={styles.num}>Human</th>
                  <th className={styles.num}>Bot</th>
                  <th className={styles.num}>Total</th>
                </tr>
              </thead>
              <tbody>
                {analytics.rss_daily.map((row) => (
                  <tr key={row.stat_date}>
                    <td>{row.stat_date}</td>
                    <td className={styles.num}>{row.human_count}</td>
                    <td className={styles.num}>{row.bot_count}</td>
                    <td className={styles.num}>{row.human_count + row.bot_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>No RSS feed request data yet.</p>
        )}
      </div>

      {/* Episode stats */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>
          <Headphones size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Episode requests & listens
        </h2>
        {analytics && analytics.episodes.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Episode</th>
                  <th className={styles.num}>Requests (human)</th>
                  <th className={styles.num}>Requests (bot)</th>
                  <th className={styles.num}>Listens (human)</th>
                  <th className={styles.num}>Listens (bot)</th>
                </tr>
              </thead>
              <tbody>
                {analytics.episodes.map((ep) => {
                  const tot = episodeTotalsMap[ep.id] ?? {
                    requestsBot: 0,
                    requestsHuman: 0,
                    listensBot: 0,
                    listensHuman: 0,
                  };
                  return (
                    <tr key={ep.id}>
                      <td>
                        <Link to={`/episodes/${ep.id}`} className={styles.episodeLink}>
                          {ep.title}
                        </Link>
                      </td>
                      <td className={styles.num}>{tot.requestsHuman}</td>
                      <td className={styles.num}>{tot.requestsBot}</td>
                      <td className={styles.num}>{tot.listensHuman}</td>
                      <td className={styles.num}>{tot.listensBot}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>No episodes or no episode stats yet.</p>
        )}
      </div>

      {/* Location breakdown */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>
          <MapPin size={18} strokeWidth={2} aria-hidden style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Requests by location
        </h2>
        <p className={styles.sectionSub}>
          Only non-bot requests include location (from GeoIP). Locations are aggregated across all episodes.
        </p>
        {locationTotalsList.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Location</th>
                  <th className={styles.num}>Human</th>
                  <th className={styles.num}>Bot</th>
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
          <p className={styles.empty}>No location data yet.</p>
        )}
      </div>
    </div>
  );
}
