import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { episodeWebSocketUrl } from '../api/episodeWs';

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1000;

/** Check if session is still valid. Returns true if auth ok, false if 401. */
async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include', method: 'GET' });
    return res.status !== 401;
  } catch {
    return true;
  }
}

export function useEpisodeWebSocket(
  episodeId: string | undefined,
  podcastId: string | undefined,
): void {
  const queryClient = useQueryClient();
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!episodeId || !podcastId) return;

    let closed = false;
    let ws: WebSocket | null = null;

    function connect() {
      if (closed) return;
      const url = episodeWebSocketUrl(episodeId!);
      ws = new WebSocket(url);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            status?: string;
            error?: string;
            segmentId?: string;
            segment?: unknown;
          };
          const t = msg.type;

          switch (t) {
            case 'callStarted':
              queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['call-session', episodeId] });
              break;
            case 'callEnded':
              queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['call-session', episodeId] });
              break;
            case 'segmentAdded':
            case 'segmentUpdated':
            case 'segmentReordered':
              queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
              break;
            case 'segmentDeleted':
              queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['me'] });
              break;
            case 'transcriptGenerated':
              queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
              break;
            case 'renderStarted':
              queryClient.invalidateQueries({ queryKey: ['render-status', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
              break;
            case 'renderCompleted':
              queryClient.invalidateQueries({ queryKey: ['render-status', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
              break;
            case 'castChanged':
              queryClient.invalidateQueries({ queryKey: ['episode-cast', podcastId!, episodeId] });
              queryClient.invalidateQueries({ queryKey: ['cast', podcastId] });
              break;
            case 'showCastChanged':
              queryClient.invalidateQueries({ queryKey: ['cast', podcastId] });
              queryClient.invalidateQueries({ queryKey: ['episode-cast', podcastId!, episodeId] });
              break;
            case 'libraryAdded':
              queryClient.invalidateQueries({ queryKey: ['library'] });
              break;
            case 'episodeUpdated':
              queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
              queryClient.invalidateQueries({ queryKey: ['episodes', podcastId] });
              break;
            default:
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        ws = null;
        if (closed) return;
        checkAuth().then((authOk) => {
          if (closed) return;
          if (!authOk) return;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (closed) return;
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY_MS,
            );
            connect();
          }, reconnectDelayRef.current);
        });
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    }

    // Defer so React Strict Mode cleanup can run first
    queueMicrotask(() => {
      if (closed) return;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
      connect();
    });

    return () => {
      closed = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
    };
  }, [episodeId, podcastId, queryClient]);
}
