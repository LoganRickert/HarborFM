import http from 'http';

/**
 * Tiny local HTTP server that records inbound POSTs (for email webhooks / alert destinations).
 * Always responds 200 so HarborFM treats deliveries as successful.
 *
 * @returns {Promise<{
 *   baseUrl: string,
 *   requests: Array<{ method: string, url: string, headers: Record<string, string>, bodyText: string, json: unknown|null, at: number }>,
 *   waitFor: (count: number, timeoutMs?: number) => Promise<void>,
 *   reset: () => void,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startHttpCatcher() {
  /** @type {Array<{ method: string, url: string, headers: Record<string, string>, bodyText: string, json: unknown|null, at: number }>} */
  const requests = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try {
        json = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        json = null;
      }
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v.join(', ');
      }
      requests.push({
        method: req.method || 'GET',
        url: req.url || '/',
        headers,
        bodyText,
        json,
        at: Date.now(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('httpCatcher: failed to bind');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function waitFor(count, timeoutMs = 8000) {
    const start = Date.now();
    while (requests.length < count) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `httpCatcher: expected ${count} request(s), got ${requests.length} after ${timeoutMs}ms`,
        );
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  function reset() {
    requests.length = 0;
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
  }

  return { baseUrl, requests, waitFor, reset, close };
}
