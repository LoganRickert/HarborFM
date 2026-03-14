import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSegmentTranscript,
  removeSilenceFromSegment,
  applyNoiseSuppressionToSegment,
  updateSegment,
} from '../../api/segments';
import type { EpisodeSegment } from '../../api/segments';
import { getLlmAvailable, askLlm } from '../../api/llm';
import { parseSrt, parseSrtTimeToSeconds } from './utils/srt';
import { X, Save } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type { WaveformData } from '../../pages/EpisodeEditor/WaveformCanvas';
import sharedStyles from '../PodcastDetail/shared.module.css';
import styles from '../../pages/EpisodeEditor.module.css';
import { useSegmentTranscript } from './hooks/useSegmentTranscript';
import { useSegmentEdit } from './hooks/useSegmentEdit';
import { useTranscriptTrimActions } from './hooks/useTranscriptTrimActions';
import { SegmentEditTab } from './tabs/SegmentEditTab';
import { SegmentFunctionsTab } from './tabs/SegmentFunctionsTab';
import { SegmentTranscriptTab } from './tabs/SegmentTranscriptTab';
import { SegmentAskTab } from './tabs/SegmentAskTab';
import { RemoveSilenceConfirmDialog } from './dialogs/RemoveSilenceConfirmDialog';
import { NoiseSuppressionConfirmDialog } from './dialogs/NoiseSuppressionConfirmDialog';
import { SegmentCloseConfirmDialog } from './dialogs/SegmentCloseConfirmDialog';
import { RemoveMarkerConfirmDialog } from './dialogs/RemoveMarkerConfirmDialog';
import { detectSilencePeriods } from './utils/detectSilence';
import { mergeTrimRanges, getTrimContainingEntry } from './utils/transcriptTrimUtils';

export type SegmentModalTab = 'edit' | 'functions' | 'transcript' | 'ask';

export interface SegmentModalProps {
  episodeId: string;
  segment: EpisodeSegment;
  segmentId: string;
  segmentName: string;
  segmentAudioPath?: string | null;
  segmentWaveformData?: WaveformData | null;
  asrAvailable: boolean;
  ownerCanTranscribe?: boolean;
  initialTab?: SegmentModalTab;
  onClose: () => void;
}

function isRateLimitMessage(msg: string | null): boolean {
  return (msg || '').toLowerCase().includes('too many requests');
}

export function SegmentModal({
  episodeId,
  segment,
  segmentId,
  segmentName,
  segmentAudioPath,
  segmentWaveformData,
  asrAvailable,
  ownerCanTranscribe = true,
  initialTab = 'transcript',
  onClose,
}: SegmentModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SegmentModalTab>(initialTab);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [addSilenceTrimsConfirmOpen, setAddSilenceTrimsConfirmOpen] = useState(false);
  const [removeSilenceConfirmOpen, setRemoveSilenceConfirmOpen] = useState(false);
  const [noiseSuppressionConfirmOpen, setNoiseSuppressionConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [removeMarkerConfirmIndex, setRemoveMarkerConfirmIndex] = useState<number | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const [askResponse, setAskResponse] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const transcript = useSegmentTranscript(episodeId, segmentId, segmentAudioPath);

  const edit = useSegmentEdit(episodeId, segment, segmentWaveformData, {
    initialTimelineMode: 'drag',
    isEditTabVisible: activeTab === 'edit',
  });

  const trimActions = useTranscriptTrimActions({
    srtEntries: transcript.srtEntries,
    trimRanges: edit.trimRanges,
    setTrimRanges: edit.setTrimRanges,
  });

  const saveMutation = useMutation({
    mutationFn: async (overrides?: { audioEq?: { lowDb: number; midDb: number; highDb: number } }) => {
      const audioEqToSave = overrides?.audioEq ?? edit.appliedAudioEq;
      const audioEqPayload =
        audioEqToSave.lowDb === 0 && audioEqToSave.midDb === 0 && audioEqToSave.highDb === 0
          ? null
          : audioEqToSave;
      const shouldSave = overrides?.audioEq !== undefined || edit.hasEditUnsavedChanges;
      if (shouldSave) {
        await updateSegment(episodeId, segmentId, {
          trimRanges: mergeTrimRanges(edit.trimRanges),
          markers: edit.markers,
          audioEq: audioEqPayload,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
    },
  });

  const hasAnyUnsavedChanges = edit.hasEditUnsavedChanges;

  const { data: llmData } = useQuery({
    queryKey: ['settings', 'llm-available'],
    queryFn: () => getLlmAvailable(),
  });
  const llmAvailable = llmData?.available ?? false;

  const askMutation = useMutation({
    mutationFn: ({
      transcript: t,
      question,
      context,
    }: {
      transcript: string;
      question: string;
      context?: { segmentName?: string; durationSec?: number; markers?: typeof edit.markers };
    }) => askLlm(t, question, context),
    onSuccess: (data) => {
      setAskResponse(data.response);
      setAskError(null);
    },
    onError: (err) => {
      setAskResponse(null);
      setAskError(err instanceof Error ? err.message : 'Failed to get response');
    },
  });

  function extractTextFromSrtForAsk(srtText: string, trimRanges: Array<[number, number]>): string {
    if (!srtText || !srtText.includes('-->')) return srtText;
    const entries = parseSrt(srtText);
    const filtered = entries.filter((e) => {
      const startSec = parseSrtTimeToSeconds(e.start);
      const endSec = parseSrtTimeToSeconds(e.end);
      return getTrimContainingEntry(startSec, endSec, trimRanges) < 0;
    });
    return filtered.map((e) => e.text).join(' ');
  }

  function handleAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = askQuestion.trim();
    if (!q) return;
    const transcriptText = transcript.text
      ? extractTextFromSrtForAsk(transcript.text, edit.trimRanges)
      : '';
    askMutation.mutate({
      transcript: transcriptText,
      question: q,
      context: {
        segmentName: segmentName || undefined,
        durationSec: edit.durationSec > 0 ? edit.durationSec : undefined,
        markers: edit.markers?.length ? edit.markers : undefined,
      },
    });
  }

  const [removingSilence, setRemovingSilence] = useState(false);
  const [applyingNoiseSuppression, setApplyingNoiseSuppression] = useState(false);

  useEffect(() => {
    if (activeTab === 'edit') setTrimError(null);
  }, [activeTab]);

  const hasTranscript = !transcript.loading && transcript.text != null && transcript.text.trim() !== '';

  useEffect(() => {
    if (!asrAvailable && activeTab === 'transcript') setActiveTab('edit');
  }, [asrAvailable, activeTab]);

  useEffect(() => {
    if (activeTab === 'ask' && (!llmAvailable || !hasTranscript)) {
      setActiveTab(asrAvailable ? 'transcript' : 'edit');
    }
  }, [activeTab, llmAvailable, asrAvailable, hasTranscript]);

  function handleCloseRequest(open: boolean) {
    if (open) return;
    if (hasAnyUnsavedChanges) {
      setCloseConfirmOpen(true);
    } else {
      onClose();
    }
  }

  function handleConfirmDiscard() {
    setCloseConfirmOpen(false);
    onClose();
  }

  function handleAddSilenceTrimsConfirm() {
    setAddSilenceTrimsConfirmOpen(false);
    const newRanges = detectSilencePeriods(edit.waveformData, edit.durationSec, 1);
    if (newRanges.length > 0) {
      edit.setTrimRanges(edit.mergeTrimRanges([...edit.trimRanges, ...newRanges]));
    }
  }

  const editPanel = (
    <div className={`${sharedStyles.editDetailsTabPanel} ${sharedStyles.editDetailsTabPanelActive}`}>
      <SegmentEditTab
        segment={segment}
        durationSec={edit.durationSec}
        waveformData={edit.waveformData}
        trimRanges={edit.trimRanges}
        markers={edit.markers}
        selection={edit.selection}
        timelineMode={edit.timelineMode}
        selectedMarkerIndex={edit.selectedMarkerIndex}
        viewStartSec={edit.viewStartSec}
        viewEndSec={edit.viewEndSec}
        isPlaying={edit.isPlaying}
        currentTime={edit.currentTime}
        trimError={trimError}
        segmentEditAudioRef={edit.segmentEditAudioRef}
        onTogglePlay={edit.toggleSegmentPlay}
        onSeek={edit.handleSeek}
        onViewChange={edit.handleViewChange}
        onTrimRangesChange={edit.setTrimRanges}
        onSelectionChange={edit.setSelection}
        onAddMarker={edit.handleAddMarker}
        onRemoveTrimRange={edit.handleRemoveTrimRange}
        onMarkerTitleChange={edit.handleMarkerTitleChange}
        onMarkerColorChange={edit.handleMarkerColorChange}
        onMarkerTypeChange={edit.handleMarkerTypeChange}
        onMarkerDone={edit.handleMarkerDone}
        onRequestRemoveMarker={(index) => setRemoveMarkerConfirmIndex(index)}
        markerDraft={edit.markerDraft}
        onTimelineModeChange={edit.setTimelineMode}
        onSelectedMarkerIndexChange={edit.setSelectedMarkerIndex}
        onZoomIn={edit.handleZoomIn}
        onZoomOut={edit.handleZoomOut}
        onBackToStart={edit.handleBackToStart}
        onFastForwardToggle={edit.handleFastForwardToggle}
        isFastForward={edit.playbackRate === 2}
        audioEditActive={edit.audioEditActive}
        draftAudioEq={edit.draftAudioEq}
        appliedAudioEq={edit.appliedAudioEq}
        onDraftAudioEqChange={edit.setDraftAudioEq}
        onAudioEditActiveChange={edit.setAudioEditActive}
        onApplyAudioEq={() => {
          edit.setAppliedAudioEq(edit.draftAudioEq);
          edit.setAudioEditActive(false);
          saveMutation.mutate({ audioEq: edit.draftAudioEq });
        }}
        onCancelAudioEq={() => {
          edit.setDraftAudioEq(edit.appliedAudioEq);
          edit.setAudioEditActive(false);
        }}
      />
    </div>
  );

  const functionsPanel = (
    <div className={`${sharedStyles.editDetailsTabPanel} ${sharedStyles.editDetailsTabPanelActive}`}>
      <SegmentFunctionsTab
        onAddSilenceTrimsClick={() => setAddSilenceTrimsConfirmOpen(true)}
        addSilenceTrimsConfirmOpen={addSilenceTrimsConfirmOpen}
        onAddSilenceTrimsConfirmOpenChange={setAddSilenceTrimsConfirmOpen}
        onAddSilenceTrimsConfirm={handleAddSilenceTrimsConfirm}
        addSilenceTrimsDisabled={!edit.waveformData?.data?.length || edit.durationSec <= 0}
        onRemoveSilence={() => setRemoveSilenceConfirmOpen(true)}
        onNoiseSuppression={() => setNoiseSuppressionConfirmOpen(true)}
        removingSilence={removingSilence}
        applyingNoiseSuppression={applyingNoiseSuppression}
        trimError={trimError}
      />
    </div>
  );

  const transcriptPanel = (
    <div className={`${sharedStyles.editDetailsTabPanel} ${sharedStyles.editDetailsTabPanelActive}`}>
      <SegmentTranscriptTab
        text={transcript.text}
        loading={transcript.loading}
        notFound={transcript.notFound}
        generateError={transcript.generateError}
        generating={transcript.generating}
        srtEntries={transcript.srtEntries}
        asrAvailable={asrAvailable}
        ownerCanTranscribe={ownerCanTranscribe ?? true}
        playingEntryIndex={transcript.playingEntryIndex ?? null}
        transcriptAudioRef={transcript.transcriptAudioRef}
        trimRanges={edit.trimRanges}
        onGenerate={transcript.handleGenerate}
        onDeleteEntry={trimActions.handleSoftDeleteEntry}
        onPlayEntry={transcript.handlePlayEntry!}
        onAdjustTime={transcript.adjustTranscriptTime}
        onRestoreEntry={trimActions.handleRestoreEntry}
        isRateLimitMessage={isRateLimitMessage}
        deleteMutationPending={false}
      />
    </div>
  );

  const askPanel = (
    <div className={`${sharedStyles.editDetailsTabPanel} ${sharedStyles.editDetailsTabPanelActive}`}>
      {!transcript.loading && transcript.text != null && (
        <SegmentAskTab
          askQuestion={askQuestion}
          onAskQuestionChange={setAskQuestion}
          onAskSubmit={handleAskSubmit}
          askResponse={askResponse}
          askError={askError}
          isRateLimitMessage={isRateLimitMessage}
          askMutationPending={askMutation.isPending}
        />
      )}
    </div>
  );

  return (
    <>
      <Dialog.Root open onOpenChange={handleCloseRequest}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.segmentTranscriptDialog} ${sharedStyles.dialogContentScrollable} ${sharedStyles.dialogShowDetailsGrid}`}
            aria-describedby={undefined}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>{segmentName}</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className={sharedStyles.editDetailsTabSelectWrap}>
              <select
                className={sharedStyles.editDetailsTabSelect}
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value as SegmentModalTab)}
                aria-label="Jump to section"
              >
                <option value="edit">Edit</option>
                <option value="functions">Functions</option>
                <option value="transcript" disabled={!asrAvailable}>Transcript</option>
                <option value="ask" disabled={!llmAvailable}>Ask</option>
              </select>
            </div>
            <div
              className={sharedStyles.editDetailsTabs}
              role="tablist"
              aria-label="Segment sections"
              onKeyDown={(e) => {
                const tabs: SegmentModalTab[] = ['edit', 'functions', 'transcript', 'ask'];
                const i = tabs.indexOf(activeTab);
                if (e.key === 'ArrowLeft' && i > 0) {
                  e.preventDefault();
                  setActiveTab(tabs[i - 1]!);
                } else if (e.key === 'ArrowRight' && i < tabs.length - 1) {
                  e.preventDefault();
                  setActiveTab(tabs[i + 1]!);
                }
              }}
            >
              {(['edit', 'functions', 'transcript', 'ask'] as const).map((tab) => {
                const transcriptDisabled = tab === 'transcript' && !asrAvailable;
                const askDisabled = tab === 'ask' && !llmAvailable;
                const isDisabled = transcriptDisabled || askDisabled;
                return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  tabIndex={activeTab === tab ? 0 : -1}
                  aria-selected={activeTab === tab}
                  aria-disabled={isDisabled}
                  className={`${sharedStyles.editDetailsTab} ${
                    activeTab === tab ? sharedStyles.editDetailsTabActive : ''
                  } ${isDisabled ? sharedStyles.editDetailsTabDisabled : ''}`}
                  onClick={() => !isDisabled && setActiveTab(tab)}
                >
                  {tab === 'edit'
                    ? 'Edit'
                    : tab === 'functions'
                      ? 'Functions'
                      : tab === 'transcript'
                        ? 'Transcript'
                        : 'Ask'}
                </button>
              );
              })}
            </div>
            <div className={`${styles.segmentModalBody} ${activeTab === 'edit' ? styles.segmentModalBodyEdit : ''}`}>
              {activeTab === 'edit' && <div className={styles.segmentModalEditWrap}>{editPanel}</div>}
              {activeTab === 'functions' && functionsPanel}
              {activeTab === 'transcript' && transcriptPanel}
              {activeTab === 'ask' && askPanel}
            </div>
            {(activeTab !== 'edit' || edit.selectedMarkerIndex == null) && (
            <div className={`${sharedStyles.dialogFooter} ${sharedStyles.dialogFooterCancelLeft}`}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden />
                  Close
                </button>
              </Dialog.Close>
              <div style={{ flex: 1 }} />
              {hasAnyUnsavedChanges && (
                <button
                  type="button"
                  className={sharedStyles.dialogConfirm}
                  onClick={() => saveMutation.mutate(undefined)}
                  disabled={saveMutation.isPending}
                  aria-label="Save edits"
                >
                  <Save size={18} strokeWidth={2} aria-hidden />
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <RemoveSilenceConfirmDialog
        open={removeSilenceConfirmOpen}
        onOpenChange={setRemoveSilenceConfirmOpen}
        onConfirm={() => {
          setRemoveSilenceConfirmOpen(false);
          setRemovingSilence(true);
          setTrimError(null);
          removeSilenceFromSegment(episodeId, segmentId, 1.5, -55)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
              return getSegmentTranscript(episodeId, segmentId).then((r) => {
                transcript.setText(r.text ?? null);
              }).catch(() => {
                transcript.setText(null);
              });
            })
            .catch((err) => setTrimError(err?.message ?? 'Failed to remove silence'))
            .finally(() => setRemovingSilence(false));
        }}
        loading={removingSilence}
      />

      <NoiseSuppressionConfirmDialog
        open={noiseSuppressionConfirmOpen}
        onOpenChange={setNoiseSuppressionConfirmOpen}
        onConfirm={() => {
          setNoiseSuppressionConfirmOpen(false);
          setApplyingNoiseSuppression(true);
          setTrimError(null);
          applyNoiseSuppressionToSegment(episodeId, segmentId, -45)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
              return getSegmentTranscript(episodeId, segmentId).then((r) => {
                transcript.setText(r.text ?? null);
              }).catch(() => {
                transcript.setText(null);
              });
            })
            .catch((err) => setTrimError(err?.message ?? 'Failed to apply noise suppression'))
            .finally(() => setApplyingNoiseSuppression(false));
        }}
        loading={applyingNoiseSuppression}
      />

      <SegmentCloseConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        onDiscard={handleConfirmDiscard}
      />

      <RemoveMarkerConfirmDialog
        open={removeMarkerConfirmIndex != null}
        onOpenChange={(open) => !open && setRemoveMarkerConfirmIndex(null)}
        onConfirm={() => {
          if (removeMarkerConfirmIndex != null) {
            edit.handleRemoveMarker(removeMarkerConfirmIndex);
            setRemoveMarkerConfirmIndex(null);
          }
        }}
      />
    </>
  );
}
