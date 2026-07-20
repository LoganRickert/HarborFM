import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, CircleCheck, Download, FileUp, Settings2, Trash2 } from 'lucide-react';
import { me } from '../api/auth';
import {
  listThemes,
  listBuiltinThemes,
  downloadBuiltinTheme,
  downloadUserTheme,
  importTheme,
  deleteTheme,
  deleteServerTheme,
  FEED_THEME_ZIP_MAX_BYTES,
  type BuiltinThemeListItem,
  type ThemeListItem,
} from '../api/themes';
import { ThemeEditorDialog } from '../components/ThemeEditorDialog';
import { formatDateShort } from '../utils/format';
import styles from './Themes.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const ownedServerPackageIds = new Set(
    themes.filter((t) => serverPackageIds.has(t.packageId)).map((t) => t.packageId),
  );

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
            {importMutation.isPending ? 'Importing…' : 'Add A Theme Zip'}
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
        {builtinsLoading && <p className={styles.empty}>Loading server themes…</p>}
        {!builtinsLoading && builtins.length === 0 && (
          <p className={styles.empty}>No server themes available.</p>
        )}
        {!builtinsLoading && builtins.length > 0 && (
          <ul className={styles.builtinList}>
            {builtins.map((theme) => {
              const hasCopy = ownedServerPackageIds.has(theme.id);
              return (
                <li key={theme.id} className={styles.builtinItem}>
                  <div className={styles.builtinMeta}>
                    <div className={styles.builtinTitleRow}>
                      <h3 className={styles.builtinName}>{theme.name}</h3>
                      <span className={styles.builtinVersion}>v{theme.version}</span>
                      {hasCopy && <span className={styles.builtinCopyBadge}>Your copy</span>}
                    </div>
                    <p className={styles.builtinDescription}>{theme.description}</p>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.downloadBtn}
                      onClick={() => void handleDownloadBuiltin(theme.id)}
                      disabled={downloadingId === `server:${theme.id}`}
                      aria-label={`Download ${theme.name} theme zip`}
                    >
                      <Download size={16} strokeWidth={2} aria-hidden />
                      {downloadingId === `server:${theme.id}` ? 'Preparing…' : 'Download'}
                    </button>
                    {isAdmin && (
                      <>
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
                      </>
                    )}
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

      <div className={styles.tableWrap}>
        <div className={styles.tableHeader}>
          <h2 className={styles.tableTitle}>Your themes</h2>
        </div>
        {isLoading && <p className={styles.empty}>Loading themes...</p>}
        {isError && <p className={styles.empty}>Failed to load themes.</p>}
        {!isLoading && !isError && themes.length === 0 && (
          <p className={styles.empty}>No imported themes yet.</p>
        )}
        {!isLoading && !isError && themes.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Size</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {themes.map((theme) => (
                <tr key={theme.id}>
                  <td className={styles.nameCell}>
                    {theme.name}
                    <span className={styles.metaMuted}>
                      Package id: {theme.packageId}
                      {serverPackageIds.has(theme.packageId)
                        ? ' (personal copy of server theme)'
                        : ''}
                    </span>
                  </td>
                  <td>{theme.version}</td>
                  <td>{formatBytes(theme.byteSize)}</td>
                  <td>{formatDateShort(theme.updatedAt)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.downloadBtn}
                        onClick={() => void handleDownloadUserTheme(theme.id)}
                        disabled={downloadingId === `user:${theme.id}`}
                        aria-label={`Download ${theme.name} theme zip`}
                      >
                        <Download size={16} strokeWidth={2} aria-hidden />
                        {downloadingId === `user:${theme.id}` ? 'Preparing…' : 'Download'}
                      </button>
                      <button
                        type="button"
                        className={styles.iconActionBtn}
                        onClick={() => setEditorThemeId(theme.id)}
                        aria-label={`Edit theme ${theme.name}`}
                      >
                        <Settings2 size={16} strokeWidth={2} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => setThemeToDelete({ kind: 'user', theme })}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete theme ${theme.name}`}
                      >
                        <Trash2 size={16} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
                  : `This will permanently delete "${themeToDelete.theme.name}". Podcasts using this theme will revert to the default layout.`
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
