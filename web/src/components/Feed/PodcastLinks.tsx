import { ExternalLink } from 'lucide-react';
import {
  SiApplepodcasts,
  SiSpotify,
  SiAmazonmusic,
  SiPodcastindex,
  SiCastbox,
  SiX,
  SiFacebook,
  SiInstagram,
  SiTiktok,
  SiYoutube,
} from 'react-icons/si';
import styles from './FeedPodcast/PodcastLinks.module.css';
import sharedStyles from '../../styles/shared.module.css';

const LINK_KEYS = [
  'apple_podcasts_url',
  'spotify_url',
  'amazon_music_url',
  'podcast_index_url',
  'listen_notes_url',
  'castbox_url',
  'x_url',
  'facebook_url',
  'instagram_url',
  'tiktok_url',
  'youtube_url',
] as const;

const PODCAST_PLATFORMS: Array<{
  key: (typeof LINK_KEYS)[number];
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  { key: 'apple_podcasts_url', label: 'Apple Podcasts', Icon: SiApplepodcasts },
  { key: 'spotify_url', label: 'Spotify', Icon: SiSpotify },
  { key: 'amazon_music_url', label: 'Amazon Music', Icon: SiAmazonmusic },
  { key: 'podcast_index_url', label: 'Podcast Index', Icon: SiPodcastindex },
  { key: 'listen_notes_url', label: 'Listen Notes', Icon: ExternalLink },
  { key: 'castbox_url', label: 'Castbox', Icon: SiCastbox },
];

const SOCIAL_PLATFORMS: Array<{
  key: (typeof LINK_KEYS)[number];
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  { key: 'x_url', label: 'X', Icon: SiX },
  { key: 'facebook_url', label: 'Facebook', Icon: SiFacebook },
  { key: 'instagram_url', label: 'Instagram', Icon: SiInstagram },
  { key: 'tiktok_url', label: 'TikTok', Icon: SiTiktok },
  { key: 'youtube_url', label: 'YouTube', Icon: SiYoutube },
];

function LinkGroup({
  label,
  platforms,
  podcast,
}: {
  label: string;
  platforms: typeof PODCAST_PLATFORMS;
  podcast: { [key: string]: unknown };
}) {
  const links = platforms.filter((p) => {
    const url = podcast[p.key];
    return url && typeof url === 'string' && url.trim().length > 0;
  });
  if (links.length === 0) return null;

  return (
    <div className={styles.linkGroup}>
      <span className={styles.linkGroupLabel}>{label}</span>
      <div className={styles.linkGroupIcons}>
        {links.map(({ key, label: platformLabel, Icon }) => {
          const url = podcast[key] as string | undefined;
          if (!url || typeof url !== 'string') return null;
          const href = url.startsWith('http') ? url : `https://${url}`;
          return (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkIcon}
              title={platformLabel}
              aria-label={`${platformLabel} (opens in new tab)`}
            >
              <Icon size={20} aria-hidden />
            </a>
          );
        })}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function hasPodcastLinks(podcast: { [key: string]: unknown }) {
  return LINK_KEYS.some((key) => {
    const url = podcast[key];
    return url && typeof url === 'string' && url.trim().length > 0;
  });
}

export function PodcastLinks({ podcast }: { podcast: { [key: string]: unknown } }) {
  if (!hasPodcastLinks(podcast)) return null;

  return (
    <div className={styles.linksContainer}>
      <LinkGroup label="Listen on" platforms={PODCAST_PLATFORMS} podcast={podcast} />
      <LinkGroup label="Follow" platforms={SOCIAL_PLATFORMS} podcast={podcast} />
    </div>
  );
}

export function PodcastLinksCard({ podcast }: { podcast: { [key: string]: unknown } }) {
  if (!hasPodcastLinks(podcast)) return null;

  return (
    <div className={sharedStyles.card}>
      <PodcastLinks podcast={podcast} />
    </div>
  );
}
