import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Edit, Play, Pause, Trash2, Upload, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  createLibraryAsset,
  deleteLibraryAsset,
  deleteLibraryAssetForUser,
  importFromPixabay,
  libraryStreamUrl,
  libraryStreamUrlForUser,
  libraryWaveformUrl,
  libraryWaveformUrlForUser,
  listLibrary,
  listLibraryForUser,
  updateLibraryAsset,
  updateLibraryAssetForUser,
  type LibraryAsset,
} from '../api/library';
import { WaveformCanvas, type WaveformData } from './EpisodeEditor/WaveformCanvas';
import { me, isReadOnly } from '../api/auth';
import { getUser } from '../api/users';
import { formatDateShort } from '../utils/format';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import styles from './Library.module.css';

const LIBRARY_PAGE_SIZE = 25;
const LIBRARY_TAGS = ['Ad', 'Intro', 'Outro', 'Bumper', 'Other'] as const;
const EMPTY_ASSETS: LibraryAsset[] = [];

function LibraryItemWaveform({
  asset,
  waveformUrl,
  currentTime,
  isPlaying,
  onSeek,
  onPlayPause,
}: {
  asset: LibraryAsset;
  waveformUrl: string;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (asset: LibraryAsset, time: number) => void;
  onPlayPause: () => void;
}) {
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const durationSec = asset.duration_sec ?? 0;

  useEffect(() => {
    if (durationSec <= 0) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    fetch(waveformUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.data?.length) setWaveformData(data as WaveformData);
        else if (!cancelled) setWaveformData(null);
      })
      .catch(() => {
        if (!cancelled) setWaveformData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [waveformUrl, durationSec]);

  if (durationSec <= 0) return null;
  return (
    <div className={styles.itemWaveformRow}>
      <button
        type="button"
        className={styles.itemPlayPauseBtn}
        onClick={onPlayPause}
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? `Pause ${asset.name}` : `Play ${asset.name}`}
      >
        {isPlaying ? <Pause size={20} strokeWidth={2} aria-hidden /> : <Play size={20} strokeWidth={2} aria-hidden />}
      </button>
      {waveformData ? (
        <WaveformCanvas
          data={waveformData}
          durationSec={durationSec}
          currentTime={currentTime}
          onSeek={(time) => onSeek(asset, time)}
          onPlayPause={onPlayPause}
          className={styles.itemWaveform}
        />
      ) : (
        <div
          className={styles.itemWaveformPlaceholder}
          role="progressbar"
          aria-valuenow={Math.round(currentTime)}
          aria-valuemin={0}
          aria-valuemax={durationSec}
          aria-label="Playback position"
          onClick={() => onPlayPause()}
        >
          <div
            className={styles.itemWaveformPlaceholderFill}
            style={{ width: `${durationSec > 0 ? (currentTime / durationSec) * 100 : 0}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    staleTime: 5 * 60 * 1000,
  });
  const currentUser = meData?.user;
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin';
  const currentUserId = currentUser?.id ?? undefined;
  const readOnly = !isAdminView && isReadOnly(currentUser);

  const { data, isLoading, isError } = useQuery({
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
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editCustomTag, setEditCustomTag] = useState('');
  const [editCopyright, setEditCopyright] = useState('');
  const [editLicense, setEditLicense] = useState('');
  const [editGlobalAsset, setEditGlobalAsset] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<LibraryAsset | null>(null);
  const [assetToEdit, setAssetToEdit] = useState<LibraryAsset | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadTag, setUploadTag] = useState('');
  const [uploadCopyright, setUploadCopyright] = useState('');
  const [uploadLicense, setUploadLicense] = useState('');
  const [customTag, setCustomTag] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPixabayImport, setShowPixabayImport] = useState(false);
  const [pixabayUrl, setPixabayUrl] = useState('');

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      if (pendingSeekRef.current != null) {
        const t = pendingSeekRef.current;
        pendingSeekRef.current = null;
        audio.currentTime = t;
        setCurrentTime(t);
      }
    };
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
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
      copyright,
      license,
      global_asset,
    }: {
      id: string;
      name: string;
      tag: string;
      copyright?: string | null;
      license?: string | null;
      global_asset?: boolean;
    }) => {
      const payload = {
        name,
        tag: tag || null,
        copyright: copyright === '' ? null : copyright ?? undefined,
        license: license === '' ? null : license ?? undefined,
        ...(global_asset !== undefined && { global_asset }),
      };
      return userId
        ? updateLibraryAssetForUser(userId, id, payload)
        : updateLibraryAsset(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', userId] });
      setEditName('');
      setEditTag('');
      setEditCustomTag('');
      setEditCopyright('');
      setEditLicense('');
      setEditGlobalAsset(false);
      setAssetToEdit(null);
    },
  });
  const uploadMutation = useMutation({
    mutationFn: ({
      file,
      name,
      tag,
      copyright,
      license,
    }: {
      file: File;
      name: string;
      tag?: string | null;
      copyright?: string | null;
      license?: string | null;
    }) =>
      createLibraryAsset(file, name, tag || undefined, copyright || undefined, license || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', userId] });
      setPendingFile(null);
      setUploadName('');
      setUploadTag('');
      setUploadCopyright('');
      setUploadLicense('');
      setCustomTag('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const pixabayImportMutation = useMutation({
    mutationFn: (url: string) => importFromPixabay(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', userId] });
      setShowPixabayImport(false);
      setPixabayUrl('');
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
      setCurrentTime(0);
    }
    audio.play().catch(() => {
      setIsPlaying(false);
    });
  }

  function handleSeek(asset: LibraryAsset, time: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === asset.id) {
      audio.currentTime = time;
      setCurrentTime(time);
      return;
    }
    pendingSeekRef.current = time;
    setPlayingId(asset.id);
    setCurrentTime(0);
    audio.src = userId ? libraryStreamUrlForUser(userId, asset.id) : libraryStreamUrl(asset.id);
    audio.load();
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
    if (readOnly) return false;
    const ownerId = asset.owner_user_id ?? (userId ?? currentUserId);
    return (currentUserId != null && String(ownerId) === String(currentUserId)) || Boolean(isAdmin);
  }

  function canDeleteAsset(asset: LibraryAsset): boolean {
    return canEditAsset(asset);
  }

  function handleEditStart(asset: LibraryAsset) {
    setAssetToEdit(asset);
    setEditName(asset.name);
    setEditCopyright(asset.copyright ?? '');
    setEditLicense(asset.license ?? '');
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
    setEditCopyright('');
    setEditLicense('');
    setEditGlobalAsset(false);
    setAssetToEdit(null);
  }

  function handleEditSave() {
    if (!assetToEdit) return;
    const name = editName.trim();
    if (!name) return;
    const tag = editTag === 'Other' ? (editCustomTag.trim() || '') : editTag.trim();
    const copyright = editCopyright.trim() || null;
    const license = editLicense.trim() || null;
    const global_asset = isAdmin ? editGlobalAsset : undefined;
    editMutation.mutate({ id: assetToEdit.id, name, tag, copyright, license, global_asset });
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
    const copyright = uploadCopyright.trim() || null;
    const license = uploadLicense.trim() || null;
    uploadMutation.mutate({ file: pendingFile, name, tag, copyright, license });
  }

  function clearPending() {
    setPendingFile(null);
    setUploadName('');
    setUploadTag('');
    setUploadCopyright('');
    setUploadLicense('');
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

      {!isAdminView && !readOnly && (
        <section className={styles.uploadCard}>
          <div className={styles.uploadHeader}>
            <h2 className={styles.uploadTitle}>Add to Library</h2>
            <p className={styles.uploadSub}>Upload a reusable clip you can insert into any episode.</p>
          </div>
          {!pendingFile ? (
            <>
              <div className={styles.uploadChooseRow}>
                <button
                  type="button"
                  className={styles.uploadChooseBtn}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Choose audio file to add to library"
                >
                  <Upload size={20} strokeWidth={2} aria-hidden />
                  Upload Audio
                </button>
                {isAdmin && (
                  !showPixabayImport ? (
                    <button
                      type="button"
                      className={styles.uploadChooseBtn}
                      onClick={() => setShowPixabayImport(true)}
                      aria-label="Import from Pixabay"
                    >
                      <Download size={20} strokeWidth={2} aria-hidden />
                      Import from Pixabay
                    </button>
                  ) : (
                    <div className={styles.pixabayImportForm}>
                      <input
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        className={styles.input}
                        placeholder="https://pixabay.com/sound-effects/..."
                        value={pixabayUrl}
                        onChange={(e) => setPixabayUrl(e.target.value)}
                        aria-label="Pixabay sound effect URL"
                      />
                      <div className={styles.pixabayImportActions}>
                        <button
                          type="button"
                          className={styles.uploadCancel}
                          onClick={() => { setShowPixabayImport(false); setPixabayUrl(''); }}
                          aria-label="Cancel Pixabay import"
                        >
                          <X size={18} strokeWidth={2} aria-hidden />
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.uploadSubmit}
                          onClick={() => pixabayImportMutation.mutate(pixabayUrl.trim())}
                          disabled={!pixabayUrl.trim() || pixabayImportMutation.isPending}
                          aria-label="Import from Pixabay"
                        >
                          <Download size={18} strokeWidth={2} aria-hidden />
                          {pixabayImportMutation.isPending ? 'Importing...' : 'Import'}
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            </>
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
              <label className={styles.uploadLabel}>
                <span>Copyright <span className={styles.optional}>(optional)</span></span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. 2026 Acme Media"
                  value={uploadCopyright}
                  onChange={(e) => setUploadCopyright(e.target.value)}
                />
              </label>
              <label className={styles.uploadLabel}>
                <span>License <span className={styles.optional}>(optional)</span></span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. CC BY 4.0, All rights reserved"
                  value={uploadLicense}
                  onChange={(e) => setUploadLicense(e.target.value)}
                />
              </label>
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
                  {uploadMutation.isPending ? 'Adding...' : 'Add to Library'}
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
          {pixabayImportMutation.isError && (
            <p className={styles.uploadError}>{pixabayImportMutation.error?.message}</p>
          )}
        </section>
      )}

      <div className={styles.controls}>
        <input
          type="search"
          className={styles.input}
          placeholder="Search by name..."
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
          <p className={styles.stateText}>Loading library...</p>
        </div>
      )}

      {isError && <FailedToLoadCard title="Failed to load library" />}

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
                    </div>
                    {(asset.copyright?.trim() || asset.license?.trim()) && (
                      <p className={styles.itemCopyrightLicense}>
                        {[asset.copyright?.trim(), asset.license?.trim()].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <div className={styles.itemMeta}>
                      {(asset.tag || asset.global_asset) && (
                        <span className={styles.itemMetaLabels}>
                          {asset.tag && <span className={styles.itemTag}>{asset.tag}</span>}
                          {Boolean(asset.global_asset) && (
                            <span className={styles.itemTag} title="Visible to everyone in the library">
                              Global
                            </span>
                          )}
                        </span>
                      )}
                      <span className={styles.itemMetaRight}>
                        <span>{formatDuration(asset.duration_sec)}</span>
                        <span className={styles.itemMetaDot} aria-hidden />
                        <span>{formatDateShort(asset.created_at)}</span>
                      </span>
                    </div>
                  </div>
                  <div className={styles.itemActions}>
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
                      </button>
                    )}
                  </div>
                  <LibraryItemWaveform
                    asset={asset}
                    waveformUrl={userId ? libraryWaveformUrlForUser(userId, asset.id) : libraryWaveformUrl(asset.id)}
                    currentTime={playingId === asset.id ? currentTime : 0}
                    isPlaying={isThisPlaying}
                    onSeek={handleSeek}
                    onPlayPause={() => handlePlay(asset)}
                  />
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
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Delete library item?</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {assetToDelete
                ? `This will permanently delete "${assetToDelete.name}".`
                : 'This will permanently delete this item.'}
            </Dialog.Description>
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
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
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={!!assetToEdit} onOpenChange={(open) => !open && handleEditCancel()}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Edit library item</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
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
              <label className={styles.dialogLabel}>
                <span>Copyright <span className={styles.optional}>(optional)</span></span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. 2026 Acme Media"
                  value={editCopyright}
                  onChange={(e) => setEditCopyright(e.target.value)}
                />
              </label>
              <label className={styles.dialogLabel}>
                <span>License <span className={styles.optional}>(optional)</span></span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. CC BY 4.0, All rights reserved"
                  value={editLicense}
                  onChange={(e) => setEditLicense(e.target.value)}
                />
              </label>
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
                {editMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
