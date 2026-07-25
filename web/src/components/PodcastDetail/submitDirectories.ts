export type DirectoryLink = {
  id: string;
  name: string;
  blurb: string;
  href: string;
  group: 'start' | 'also';
  /** When true, append ?url= with the absolute public RSS feed. */
  appendRssUrl?: boolean;
};

/** Static submit destinations. URLs are official creator/submit landing pages. */
export const SUBMIT_DIRECTORIES: DirectoryLink[] = [
  {
    id: 'apple',
    name: 'Apple Podcasts',
    blurb: 'Default on iPhone and many third-party apps.',
    href: 'https://podcastsconnect.apple.com',
    group: 'start',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    blurb: 'Large global audience and fast review.',
    href: 'https://podcasters.spotify.com',
    group: 'start',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    blurb: 'Link your RSS in YouTube Studio Podcasts.',
    href: 'https://studio.youtube.com',
    group: 'start',
  },
  {
    id: 'amazon',
    name: 'Amazon Music',
    blurb: 'Amazon Music, Audible, and Alexa.',
    href: 'https://podcasters.amazon.com',
    group: 'start',
  },
  {
    id: 'podcast-index',
    name: 'Podcast Index',
    blurb: 'Open index used by many indie apps.',
    href: 'https://podcastindex.org/add',
    group: 'start',
  },
  {
    id: 'listen-notes',
    name: 'Listen Notes',
    blurb: 'Podcast search engine and API catalog.',
    href: 'https://www.listennotes.com/submit/',
    group: 'start',
    appendRssUrl: true,
  },
  {
    id: 'iheart',
    name: 'iHeartRadio',
    blurb: 'Radio and podcasts across the US.',
    href: 'https://www.iheart.com/content/submit-your-podcast/',
    group: 'also',
  },
  {
    id: 'pandora',
    name: 'Pandora',
    blurb: 'Music and podcast discovery in the US.',
    href: 'https://www.pandora.com/station/submit',
    group: 'also',
  },
  {
    id: 'tunein',
    name: 'TuneIn',
    blurb: 'Also helps Alexa pick up your show.',
    href: 'https://help.tunein.com/contact/add-podcast-S19BZg6_P',
    group: 'also',
  },
  {
    id: 'deezer',
    name: 'Deezer',
    blurb: 'Strong reach in Europe and beyond.',
    href: 'https://podcasters.deezer.com',
    group: 'also',
  },
  {
    id: 'castbox',
    name: 'Castbox',
    blurb: 'Popular Android podcast app.',
    href: 'https://castbox.fm/creator',
    group: 'also',
  },
  {
    id: 'podchaser',
    name: 'Podchaser',
    blurb: 'Reviews, credits, and discovery.',
    href: 'https://www.podchaser.com/',
    group: 'also',
  },
  {
    id: 'player-fm',
    name: 'Player FM',
    blurb: 'Import your feed for Player FM listeners.',
    href: 'https://player.fm/importer/feed',
    group: 'also',
  },
];

export function directoryHref(entry: DirectoryLink, absoluteRssUrl: string): string {
  if (!entry.appendRssUrl) return entry.href;
  const u = new URL(entry.href);
  u.searchParams.set('url', absoluteRssUrl);
  return u.toString();
}
