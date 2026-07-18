import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FolderUp, Lock, Plus } from 'lucide-react';
import { getPodcast } from '../api/podcasts';
import {
  getProjectImportStatus,
  listEpisodes,
  startImportEpisodeProject,
} from '../api/episodes';
import { formatDateShort } from '../utils/format';
import { me, isReadOnly } from '../api/auth';
import { FullPageLoading, InlineLoading } from '../components/Loading';
import { Breadcrumb } from '../components/Breadcrumb';
import { PleaseWaitDialog } from '../components/PleaseWaitDialog';
import { pollUntil } from '../utils/projectZipTransfer';
import styles from './EpisodesList.module.css';

export function EpisodesList() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [importedEpisodeId, setImportedEpisodeId] = useState<string | null>(null);

  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: episodes = [], isLoading: episodesLoading } = useQuery({
    queryKey: ['episodes', id],
    queryFn: () => listEpisodes(id!),
    enabled: !!id,
  });
  const maxEpisodes = podcast?.maxEpisodes ?? null;
  const episodeCount = Number(podcast?.episodeCount ?? episodes.length);
  const atEpisodeLimit = maxEpisodes != null && maxEpisodes > 0 && episodeCount >= Number(maxEpisodes);
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const readOnly = isReadOnly(meData?.user);
  const myRole = (podcast as { myRole?: string } | undefined)?.myRole;
  const canCreateEpisode = myRole === 'owner' || myRole === 'manager';

  const publishedCount = episodes.filter((e) => e.status === 'published').length;
  const scheduledCount = episodes.filter((e) => e.status === 'scheduled').length;
  const draftCount = episodes.filter((e) => e.status === 'draft').length;

  async function handleImportFile(file: File | undefined) {
    if (!id || !file || (importOpen && !importError && !importWarning)) return;
    setImportError(null);
    setImportWarning(null);
    setImportedEpisodeId(null);
    setImportOpen(true);
    try {
      await startImportEpisodeProject(id, file);
      const result = await pollUntil(() => getProjectImportStatus(id), {
        pendingStatuses: ['importing'],
        successStatuses: ['done'],
      });
      if (!result.episodeId) {
        throw new Error('Import finished without an episode id');
      }
      if (result.warning) {
        setImportedEpisodeId(result.episodeId);
        setImportWarning(result.warning);
        return;
      }
      setImportOpen(false);
      navigate(`/episodes/${result.episodeId}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function dismissImportWait() {
    const episodeId = importedEpisodeId;
    setImportOpen(false);
    setImportError(null);
    setImportWarning(null);
    setImportedEpisodeId(null);
    if (episodeId) {
      navigate(`/episodes/${episodeId}`);
    }
  }

  if (!id) return null;
  if (podcastLoading) return <FullPageLoading />;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast?.title ?? 'Show', href: `/podcasts/${id}`, mobileLabel: 'Podcast' },
    { label: 'Episodes' },
  ];

  const canImport = canCreateEpisode && !readOnly && !atEpisodeLimit;

  return (
    <div className={styles.wrap}>
      <Breadcrumb items={breadcrumbItems} />
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>Episodes</h1>
          <div className={styles.headerActions}>
            {readOnly ? (
              <span className={`${styles.secondaryBtn} ${styles.newBtnDisabled}`} title="Read-only account">
                <FolderUp size={18} strokeWidth={2.5} aria-hidden />
                Import Project
              </span>
            ) : !canCreateEpisode ? (
              <span
                className={`${styles.secondaryBtn} ${styles.newBtnDisabled}`}
                title="Only managers and the owner can import projects"
              >
                <FolderUp size={18} strokeWidth={2.5} aria-hidden />
                Import Project
              </span>
            ) : atEpisodeLimit ? (
              <span
                className={`${styles.secondaryBtn} ${styles.newBtnDisabled}`}
                title="You're at max episodes for this show"
              >
                <FolderUp size={18} strokeWidth={2.5} aria-hidden />
                Import Project
              </span>
            ) : (
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={importOpen && !importError && !importWarning}
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderUp size={18} strokeWidth={2.5} aria-hidden />
                Import Project
              </button>
            )}
            {readOnly ? (
              <span className={`${styles.newBtn} ${styles.newBtnDisabled}`} title="Read-only account">
                <Plus size={18} strokeWidth={2.5} aria-hidden />
                New Episode
              </span>
            ) : !canCreateEpisode ? (
              <span
                className={`${styles.newBtn} ${styles.newBtnDisabled}`}
                title="Only managers and the owner can create episodes"
              >
                <Plus size={18} strokeWidth={2.5} aria-hidden />
                New Episode
              </span>
            ) : atEpisodeLimit ? (
              <span
                className={`${styles.newBtn} ${styles.newBtnDisabled}`}
                title="You're at max episodes for this show"
              >
                <Plus size={18} strokeWidth={2.5} aria-hidden />
                New Episode
              </span>
            ) : (
              <Link to={`/podcasts/${id}/episodes/new`} className={styles.newBtn}>
                <Plus size={18} strokeWidth={2.5} aria-hidden />
                New Episode
              </Link>
            )}
          </div>
          {canImport && (
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className={styles.hiddenFileInput}
              onChange={(e) => void handleImportFile(e.target.files?.[0])}
            />
          )}
        </div>
        <PleaseWaitDialog
          open={importOpen}
          title="Please wait"
          description="Importing project…"
          error={importError}
          errorTitle="Import failed"
          warning={importWarning}
          warningTitle="Import finished"
          onDismiss={dismissImportWait}
        />
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{publishedCount}</span>
            <span className={styles.summaryLabel}>Published</span>
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{scheduledCount}</span>
            <span className={styles.summaryLabel}>Scheduled</span>
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{draftCount}</span>
            <span className={styles.summaryLabel}>Draft</span>
          </span>
        </div>
        {episodesLoading && (
          <p className={styles.muted}>
            <InlineLoading label="Loading episodes" />
          </p>
        )}
        {!episodesLoading && episodes.length === 0 && (
          <div className={styles.empty}>
            <p>No episodes yet.</p>
            {readOnly ? (
              <span className={`${styles.emptyLink} ${styles.emptyLinkDisabled}`} title="Read-only account">
                Create first episode
              </span>
            ) : !canCreateEpisode ? (
              <span
                className={`${styles.emptyLink} ${styles.emptyLinkDisabled}`}
                title="Only managers and the owner can create episodes"
              >
                Create first episode
              </span>
            ) : atEpisodeLimit ? (
              <span
                className={`${styles.emptyLink} ${styles.emptyLinkDisabled}`}
                title="You're at max episodes for this show"
              >
                Create first episode
              </span>
            ) : (
              <Link to={`/podcasts/${id}/episodes/new`} className={styles.emptyLink}>
                Create first episode
              </Link>
            )}
          </div>
        )}
        {!episodesLoading && episodes.length > 0 && (
          <div className={styles.episodesByStatus}>
            {(['draft', 'scheduled', 'published'] as const).map((status) => {
              const statusEpisodes = episodes.filter((e) => e.status === status);
              if (statusEpisodes.length === 0) return null;
              const sectionLabel = status.charAt(0).toUpperCase() + status.slice(1);
              return (
                <div key={status} className={styles.statusSection}>
                  <h2 className={styles.statusSectionTitle}>{sectionLabel}</h2>
                  <ul className={styles.list}>
                    {statusEpisodes.map((ep) => {
                      const isSubscriberOnly = Boolean(ep.subscriberOnly);
                      const isExpired =
                        Boolean(ep.expiresAt && ep.expiresAt.trim()) &&
                        new Date(ep.expiresAt!).getTime() <= Date.now();
                      const statusBadgeText = isExpired
                        ? 'Expired'
                        : ep.publishAt && ep.publishAt.trim()
                          ? formatDateShort(ep.publishAt)
                          : sectionLabel;
                      return (
                        <li
                          key={ep.id}
                          className={isSubscriberOnly ? `${styles.item} ${styles.itemSubscriberOnly}` : styles.item}
                        >
                          <Link to={`/episodes/${ep.id}`} className={styles.itemLink} aria-label={`Open ${ep.title}`}>
                            <div className={styles.itemContent}>
                              <div className={styles.itemTitleRow}>
                                {isSubscriberOnly && (
                                  <Lock size={14} strokeWidth={2.5} className={styles.itemTitleLockGold} aria-label="Subscriber only" />
                                )}
                                <span className={styles.itemTitle}>{ep.title}</span>
                              </div>
                              <div className={styles.itemMeta}>
                                <span className={styles.itemStatus}>{statusBadgeText}</span>
                                {(ep.seasonNumber != null || ep.episodeNumber != null) && (
                                  <span className={styles.itemMetaItem}>
                                    S{ep.seasonNumber ?? '?'} E{ep.episodeNumber ?? '?'}
                                  </span>
                                )}
                                {ep.audioFinalPath && (
                                  <span className={styles.itemMetaItem}>✓ Audio</span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className={styles.itemChevron} size={20} strokeWidth={2} aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
