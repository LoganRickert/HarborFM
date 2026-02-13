import type { UseMutationResult } from '@tanstack/react-query';
import { Rss, FlaskConical, Pencil, Trash2 } from 'lucide-react';
import type { Export, ExportMode } from '../../api/exports';
import { EXPORT_MODE_LABELS } from '../../api/exports';
import localStyles from './Exports.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface ExportsListProps {
  exports: Export[];
  readOnly: boolean;
  testingId: string | null;
  testMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, string, unknown>;
  onTest: (exportId: string) => void;
  onEdit: (exp: Export) => void;
  onDelete: (exp: Export) => void;
  isDeleting: boolean;
}

export function ExportsList({
  exports,
  readOnly,
  testingId,
  testMutation,
  onTest,
  onEdit,
  onDelete,
  isDeleting,
}: ExportsListProps) {
  return (
    <ul className={styles.exportList}>
      {exports.map((exp) => {
        const publicBase = (exp.public_base_url ?? '').trim().replace(/\/$/, '');
        const exportPrefix = (exp.prefix ?? '').trim().replace(/^\/|\/$/g, '');
        const feedUrl = publicBase
          ? (exportPrefix ? `${publicBase}/${exportPrefix}/feed.xml` : `${publicBase}/feed.xml`)
          : null;
        const isTesting = testingId === exp.id;
        return (
          <li key={exp.id} className={styles.exportCard}>
            <div className={styles.exportCardRow}>
              <div className={styles.exportCardMeta}>
                <strong>{exp.name}</strong>
                <span className={styles.exportModeBadge}>{EXPORT_MODE_LABELS[exp.mode as ExportMode] ?? exp.mode}</span>
              </div>
              <div className={styles.exportCardActions}>
                <button
                  type="button"
                  className={styles.cancel}
                  onClick={() => feedUrl && window.open(feedUrl, '_blank', 'noopener,noreferrer')}
                  disabled={!feedUrl}
                  title={feedUrl ? 'Open RSS feed' : 'Set public base URL to open RSS'}
                  aria-label={`Open RSS feed for ${exp.name}`}
                >
                  <Rss size={16} aria-hidden />
                  RSS
                </button>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={() => onTest(exp.id)}
                      disabled={isTesting}
                      aria-label={`Test connection for ${exp.name}`}
                    >
                      <FlaskConical size={16} aria-hidden />
                      {isTesting ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={() => onEdit(exp)}
                      aria-label={`Edit ${exp.name}`}
                    >
                      <Pencil size={16} aria-hidden />
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.exportDeleteBtn}
                      onClick={() => onDelete(exp)}
                      disabled={isDeleting}
                      aria-label={`Delete ${exp.name}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </>
                )}
              </div>
            </div>
            {testMutation.variables === exp.id && testMutation.isSuccess && testMutation.data?.ok === true && (
              <p className={`${styles.success} ${styles.exportResult}`}>Connection OK.</p>
            )}
            {testMutation.variables === exp.id && testMutation.isSuccess && testMutation.data?.ok === false && (
              <p className={`${styles.error} ${styles.exportResult}`}>{testMutation.data?.error || 'Test failed'}</p>
            )}
            {testMutation.isError && testMutation.variables === exp.id && (
              <p className={`${styles.error} ${styles.exportResult}`}>{testMutation.error?.message}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
