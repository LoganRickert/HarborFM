import { listDueMeetingReminders } from "./meetings.js";
import { sendDueMeetingReminder } from "./meetingMail.js";

const INTERVAL_MS = 15 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const due = listDueMeetingReminders(50);
    for (const meeting of due) {
      try {
        await sendDueMeetingReminder(meeting);
      } catch (err) {
        console.warn(
          `[meetingReminder] poller failed for ${meeting.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[meetingReminder] poller tick error:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Start the ~15 minute poller for group-call invitee reminder emails. */
export function startMeetingReminderPoller(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}
