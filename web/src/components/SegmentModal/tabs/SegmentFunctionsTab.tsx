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
  onSegmentSplit: () => void;
  removingSilence: boolean;
  applyingNoiseSuppression: boolean;
  splittingSegment: boolean;
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
  onSegmentSplit,
  removingSilence,
  applyingNoiseSuppression,
  splittingSegment,
  trimError,
}: SegmentFunctionsTabProps) {
  const serverBusy = removingSilence || applyingNoiseSuppression || splittingSegment;
  return (
    <div>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onAddSilenceTrimsClick}
        disabled={addSilenceTrimsDisabled || serverBusy}
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
        disabled={serverBusy}
        style={{ width: '100%', marginBottom: '0.5rem' }}
        aria-label="Server remove silence from segment"
      >
        {removingSilence ? 'Removing...' : 'Server Remove Silence'}
      </button>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onNoiseSuppression}
        disabled={serverBusy}
        style={{ width: '100%', marginBottom: '0.5rem' }}
        aria-label="Apply noise suppression to segment"
      >
        {applyingNoiseSuppression ? 'Applying...' : 'Noise Suppression'}
      </button>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onSegmentSplit}
        disabled={serverBusy}
        style={{ width: '100%' }}
        aria-label="Split segment into two"
      >
        {splittingSegment ? 'Splitting...' : 'Segment Split'}
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
