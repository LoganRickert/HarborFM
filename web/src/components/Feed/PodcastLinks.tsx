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
  SiDiscord,
} from 'react-icons/si';
import type { PublicPodcast } from '../../api/public';
import styles from './FeedPodcast/PodcastLinks.module.css';
import sharedStyles from '../../styles/shared.module.css';

type PodcastWithLinks = PublicPodcast | { [key: string]: unknown } | Record<string, string | null | undefined>;

const LINK_KEYS = [
  'applePodcastsUrl',
  'spotifyUrl',
  'amazonMusicUrl',
  'podcastIndexUrl',
  'listenNotesUrl',
  'castboxUrl',
  'xUrl',
  'facebookUrl',
  'instagramUrl',
  'tiktokUrl',
  'youtubeUrl',
  'discordUrl',
] as const;

const PODCAST_PLATFORMS: Array<{
  key: (typeof LINK_KEYS)[number];
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  { key: 'applePodcastsUrl', label: 'Apple Podcasts', Icon: SiApplepodcasts },
  { key: 'spotifyUrl', label: 'Spotify', Icon: SiSpotify },
  { key: 'amazonMusicUrl', label: 'Amazon Music', Icon: SiAmazonmusic },
  { key: 'podcastIndexUrl', label: 'Podcast Index', Icon: SiPodcastindex },
  { key: 'listenNotesUrl', label: 'Listen Notes', Icon: ExternalLink },
  { key: 'castboxUrl', label: 'Castbox', Icon: SiCastbox },
];

const SOCIAL_PLATFORMS: Array<{
  key: (typeof LINK_KEYS)[number];
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  { key: 'xUrl', label: 'X', Icon: SiX },
  { key: 'facebookUrl', label: 'Facebook', Icon: SiFacebook },
  { key: 'instagramUrl', label: 'Instagram', Icon: SiInstagram },
  { key: 'tiktokUrl', label: 'TikTok', Icon: SiTiktok },
  { key: 'youtubeUrl', label: 'YouTube', Icon: SiYoutube },
  { key: 'discordUrl', label: 'Discord', Icon: SiDiscord },
];

function LinkGroup({
  label,
  platforms,
  podcast,
}: {
  label: string;
  platforms: typeof PODCAST_PLATFORMS;
  podcast: PodcastWithLinks;
}) {
  const p = podcast as Record<string, unknown>;
  const links = platforms.filter((plat) => {
    const url = p[plat.key];
    return url && typeof url === 'string' && url.trim().length > 0;
  });
  if (links.length === 0) return null;

  return (
    <div className={styles.linkGroup}>
      <span className={styles.linkGroupLabel}>{label}</span>
      <div className={styles.linkGroupIcons}>
        {links.map(({ key, label: platformLabel, Icon }) => {
          const url = p[key] as string | undefined;
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
export function hasPodcastLinks(podcast: PodcastWithLinks) {
  const p = podcast as Record<string, unknown>;
  return LINK_KEYS.some((key) => {
    const url = p[key];
    return url && typeof url === 'string' && url.trim().length > 0;
  });
}

export function PodcastLinks({ podcast }: { podcast: PodcastWithLinks }) {
  if (!hasPodcastLinks(podcast)) return null;

  return (
    <div className={styles.linksContainer}>
      <LinkGroup label="Listen on" platforms={PODCAST_PLATFORMS} podcast={podcast} />
      <LinkGroup label="Follow" platforms={SOCIAL_PLATFORMS} podcast={podcast} />
    </div>
  );
}

export function PodcastLinksCard({ podcast }: { podcast: PodcastWithLinks }) {
  if (!hasPodcastLinks(podcast)) return null;

  return (
    <div className={sharedStyles.card}>
      <PodcastLinks podcast={podcast} />
    </div>
  );
}
