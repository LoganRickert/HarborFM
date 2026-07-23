import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPodcast } from '../api/podcasts';
import { getPublicConfig } from '../api/public';
import { me, isReadOnly } from '../api/auth';
import { FullPageLoading } from '../components/Loading';
import { EditShowDetailsDialog } from './EditShowDetailsDialog';
import { EditSocialLinksDialog } from './EditSocialLinksDialog';
import { EditPageCustomizationsDialog } from './EditPageCustomizationsDialog';
import { Breadcrumb } from '../components/Breadcrumb';
import { PodcastHero } from '../components/PodcastDetail/PodcastHero';
import { RssFeedCard } from '../components/PodcastDetail/RssFeedCard';
import { ShowCastCard } from '../components/ShowCast';
import { ExportsSection } from '../components/Exports/ExportsSection';
import { CollaboratorsSection } from '../components/Collaborators/CollaboratorsSection';
import { SubscriberTokensSection } from '../components/SubscriberTokens/SubscriberTokensSection';
import { StripePaymentsSection } from '../components/StripePayments/StripePaymentsSection';
import { StripeSubscriptionsSection } from '../components/StripeSubscriptions/StripeSubscriptionsSection';
import { EpisodeAlertsSection } from '../components/EpisodeAlerts/EpisodeAlertsSection';
import sharedStyles from '../components/PodcastDetail/shared.module.css';
import localStyles from './PodcastDetail.module.css';

const styles = { ...sharedStyles, ...localStyles };

export function PodcastDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: podcast, isLoading, isFetching, isError } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 10_000,
  });

  const publicFeedsEnabled = publicConfig?.publicFeedsEnabled !== false;
  const readOnly = isReadOnly(meData?.user);
  const myRole = (podcast as { myRole?: string } | undefined)?.myRole;
  const canManageShow = myRole === 'owner' || myRole === 'manager';

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [linksDialogOpen, setLinksDialogOpen] = useState(false);
  const [pageCustomizationsDialogOpen, setPageCustomizationsDialogOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  if (!id) return null;
  if (isLoading || (!podcast && isFetching)) return <FullPageLoading />;
  if (isError || !podcast) return <p className={styles.error}>Podcast not found.</p>;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast.title, mobileLabel: 'Podcast' },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumb items={breadcrumbItems} />

      <div className={`${styles.card} ${styles.podcastShowCard}`}>
        <PodcastHero
          podcast={podcast}
          readOnly={readOnly}
          canManageShow={canManageShow}
          onEditClick={() => setDetailsDialogOpen(true)}
          onLinksClick={() => setLinksDialogOpen(true)}
          onPageCustomizationsClick={() => setPageCustomizationsDialogOpen(true)}
          publicFeedsEnabled={publicFeedsEnabled}
          detailsExpanded={detailsExpanded}
          onDetailsToggle={() => setDetailsExpanded((e) => !e)}
        />
      </div>

      {detailsDialogOpen && (
        <EditShowDetailsDialog
          open
          podcastId={id}
          onClose={() => setDetailsDialogOpen(false)}
        />
      )}

      {linksDialogOpen && (
        <EditSocialLinksDialog
          open
          podcastId={id}
          onClose={() => setLinksDialogOpen(false)}
        />
      )}

      {pageCustomizationsDialogOpen && (
        <EditPageCustomizationsDialog
          open
          podcastId={id}
          onClose={() => setPageCustomizationsDialogOpen(false)}
        />
      )}

      <RssFeedCard podcast={podcast} />

      <ShowCastCard podcastId={id} myRole={myRole} />

      {canManageShow && (
        <CollaboratorsSection
          podcastId={id}
          effectiveMaxCollaborators={podcast?.effectiveMaxCollaborators ?? undefined}
        />
      )}

      {canManageShow && <ExportsSection podcastId={id} readOnly={readOnly} />}

      {canManageShow && (
        <SubscriberTokensSection
          podcastId={id}
          podcastSlug={podcast.slug}
          readOnly={readOnly}
          subscriberOnlyFeedEnabled={Boolean(podcast?.subscriberOnlyFeedEnabled)}
          effectiveMaxSubscriberTokens={podcast?.effectiveMaxSubscriberTokens ?? undefined}
          canonicalFeedUrl={podcast.canonicalFeedUrl}
        />
      )}

      {canManageShow && Boolean(podcast?.subscriberOnlyFeedEnabled) && (
        <StripePaymentsSection podcastId={id} readOnly={readOnly} />
      )}

      {canManageShow && Boolean(podcast?.subscriberOnlyFeedEnabled) && (
        <StripeSubscriptionsSection podcastId={id} readOnly={readOnly} />
      )}

      {canManageShow && (
        <EpisodeAlertsSection podcastId={id} readOnly={readOnly} />
      )}
    </div>
  );
}
