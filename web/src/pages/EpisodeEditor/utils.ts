import type { Episode } from '../../api/episodes';
import { parseUtc } from '../../utils/format';
import type { ValueBlockForm } from '../../components/EpisodeEditor/valueBlocksForm';
import { emptyValueRecipient } from '../../components/EpisodeEditor/valueBlocksForm';

/** Form-friendly episode fields (strings for inputs, booleans for checkboxes). */
export interface EpisodeForm {
  title: string;
  slug: string;
  description: string;
  subtitle: string;
  summary: string;
  contentEncoded: string;
  guid: string;
  artworkUrl: string;
  seasonNumber: string;
  episodeNumber: string;
  status: string;
  publishAt: string;
  expiresAt: string;
  explicit: boolean;
  episodeType: 'full' | 'trailer' | 'bonus' | '';
  episodeLink: string;
  guidIsPermalink: boolean;
  subscriberOnly: boolean;
  subscriberOnlyStartsAt: string;
  subscriberOnlyEndsAt: string;
  contentLinks: Array<{ href: string; text: string }>;
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
  podcastImages: Array<{
    href: string;
    alt: string;
    aspectRatio: string;
    width: string;
    height: string;
    type: string;
    purpose: string;
  }>;
  fundingLinks: Array<{ href: string; text: string }>;
  chat: { server: string; protocol: string; accountId: string; space: string };
  valueBlocks: ValueBlockForm[];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

export function episodeToForm(episode: Episode): EpisodeForm {
  const rawLinks = episode.contentLinks;
  const contentLinks: Array<{ href: string; text: string }> = Array.isArray(rawLinks)
    ? rawLinks
        .filter((l): l is { href: string; text?: string | null } =>
          typeof l === 'object' && l != null && typeof (l as { href?: unknown }).href === 'string',
        )
        .map((l) => ({ href: l.href, text: l.text?.trim() ? String(l.text) : '' }))
    : [];

  const podcastTxts = Array.isArray(episode.podcastTxts)
    ? episode.podcastTxts.map((t) => ({
        purpose: asString(t?.purpose),
        value: asString(t?.value),
      }))
    : [];

  const socialInteracts = Array.isArray(episode.socialInteracts)
    ? episode.socialInteracts.map((s) => ({
        protocol: asString(s?.protocol),
        uri: asString(s?.uri),
        accountId: asString(s?.accountId),
        accountUrl: asString(s?.accountUrl),
        priority: s?.priority != null ? String(s.priority) : '',
      }))
    : [];

  const locations = Array.isArray(episode.locations)
    ? episode.locations.map((l) => ({
        name: asString(l?.name),
        rel: asString(l?.rel) || 'subject',
        geo: asString(l?.geo),
        osm: asString(l?.osm),
        country: asString(l?.country),
      }))
    : [];

  const lic = episode.license;
  const license = {
    identifier: asString(lic?.identifier),
    url: asString(lic?.url),
  };

  const podcastImages = Array.isArray(episode.podcastImages)
    ? episode.podcastImages.map((img) => ({
        href: asString(img?.href),
        alt: asString(img?.alt),
        aspectRatio: asString(img?.aspectRatio),
        width: img?.width != null ? String(img.width) : '',
        height: img?.height != null ? String(img.height) : '',
        type: asString(img?.type),
        purpose: asString(img?.purpose),
      }))
    : [];

  const fundingLinks = Array.isArray(episode.fundingLinks)
    ? episode.fundingLinks.map((f) => ({
        href: asString(f?.url),
        text: asString(f?.text),
      }))
    : [];

  const ch = episode.chat;
  const chat = {
    server: asString(ch?.server),
    protocol: asString(ch?.protocol),
    accountId: asString(ch?.accountId),
    space: asString(ch?.space),
  };

  const valueBlocks: ValueBlockForm[] = Array.isArray(episode.valueBlocks)
    ? episode.valueBlocks.map((b) => ({
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

  return {
    title: episode.title,
    slug: episode.slug || slugify(episode.title),
    description: episode.description ?? '',
    subtitle: episode.subtitle ?? '',
    summary: episode.summary ?? '',
    contentEncoded: episode.contentEncoded ?? '',
    guid: episode.guid ?? '',
    artworkUrl: episode.artworkUrl ?? '',
    seasonNumber: episode.seasonNumber != null ? String(episode.seasonNumber) : '',
    episodeNumber: episode.episodeNumber != null ? String(episode.episodeNumber) : '',
    status: episode.status,
    publishAt: episode.publishAt ? toDateTimeLocalValue(episode.publishAt) : '',
    expiresAt: episode.expiresAt ? toDateTimeLocalValue(episode.expiresAt) : '',
    explicit: !!episode.explicit,
    episodeType: (episode.episodeType as 'full' | 'trailer' | 'bonus') || 'full',
    episodeLink: episode.episodeLink ?? '',
    guidIsPermalink: episode.guidIsPermalink === 1,
    subscriberOnly: !!(episode.subscriberOnly),
    subscriberOnlyStartsAt: episode.subscriberOnlyStartsAt
      ? toDateTimeLocalValue(episode.subscriberOnlyStartsAt)
      : '',
    subscriberOnlyEndsAt: episode.subscriberOnlyEndsAt
      ? toDateTimeLocalValue(episode.subscriberOnlyEndsAt)
      : '',
    contentLinks,
    podcastTxts,
    socialInteracts,
    locations,
    license,
    podcastImages,
    fundingLinks,
    chat,
    valueBlocks,
  };
}

export type PublishFormFields = Pick<
  EpisodeForm,
  'status' | 'seasonNumber' | 'episodeNumber' | 'publishAt' | 'expiresAt'
>;

/** True when both dates are set and expiresAt is not strictly after publishAt. */
export function isExpiresAtBeforePublishAt(fields: {
  publishAt?: string | null;
  expiresAt?: string | null;
}): boolean {
  const publishAt = typeof fields.publishAt === 'string' ? fields.publishAt.trim() : '';
  const expiresAt = typeof fields.expiresAt === 'string' ? fields.expiresAt.trim() : '';
  if (!publishAt || !expiresAt) return false;
  return new Date(expiresAt).getTime() <= new Date(publishAt).getTime();
}

export const EXPIRES_AT_BEFORE_PUBLISH_AT_MESSAGE = 'Expires at must be after Publish at';

/** True when both window dates are set and start is not strictly before end. */
export function isSubscriberOnlyWindowInvalid(fields: {
  subscriberOnlyStartsAt?: string | null;
  subscriberOnlyEndsAt?: string | null;
}): boolean {
  const startsAt =
    typeof fields.subscriberOnlyStartsAt === 'string' ? fields.subscriberOnlyStartsAt.trim() : '';
  const endsAt =
    typeof fields.subscriberOnlyEndsAt === 'string' ? fields.subscriberOnlyEndsAt.trim() : '';
  if (!startsAt || !endsAt) return false;
  return new Date(startsAt).getTime() >= new Date(endsAt).getTime();
}

export const SUBSCRIBER_ONLY_WINDOW_INVALID_MESSAGE =
  'Subscriber only until must be after Subscriber only from';

/** Build API update payload for publish fields only. */
export function publishFieldsToApiPayload(fields: PublishFormFields) {
  if (isExpiresAtBeforePublishAt(fields)) {
    throw new Error(EXPIRES_AT_BEFORE_PUBLISH_AT_MESSAGE);
  }
  return {
    status: fields.status as 'draft' | 'scheduled' | 'published',
    seasonNumber: fields.seasonNumber === '' ? null : parseInt(fields.seasonNumber, 10),
    episodeNumber: fields.episodeNumber === '' ? null : parseInt(fields.episodeNumber, 10),
    publishAt: fields.publishAt ? new Date(fields.publishAt).toISOString() : null,
    expiresAt: fields.expiresAt ? new Date(fields.expiresAt).toISOString() : null,
  };
}

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

/** Build API update payload from form. */
export function formToApiPayload(form: EpisodeForm) {
  const contentLinks = form.contentLinks
    .map((l) => ({
      href: l.href.trim(),
      text: l.text.trim() || null,
    }))
    .filter((l) => l.href.length > 0);

  const podcastTxts = form.podcastTxts
    .map((t) => ({
      purpose: nullIfEmpty(t.purpose),
      value: t.value.trim(),
    }))
    .filter((t) => t.value.length > 0);

  const socialInteracts = form.socialInteracts
    .map((s) => {
      const protocol = s.protocol.trim();
      const priorityRaw = s.priority.trim();
      const priority =
        priorityRaw === '' ? null : Number.isFinite(Number(priorityRaw)) ? Math.floor(Number(priorityRaw)) : null;
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

  const podcastImages = form.podcastImages
    .map((img) => {
      const widthRaw = img.width.trim();
      const heightRaw = img.height.trim();
      return {
        href: img.href.trim(),
        alt: nullIfEmpty(img.alt),
        aspectRatio: nullIfEmpty(img.aspectRatio),
        width: widthRaw && Number.isFinite(Number(widthRaw)) ? Math.floor(Number(widthRaw)) : null,
        height: heightRaw && Number.isFinite(Number(heightRaw)) ? Math.floor(Number(heightRaw)) : null,
        type: nullIfEmpty(img.type),
        purpose: nullIfEmpty(img.purpose),
      };
    })
    .filter((img) => img.href.length > 0);

  const fundingLinks = form.fundingLinks
    .map((l) => ({
      url: l.href.trim(),
      text: l.text.trim() || null,
    }))
    .filter((l) => l.url.length > 0);

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

  if (isExpiresAtBeforePublishAt(form)) {
    throw new Error(EXPIRES_AT_BEFORE_PUBLISH_AT_MESSAGE);
  }
  if (isSubscriberOnlyWindowInvalid(form)) {
    throw new Error(SUBSCRIBER_ONLY_WINDOW_INVALID_MESSAGE);
  }

  return {
    title: form.title,
    slug: form.slug || slugify(form.title),
    description: form.description,
    subtitle: form.subtitle?.trim() || null,
    summary: form.summary?.trim() || null,
    contentEncoded: form.contentEncoded?.trim() || null,
    guid: form.guid?.trim() || undefined,
    seasonNumber: form.seasonNumber === '' ? null : parseInt(form.seasonNumber, 10),
    episodeNumber: form.episodeNumber === '' ? null : parseInt(form.episodeNumber, 10),
    episodeType: form.episodeType || 'full',
    status: form.status,
    artworkUrl: form.artworkUrl === '' ? null : form.artworkUrl,
    explicit: form.explicit ? 1 : 0,
    publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    episodeLink: form.episodeLink || null,
    guidIsPermalink: form.guidIsPermalink ? 1 : 0,
    subscriberOnly: form.subscriberOnly ? 1 : 0,
    subscriberOnlyStartsAt: form.subscriberOnlyStartsAt
      ? new Date(form.subscriberOnlyStartsAt).toISOString()
      : null,
    subscriberOnlyEndsAt: form.subscriberOnlyEndsAt
      ? new Date(form.subscriberOnlyEndsAt).toISOString()
      : null,
    contentLinks: contentLinks.length > 0 ? contentLinks : null,
    podcastTxts: podcastTxts.length > 0 ? podcastTxts : null,
    socialInteracts: socialInteracts.length > 0 ? socialInteracts : null,
    locations: locations.length > 0 ? locations : null,
    license,
    podcastImages: podcastImages.length > 0 ? podcastImages : null,
    fundingLinks: fundingLinks.length > 0 ? fundingLinks : null,
    chat,
    valueBlocks: valueBlocks.length > 0 ? valueBlocks : null,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatLibraryDate(createdAt: string): string {
  const d = parseUtc(createdAt);
  if (!d) return createdAt;
  try {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return createdAt;
  }
}

/** Format ISO date string for datetime-local input (local time, with seconds for Safari). Parses server UTC first. */
export function toDateTimeLocalValue(iso: string): string {
  const d = parseUtc(iso);
  if (!d) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
