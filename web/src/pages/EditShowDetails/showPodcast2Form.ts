import type { ValueBlockForm } from '../../components/EpisodeEditor/valueBlocksForm';
import { emptyValueRecipient } from '../../components/EpisodeEditor/valueBlocksForm';
import type { PodrollFormItem } from '../../components/EpisodeEditor/podrollForm';
import type { Podcast } from '../../api/podcasts';

/** Form-friendly Podcast 2.0 channel fields (string inputs). */
export type ShowPodcast2Form = {
  fundingLinks: Array<{ href: string; text: string }>;
  podcastTxts: Array<{ purpose: string; value: string }>;
  socialInteracts: Array<{
    protocol: string;
    uri: string;
    accountId: string;
    accountUrl: string;
    priority: string;
  }>;
  locations: Array<{
    name: string;
    rel: string;
    geo: string;
    osm: string;
    country: string;
  }>;
  license: { identifier: string; url: string };
  chat: { server: string; protocol: string; accountId: string; space: string };
  valueBlocks: ValueBlockForm[];
  blocks: Array<{ id: string; value: string }>;
  publisher: { feedGuid: string; feedUrl: string; medium: string };
  podroll: PodrollFormItem[];
  updateFrequency: {
    rrule: string;
    label: string;
    complete: boolean;
    dtstart: string;
  };
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

export function emptyShowPodcast2Form(): ShowPodcast2Form {
  return {
    fundingLinks: [],
    podcastTxts: [],
    socialInteracts: [],
    locations: [],
    license: { identifier: '', url: '' },
    chat: { server: '', protocol: '', accountId: '', space: '' },
    valueBlocks: [],
    blocks: [],
    publisher: { feedGuid: '', feedUrl: '', medium: 'publisher' },
    podroll: [],
    updateFrequency: { rrule: '', label: '', complete: false, dtstart: '' },
  };
}

export function podcastToShowPodcast2Form(podcast: Podcast): ShowPodcast2Form {
  const fundingLinks = Array.isArray(podcast.fundingLinks)
    ? podcast.fundingLinks.map((f) => ({
        href: asString(f?.url),
        text: asString(f?.text),
      }))
    : [];

  const podcastTxts = Array.isArray(podcast.podcastTxts)
    ? podcast.podcastTxts.map((t) => ({
        purpose: asString(t?.purpose),
        value: asString(t?.value),
      }))
    : [];

  const socialInteracts = Array.isArray(podcast.socialInteracts)
    ? podcast.socialInteracts.map((s) => ({
        protocol: asString(s?.protocol),
        uri: asString(s?.uri),
        accountId: asString(s?.accountId),
        accountUrl: asString(s?.accountUrl),
        priority: s?.priority != null ? String(s.priority) : '',
      }))
    : [];

  const locations = Array.isArray(podcast.locations)
    ? podcast.locations.map((l) => ({
        name: asString(l?.name),
        rel: asString(l?.rel) || 'subject',
        geo: asString(l?.geo),
        osm: asString(l?.osm),
        country: asString(l?.country),
      }))
    : [];

  const lic = podcast.license;
  const license =
    lic && typeof lic === 'object'
      ? { identifier: asString(lic.identifier), url: asString(lic.url) }
      : { identifier: '', url: '' };

  const ch = podcast.chat;
  const chat = {
    server: asString(ch?.server),
    protocol: asString(ch?.protocol),
    accountId: asString(ch?.accountId),
    space: asString(ch?.space),
  };

  const valueBlocks: ValueBlockForm[] = Array.isArray(podcast.valueBlocks)
    ? podcast.valueBlocks.map((b) => ({
        type: asString(b?.type),
        method: asString(b?.method),
        suggested: asString(b?.suggested),
        recipients:
          Array.isArray(b?.recipients) && b.recipients.length > 0
            ? b.recipients.map((r) => ({
                type: asString(r?.type),
                address: asString(r?.address),
                split: r?.split != null ? String(r.split) : '0',
                name: asString(r?.name),
                customKey: asString(r?.customKey),
                customValue: asString(r?.customValue),
                fee: r?.fee === true,
              }))
            : [emptyValueRecipient()],
      }))
    : [];

  const blocks = Array.isArray(podcast.blocks)
    ? podcast.blocks.map((b) => ({
        id: asString(b?.id),
        value: b?.value === 'no' ? 'no' : 'yes',
      }))
    : [];

  const pub = podcast.publisher;
  const publisher = {
    feedGuid: asString(pub?.feedGuid),
    feedUrl: asString(pub?.feedUrl),
    medium: asString(pub?.medium) || 'publisher',
  };

  const podroll: PodrollFormItem[] = Array.isArray(podcast.podroll)
    ? podcast.podroll.map((p) => ({
        feedGuid: asString(p?.feedGuid),
        feedUrl: asString(p?.feedUrl),
        title: asString(p?.title),
        coverArtUrl: asString(p?.coverArtUrl),
        homeUrl: asString(p?.homeUrl),
      }))
    : [];

  const uf = podcast.updateFrequency;
  const updateFrequency = {
    rrule: asString(uf?.rrule),
    label: asString(uf?.label),
    complete: uf?.complete === true,
    dtstart: asString(uf?.dtstart),
  };

  return {
    fundingLinks,
    podcastTxts,
    socialInteracts,
    locations,
    license,
    chat,
    valueBlocks,
    blocks,
    publisher,
    podroll,
    updateFrequency,
  };
}

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

/** Build API payload fragment for Podcast 2.0 channel fields. */
export function showPodcast2FormToApiPayload(form: ShowPodcast2Form) {
  const fundingLinks = form.fundingLinks
    .map((l) => ({ url: l.href.trim(), text: l.text.trim() || null }))
    .filter((l) => l.url.length > 0);

  const podcastTxts = form.podcastTxts
    .map((t) => ({ purpose: nullIfEmpty(t.purpose), value: t.value.trim() }))
    .filter((t) => t.value.length > 0);

  const socialInteracts = form.socialInteracts
    .map((s) => {
      const protocol = s.protocol.trim();
      const priorityRaw = s.priority.trim();
      const priority =
        priorityRaw === ''
          ? null
          : Number.isFinite(Number(priorityRaw))
            ? Math.floor(Number(priorityRaw))
            : null;
      return {
        protocol,
        uri: nullIfEmpty(s.uri),
        accountId: nullIfEmpty(s.accountId),
        accountUrl: nullIfEmpty(s.accountUrl),
        priority,
      };
    })
    .filter((s) => {
      if (!s.protocol) return false;
      if (s.protocol.toLowerCase() === 'disabled') return true;
      return !!s.uri;
    });

  const locations = form.locations
    .map((l) => ({
      name: l.name.trim(),
      rel: l.rel === 'creator' || l.rel === 'subject' ? l.rel : null,
      geo: nullIfEmpty(l.geo),
      osm: nullIfEmpty(l.osm),
      country: nullIfEmpty(l.country)?.toUpperCase() ?? null,
    }))
    .filter((l) => l.name.length > 0);

  const licenseId = form.license.identifier.trim();
  const license = licenseId
    ? { identifier: licenseId, url: nullIfEmpty(form.license.url) }
    : null;

  const chatServer = form.chat.server.trim();
  const chatProtocol = form.chat.protocol.trim();
  const chat =
    chatServer && chatProtocol
      ? {
          server: chatServer,
          protocol: chatProtocol,
          accountId: nullIfEmpty(form.chat.accountId),
          space: nullIfEmpty(form.chat.space),
        }
      : null;

  const valueBlocks = form.valueBlocks
    .map((b) => {
      const recipients = b.recipients
        .map((r) => {
          const splitRaw = r.split.trim();
          const split = splitRaw === '' ? NaN : Number(splitRaw);
          return {
            type: r.type.trim(),
            address: r.address.trim(),
            split: Number.isFinite(split) ? Math.floor(split) : NaN,
            name: nullIfEmpty(r.name),
            customKey: nullIfEmpty(r.customKey),
            customValue: nullIfEmpty(r.customValue),
            fee: r.fee ? true : null,
          };
        })
        .filter((r) => r.type && r.address && Number.isFinite(r.split) && r.split >= 0);
      return {
        type: b.type.trim(),
        method: b.method.trim(),
        suggested: nullIfEmpty(b.suggested),
        recipients,
      };
    })
    .filter((b) => b.type && b.method && b.recipients.length > 0);

  const blocks = form.blocks
    .map((b) => ({
      id: nullIfEmpty(b.id),
      value: (b.value === 'no' ? 'no' : 'yes') as 'yes' | 'no',
    }))
    .filter((b) => b.value === 'yes' || b.value === 'no');

  const feedGuid = form.publisher.feedGuid.trim();
  const publisher = feedGuid
    ? {
        feedGuid,
        feedUrl: nullIfEmpty(form.publisher.feedUrl),
        medium: nullIfEmpty(form.publisher.medium) || 'publisher',
      }
    : null;

  const podroll = form.podroll
    .map((p) => ({
      feedGuid: p.feedGuid.trim(),
      feedUrl: nullIfEmpty(p.feedUrl),
      title: nullIfEmpty(p.title),
      coverArtUrl: nullIfEmpty(p.coverArtUrl),
      homeUrl: nullIfEmpty(p.homeUrl),
    }))
    .filter((p) => p.feedGuid.length > 0);

  const uf = form.updateFrequency;
  const hasUf =
    uf.complete ||
    uf.rrule.trim() ||
    uf.label.trim() ||
    uf.dtstart.trim();
  const updateFrequency = hasUf
    ? {
        rrule: nullIfEmpty(uf.rrule),
        label: nullIfEmpty(uf.label),
        complete: uf.complete ? true : null,
        dtstart: nullIfEmpty(uf.dtstart),
      }
    : null;

  return {
    fundingLinks: fundingLinks.length > 0 ? fundingLinks : null,
    podcastTxts: podcastTxts.length > 0 ? podcastTxts : null,
    socialInteracts: socialInteracts.length > 0 ? socialInteracts : null,
    locations: locations.length > 0 ? locations : null,
    license,
    chat,
    valueBlocks: valueBlocks.length > 0 ? valueBlocks : null,
    blocks: blocks.length > 0 ? blocks : null,
    publisher,
    podroll: podroll.length > 0 ? podroll : null,
    updateFrequency,
  };
}
