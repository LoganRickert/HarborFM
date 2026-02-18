import styles from '../../../pages/EpisodeEditor.module.css';
import { AddSilenceTrimsConfirmDialog } from '../dialogs/AddSilenceTrimsConfirmDialog';

export interface SegmentFunctionsTabProps {
  onAddSilenceTrimsClick: () => void;
  addSilenceTrimsConfirmOpen: boolean;
  onAddSilenceTrimsConfirmOpenChange: (open: boolean) => void;
  onAddSilenceTrimsConfirm: () => void;
  addSilenceTrimsDisabled?: boolean;
  onRemoveSilence: () => void;
  onNoiseSuppression: () => void;
  removingSilence: boolean;
  applyingNoiseSuppression: boolean;
  trimError: string | null;
}

export function SegmentFunctionsTab({
  onAddSilenceTrimsClick,
  addSilenceTrimsConfirmOpen,
  onAddSilenceTrimsConfirmOpenChange,
  onAddSilenceTrimsConfirm,
  addSilenceTrimsDisabled = false,
  onRemoveSilence,
  onNoiseSuppression,
  removingSilence,
  applyingNoiseSuppression,
  trimError,
}: SegmentFunctionsTabProps) {
  return (
    <div>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onAddSilenceTrimsClick}
        disabled={addSilenceTrimsDisabled || removingSilence || applyingNoiseSuppression}
        style={{ width: '100%', marginBottom: '1rem' }}
        aria-label="Add silence trims"
      >
        Add Silence Trims
      </button>
      <h3 className={styles.dialogDescription} style={{ marginBottom: '0.5rem', fontWeight: 600 }}>
        Server Functions
      </h3>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onRemoveSilence}
        disabled={removingSilence || applyingNoiseSuppression}
        style={{ width: '100%', marginBottom: '0.5rem' }}
        aria-label="Server remove silence from segment"
      >
        {removingSilence ? 'Removing...' : 'Server Remove Silence'}
      </button>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onNoiseSuppression}
        disabled={removingSilence || applyingNoiseSuppression}
        style={{ width: '100%' }}
        aria-label="Apply noise suppression to segment"
      >
        {applyingNoiseSuppression ? 'Applying...' : 'Noise Suppression'}
      </button>
      {trimError && (
        <p className={`${styles.error} ${styles.rateLimitError}`} role="alert">
          {trimError}
        </p>
      )}
      <AddSilenceTrimsConfirmDialog
        open={addSilenceTrimsConfirmOpen}
        onOpenChange={onAddSilenceTrimsConfirmOpenChange}
        onConfirm={onAddSilenceTrimsConfirm}
      />
    </div>
  );
}
