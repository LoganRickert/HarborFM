import localStyles from './Exports.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface ExportDeployResultsProps {
  results?: Array<{
    export_id: string;
    name: string;
    status: string;
    uploaded?: number;
    skipped?: number;
    errors?: string[];
  }>;
  error?: Error | null;
  isSuccess: boolean;
  isError: boolean;
}

export function ExportDeployResults({ results, error, isSuccess, isError }: ExportDeployResultsProps) {
  if (!isSuccess && !isError) return null;

  return (
    <div className={styles.deployAllRow}>
      {isSuccess && results && (
        <div className={styles.deployAllResults}>
          {results.map((r) => (
            <p key={r.export_id} className={r.status === 'success' ? styles.success : styles.error}>
              {r.name}: {r.status === 'success'
                ? `Uploaded ${r.uploaded} file(s)${r.skipped && r.skipped > 0 ? `, ${r.skipped} unchanged` : ''}.`
                : (r.errors ?? ['Failed']).join('; ')}
            </p>
          ))}
        </div>
      )}
      {isError && (
        <p className={styles.error}>{error?.message}</p>
      )}
    </div>
  );
}
