import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Edit, Play, Pause, Trash2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  createLibraryAsset,
  deleteLibraryAsset,
  deleteLibraryAssetForUser,
  libraryStreamUrl,
  libraryStreamUrlForUser,
  listLibrary,
  listLibraryForUser,
  updateLibraryAsset,
  updateLibraryAssetForUser,
  type LibraryAsset,
} from '../api/library';
import { me } from '../api/auth';
import { getUser } from '../api/users';
import styles from './Library.module.css';

const LIBRARY_PAGE_SIZE = 25;
const LIBRARY_TAGS = ['Ad', 'Intro', 'Outro', 'Bumper', 'Other'] as const;
const EMPTY_ASSETS: LibraryAsset[] = [];

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatLibraryDate(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : createdAt;
  } catch {
    return createdAt;
  }
}

export function Library() {
  const { userId } = useParams<{ userId?: string }>();
  const isAdminView = Boolean(userId);
  const queryClient = useQueryClient();
  const { data: selectedUser } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId!),
    enabled: !!userId,
  });
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const currentUser = meData?.user;
  const isAdmin = currentUser?.role === 'admin';
  const currentUserId = currentUser?.id;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['library', userId],
    queryFn: () => (userId ? listLibraryForUser(userId) : listLibrary()),
  });
  const assets = useMemo(() => data?.assets ?? EMPTY_ASSETS, [data?.assets]);

  const [filterQuery, setFilterQuery] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editCustomTag, setEditCustomTag] = useState('');
  const [editGlobalAsset, setEditGlobalAsset] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<LibraryAsset | null>(null);
  const [assetToEdit, setAssetToEdit] = useState<LibraryAsset | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadTag, setUploadTag] = useState('');
  const [customTag, setCustomTag] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audioRef.current = null;
    };
  }, []);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => (userId ? deleteLibraryAssetForUser(userId, id) : deleteLibraryAsset(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['library', userId] }),
  });
  const editMutation = useMutation({
    mutationFn: ({
      id,
      name,
      tag,
      global_asset,
    }: {
      id: string;
      name: string;
      tag: string;
      global_asset?: boolean;
    }) => {
      const payload = { name, tag: tag || null, ...(global_asset !== undefined && { global_asset }) };
      return userId
        ? updateLibraryAssetForUser(userId, id, payload)
        : updateLibraryAsset(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', userId] });
      setEditName('');
      setEditTag('');
      setEditCustomTag('');
      setEditGlobalAsset(false);
      setAssetToEdit(null);
    },
  });
  const uploadMutation = useMutation({
    mutationFn: ({ file, name, tag }: { file: File; name: string; tag?: string | null }) =>
      createLibraryAsset(file, name, tag || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', userId] });
      setPendingFile(null);
      setUploadName('');
      setUploadTag('');
      setCustomTag('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const tagOptions = useMemo(() => {
    const preset = new Set<string>(LIBRARY_TAGS);
    const fromData = new Set<string>();
    assets.forEach((a) => { if (a.tag) fromData.add(a.tag); });
    const ordered = [...LIBRARY_TAGS.filter((t) => t !== 'Other'), ...Array.from(fromData).filter((t) => !preset.has(t)).sort()];
    return ordered;
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
  }, [assets, filterQuery, filterTag, sortNewestFirst]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / LIBRARY_PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const paginatedAssets = useMemo(
    () => filteredAndSorted.slice((pageClamped - 1) * LIBRARY_PAGE_SIZE, pageClamped * LIBRARY_PAGE_SIZE),
    [filteredAndSorted, pageClamped]
  );
  const rangeStart = filteredAndSorted.length === 0 ? 0 : (pageClamped - 1) * LIBRARY_PAGE_SIZE + 1;
  const rangeEnd = (pageClamped - 1) * LIBRARY_PAGE_SIZE + paginatedAssets.length;

  useEffect(() => {
    setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
  }, [totalPages]);

  function handlePlay(asset: LibraryAsset) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === asset.id && isPlaying) {
      audio.pause();
      return;
    }
    if (playingId !== asset.id) {
      audio.src = userId ? libraryStreamUrlForUser(userId, asset.id) : libraryStreamUrl(asset.id);
      setPlayingId(asset.id);
    }
    audio.play().catch(() => {
      setIsPlaying(false);
    });
  }

  function handleDeleteConfirm() {
    if (!assetToDelete) return;
    if (playingId === assetToDelete.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    deleteMutation.mutate(assetToDelete.id, {
      onSuccess: () => setAssetToDelete(null),
    });
  }

  function handleDeleteRequest(asset: LibraryAsset) {
    setAssetToDelete(asset);
  }

  function canEditAsset(asset: LibraryAsset): boolean {
    const ownerId = asset.owner_user_id ?? (userId || currentUserId);
    return ownerId === currentUserId || isAdmin === true;
  }

  function canDeleteAsset(asset: LibraryAsset): boolean {
    return canEditAsset(asset);
  }

  function handleEditStart(asset: LibraryAsset) {
    setAssetToEdit(asset);
    setEditName(asset.name);
    setEditGlobalAsset(Boolean(asset.global_asset));
    if (!asset.tag) {
      setEditTag('');
      setEditCustomTag('');
    } else if (LIBRARY_TAGS.includes(asset.tag as (typeof LIBRARY_TAGS)[number])) {
      setEditTag(asset.tag);
      setEditCustomTag('');
    } else {
      setEditTag('Other');
      setEditCustomTag(asset.tag);
    }
  }

  function handleEditCancel() {
    setEditName('');
    setEditTag('');
    setEditCustomTag('');
    setEditGlobalAsset(false);
    setAssetToEdit(null);
  }

  function handleEditSave() {
    if (!assetToEdit) return;
    const name = editName.trim();
    if (!name) return;
    const tag = editTag === 'Other' ? (editCustomTag.trim() || '') : editTag.trim();
    const global_asset = isAdmin ? editGlobalAsset : undefined;
    editMutation.mutate({ id: assetToEdit.id, name, tag, global_asset });
  }

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
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {isAdminView ? `Library (${selectedUser?.email ?? userId})` : 'Library'}
          </h1>
          <p className={styles.subtitle}>
            Explore, search, listen, and manage your reusable audio clips.
          </p>
        </div>
      </header>

      {!isAdminView && (
        <section className={styles.uploadCard}>
          <div className={styles.uploadHeader}>
            <h2 className={styles.uploadTitle}>Add to library</h2>
            <p className={styles.uploadSub}>Upload a reusable clip you can insert into any episode.</p>
          </div>
          {!pendingFile ? (
            <button
              type="button"
              className={styles.uploadChooseBtn}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Choose audio file to add to library"
            >
              Choose audio file
            </button>
          ) : (
            <div className={styles.uploadForm}>
              <p className={styles.uploadPendingFile}>{pendingFile.name}</p>
              <label className={styles.uploadLabel}>
                Name
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Mid-roll ad, Show intro"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                />
              </label>
              <label className={styles.uploadLabel}>
                Tag
                <select
                  className={styles.select}
                  value={uploadTag}
                  onChange={(e) => setUploadTag(e.target.value)}
                >
                  <option value="">None</option>
                  {LIBRARY_TAGS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              {uploadTag === 'Other' && (
                <label className={styles.uploadLabel}>
                  Custom tag
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Promo, Transition"
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                  />
                </label>
              )}
              <div className={styles.uploadActions}>
                <button type="button" className={styles.uploadCancel} onClick={clearPending} aria-label="Cancel adding to library">
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.uploadSubmit}
                  onClick={handleAddToLibrary}
                  disabled={uploadMutation.isPending}
                  aria-label="Add file to library"
                >
                  {uploadMutation.isPending ? 'Adding…' : 'Add to Library'}
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
            <p className={styles.uploadError}>{uploadMutation.error?.message}</p>
          )}
        </section>
      )}

      <div className={styles.controls}>
        <input
          type="search"
          className={styles.input}
          placeholder="Search by name…"
          value={filterQuery}
          onChange={(e) => { setFilterQuery(e.target.value); setPage(1); }}
          aria-label="Search library"
        />
        <select
          className={styles.select}
          value={filterTag}
          onChange={(e) => { setFilterTag(e.target.value); setPage(1); }}
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {tagOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className={styles.sortToggle} role="group" aria-label="Sort order">
          <button
            type="button"
            className={sortNewestFirst ? styles.sortBtnActive : styles.sortBtn}
            aria-label="Sort newest first"
            onClick={() => { setSortNewestFirst(true); setPage(1); }}
          >
            <ArrowDown size={16} strokeWidth={2} aria-hidden />
            Newest
          </button>
          <button
            type="button"
            className={!sortNewestFirst ? styles.sortBtnActive : styles.sortBtn}
            aria-label="Sort oldest first"
            onClick={() => { setSortNewestFirst(false); setPage(1); }}
          >
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
            Oldest
          </button>
        </div>
      </div>

      {isLoading && (
        <div className={styles.stateCard}>
          <p className={styles.stateText}>Loading library…</p>
        </div>
      )}

      {isError && (
        <div className={styles.stateCard}>
          <p className={styles.stateText}>
            {error instanceof Error ? error.message : 'Failed to load library'}
          </p>
        </div>
      )}

      {!isLoading && !isError && assets.length === 0 && (
        <div className={styles.stateCard}>
          <p className={styles.stateText}>Your library is empty. Add clips from the episode editor.</p>
        </div>
      )}

      {!isLoading && !isError && assets.length > 0 && filteredAndSorted.length === 0 && (
        <div className={styles.stateCard}>
          <p className={styles.stateText}>No files match your filters.</p>
        </div>
      )}

      {!isLoading && !isError && filteredAndSorted.length > 0 && (
        <>
          <div className={styles.metaRow}>
            <span className={styles.metaText}>
              Showing {rangeStart}-{rangeEnd} of {filteredAndSorted.length} files
            </span>
          </div>
          <div className={styles.list}>
            {paginatedAssets.map((asset) => {
              const isThisPlaying = playingId === asset.id && isPlaying;
              return (
                <div key={asset.id} className={styles.item}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTitleRow}>
                      <span className={styles.itemName}>{asset.name}</span>
                      {asset.tag && <span className={styles.itemTag}>{asset.tag}</span>}
                      {asset.global_asset && (
                        <span className={styles.itemTag} title="Visible to everyone in the library">
                          Global
                        </span>
                      )}
                    </div>
                    <div className={styles.itemMeta}>
                      {formatDuration(asset.duration_sec)} · {formatLibraryDate(asset.created_at)}
                    </div>
                  </div>
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.listenBtn}
                      onClick={() => handlePlay(asset)}
                      aria-label={isThisPlaying ? `Pause ${asset.name}` : `Listen to ${asset.name}`}
                    >
                      {isThisPlaying ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
                      {isThisPlaying ? 'Pause' : 'Listen'}
                    </button>
                    {canEditAsset(asset) && (
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => handleEditStart(asset)}
                        aria-label={`Edit ${asset.name}`}
                      >
                        <Edit size={16} strokeWidth={2} />
                        Edit
                      </button>
                    )}
                    {canDeleteAsset(asset) && (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDeleteRequest(asset)}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete ${asset.name}`}
                      >
                        <Trash2 size={16} strokeWidth={2} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className={styles.pagination}>
              <span className={styles.paginationLabel}>Page {pageClamped} of {totalPages}</span>
              <div className={styles.paginationBtns}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageClamped <= 1}
                  aria-label="Previous page of library"
                >
                  ←
                </button>
                <button
                  type="button"
                  className={styles.pageBtn}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageClamped >= totalPages}
                  aria-label="Next page of library"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <Dialog.Root open={!!assetToDelete} onOpenChange={(open) => !open && setAssetToDelete(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Delete library item?</Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {assetToDelete
                ? `This will permanently delete "${assetToDelete.name}".`
                : 'This will permanently delete this item.'}
            </Dialog.Description>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Cancel deleting library item">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={handleDeleteConfirm}
                disabled={deleteMutation.isPending}
                aria-label="Confirm delete library item"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={!!assetToEdit} onOpenChange={(open) => !open && handleEditCancel()}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Edit library item</Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              Update the name and tag for this library item.
            </Dialog.Description>
            <div className={styles.dialogForm}>
              <label className={styles.dialogLabel}>
                Name
                <input
                  type="text"
                  className={styles.input}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className={styles.dialogLabel}>
                Tag
                <select
                  className={styles.select}
                  value={editTag}
                  onChange={(e) => setEditTag(e.target.value)}
                >
                  <option value="">None</option>
                  {LIBRARY_TAGS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              {editTag === 'Other' && (
                <label className={styles.dialogLabel}>
                  Custom tag
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Promo, Transition"
                    value={editCustomTag}
                    onChange={(e) => setEditCustomTag(e.target.value)}
                  />
                </label>
              )}
              {isAdmin && (
                <label className="toggle" style={{ marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={editGlobalAsset}
                    onChange={(e) => setEditGlobalAsset(e.target.checked)}
                    aria-label="Global Asset"
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Global Asset</span>
                </label>
              )}
            </div>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Cancel editing library item">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.dialogConfirm}
                onClick={handleEditSave}
                disabled={editMutation.isPending || editName.trim() === ''}
                aria-label="Save library item"
              >
                {editMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
