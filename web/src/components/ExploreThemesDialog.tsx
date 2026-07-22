import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  CircleAlert,
  Compass,
  Library,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  HARBORFM_OFFICIAL_THEME_CATALOG_URL,
  addThemeDestination,
  browseThemeDestinationCatalog,
  deleteThemeDestination,
  installThemeFromCatalog,
  listThemeDestinations,
  type ThemeCatalogEntry,
  type ThemeDestination,
} from '../api/themes';
import { StripeConfirmDialog } from './StripePayments/StripeConfirmDialog';
import styles from './ExploreThemesDialog.module.css';

type View =
  | { kind: 'destinations' }
  | { kind: 'add' }
  | { kind: 'browse'; destination: ThemeDestination };

type Props = {
  open: boolean;
  isAdmin: boolean;
  serverPackageIds: Set<string>;
  onOpenChange: (open: boolean) => void;
  onInstalled: (message: string) => void;
};

export function ExploreThemesDialog({
  open,
  isAdmin,
  serverPackageIds,
  onOpenChange,
  onInstalled,
}: Props) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: 'destinations' });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, true>>({});
  const [pendingDelete, setPendingDelete] = useState<ThemeDestination | null>(null);

  useEffect(() => {
    if (!open) {
      setView({ kind: 'destinations' });
      setName('');
      setUrl('');
      setFormError(null);
      setInstallingKey(null);
      setBrokenPreviews({});
      setPendingDelete(null);
    }
  }, [open]);

  const destinationsQuery = useQuery({
    queryKey: ['themes', 'destinations'],
    queryFn: listThemeDestinations,
    enabled: open,
  });

  const browseQuery = useQuery({
    queryKey: [
      'themes',
      'destinations',
      view.kind === 'browse' ? view.destination.id : null,
      'catalog',
    ],
    queryFn: () =>
      browseThemeDestinationCatalog(
        (view as Extract<View, { kind: 'browse' }>).destination.id,
      ),
    enabled: open && view.kind === 'browse',
  });

  const addMutation = useMutation({
    mutationFn: addThemeDestination,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['themes', 'destinations'] });
      setView({ kind: 'destinations' });
      setName('');
      setUrl('');
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteThemeDestination,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['themes', 'destinations'] });
      setPendingDelete(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
      setPendingDelete(null);
    },
  });

  const installMutation = useMutation({
    mutationFn: installThemeFromCatalog,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['themes'] });
      queryClient.invalidateQueries({ queryKey: ['themes', 'builtins'] });
      setInstallingKey(null);
      const label = result.name || result.packageId;
      onInstalled(
        result.scope === 'server'
          ? result.updated
            ? `Updated server theme ${label}.`
            : `Added server theme ${label}.`
          : result.updated
            ? `Updated ${label} in your themes.`
            : `Added ${label} to your themes.`,
      );
    },
    onError: (err: Error) => {
      setInstallingKey(null);
      setFormError(err.message);
    },
  });

  const destinations = destinationsQuery.data?.destinations ?? [];
  const hasOfficial = destinationsQuery.data?.hasOfficial ?? false;
  const officialUrl =
    destinationsQuery.data?.officialCatalogUrl ?? HARBORFM_OFFICIAL_THEME_CATALOG_URL;

  function goDestinations() {
    setFormError(null);
    setName('');
    setUrl('');
    setView({ kind: 'destinations' });
  }

  function openAddDestination() {
    setFormError(null);
    setName('');
    setUrl('');
    setView({ kind: 'add' });
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setFormError('Enter a name for this catalog destination.');
      return;
    }
    if (!trimmedUrl) {
      setFormError('Paste a catalog.json URL.');
      return;
    }
    addMutation.mutate({ name: trimmedName, url: trimmedUrl });
  }

  function handleInstall(theme: ThemeCatalogEntry, scope: 'user' | 'server') {
    if (view.kind !== 'browse') return;
    setFormError(null);
    setInstallingKey(`${scope}:${theme.id}`);
    installMutation.mutate({
      destinationId: view.destination.id,
      packageId: theme.id,
      scope,
    });
  }

  const title =
    view.kind === 'add'
      ? 'Add New Destination'
      : view.kind === 'browse'
        ? view.destination.name
        : 'Explore Themes';

  const srDescription =
    view.kind === 'add'
      ? 'Add a theme catalog destination'
      : view.kind === 'browse'
        ? 'Browse themes in this catalog'
        : 'Explore theme catalog destinations';

  return (
    <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={`${styles.content} ${view.kind === 'browse' ? styles.contentWide : ''}`}
          aria-describedby={undefined}
        >
          <div className={styles.header}>
            <div className={styles.headerMain}>
              <div className={styles.headerTop}>
                <Dialog.Title className={styles.title}>{title}</Dialog.Title>
              </div>
              <Dialog.Description className={styles.srOnly}>
                {srDescription}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className={styles.closeBtn} aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className={styles.body}>
            {view.kind === 'destinations' ? (
              <>
                {isAdmin ? (
                  <div className={`${styles.toolbar} ${styles.toolbarEnd}`}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={openAddDestination}
                    >
                      <Plus size={16} strokeWidth={2} aria-hidden />
                      Add New Destination
                    </button>
                  </div>
                ) : null}

                {destinationsQuery.isLoading && (
                  <p className={styles.loadingText}>Loading destinations...</p>
                )}
                {destinationsQuery.isError && (
                  <div className={styles.errorCard} role="alert">
                    <CircleAlert size={16} aria-hidden />
                    <p>
                      {(destinationsQuery.error as Error).message ||
                        'Failed to load destinations.'}
                    </p>
                  </div>
                )}
                {!destinationsQuery.isLoading &&
                  !destinationsQuery.isError &&
                  destinations.length === 0 && (
                    <div className={styles.emptyState}>
                      <span className={styles.emptyIcon} aria-hidden>
                        <Library size={20} strokeWidth={2} />
                      </span>
                      <p className={styles.emptyTitle}>No destinations yet</p>
                      <p className={styles.emptyText}>
                        {isAdmin
                          ? 'Add a catalog destination to browse and install themes.'
                          : 'Ask an administrator to add a catalog destination.'}
                      </p>
                      {isAdmin ? (
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={openAddDestination}
                        >
                          <Plus size={16} strokeWidth={2} aria-hidden />
                          Add New Destination
                        </button>
                      ) : null}
                    </div>
                  )}
                {destinations.length > 0 && (
                  <ul className={styles.destinationList}>
                    {destinations.map((destination) => (
                      <li key={destination.id} className={styles.destinationItem}>
                        <span className={styles.destinationIcon} aria-hidden>
                          <Library size={18} strokeWidth={2} />
                        </span>
                        <div className={styles.destinationMeta}>
                          <p className={styles.destinationName}>{destination.name}</p>
                          <p className={styles.destinationUrl} title={destination.url}>
                            {destination.url}
                          </p>
                        </div>
                        <div className={styles.destinationActions}>
                          <button
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() => {
                              setFormError(null);
                              setView({ kind: 'browse', destination });
                            }}
                          >
                            Browse
                          </button>
                          {isAdmin ? (
                            <button
                              type="button"
                              className={styles.deleteIconBtn}
                              aria-label={`Remove ${destination.name}`}
                              disabled={deleteMutation.isPending}
                              onClick={() => setPendingDelete(destination)}
                            >
                              <Trash2 size={16} strokeWidth={2} />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}

            {view.kind === 'add' ? (
              <form className={styles.form} onSubmit={handleAddSubmit}>
                <label className={styles.label}>
                  Catalog JSON URL
                  <input
                    className={styles.input}
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/catalog.json"
                    autoFocus
                    disabled={addMutation.isPending}
                  />
                </label>
                <label className={styles.label}>
                  Name
                  <input
                    className={styles.input}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Official Themes"
                    maxLength={120}
                    disabled={addMutation.isPending}
                  />
                </label>

                {!hasOfficial ? (
                  <div className={styles.quickAddCard}>
                    <p className={styles.quickAddTitle}>Official Themes</p>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      disabled={addMutation.isPending}
                      onClick={() => {
                        setFormError(null);
                        setName('Official Themes');
                        setUrl(officialUrl);
                        addMutation.mutate({
                          name: 'Official Themes',
                          url: officialUrl,
                        });
                      }}
                    >
                      Quick Add
                    </button>
                  </div>
                ) : null}

                {formError ? (
                  <div className={styles.errorCard} role="alert">
                    <CircleAlert size={16} aria-hidden />
                    <p>{formError}</p>
                  </div>
                ) : null}

                <div className={styles.footer}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    disabled={addMutation.isPending}
                    onClick={goDestinations}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.primaryBtn}
                    disabled={addMutation.isPending}
                  >
                    {addMutation.isPending ? (
                      'Adding...'
                    ) : (
                      <>
                        <Plus size={16} strokeWidth={2} aria-hidden />
                        Add Destination
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : null}

            {view.kind === 'browse' ? (
              <>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={goDestinations}
                  >
                    <ArrowLeft size={16} strokeWidth={2} aria-hidden />
                    View All Catalogs
                  </button>
                </div>
                {browseQuery.isLoading && (
                  <p className={styles.loadingText}>Loading catalog...</p>
                )}
                {browseQuery.isError && (
                  <div className={styles.errorCard} role="alert">
                    <CircleAlert size={16} aria-hidden />
                    <p>
                      {(browseQuery.error as Error).message || 'Failed to load catalog.'}
                    </p>
                  </div>
                )}
                {formError ? (
                  <div className={styles.errorCard} role="alert">
                    <CircleAlert size={16} aria-hidden />
                    <p>{formError}</p>
                  </div>
                ) : null}
                {browseQuery.data && browseQuery.data.themes.length === 0 && (
                  <div className={styles.emptyState}>
                    <span className={styles.emptyIcon} aria-hidden>
                      <Compass size={20} strokeWidth={2} />
                    </span>
                    <p className={styles.emptyTitle}>No themes in this catalog</p>
                    <p className={styles.emptyText}>
                      This destination returned an empty themes list.
                    </p>
                  </div>
                )}
                {browseQuery.data && browseQuery.data.themes.length > 0 && (
                  <ul className={styles.themeList}>
                    {browseQuery.data.themes.map((theme) => {
                      const previewBroken = Boolean(brokenPreviews[theme.id]);
                      const previewSrc =
                        !previewBroken && theme.previewUrl ? theme.previewUrl : null;
                      const alreadyServer = serverPackageIds.has(theme.id);
                      return (
                        <li key={theme.id} className={styles.themeItem}>
                          <div className={styles.themeThumb} aria-hidden>
                            {previewSrc ? (
                              <img
                                src={previewSrc}
                                alt=""
                                loading="lazy"
                                onError={() =>
                                  setBrokenPreviews((prev) =>
                                    prev[theme.id] ? prev : { ...prev, [theme.id]: true },
                                  )
                                }
                              />
                            ) : (
                              <span className={styles.themeThumbFallback}>
                                {theme.name.slice(0, 1)}
                              </span>
                            )}
                          </div>
                          <div className={styles.themeMeta}>
                            <div className={styles.themeTitleRow}>
                              <h3 className={styles.themeName}>{theme.name}</h3>
                              <span className={styles.themeVersion}>v{theme.version}</span>
                              {alreadyServer ? (
                                <span className={styles.serverBadge}>On server</span>
                              ) : null}
                            </div>
                            {theme.description ? (
                              <p className={styles.themeDescription}>{theme.description}</p>
                            ) : null}
                          </div>
                          <div className={styles.themeActions}>
                            {isAdmin && !alreadyServer ? (
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                disabled={installMutation.isPending}
                                onClick={() => handleInstall(theme, 'server')}
                              >
                                {installingKey === `server:${theme.id}`
                                  ? 'Adding...'
                                  : 'Add Server Theme'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              disabled={installMutation.isPending}
                              onClick={() => handleInstall(theme, 'user')}
                            >
                              {installingKey === `user:${theme.id}`
                                ? 'Adding...'
                                : 'Add To My Themes'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <StripeConfirmDialog
      open={pendingDelete != null}
      title="Delete destination?"
      description={
        pendingDelete
          ? `Are you sure you want to delete "${pendingDelete.name}"? Themes already installed on this instance are not removed.`
          : ''
      }
      confirmLabel="Delete"
      pendingLabel="Deleting..."
      pending={deleteMutation.isPending}
      elevated
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setPendingDelete(null);
      }}
      onConfirm={() => {
        if (!pendingDelete) return;
        deleteMutation.mutate(pendingDelete.id);
      }}
    />
    </>
  );
}

/** Compact CTA used in the Import theme card. */
export function ExploreThemesCta({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.exploreCta}
      onClick={onClick}
      disabled={disabled}
      aria-label="Explore Themes from catalog destinations"
    >
      <span className={styles.exploreCtaIcon} aria-hidden>
        <Compass size={26} strokeWidth={2} />
      </span>
      <span className={styles.exploreCtaText}>Explore Themes</span>
      <span className={styles.exploreCtaHint}>Browse catalogs and install themes</span>
    </button>
  );
}
