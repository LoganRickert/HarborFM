import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Upload } from 'lucide-react';
import { getEpisodeTranscript, updateEpisodeTranscript } from '../../api/segments';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeTranscriptModalProps {
  episodeId: string;
  onClose: () => void;
  /** If false, transcript is read-only (view only). */
  canEdit: boolean;
}

export function EpisodeTranscriptModal({
  episodeId,
  onClose,
  canEdit,
}: EpisodeTranscriptModalProps) {
  const [text, setText] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setEditValue(result);
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEpisodeTranscript(episodeId)
      .then((r) => {
        if (!cancelled) {
          setText(r.text);
          setEditValue(r.text);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load transcript';
          if (msg.includes('not found') || msg.includes('Not found') || (err as { status?: number })?.status === 404) {
            setText('');
            setEditValue('');
          } else {
            setError(msg);
            setText(null);
            setEditValue('');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [episodeId]);

  const updateMutation = useMutation({
    mutationFn: (newText: string) => updateEpisodeTranscript(episodeId, newText),
    onSuccess: (data) => {
      setText(data.text);
      setEditValue(data.text);
      queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
      onClose();
    },
  });

  const handleSave = () => {
    if (!canEdit) return;
    updateMutation.mutate(editValue);
  };

  const hasChanges = text != null && editValue !== text;
  const isSaving = updateMutation.isPending;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.episodeTranscriptDialog}`}
          aria-describedby="episode-transcript-description"
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Episode Transcript</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close" disabled={isSaving}>
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description id="episode-transcript-description" className={styles.dialogDescription}>
            {canEdit
              ? 'View and edit the transcript (SRT) for the final episode. Changes are saved to the file used for the public transcript.'
              : 'View the transcript for the final episode. Only owners and editors can edit.'}
          </Dialog.Description>
          <div className={styles.episodeTranscriptBody}>
            {loading && <p className={styles.episodeTranscriptStatus}>Loading…</p>}
            {error && (
              <div className={styles.episodeTranscriptErrorWrap}>
                <p className={styles.episodeTranscriptError} role="alert">{error}</p>
              </div>
            )}
            {!loading && !error && (
              <>
                {canEdit ? (
                  <>
                    <div className={styles.episodeTranscriptUploadRow}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".srt,text/plain,application/x-subrip"
                        style={{ display: 'none' }}
                        onChange={handleUploadFile}
                      />
                      <button
                        type="button"
                        className={styles.episodeTranscriptUploadBtn}
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Upload SRT file"
                      >
                        <Upload size={18} strokeWidth={2} aria-hidden />
                        Upload SRT file
                      </button>
                    </div>
                    <textarea
                      ref={transcriptRef}
                      className={styles.transcriptText}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder="Transcript (SRT format). Paste here or upload an SRT file above."
                      spellCheck={false}
                      aria-label="Transcript text"
                      rows={4}
                    />
                  </>
                ) : (
                  <pre className={styles.transcriptText}>{text ?? '(empty)'}</pre>
                )}
                {canEdit && (
                  <div className={`${styles.dialogActions} ${styles.episodeTranscriptDialogActions}`}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={onClose}
                      disabled={isSaving}
                      aria-label="Cancel"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.submit}
                      onClick={handleSave}
                      disabled={isSaving || !hasChanges}
                      aria-label="Save transcript"
                    >
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
