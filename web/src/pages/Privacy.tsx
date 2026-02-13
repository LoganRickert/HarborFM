import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { marked } from 'marked';
import { getPublicLegal } from '../api/settings';
import { FullPageLoading } from '../components/Loading';
import styles from './Privacy.module.css';

marked.setOptions({ gfm: true, breaks: true });

const DEFAULT_PRIVACY = (
  <>
    <p>
      HarborFM is an open-source podcast creator. This privacy policy describes how your data is handled when
      you use a HarborFM instance.
    </p>
    <h2>Data we collect and use</h2>
    <p>
      <strong>Account data.</strong> When you register, we store your email address and a hashed password. We
      use this to authenticate you and to manage your account.
    </p>
    <p>
      <strong>Login and security.</strong> When you sign in, we may record your IP address, user agent, and
      approximate location (country/city from IP, if GeoLite2 is enabled) for security and to show "last login"
      information to admins. We use this to detect abuse and to help you verify your account activity.
    </p>
    <p>
      <strong>Content you create.</strong> Podcasts, episodes, audio files, and other content you create are
      stored on the server. They are used to produce and serve your shows and to provide features you use (e.g.
      exports, RSS).
    </p>
    <h2>Who operates this instance</h2>
    <p>
      This HarborFM server is operated by the administrator of this instance. Data is stored on their
      infrastructure and is subject to their policies and applicable law. For questions about this instance,
      contact the server administrator.
    </p>
    <h2>Data sharing</h2>
    <p>
      We do not sell your data. Data may be shared only as needed to operate the service (e.g. with hosting or
      export providers you configure) or when required by law.
    </p>
    <h2>Your rights</h2>
    <p>
      You can request access to, correction of, or deletion of your account and data by contacting the
      administrator of this instance. Export and deletion capabilities may also be available in the app.
    </p>
    <h2>Changes</h2>
    <p>
      We may update this policy from time to time. The "Last updated" date at the top will be revised when we
      do. Continued use of the service after changes constitutes acceptance of the updated policy.
    </p>
  </>
);

export function Privacy() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['publicLegal'],
    queryFn: getPublicLegal,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading || (data == null && !isError)) {
    return <FullPageLoading />;
  }

  const customPrivacy = data?.privacy?.trim() || null;

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Link to="/login" className={styles.back}>
              ← Back to sign in
            </Link>
            <h1 className={styles.title}>Privacy Policy</h1>
            {!customPrivacy && <p className={styles.updated}>Last updated: February 2026</p>}
          </div>
          <div className={styles.content}>
            {customPrivacy ? (
              <div
                className={styles.markdownBody}
                dangerouslySetInnerHTML={{ __html: marked.parse(customPrivacy, { async: false }) as string }}
              />
            ) : (
              DEFAULT_PRIVACY
            )}
          </div>
          <p className={styles.footerLinks}>
            <Link to="/privacy">Privacy Policy</Link>
            <span className={styles.footerSep} aria-hidden />
            <Link to="/terms">Terms of Service</Link>
            <span className={styles.footerSep} aria-hidden />
            <Link to="/contact">Contact</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
