import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  FileUp,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { me } from '../api/auth';
import {
  listThemes,
  listBuiltinThemes,
  downloadBuiltinTheme,
  downloadUserTheme,
  importTheme,
  deleteTheme,
  deleteServerTheme,
  themeAssetPreviewUrl,
  updateServerThemeFromCatalog,
  FEED_THEME_ZIP_MAX_BYTES,
  type BuiltinThemeListItem,
  type ThemeListItem,
} from '../api/themes';
import {
  ExploreThemesCta,
  ExploreThemesDialog,
} from '../components/ExploreThemesDialog';
import { ThemeEditorDialog } from '../components/ThemeEditorDialog';
import styles from './Themes.module.css';

/** Strip import-time personal-copy suffix for display. */
function displayThemeName(name: string): string {
  return name.replace(/\s*\(yours\)\s*$/i, '').trim() || name;
}

type DeleteTarget =
  | { kind: 'user'; theme: ThemeListItem }
  | { kind: 'server'; theme: BuiltinThemeListItem };

export function Themes() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dropActive, setDropActive] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [themeToDelete, setThemeToDelete] = useState<DeleteTarget | null>(null);
  const [editorThemeId, setEditorThemeId] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, true>>({});
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    staleTime: 5 * 60 * 1000,
  });

  const canImportTheme = meData?.user?.canImportTheme === 1;
  const isAdmin = meData?.user?.role === 'admin';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['themes'],
    queryFn: listThemes,
    enabled: canImportTheme,
  });

  const { data: builtinsData, isLoading: builtinsLoading } = useQuery({
    queryKey: ['themes', 'builtins'],
    queryFn: listBuiltinThemes,
    enabled: canImportTheme,
  });

  const importMutation = useMutation({
    mutationFn: importTheme,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['themes'] });
      setImportError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      const label = result.name || result.packageId || 'theme';
      if (result.fromBuiltin) {
        setImportNotice(
          result.updated
            ? `Updated your ${label} copy.`
            : `Created your ${label} copy. Assign it in Page Customizations (not the built-in option).`,
        );
      } else {
        setImportNotice(result.updated ? `Updated ${label}.` : `Imported ${label}.`);
      }
    },
    onError: (err: Error) => {
      setImportNotice(null);
      setImportError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (target: DeleteTarget) => {
      if (target.kind === 'server') {
        await deleteServerTheme(target.theme.id);
      } else {
        await deleteTheme(target.theme.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['themes'] });
      queryClient.invalidateQueries({ queryKey: ['themes', 'builtins'] });
      setThemeToDelete(null);
    },
  });

  function submitThemeFile(file: File | undefined | null) {
    setImportError(null);
    setImportNotice(null);
    if (!file) return;
    if (file.size > FEED_THEME_ZIP_MAX_BYTES) {
      setImportError(
        `Theme zip must be at most ${FEED_THEME_ZIP_MAX_BYTES / (1024 * 1024)} MB.`,
      );
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setImportError('File must be a .zip archive.');
      return;
    }
    importMutation.mutate(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    submitThemeFile(file);
  }

  function openFilePicker() {
    if (importMutation.isPending) return;
    fileInputRef.current?.click();
  }

  function handleDeleteConfirm() {
    if (!themeToDelete) return;
    deleteMutation.mutate(themeToDelete);
  }

  async function handleDownloadBuiltin(builtinId: string) {
    setDownloadError(null);
    setDownloadingId(`server:${builtinId}`);
    try {
      await downloadBuiltinTheme(builtinId);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDownloadUserTheme(themeId: string) {
    setDownloadError(null);
    setDownloadingId(`user:${themeId}`);
    try {
      await downloadUserTheme(themeId);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleUpdateServerTheme(builtinId: string) {
    setDownloadError(null);
    setImportNotice(null);
    setUpdatingId(builtinId);
    try {
      const result = await updateServerThemeFromCatalog(builtinId);
      queryClient.invalidateQueries({ queryKey: ['themes', 'builtins'] });
      if (result.updated) {
        setImportNotice(`Updated ${result.name} to v${result.version}.`);
      } else {
        setImportNotice(result.message || `${result.name} is already up to date.`);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdatingId(null);
    }
  }

  if (meLoading) {
    return (
      <div className={styles.page}>
        <p className={styles.subtitle}>Loading...</p>
      </div>
    );
  }

  if (!canImportTheme) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Themes</h1>
          </div>
        </div>
        <div className={styles.gateMessage}>
          Theme import is not enabled for your account. Contact an administrator if you need access.
        </div>
      </div>
    );
  }

  const themes = data?.themes ?? [];
  const builtins = builtinsData?.builtins ?? [];
  const serverPackageIds = new Set(builtins.map((t) => t.id));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Themes</h1>
          <p className={styles.subtitle}>
            Download a starter, edit it locally, then upload your zip. Assign your copy in Page
            Customizations on each show.
          </p>
        </div>
      </div>

      <div className={styles.importCard}>
        <h2 className={styles.importTitle}>Import theme</h2>
        <div className={styles.importSplit}>
          <div
            className={`${styles.dropZone} ${dropActive ? styles.dropZoneActive : ''} ${
              importMutation.isPending ? styles.dropZoneBusy : ''
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (importMutation.isPending) return;
              dragDepthRef.current += 1;
              setDropActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) setDropActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepthRef.current = 0;
              setDropActive(false);
              if (importMutation.isPending) return;
              submitThemeFile(e.dataTransfer.files?.[0]);
            }}
            onClick={openFilePicker}
            role="button"
            tabIndex={importMutation.isPending ? -1 : 0}
            aria-disabled={importMutation.isPending}
            aria-label="Add a theme zip. Drag and drop, or choose a file"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
          >
            <span className={styles.dropZoneIcon} aria-hidden>
              <FileUp size={26} strokeWidth={2} />
            </span>
            <p className={styles.dropZoneText}>
              {importMutation.isPending ? 'Importing...' : 'Add A Theme Zip'}
            </p>
            <p className={styles.dropZoneHint}>
              Drag and drop, or choose a file (.zip,{' '}
              {FEED_THEME_ZIP_MAX_BYTES / (1024 * 1024)} MB max)
            </p>
            {!importMutation.isPending && (
              <span className={styles.dropZoneAction}>Choose file</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed,application/x-compressed"
              className={styles.fileInput}
              disabled={importMutation.isPending}
              onChange={handleFileChange}
              tabIndex={-1}
              aria-hidden
            />
          </div>
          <ExploreThemesCta onClick={() => setExploreOpen(true)} />
        </div>
        {importError && (
          <div className={styles.errorCard} role="alert">
            <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
            <p className={styles.errorCardMessage}>{importError}</p>
          </div>
        )}
        {importNotice && (
          <div className={styles.importSuccessCard} role="status">
            <CircleCheck size={18} className={styles.importSuccessIcon} aria-hidden />
            <p className={styles.importSuccessMessage}>{importNotice}</p>
          </div>
        )}
      </div>

      <div className={styles.builtinCard}>
        <div className={styles.builtinHeader}>
          <div className={styles.builtinHeaderTop}>
            <h2 className={styles.importTitle}>Server Themes</h2>
            <a
              className={styles.skillDownloadBtn}
              href="/theme-SKILL.md"
              download="SKILL.md"
              aria-label="Download theme SKILL.md for AI theme generation"
            >
              <Download size={16} strokeWidth={2} aria-hidden />
              Download SKILL.md
            </a>
          </div>
          <p className={styles.builtinLead}>
            Download a server theme, change what you want, then import the zip above. First upload
            creates your copy; uploading again with the same package id updates it.
          </p>
        </div>
        {builtinsLoading && <p className={styles.empty}>Loading server themes...</p>}
        {!builtinsLoading && builtins.length === 0 && (
          <p className={styles.empty}>No server themes available.</p>
        )}
        {!builtinsLoading && builtins.length > 0 && (
          <ul className={styles.builtinList}>
            {builtins.map((theme) => {
              const previewBroken = Boolean(brokenPreviews[theme.id]);
              const previewSrc = previewBroken
                ? null
                : themeAssetPreviewUrl(theme.id, 'server', 'images/preview.jpg');
              return (
                <li key={theme.id} className={styles.builtinItem}>
                  {previewSrc ? (
                    <button
                      type="button"
                      className={`${styles.builtinThumb} ${styles.builtinThumbButton}`}
                      onClick={() =>
                        setLightbox({
                          src: previewSrc,
                          alt: `${theme.name} theme preview`,
                        })
                      }
                      aria-label={`View ${theme.name} preview`}
                    >
                      <img
                        src={previewSrc}
                        alt=""
                        loading="lazy"
                        className={styles.builtinThumbImage}
                        onError={() =>
                          setBrokenPreviews((prev) =>
                            prev[theme.id] ? prev : { ...prev, [theme.id]: true },
                          )
                        }
                      />
                    </button>
                  ) : (
                    <div className={styles.builtinThumb} aria-hidden>
                      <span className={styles.builtinThumbFallback}>
                        {theme.name.slice(0, 1)}
                      </span>
                    </div>
                  )}
                  <div className={styles.builtinMeta}>
                    <div className={styles.builtinTitleRow}>
                      <h3 className={styles.builtinName}>{theme.name}</h3>
                      <span className={styles.builtinVersion}>v{theme.version}</span>
                    </div>
                    <p className={styles.builtinDescription}>{theme.description}</p>
                  </div>
                  <div className={styles.rowActions}>
                    <div className={styles.rowActionsPrimary}>
                      {theme.homepage ? (
                        <a
                          className={styles.previewBtn}
                          href={theme.homepage}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${theme.name} live preview`}
                        >
                          <ExternalLink size={16} strokeWidth={2} aria-hidden />
                          Preview
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className={styles.downloadBtn}
                        onClick={() => void handleDownloadBuiltin(theme.id)}
                        disabled={downloadingId === `server:${theme.id}`}
                        aria-label={`Download ${theme.name} theme zip`}
                      >
                        <Download size={16} strokeWidth={2} aria-hidden />
                        {downloadingId === `server:${theme.id}` ? 'Preparing...' : 'Download'}
                      </button>
                      {isAdmin && theme.catalog ? (
                        <button
                          type="button"
                          className={styles.downloadBtn}
                          onClick={() => void handleUpdateServerTheme(theme.id)}
                          disabled={updatingId === theme.id}
                          aria-label={`Update ${theme.name} from catalog`}
                        >
                          <RefreshCw size={16} strokeWidth={2} aria-hidden />
                          {updatingId === theme.id ? 'Checking...' : 'Update'}
                        </button>
                      ) : null}
                    </div>
                    {isAdmin ? (
                      <div className={styles.rowActionsAdmin}>
                        <button
                          type="button"
                          className={styles.iconActionBtn}
                          onClick={() => setEditorThemeId(theme.id)}
                          aria-label={`Edit server theme ${theme.name}`}
                        >
                          <Settings2 size={16} strokeWidth={2} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => setThemeToDelete({ kind: 'server', theme })}
                          disabled={deleteMutation.isPending}
                          aria-label={`Delete server theme ${theme.name}`}
                        >
                          <Trash2 size={16} strokeWidth={2} aria-hidden />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {downloadError && (
          <div className={styles.errorCard} role="alert">
            <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
            <p className={styles.errorCardMessage}>{downloadError}</p>
          </div>
        )}
      </div>

      <div className={styles.builtinCard}>
        <div className={styles.builtinHeader}>
          <div className={styles.builtinHeaderTop}>
            <h2 className={styles.importTitle}>Your Themes</h2>
          </div>
        </div>
        {isLoading && <p className={styles.empty}>Loading themes...</p>}
        {isError && <p className={styles.empty}>Failed to load themes.</p>}
        {!isLoading && !isError && themes.length === 0 && (
          <p className={styles.empty}>No imported themes yet.</p>
        )}
        {!isLoading && !isError && themes.length > 0 && (
          <ul className={styles.builtinList}>
            {themes.map((theme) => {
              const label = displayThemeName(theme.name);
              const previewBroken = Boolean(brokenPreviews[`user:${theme.id}`]);
              const previewSrc = previewBroken
                ? null
                : themeAssetPreviewUrl(theme.id, 'user', 'images/preview.jpg');
              return (
                <li key={theme.id} className={styles.builtinItem}>
                  {previewSrc ? (
                    <button
                      type="button"
                      className={`${styles.builtinThumb} ${styles.builtinThumbButton}`}
                      onClick={() =>
                        setLightbox({
                          src: previewSrc,
                          alt: `${label} theme preview`,
                        })
                      }
                      aria-label={`View ${label} preview`}
                    >
                      <img
                        src={previewSrc}
                        alt=""
                        loading="lazy"
                        className={styles.builtinThumbImage}
                        onError={() =>
                          setBrokenPreviews((prev) =>
                            prev[`user:${theme.id}`]
                              ? prev
                              : { ...prev, [`user:${theme.id}`]: true },
                          )
                        }
                      />
                    </button>
                  ) : (
                    <div className={styles.builtinThumb} aria-hidden>
                      <span className={styles.builtinThumbFallback}>
                        {label.slice(0, 1)}
                      </span>
                    </div>
                  )}
                  <div className={styles.builtinMeta}>
                    <div className={styles.builtinTitleRow}>
                      <h3 className={styles.builtinName}>{label}</h3>
                      <span className={styles.builtinVersion}>v{theme.version}</span>
                    </div>
                    {theme.description ? (
                      <p className={styles.builtinDescription}>{theme.description}</p>
                    ) : null}
                  </div>
                  <div className={styles.rowActions}>
                    <div className={styles.rowActionsPrimary}>
                      <button
                        type="button"
                        className={styles.downloadBtn}
                        onClick={() => void handleDownloadUserTheme(theme.id)}
                        disabled={downloadingId === `user:${theme.id}`}
                        aria-label={`Download ${label} theme zip`}
                      >
                        <Download size={16} strokeWidth={2} aria-hidden />
                        {downloadingId === `user:${theme.id}` ? 'Preparing...' : 'Download'}
                      </button>
                    </div>
                    <div className={styles.rowActionsAdmin}>
                      <button
                        type="button"
                        className={styles.iconActionBtn}
                        onClick={() => setEditorThemeId(theme.id)}
                        aria-label={`Edit theme ${label}`}
                      >
                        <Settings2 size={16} strokeWidth={2} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => setThemeToDelete({ kind: 'user', theme })}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete theme ${label}`}
                      >
                        <Trash2 size={16} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog.Root
        open={!!lightbox}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.lightboxOverlay} />
          <Dialog.Content className={styles.lightboxContent} aria-describedby={undefined}>
            <Dialog.Title className={styles.srOnly}>
              {lightbox?.alt?.trim() || 'Theme preview'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.lightboxClose} aria-label="Close preview">
                <X size={18} />
              </button>
            </Dialog.Close>
            {lightbox ? (
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className={styles.lightboxImg}
                onClick={() => setLightbox(null)}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={!!themeToDelete}
        onOpenChange={(open) => !open && setThemeToDelete(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Delete theme?</Dialog.Title>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {themeToDelete
                ? themeToDelete.kind === 'server'
                  ? `This will permanently delete the server theme "${themeToDelete.theme.name}" from disk. Podcasts using it will revert to the default layout.`
                  : `This will permanently delete "${displayThemeName(themeToDelete.theme.name)}". Podcasts using this theme will revert to the default layout.`
                : 'This will permanently delete this theme.'}
            </Dialog.Description>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Cancel deleting theme">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.submitDanger}
                onClick={handleDeleteConfirm}
                disabled={deleteMutation.isPending}
                aria-label="Confirm delete theme"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ExploreThemesDialog
        open={exploreOpen}
        isAdmin={isAdmin}
        serverPackageIds={serverPackageIds}
        onOpenChange={setExploreOpen}
        onInstalled={(message) => {
          setImportError(null);
          setImportNotice(message);
          setExploreOpen(false);
        }}
      />

      <ThemeEditorDialog
        open={!!editorThemeId}
        themeId={editorThemeId}
        isAdmin={isAdmin}
        onClose={() => setEditorThemeId(null)}
        onThemeIdChange={(nextId) => setEditorThemeId(nextId)}
      />
    </div>
  );
}
