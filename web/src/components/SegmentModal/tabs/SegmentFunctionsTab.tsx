import {
  Scissors,
  Eraser,
  Volume2,
  SplitSquareHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import styles from '../../../pages/EpisodeEditor.module.css';
import { AddSilenceTrimsConfirmDialog } from '../dialogs/AddSilenceTrimsConfirmDialog';
import { ClearAllTrimsConfirmDialog } from '../dialogs/ClearAllTrimsConfirmDialog';

export interface SegmentFunctionsTabProps {
  onAddSilenceTrimsClick: () => void;
  addSilenceTrimsConfirmOpen: boolean;
  onAddSilenceTrimsConfirmOpenChange: (open: boolean) => void;
  onAddSilenceTrimsConfirm: () => void;
  addSilenceTrimsDisabled?: boolean;
  onClearAllTrimsClick: () => void;
  clearAllTrimsConfirmOpen: boolean;
  onClearAllTrimsConfirmOpenChange: (open: boolean) => void;
  onClearAllTrimsConfirm: () => void;
  clearAllTrimsDisabled?: boolean;
  clearingAllTrims?: boolean;
  onRemoveSilence: () => void;
  onNoiseSuppression: () => void;
  onSegmentSplit: () => void;
  onRestoreOriginalMix: () => void;
  restoreOriginalMixDisabled?: boolean;
  removingSilence: boolean;
  applyingNoiseSuppression: boolean;
  splittingSegment: boolean;
  restoringOriginalMix: boolean;
  trimError: string | null;
}

export function SegmentFunctionsTab({
  onAddSilenceTrimsClick,
  addSilenceTrimsConfirmOpen,
  onAddSilenceTrimsConfirmOpenChange,
  onAddSilenceTrimsConfirm,
  addSilenceTrimsDisabled = false,
  onClearAllTrimsClick,
  clearAllTrimsConfirmOpen,
  onClearAllTrimsConfirmOpenChange,
  onClearAllTrimsConfirm,
  clearAllTrimsDisabled = false,
  clearingAllTrims = false,
  onRemoveSilence,
  onNoiseSuppression,
  onSegmentSplit,
  onRestoreOriginalMix,
  restoreOriginalMixDisabled = false,
  removingSilence,
  applyingNoiseSuppression,
  splittingSegment,
  restoringOriginalMix,
  trimError,
}: SegmentFunctionsTabProps) {
  const serverBusy =
    removingSilence ||
    applyingNoiseSuppression ||
    splittingSegment ||
    restoringOriginalMix ||
    clearingAllTrims;

  return (
    <div className={styles.functionsTab}>
      <section className={styles.functionsSection} aria-labelledby="segment-functions-trims">
        <h3 id="segment-functions-trims" className={styles.functionsSectionLabel}>
          Trims
        </h3>
        <div className={styles.manageSegmentActions}>
          <button
            type="button"
            className={styles.manageSegmentAction}
            onClick={onAddSilenceTrimsClick}
            disabled={addSilenceTrimsDisabled || serverBusy}
            aria-label="Add silence trims"
          >
            <Scissors size={18} aria-hidden />
            <span>Add Silence Trims</span>
            <span className={styles.manageSegmentActionHint}>
              Mark quiet stretches as non-destructive trims
            </span>
          </button>
          <button
            type="button"
            className={styles.manageSegmentAction}
            onClick={onClearAllTrimsClick}
            disabled={clearAllTrimsDisabled || serverBusy}
            aria-label="Clear all trims"
          >
            <Trash2 size={18} aria-hidden />
            <span>{clearingAllTrims ? 'Clearing...' : 'Clear All Trims'}</span>
            <span className={styles.manageSegmentActionHint}>
              Remove every trim range from this section
            </span>
          </button>
        </div>
      </section>

      <section className={styles.functionsSection} aria-labelledby="segment-functions-server">
        <h3 id="segment-functions-server" className={styles.functionsSectionLabel}>
          Server Functions
        </h3>
        <div className={styles.manageSegmentActions}>
          <button
            type="button"
            className={styles.manageSegmentAction}
            onClick={onRemoveSilence}
            disabled={serverBusy}
            aria-label="Remove silence from segment audio"
          >
            <Eraser size={18} aria-hidden />
            <span>{removingSilence ? 'Removing...' : 'Remove Silence'}</span>
            <span className={styles.manageSegmentActionHint}>
              Rewrite the audio file without long silent gaps
            </span>
          </button>
          <button
            type="button"
            className={styles.manageSegmentAction}
            onClick={onNoiseSuppression}
            disabled={serverBusy}
            aria-label="Apply noise suppression to segment"
          >
            <Volume2 size={18} aria-hidden />
            <span>{applyingNoiseSuppression ? 'Applying...' : 'Noise Suppression'}</span>
            <span className={styles.manageSegmentActionHint}>
              Reduce background noise on the mix
            </span>
          </button>
          <button
            type="button"
            className={styles.manageSegmentAction}
            onClick={onSegmentSplit}
            disabled={serverBusy}
            aria-label="Split segment into two"
          >
            <SplitSquareHorizontal size={18} aria-hidden />
            <span>{splittingSegment ? 'Splitting...' : 'Segment Split'}</span>
            <span className={styles.manageSegmentActionHint}>
              Cut this section into two at a chosen time
            </span>
          </button>
          <button
            type="button"
            className={styles.manageSegmentAction}
            onClick={onRestoreOriginalMix}
            disabled={serverBusy || restoreOriginalMixDisabled}
            title={
              restoreOriginalMixDisabled
                ? 'Original multitrack layout is not available for this section'
                : undefined
            }
            aria-label="Restore original mix from multitrack layout"
          >
            <RotateCcw size={18} aria-hidden />
            <span>{restoringOriginalMix ? 'Restoring...' : 'Restore Original Mix'}</span>
            <span className={styles.manageSegmentActionHint}>
              Remake the mix from the original multitrack layout
            </span>
          </button>
        </div>
      </section>

      {trimError && (
        <p className={styles.manageSegmentError} role="alert">
          {trimError}
        </p>
      )}

      <AddSilenceTrimsConfirmDialog
        open={addSilenceTrimsConfirmOpen}
        onOpenChange={onAddSilenceTrimsConfirmOpenChange}
        onConfirm={onAddSilenceTrimsConfirm}
      />
      <ClearAllTrimsConfirmDialog
        open={clearAllTrimsConfirmOpen}
        onOpenChange={onClearAllTrimsConfirmOpenChange}
        onConfirm={onClearAllTrimsConfirm}
        loading={clearingAllTrims}
      />
    </div>
  );
}
