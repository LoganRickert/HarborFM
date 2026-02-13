import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { authenticateSubscriber, getSubscriberAuthStatus, logoutSubscriber } from '../api/public';
import { extractTokenFromInput, isValidTokenFormat } from '../utils/subscriberToken';

interface SubscriberAuthContextType {
  isAuthenticated: boolean;
  authenticatedPodcasts: string[];
  tokenMap: Record<string, string>;
  isAuthenticatedForPodcast: (podcastSlug: string) => boolean;
  getTokenIdForPodcast: (podcastSlug: string) => string | null;
  authenticate: (tokenOrUrl: string, podcastSlug: string) => Promise<void>;
  logout: (podcastSlug?: string) => Promise<void>;
  checkStatus: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const SubscriberAuthContext = createContext<SubscriberAuthContextType | undefined>(undefined);

export function SubscriberAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authenticatedPodcasts, setAuthenticatedPodcasts] = useState<string[]>([]);
  const [tokenMap, setTokenMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const status = await getSubscriberAuthStatus();
      setIsAuthenticated(status.authenticated);
      setAuthenticatedPodcasts(status.podcastSlugs);
      setTokenMap(status.tokens);
    } catch (err) {
      console.error('Failed to check subscriber auth status:', err);
      setIsAuthenticated(false);
      setAuthenticatedPodcasts([]);
      setTokenMap({});
    }
  }, []);

  // Check status on mount
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const isAuthenticatedForPodcast = useCallback(
    (podcastSlug: string) => {
      return authenticatedPodcasts.includes(podcastSlug);
    },
    [authenticatedPodcasts]
  );

  const getTokenIdForPodcast = useCallback(
    (podcastSlug: string) => {
      return tokenMap?.[podcastSlug] || null;
    },
    [tokenMap]
  );

  const authenticate = useCallback(
    async (tokenOrUrl: string, podcastSlug: string) => {
      setIsLoading(true);
      setError(null);

      try {
        // Extract token from input
        const token = extractTokenFromInput(tokenOrUrl);
        if (!token) {
          throw new Error('Invalid token or URL format');
        }

        if (!isValidTokenFormat(token)) {
          throw new Error('Invalid token format');
        }

        // Authenticate with backend
        await authenticateSubscriber(token, podcastSlug);

        // Reload page to fetch private content with new cookie
        window.location.reload();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        setError(message);
        setIsLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async (podcastSlug?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await logoutSubscriber(podcastSlug);

      // Reload page to lock content again
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
      setIsLoading(false);
    }
  }, []);

  const value: SubscriberAuthContextType = {
    isAuthenticated,
    authenticatedPodcasts,
    tokenMap,
    isAuthenticatedForPodcast,
    getTokenIdForPodcast,
    authenticate,
    logout,
    checkStatus,
    isLoading,
    error,
  };

  return (
    <SubscriberAuthContext.Provider value={value}>
      {children}
    </SubscriberAuthContext.Provider>
  );
}

// Hook in same file as Provider for co-location; Fast Refresh prefers components-only files
// eslint-disable-next-line react-refresh/only-export-components
export function useSubscriberAuth(): SubscriberAuthContextType {
  const context = useContext(SubscriberAuthContext);
  if (context === undefined) {
    throw new Error('useSubscriberAuth must be used within a SubscriberAuthProvider');
  }
  return context;
}
