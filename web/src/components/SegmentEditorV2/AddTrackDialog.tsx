import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { FileAudio, Library, Upload, X } from 'lucide-react';
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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [dragOver, setDragOver] = useState(false);
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
      setDragOver(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  const assets = useMemo(() => {
    const list: LibraryAsset[] = data?.assets ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.name.toLowerCase().includes(q));
  }, [data?.assets, filter]);

  const chooseFile = (next: File | null) => {
    setFile(next);
    setError(null);
    if (next && !trackName.trim()) {
      setTrackName(next.name.replace(/\.[^.]+$/, ''));
    }
  };

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
          className={`${styles.dialogContent} ${styles.dialogContentOnModal} ${styles.addTrackDialog}`}
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
          <div className={styles.addTrackHeader}>
            <div className={styles.addTrackHeaderText}>
              <Dialog.Title className={styles.addTrackTitle}>Add Track</Dialog.Title>
              <Dialog.Description className={styles.addTrackSubtitle}>
                Insert audio at the playhead from a file or your library.
              </Dialog.Description>
            </div>
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

          <div className={styles.addTrackBody}>
            <div className={styles.addTrackTabs} role="tablist" aria-label="Add track source">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'upload'}
                className={
                  tab === 'upload' ? styles.addTrackTabActive : styles.addTrackTab
                }
                onClick={() => setTab('upload')}
                disabled={busy}
              >
                <Upload size={14} strokeWidth={2.25} aria-hidden />
                Upload
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'library'}
                className={
                  tab === 'library' ? styles.addTrackTabActive : styles.addTrackTab
                }
                onClick={() => setTab('library')}
                disabled={busy}
              >
                <Library size={14} strokeWidth={2.25} aria-hidden />
                Library
              </button>
            </div>

            <label className={styles.addTrackField}>
              <span className={styles.addTrackFieldLabel}>Track name</span>
              <input
                type="text"
                value={trackName}
                onChange={(e) => setTrackName(e.target.value)}
                disabled={busy}
                placeholder="Optional, defaults from the file"
              />
            </label>

            {tab === 'upload' ? (
              <div className={styles.addTrackPanel}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.webm,.ogg,.m4a"
                  disabled={busy}
                  className={styles.addTrackFileInput}
                  onChange={(e) => {
                    chooseFile(e.target.files?.[0] ?? null);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.addTrackDropzone}${
                    dragOver ? ` ${styles.addTrackDropzoneActive}` : ''
                  }${file ? ` ${styles.addTrackDropzoneFilled}` : ''}`}
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!busy) setDragOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!busy) setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                    if (busy) return;
                    const next = e.dataTransfer.files?.[0] ?? null;
                    if (next) chooseFile(next);
                  }}
                >
                  <span className={styles.addTrackDropzoneIcon} aria-hidden>
                    {file ? <FileAudio size={22} strokeWidth={1.75} /> : <Upload size={22} strokeWidth={1.75} />}
                  </span>
                  {file ? (
                    <>
                      <span className={styles.addTrackDropzoneTitle}>{file.name}</span>
                      <span className={styles.addTrackDropzoneHint}>
                        {formatBytes(file.size)} · Click or drop to replace
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={styles.addTrackDropzoneTitle}>
                        Drop an audio file here
                      </span>
                      <span className={styles.addTrackDropzoneHint}>
                        or click to browse · MP3, WAV, WebM, OGG, M4A
                      </span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className={styles.addTrackPanel}>
                <label className={styles.addTrackField}>
                  <span className={styles.addTrackFieldLabel}>Search</span>
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter library assets"
                    disabled={busy}
                    aria-label="Search library"
                  />
                </label>
                {isLoading ? (
                  <p className={styles.addTrackEmpty}>Loading library...</p>
                ) : assets.length === 0 ? (
                  <p className={styles.addTrackEmpty}>No library assets found.</p>
                ) : (
                  <ul className={styles.addTrackLibraryList}>
                    {assets.map((asset) => (
                      <li key={asset.id}>
                        <button
                          type="button"
                          className={styles.addTrackLibraryItem}
                          disabled={busy}
                          onClick={() => void pickAsset(asset)}
                        >
                          <span className={styles.addTrackLibraryItemIcon} aria-hidden>
                            <FileAudio size={16} strokeWidth={1.75} />
                          </span>
                          <span className={styles.addTrackLibraryItemName}>{asset.name}</span>
                          <span className={styles.addTrackLibraryItemAction}>Add</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {error ? (
              <p className={styles.addTrackError} role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {tab === 'upload' ? (
            <div className={styles.addTrackFooter}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.addTrackCancelBtn}
                  disabled={busy}
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.addTrackSubmitBtn}
                onClick={() => void submitUpload()}
                disabled={busy || !file}
              >
                <Upload size={14} strokeWidth={2.25} aria-hidden />
                {busy ? 'Adding...' : 'Add track'}
              </button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
