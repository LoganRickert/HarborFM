import { TestBlockProps } from '../../types/settings';
import styles from './TestBlock.module.css';

export function TestBlock({
  testMutation,
  onTest,
  disabled = false,
  successMessage,
  testLabel = 'Test',
}: TestBlockProps) {
  const isSuccess = testMutation.data?.ok === true;
  const resultMessage =
    testMutation.data?.ok === true
      ? successMessage
      : testMutation.data?.error ?? testMutation.error?.message ?? 'Connection failed';

  return (
    <div className={styles.testBlock}>
      {(testMutation.data != null || testMutation.error != null) && (
        <div
          className={isSuccess ? styles.noticeSuccess : styles.noticeError}
          role="status"
          aria-live="polite"
        >
          <span className={styles.noticeTitle}>{isSuccess ? 'Success' : 'Error'}</span>
          <p className={styles.noticeBody}>{resultMessage}</p>
        </div>
      )}
      <div className={styles.testRow}>
        <button
          type="button"
          className={styles.testBtn}
          onClick={onTest}
          disabled={disabled || testMutation.isPending}
        >
          {testMutation.isPending ? 'Testing...' : testLabel}
        </button>
      </div>
    </div>
  );
}
