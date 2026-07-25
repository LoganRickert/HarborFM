import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Upload, X } from 'lucide-react';
import { listLibrary, type LibraryAsset } from '../../api/library';
import styles from '../../pages/EpisodeEditor.module.css';

export type AddTrackDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File, trackName?: string) => Promise<void>;
  onPickLibrary: (assetId: string, trackName?: string) => Promise<void>;
  busy?: boolean;
};

type Tab = 'upload' | 'library';

export function AddTrackDialog({
  open,
  onOpenChange,
  onUpload,
  onPickLibrary,
  busy = false,
}: AddTrackDialogProps) {
  const [tab, setTab] = useState<Tab>('upload');
  const [trackName, setTrackName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['library'],
    queryFn: () => listLibrary(),
    enabled: open && tab === 'library',
  });

  useEffect(() => {
    if (!open) {
      setTab('upload');
      setTrackName('');
      setFile(null);
      setError(null);
      setFilter('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  const assets = useMemo(() => {
    const list: LibraryAsset[] = data?.assets ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.name.toLowerCase().includes(q));
  }, [data?.assets, filter]);

  const submitUpload = async () => {
    if (!file) {
      setError('Choose an audio file to upload.');
      return;
    }
    setError(null);
    try {
      await onUpload(file, trackName.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const pickAsset = async (asset: LibraryAsset) => {
    setError(null);
    try {
      await onPickLibrary(asset.id, trackName.trim() || asset.name);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add library asset');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`}
        />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => {
            e.stopPropagation();
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Add track</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={busy}
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <p className={styles.dialogDescription}>
              Insert audio at the playhead. Upload a file or pick from your library.
            </p>
          </Dialog.Description>

          <div className={styles.segmentEditorV2ToolGroup} role="tablist" aria-label="Add track source">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'upload'}
              className={
                tab === 'upload'
                  ? styles.segmentEditorV2ToolActive
                  : styles.segmentEditorV2Tool
              }
              onClick={() => setTab('upload')}
              disabled={busy}
            >
              Upload
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'library'}
              className={
                tab === 'library'
                  ? styles.segmentEditorV2ToolActive
                  : styles.segmentEditorV2Tool
              }
              onClick={() => setTab('library')}
              disabled={busy}
            >
              Library
            </button>
          </div>

          <label className={styles.segmentEditorV2AddTrackField}>
            <span>Track name (optional)</span>
            <input
              type="text"
              value={trackName}
              onChange={(e) => setTrackName(e.target.value)}
              disabled={busy}
              placeholder="e.g. Music bed"
            />
          </label>

          {tab === 'upload' ? (
            <div className={styles.segmentEditorV2AddTrackPanel}>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.wav,.webm,.ogg,.m4a"
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setFile(next);
                  if (next && !trackName.trim()) {
                    setTrackName(next.name.replace(/\.[^.]+$/, ''));
                  }
                }}
              />
              <button
                type="button"
                className={styles.submit}
                onClick={() => void submitUpload()}
                disabled={busy || !file}
              >
                <Upload size={14} aria-hidden />
                {busy ? 'Adding...' : 'Add upload'}
              </button>
            </div>
          ) : (
            <div className={styles.segmentEditorV2AddTrackPanel}>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search library..."
                disabled={busy}
                aria-label="Search library"
              />
              {isLoading ? (
                <p className={styles.episodeTranscriptStatus}>Loading library...</p>
              ) : assets.length === 0 ? (
                <p className={styles.episodeTranscriptStatus}>No library assets found.</p>
              ) : (
                <ul className={styles.segmentEditorV2LibraryList}>
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <button
                        type="button"
                        className={styles.segmentEditorV2Tool}
                        disabled={busy}
                        onClick={() => void pickAsset(asset)}
                      >
                        {asset.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
