import type { ShowNotesGuestTag } from '@harborfm/shared';

const BASE = '/api';

export interface MeetingTopicsGuestItem {
  id: string;
  text: string;
  tag: ShowNotesGuestTag;
  submittedBy: string;
  position: number;
  addedToNotes: boolean;
}

export interface MeetingTopicsListResponse {
  podcast: { title: string };
  episode: { id: string; title: string };
  meetingStatus: string;
  scheduledStartAt: string;
  submittedBy: string;
  fromInvite: boolean;
  items: MeetingTopicsGuestItem[];
}

export type MeetingTopicsIdentity = {
  invite?: string | null;
  submittedBy?: string | null;
};

function identityQuery(identity: MeetingTopicsIdentity): string {
  const params = new URLSearchParams();
  if (identity.invite?.trim()) params.set('invite', identity.invite.trim());
  if (identity.submittedBy?.trim()) params.set('submittedBy', identity.submittedBy.trim());
  const q = params.toString();
  return q ? `?${q}` : '';
}

function identityBody(identity: MeetingTopicsIdentity): Record<string, string> {
  const body: Record<string, string> = {};
  if (identity.invite?.trim()) body.invite = identity.invite.trim();
  if (identity.submittedBy?.trim()) body.submittedBy = identity.submittedBy.trim();
  return body;
}

async function parseJson<T>(r: Response): Promise<T> {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error((data as { error?: string }).error ?? r.statusText), {
      status: r.status,
      meetingStatus: (data as { meetingStatus?: string }).meetingStatus,
    });
  }
  return data as T;
}

export function listMeetingTopics(
  token: string,
  identity: MeetingTopicsIdentity,
): Promise<MeetingTopicsListResponse> {
  return fetch(
    `${BASE}/call/meetings/by-token/${encodeURIComponent(token)}/topics${identityQuery(identity)}`,
    { method: 'GET', credentials: 'include' },
  ).then((r) => parseJson<MeetingTopicsListResponse>(r));
}

export function createMeetingTopic(
  token: string,
  identity: MeetingTopicsIdentity,
  body: { text?: string; tag: ShowNotesGuestTag },
): Promise<MeetingTopicsGuestItem> {
  return fetch(`${BASE}/call/meetings/by-token/${encodeURIComponent(token)}/topics`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...identityBody(identity), ...body }),
  }).then((r) => parseJson<MeetingTopicsGuestItem>(r));
}

export function updateMeetingTopic(
  token: string,
  itemId: string,
  identity: MeetingTopicsIdentity,
  body: { text?: string; tag?: ShowNotesGuestTag },
): Promise<MeetingTopicsGuestItem> {
  return fetch(
    `${BASE}/call/meetings/by-token/${encodeURIComponent(token)}/topics/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...identityBody(identity), ...body }),
    },
  ).then((r) => parseJson<MeetingTopicsGuestItem>(r));
}

export function reorderMeetingTopics(
  token: string,
  identity: MeetingTopicsIdentity,
  itemIds: string[],
): Promise<{ items: MeetingTopicsGuestItem[] }> {
  return fetch(
    `${BASE}/call/meetings/by-token/${encodeURIComponent(token)}/topics/reorder`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...identityBody(identity), itemIds }),
    },
  ).then((r) => parseJson<{ items: MeetingTopicsGuestItem[] }>(r));
}

export function deleteMeetingTopic(
  token: string,
  itemId: string,
  identity: MeetingTopicsIdentity,
): Promise<{ ok: boolean }> {
  return fetch(
    `${BASE}/call/meetings/by-token/${encodeURIComponent(token)}/topics/${encodeURIComponent(itemId)}${identityQuery(identity)}`,
    { method: 'DELETE', credentials: 'include' },
  ).then((r) => parseJson<{ ok: boolean }>(r));
}

export function meetingTopicsSubmitterKey(token: string): string {
  return `harborfm_meeting_topics_submitter_${token}`;
}
