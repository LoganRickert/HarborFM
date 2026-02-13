import { GeoliteSectionProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

export function GeoliteSection({
  form,
  onFormChange,
  geoliteTestMutation,
  geoliteCheckMutation,
  geoliteUpdateMutation,
  onGeoliteTest,
  onGeoliteCheck,
  onGeoliteUpdate,
}: GeoliteSectionProps) {
  return (
    <SectionCard
      title="GeoLite2 / MaxMind"
      subtitle={
        <>
          Optional. Create a free <a
            href="https://www.maxmind.com/en/geolite2/signup"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            GeoLite2 account
          </a>. When Account ID and License Key are set and saved, the server will run the GeoIP Update program
          to download GeoLite2-Country and GeoLite2-City into the data folder. Requires <a
            href="https://github.com/maxmind/geoipupdate/releases"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            geoipupdate
          </a> to be installed on the server.
        </>
      }
    >
      <label className={styles.label}>
        MaxMind Account ID
        <input
          type="text"
          className={styles.input}
          placeholder="123456"
          value={form.maxmind_account_id}
          onChange={(e) => onFormChange({ maxmind_account_id: e.target.value })}
          autoComplete="off"
        />
      </label>
      <label className={styles.label}>
        MaxMind License Key
        <input
          type="password"
          className={styles.input}
          placeholder={form.maxmind_license_key === '(set)' ? '(saved)' : 'Enter license key'}
          value={form.maxmind_license_key === '(set)' ? '' : form.maxmind_license_key}
          onChange={(e) => onFormChange({ maxmind_license_key: e.target.value })}
          autoComplete="off"
        />
      </label>
      <div className={styles.testBlock}>
        {(geoliteTestMutation.data != null || geoliteTestMutation.error != null) && (
          <div
            className={geoliteTestMutation.data?.ok ? styles.noticeSuccess : styles.noticeError}
            role="status"
            aria-live="polite"
          >
            <p className={styles.noticeBody}>
              {geoliteTestMutation.data?.ok
                ? 'MaxMind credentials are valid.'
                : (geoliteTestMutation.data?.error ?? geoliteTestMutation.error?.message ?? 'Test failed')}
            </p>
          </div>
        )}
        {(geoliteCheckMutation.data != null || geoliteCheckMutation.error != null) && (
          <div
            className={
              geoliteCheckMutation.data?.city || geoliteCheckMutation.data?.country
                ? styles.noticeSuccess
                : styles.noticeError
            }
            role="status"
            aria-live="polite"
          >
            {geoliteCheckMutation.data != null ? (
              <p className={styles.noticeBody}>
                {geoliteCheckMutation.data.city && geoliteCheckMutation.data.country
                  ? 'GeoLite2-City and GeoLite2-Country databases are present.'
                  : geoliteCheckMutation.data.city
                    ? 'GeoLite2-City database is present. GeoLite2-Country is missing.'
                    : geoliteCheckMutation.data.country
                      ? 'GeoLite2-Country database is present. GeoLite2-City is missing.'
                      : 'No GeoLite2 database files found. Save Account ID and License Key, then run Update.'}
              </p>
            ) : (
              <p className={styles.noticeBody}>{geoliteCheckMutation.error?.message ?? 'Check failed'}</p>
            )}
          </div>
        )}
        {(geoliteUpdateMutation.data != null || geoliteUpdateMutation.error != null) && (
          <div
            className={geoliteUpdateMutation.data?.ok ? styles.noticeSuccess : styles.noticeError}
            role="status"
            aria-live="polite"
          >
            <p className={styles.noticeBody}>
              {geoliteUpdateMutation.data?.ok
                ? 'Databases updated successfully. Reader refreshed.'
                : (geoliteUpdateMutation.data?.error ?? geoliteUpdateMutation.error?.message ?? 'Update failed')}
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className={styles.testBtn}
            onClick={onGeoliteTest}
            disabled={
              !form.maxmind_account_id.trim() ||
              (form.maxmind_license_key !== '(set)' && !form.maxmind_license_key.trim()) ||
              geoliteTestMutation.isPending
            }
            aria-busy={geoliteTestMutation.isPending}
          >
            {geoliteTestMutation.isPending ? 'Testing...' : 'Test'}
          </button>
          <button
            type="button"
            className={styles.testBtn}
            onClick={onGeoliteCheck}
            disabled={
              !form.maxmind_account_id.trim() ||
              (form.maxmind_license_key !== '(set)' && !form.maxmind_license_key.trim()) ||
              geoliteCheckMutation.isPending
            }
            aria-busy={geoliteCheckMutation.isPending}
          >
            {geoliteCheckMutation.isPending ? 'Checking...' : 'Check'}
          </button>
          <button
            type="button"
            className={styles.testBtn}
            onClick={onGeoliteUpdate}
            disabled={
              !form.maxmind_account_id.trim() ||
              (form.maxmind_license_key !== '(set)' && !form.maxmind_license_key.trim()) ||
              geoliteUpdateMutation.isPending
            }
            aria-busy={geoliteUpdateMutation.isPending}
          >
            {geoliteUpdateMutation.isPending ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
