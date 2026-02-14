import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from './store/auth';
import { me } from './api/auth';
import { setupStatus } from './api/setup';
import { getPublicConfig } from './api/public';
import { Layout } from './components/Layout';
import { ServerDown } from './components/ServerDown';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Setup } from './pages/Setup';
import { ResetPassword } from './pages/ResetPassword';
import { VerifyEmail } from './pages/VerifyEmail';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { Contact } from './pages/Contact';
import { Dashboard } from './pages/Dashboard';
import { PodcastNew } from './pages/PodcastNew';
import { PodcastDetail } from './pages/PodcastDetail';
import { PodcastAnalytics } from './pages/PodcastAnalytics';
import { EpisodesList } from './pages/EpisodesList';
import { EpisodeNew } from './pages/EpisodeNew';
import { EpisodeEditor } from './pages/EpisodeEditor';
import { Settings } from './pages/Settings';
import { Profile } from './pages/Profile';
import { Users } from './pages/Users';
import { Messages } from './pages/Messages';
import { FeedHome } from './pages/FeedHome';
import { FeedPodcast } from './pages/FeedPodcast';
import { FeedEpisode } from './pages/FeedEpisode';
import { EmbedEpisode } from './pages/EmbedEpisode';
import { Library } from './pages/Library';
import { SubscriberAuthProvider } from './hooks/useSubscriberAuth';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Defer until after React has committed and the browser has painted the new route.
    // Fixes mobile (e.g. iOS Safari) where scrolling in the same tick often has no effect.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.documentElement.scrollLeft = 0;
        document.body.scrollTop = 0;
        document.body.scrollLeft = 0;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);
  return null;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: !user, // Only run if we don't already have a user
  });

  const resolvedUser = user ?? data?.user;

  if (isLoading) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }

  if (resolvedUser?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: !user, // Only run if we don't already have a user
  });

  // If we have a user (from store or query), redirect to dashboard
  if (user || data?.user) {
    return <Navigate to="/" replace />;
  }

  // Show loading while checking auth status
  if (isLoading) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }

  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, setUser } = useAuthStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data?.user) setUser(data.user);
    // Only clear user on error if we don't already have a user set
    // This prevents clearing the user immediately after login if the query fails
    if (isError && !user) {
      setUser(null);
    }
  }, [data, isError, setUser, user]);

  if (isLoading) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }
  if (!user && isError) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }

  if (isError) {
    const details = error instanceof Error ? error.message : 'Failed to reach server';
    return (
      <ServerDown
        title="Server is offline"
        message="Could not load setup status. The server may be down or restarting."
        details={details}
        onRetry={() => { void refetch(); }}
      />
    );
  }

  if (data?.setupRequired) {
    // Don't allow access to app/auth routes until setup completes.
    return <Navigate to="/setup" replace state={{ from: location.pathname }} />;
  }

  if (location.pathname === '/register' && data && data.registrationEnabled === false) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicFeedsGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    retry: false,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }

  if (data && data.public_feeds_enabled === false) {
    // Redirect to dashboard if authed, login if not (handled by RequireAuth on "/").
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/** At "/": if this host is a custom podcast domain, show that feed at root (URL stays /). Otherwise show app. */
function RootRoute() {
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const { data, isLoading, isFetching, isFetched } = useQuery({
    queryKey: ['publicConfig', host],
    queryFn: getPublicConfig,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const waitingForConfig = !isFetched || isFetching || isLoading;
  if (waitingForConfig) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }

  if (data?.custom_feed_slug) {
    return (
      <PublicFeedsGuard>
        <FeedPodcast podcastSlugOverride={data.custom_feed_slug} />
      </PublicFeedsGuard>
    );
  }

  return (
    <SetupGuard>
      <RequireAuth>
        <Layout />
      </RequireAuth>
    </SetupGuard>
  );
}

/** For path /:episodeSlug: on custom domain show episode at short URL; otherwise redirect to /. */
function CustomFeedEpisodeWrapper() {
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const { episodeSlug } = useParams<{ episodeSlug: string }>();
  const { data, isLoading, isFetching, isFetched } = useQuery({
    queryKey: ['publicConfig', host],
    queryFn: getPublicConfig,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const waiting = !isFetched || isFetching || isLoading;
  if (waiting) {
    return (
      <div className="app-loading">
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
        <span className="app-loading__dot" />
      </div>
    );
  }

  if (data?.custom_feed_slug && episodeSlug) {
    return (
      <FeedEpisode
        podcastSlugOverride={data.custom_feed_slug}
        episodeSlugOverride={episodeSlug}
      />
    );
  }

  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <SubscriberAuthProvider>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<SetupGuard><RequireGuest><Login /></RequireGuest></SetupGuard>} />
          <Route path="/register" element={<SetupGuard><RequireGuest><Register /></RequireGuest></SetupGuard>} />
          <Route path="/reset-password" element={<SetupGuard><RequireGuest><ResetPassword /></RequireGuest></SetupGuard>} />
          <Route path="/verify-email" element={<SetupGuard><VerifyEmail /></SetupGuard>} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<SetupGuard><Contact /></SetupGuard>} />
          <Route path="/feed" element={<PublicFeedsGuard><FeedHome /></PublicFeedsGuard>} />
          <Route path="/feed/:podcastSlug" element={<PublicFeedsGuard><FeedPodcast /></PublicFeedsGuard>} />
          <Route path="/feed/:podcastSlug/:episodeSlug" element={<PublicFeedsGuard><FeedEpisode /></PublicFeedsGuard>} />
          <Route path="/embed/:podcastSlug/:episodeSlug" element={<PublicFeedsGuard><EmbedEpisode /></PublicFeedsGuard>} />
          <Route path="/embed/:episodeSlug" element={<PublicFeedsGuard><EmbedEpisode /></PublicFeedsGuard>} />
        <Route path="/" element={<RootRoute />}>
          <Route index element={<Dashboard />} />
          <Route path="podcasts/new" element={<PodcastNew />} />
          <Route path="podcasts/:id" element={<PodcastDetail />} />
          <Route path="podcasts/:id/analytics" element={<PodcastAnalytics />} />
          <Route path="podcasts/:id/episodes" element={<EpisodesList />} />
          <Route path="podcasts/:id/episodes/new" element={<EpisodeNew />} />
          <Route path="episodes/:id" element={<EpisodeEditor />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:userId" element={<RequireAdmin><Library /></RequireAdmin>} />
          <Route path="dashboard/:userId" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
          <Route path="profile" element={<Profile />} />
          <Route path="users" element={<RequireAdmin><Users /></RequireAdmin>} />
          <Route path="messages" element={<Messages />} />
          <Route path="settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
        </Route>
          <Route path="/:episodeSlug" element={<PublicFeedsGuard><CustomFeedEpisodeWrapper /></PublicFeedsGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SubscriberAuthProvider>
    </BrowserRouter>
  );
}
