const POLL_INTERVAL_MS = 1500;

/**
 * Poll a status endpoint until success or failure.
 * `successStatuses` may include `idle` so a cleared terminal status (another
 * client already read ready/done) does not hang forever.
 */
export async function pollUntil<T extends { status: string; error?: string }>(
  fetchStatus: () => Promise<T>,
  opts: {
    pendingStatuses: string[];
    successStatuses: string[];
    failedStatus?: string;
  },
): Promise<T> {
  const failedStatus = opts.failedStatus ?? 'failed';
  for (;;) {
    const result = await fetchStatus();
    if (opts.successStatuses.includes(result.status)) return result;
    if (result.status === failedStatus) {
      throw new Error(result.error ?? 'Operation failed');
    }
    if (!opts.pendingStatuses.includes(result.status)) {
      throw new Error(result.error ?? `Unexpected status: ${result.status}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** Fetch an authenticated download URL and trigger a browser save. */
export async function downloadAuthenticatedBlob(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
