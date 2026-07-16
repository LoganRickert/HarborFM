import { dispatchEpisodeAlerts } from "./dispatch.js";
import { listDueAlertEpisodes } from "./repo.js";

const INTERVAL_MS = 15 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const due = listDueAlertEpisodes(50);
    for (const ep of due) {
      try {
        await dispatchEpisodeAlerts(ep.id);
      } catch (err) {
        console.warn(
          `[episodeAlerts] poller failed for ${ep.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[episodeAlerts] poller tick error:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Start the ~15 minute release poller for time-gated episode alerts. */
export function startEpisodeAlertsPoller(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}
