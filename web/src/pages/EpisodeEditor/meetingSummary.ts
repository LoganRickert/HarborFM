import type { CallMeeting } from '../../api/call';

/** Format a meeting start for summary card. */
export function formatMeetingSummary(meeting: CallMeeting): string {
  try {
    return new Date(meeting.scheduledStartAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return meeting.scheduledStartAt;
  }
}
