import { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, ArrowDown, ArrowUp } from 'lucide-react';
import { listLibrary, createLibraryAsset, type LibraryAsset } from '../../api/library';
import { formatDuration, formatLibraryDate } from './utils';
import styles from '../EpisodeEditor.module.css';

const LIBRARY_TAGS = ['Ad', 'Intro', 'Outro', 'Bumper', 'Other'] as const;
const LIBRARY_PAGE_SIZE = 10;
const EMPTY_LIBRARY_ASSETS: LibraryAsset[] = [];

export interface LibraryModalProps {
  onClose: () => void;
  onSelect: (assetId: string) => void;
  isAdding: boolean;
  error?: string;
}

export function LibraryModal({ onClose, onSelect, isAdding, error }: LibraryModalProps) {
  const queryClient = useQueryClient();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadTag, setUploadTag] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['library'],
    queryFn: () => listLibrary(),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, name, tag }: { file: File; name: string; tag?: string | null }) =>
      createLibraryAsset(file, name, tag || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      setPendingFile(null);
      setUploadName('');
      setUploadTag('');
      setCustomTag('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const assets = useMemo(() => data?.assets ?? EMPTY_LIBRARY_ASSETS, [data?.assets]);

  const tagOptions = useMemo(() => {
    const preset = new Set<string>(LIBRARY_TAGS);
    const fromData = new Set<string>();
    assets.forEach((a) => {
      if (a.tag) fromData.add(a.tag);
    });
    return [...LIBRARY_TAGS.filter((t) => t !== 'Other'), ...Array.from(fromData).filter((t) => !preset.has(t)).sort()];
  }, [assets]);

  const filteredAndSorted = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    let list = assets.filter((a) => {
      if (filterTag && a.tag !== filterTag) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortNewestFirst ? tb - ta : ta - tb;
    });
    return list;
  }, [assets, filterTag, filterQuery, sortNewestFirst]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / LIBRARY_PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const paginatedAssets = useMemo(
    () => filteredAndSorted.slice((pageClamped - 1) * LIBRARY_PAGE_SIZE, pageClamped * LIBRARY_PAGE_SIZE),
    [filteredAndSorted, pageClamped]
  );

  useEffect(() => {
    setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
  }, [totalPages]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setUploadName(file.name.replace(/\.[^.]+$/, ''));
    setUploadTag('');
  }

  function handleAddToLibrary() {
    if (!pendingFile) return;
    const name = uploadName.trim() || pendingFile.name.replace(/\.[^.]+$/, '');
    const tag = uploadTag === 'Other' ? (customTag.trim() || null) : (uploadTag || null);
    uploadMutation.mutate({ file: pendingFile, name, tag });
  }

  function clearPending() {
    setPendingFile(null);
    setUploadName('');
    setUploadTag('');
    setCustomTag('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className={styles.libraryOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.libraryCard} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.libraryTitle}>Insert from library</h3>
        <p className={styles.librarySub}>Reusable clips (ads, intros, outros) you can use in any episode.</p>

        {!pendingFile ? (
          <button
            type="button"
            className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.libraryChooseFileBtn}`}
            style={{ width: '100%', marginBottom: '1rem' }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={24} strokeWidth={2} aria-hidden />
            <span>Choose file to add to library</span>
          </button>
        ) : (
          <div className={styles.libraryUploadForm}>
            <p className={styles.libraryPendingFile}>{pendingFile.name}</p>
            <label className={styles.recordLabel}>
              Name
              <input
                type="text"
                className={styles.recordNameInput}
                placeholder="e.g. Mid-roll ad, Show intro"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </label>
            <label className={styles.recordLabel}>
              Tag
              <select className={styles.select} value={uploadTag} onChange={(e) => setUploadTag(e.target.value)}>
                <option value="">None</option>
                {LIBRARY_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {uploadTag === 'Other' && (
              <label className={styles.recordLabel}>
                Custom tag
                <input
                  type="text"
                  className={styles.recordNameInput}
                  placeholder="e.g. Promo, Transition"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                />
              </label>
            )}
            <div className={styles.libraryUploadActions}>
              <button type="button" className={styles.cancel} onClick={clearPending} aria-label="Cancel adding to library">
                Cancel
              </button>
              <button type="button" className={styles.submit} onClick={handleAddToLibrary} disabled={uploadMutation.isPending} aria-label="Add file to library">
                {uploadMutation.isPending ? 'Adding…' : 'Add to library'}
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm,.ogg"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {uploadMutation.isError && (
          <p className={styles.error} style={{ marginBottom: '0.5rem' }}>
            {uploadMutation.error?.message}
          </p>
        )}

        {!pendingFile && !isLoading && assets.length > 0 && (
          <div className={styles.libraryFilters}>
            <input
              type="search"
              className={styles.input}
              placeholder="Search by name…"
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by name"
            />
            <select className={styles.select} value={filterTag} onChange={(e) => { setFilterTag(e.target.value); setPage(1); }} aria-label="Filter by tag">
              <option value="">All tags</option>
              {tagOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className={styles.librarySortToggle} role="group" aria-label="Sort order">
              <button
                type="button"
                className={sortNewestFirst ? styles.librarySortBtnActive : styles.librarySortBtn}
                onClick={() => { setSortNewestFirst(true); setPage(1); }}
                title="Newest first"
                aria-label="Newest first"
              >
                <ArrowDown size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={!sortNewestFirst ? styles.librarySortBtnActive : styles.librarySortBtn}
                onClick={() => { setSortNewestFirst(false); setPage(1); }}
                title="Oldest first"
                aria-label="Oldest first"
              >
                <ArrowUp size={16} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {!pendingFile &&
          (isLoading ? (
            <p className={styles.libraryEmpty}>Loading…</p>
          ) : assets.length === 0 ? (
            <p className={styles.libraryEmpty}>No library clips yet. Choose a file above to add one.</p>
          ) : filteredAndSorted.length === 0 ? (
            <p className={styles.libraryEmpty}>No clips match your filters.</p>
          ) : (
            <>
              <ul className={styles.libraryList}>
                {paginatedAssets.map((asset: LibraryAsset) => (
                  <li key={asset.id} className={styles.libraryItem} onClick={() => !isAdding && onSelect(asset.id)}>
                    <div className={styles.libraryItemContent}>
                      <div className={styles.libraryItemName}>
                        {asset.name}
                        {asset.tag && <span className={styles.libraryItemTag}>{asset.tag}</span>}
                      </div>
                      <div className={styles.libraryItemMeta}>
                        {formatDuration(asset.duration_sec)}
                        <span className={styles.libraryItemDate}> · {formatLibraryDate(asset.created_at)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className={styles.libraryPagination}>
                  <span className={styles.libraryPaginationLabel}>
                    Page {pageClamped} of {totalPages}
                  </span>
                  <div className={styles.libraryPaginationBtns}>
                    <button type="button" className={styles.libraryPageBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped <= 1} aria-label="Previous page">
                      ←
                    </button>
                    <button type="button" className={styles.libraryPageBtn} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped >= totalPages} aria-label="Next page">
                      →
                    </button>
                  </div>
                </div>
              )}
            </>
          ))}
        {error && (
          <p className={styles.error} style={{ marginTop: '0.5rem' }}>
            {error}
          </p>
        )}
        <button type="button" className={styles.libraryClose} onClick={onClose} aria-label="Close library">
          Close
        </button>
      </div>
    </div>
  );
}
