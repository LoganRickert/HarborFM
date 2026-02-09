import { Link } from 'react-router-dom';
import styles from './Terms.module.css';

export function Terms() {
  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Link to="/login" className={styles.back}>
              ← Back to sign in
            </Link>
            <h1 className={styles.title}>Terms of Service</h1>
            <p className={styles.updated}>Last updated: February 2026</p>
          </div>
          <div className={styles.content}>
            <p>
              Welcome to HarborFM. By using this service, you agree to these terms. HarborFM is open-source software;
              this instance is operated by the server administrator.
            </p>

            <h2>Use of the service</h2>
            <p>
              You must use the service in compliance with applicable laws and not for illegal, harmful, or abusive
              purposes. You are responsible for the content you create and for keeping your account credentials
              secure.
            </p>

            <h2>Account and content</h2>
            <p>
              You may need to register an account to use certain features. The administrator may disable registration,
              suspend accounts, or remove content that violates these terms or applicable law. We may retain data as
              needed for the operation of the service or legal obligations.
            </p>

            <h2>Intellectual property</h2>
            <p>
              You retain rights to the content you create. By uploading or publishing content, you grant the operator
              the rights necessary to host, serve, and deliver your content (e.g. podcasts and RSS). HarborFM software
              is licensed under its project license; see the repository for details.
            </p>

            <h2>Disclaimer</h2>
            <p>
              The service is provided “as is.” The operator is not liable for any damages arising from your use of
              the service or any third-party services you connect (e.g. export providers). Availability and features may
              change.
            </p>

            <h2>Changes</h2>
            <p>
              These terms may be updated from time to time. The “Last updated” date will be revised when we do.
              Continued use after changes constitutes acceptance of the updated terms.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
