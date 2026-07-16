import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { me } from '../../api/auth';
import {
  createEpisodeAlertDestination,
  deleteEpisodeAlertDestination,
  getEpisodeAlerts,
  updateEpisodeAlertDestination,
  updateEpisodeAlertsSettings,
  type EpisodeAlertDestination,
  type EpisodeAlertDestinationType,
  type EpisodeAlertList,
  type EpisodeAlertScope,
} from '../../api/episodeAlerts';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './EpisodeAlerts.module.css';
import { StripeConfirmDialog } from '../StripePayments/StripeConfirmDialog';

const styles = { ...sharedStyles, ...localStyles };

const TYPE_LABELS: Record<EpisodeAlertDestinationType, string> = {
  builtin: 'Built-In Notifications',
  byo_email: 'Bring Your Own Email (SMTP)',
  byo_sendgrid: 'Bring Your Own SendGrid',
  discord: 'Discord Webhook',
  slack: 'Slack Webhook',
  telegram: 'Telegram',
  mastodon: 'Mastodon',
  matrix: 'Matrix',
  lemmy: 'Lemmy',
  bluesky: 'Bluesky',
  json_webhook: 'JSON Webhook',
};

const TYPE_HELP: Partial<Record<EpisodeAlertDestinationType, { text: string; href?: string }>> = {
  builtin: {
    text: 'Uses the server Settings email provider (SMTP, SendGrid, or Discord webhook).',
  },
  byo_email: {
    text: 'Send with your own SMTP credentials for this show only.',
  },
  byo_sendgrid: {
    text: 'Send with your own SendGrid API key for this show only.',
    href: 'https://docs.sendgrid.com/for-developers/sending-email/api-getting-started',
  },
  discord: {
    text: 'Post to a Discord channel via an incoming webhook. Leave the message blank to use the rich episode embed (artwork, description, listen link).',
    href: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
  },
  slack: {
    text: 'Post to Slack via an incoming webhook. Leave the message blank for a rich Block Kit post with artwork and description.',
    href: 'https://api.slack.com/messaging/webhooks',
  },
  telegram: {
    text: 'Create a bot with BotFather, then use the bot token and chat/channel ID. Leave the message blank for a photo caption with episode details.',
    href: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  },
  mastodon: {
    text: 'Create an app token with write:statuses on your Mastodon instance. Leave the status blank for a default post with title, description, and listen link.',
    href: 'https://docs.joinmastodon.org/client/authorized/',
  },
  matrix: {
    text: 'Needs a homeserver URL, access token, and room ID (!room:server). Leave the message blank for a default episode alert.',
    href: 'https://spec.matrix.org/latest/client-server-api/',
  },
  lemmy: {
    text: 'Post to a Lemmy community using JWT or username/password. Leave title/body blank for defaults with description and listen link.',
  },
  bluesky: {
    text: 'Use your handle and an app password (not your main password). Leave the post blank for a default post with an episode link card.',
    href: 'https://bsky.app/settings/app-passwords',
  },
  json_webhook: {
    text: 'POST a custom JSON body to any URL. Leave the body blank for the default payload, or use template variables below.',
  },
};

const TEMPLATE_VARS =
  '{{title}} {{description}} {{episodeUrl}} {{rssUrl}} {{publishAt}} {{premium}} {{podcastTitle}} {{artworkUrl}} {{seasonEpisode}}';

interface EpisodeAlertsSectionProps {
  podcastId: string;
  readOnly?: boolean;
}

type FormState = {
  name: string;
  type: EpisodeAlertDestinationType;
  enabled: boolean;
  episodeScope: EpisodeAlertScope;
  config: Record<string, string>;
};

function emptyForm(type: EpisodeAlertDestinationType = 'discord'): FormState {
  return { name: '', type, enabled: true, episodeScope: 'all', config: {} };
}

function configFromDestination(d: EpisodeAlertDestination): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.config ?? {})) {
    if (v == null) continue;
    if (typeof v === 'boolean') out[k] = v ? 'true' : 'false';
    else out[k] = String(v);
  }
  return out;
}

export function EpisodeAlertsSection({ podcastId, readOnly }: EpisodeAlertsSectionProps) {
  const queryClient = useQueryClient();
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const canEpisodeAlert = meData?.user?.canEpisodeAlert === 1;

  const { data, isLoading } = useQuery({
    queryKey: ['episode-alerts', podcastId],
    queryFn: () => getEpisodeAlerts(podcastId),
    enabled: Boolean(podcastId) && canEpisodeAlert,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EpisodeAlertDestination | null>(null);

  const settingsMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateEpisodeAlertsSettings>[1]) =>
      updateEpisodeAlertsSettings(podcastId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['episode-alerts', podcastId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveDestMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form.config)) {
        if (k === 'smtpPort') {
          const n = Number(v);
          if (!Number.isNaN(n)) config[k] = n;
          continue;
        }
        if (k === 'smtpSecure') {
          config[k] = v === 'true';
          continue;
        }
        config[k] = v;
      }
      if (editingId) {
        return updateEpisodeAlertDestination(podcastId, editingId, {
          name: form.name,
          enabled: form.enabled,
          episodeScope: form.episodeScope,
          config,
        });
      }
      return createEpisodeAlertDestination(podcastId, {
        name: form.name,
        type: form.type,
        enabled: form.enabled,
        episodeScope: form.episodeScope,
        config,
      });
    },
    onSuccess: () => {
      setAdding(false);
      setEditingId(null);
      setForm(emptyForm());
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['episode-alerts', podcastId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (destinationId: string) =>
      deleteEpisodeAlertDestination(podcastId, destinationId),
    onSuccess: (_data, destinationId) => {
      if (editingId === destinationId) {
        setEditingId(null);
        setForm(emptyForm());
      }
      setPendingDelete(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['episode-alerts', podcastId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const settings = data?.settings;
  const destinations = data?.destinations ?? [];
  const listCounts = data?.listCounts;

  const typeHelp = useMemo(() => TYPE_HELP[form.type], [form.type]);

  function setConfig(key: string, value: string) {
    setForm((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
  }

  function startEdit(d: EpisodeAlertDestination) {
    setAdding(false);
    setEditingId(d.id);
    setForm({
      name: d.name,
      type: d.type,
      enabled: d.enabled,
      episodeScope: d.episodeScope === 'premium' ? 'premium' : 'all',
      config: configFromDestination(d),
    });
    setError(null);
  }

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setForm(emptyForm('discord'));
    setError(null);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
  }

  if (!canEpisodeAlert) {
    return (
      <div className={styles.card}>
        <div className={styles.exportHeader}>
          <div className={styles.exportTitle}>
            <Bell size={20} aria-hidden />
            <h2 className={styles.sectionTitle}>Episode Alerts</h2>
          </div>
        </div>
        <div className={styles.disabledCard}>
          Episode Alerts are not enabled for your account. Ask an administrator to turn on
          Can Episode Alert.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Bell size={20} aria-hidden />
          <h2 className={styles.sectionTitle}>Episode Alerts</h2>
        </div>
      </div>
      <p className={styles.pdCardSectionSub}>
        Notify listeners and communities when a new episode is released.
      </p>

      {isLoading || !settings ? (
        <p className={styles.pdCardSectionSub}>Loading…</p>
      ) : (
        <>
          {listCounts && (
            <div className={styles.listStats} aria-live="polite">
              <div className={styles.listStatsIntro}>
                <span className={styles.listStatsEyebrow}>Email alert lists</span>
                <strong className={styles.listStatsTotal}>
                  {listCounts.total === 0
                    ? 'Waiting for the first signup'
                    : listCounts.total === 1
                      ? '1 verified email on alert lists'
                      : `${listCounts.total} verified emails on alert lists`}
                </strong>
              </div>
              <div className={styles.listStatsGrid} role="list">
                <div
                  role="listitem"
                  className={
                    listCounts.general > 0 ? styles.listStatLive : styles.listStat
                  }
                >
                  <span className={styles.listStatValue}>{listCounts.general}</span>
                  <span className={styles.listStatLabel}>General</span>
                </div>
                <div
                  role="listitem"
                  className={
                    listCounts.subscribers > 0 ? styles.listStatLive : styles.listStat
                  }
                >
                  <span className={styles.listStatValue}>{listCounts.subscribers}</span>
                  <span className={styles.listStatLabel}>Subscribers</span>
                </div>
              </div>
            </div>
          )}

          <div className={styles.showSettingsStack}>
            <div className={styles.plansSetting}>
              <div className={styles.plansSettingText}>
                <span className={styles.plansSettingLabel}>Episode alerts</span>
              </div>
              <div className={styles.segmented} role="group" aria-label="Episode alerts enabled">
                <button
                  type="button"
                  className={!settings.episodeAlertsEnabled ? styles.segmentedActive : styles.segmentedBtn}
                  disabled={readOnly || settingsMutation.isPending}
                  onClick={() => settingsMutation.mutate({ episodeAlertsEnabled: false })}
                >
                  Disabled
                </button>
                <button
                  type="button"
                  className={settings.episodeAlertsEnabled ? styles.segmentedActive : styles.segmentedBtn}
                  disabled={readOnly || settingsMutation.isPending}
                  onClick={() => settingsMutation.mutate({ episodeAlertsEnabled: true })}
                >
                  Enabled
                </button>
              </div>
            </div>

            <div className={styles.plansSetting}>
              <div className={styles.plansSettingText}>
                <span className={styles.plansSettingLabel}>Checkout signup list</span>
                <span className={styles.plansSettingHint}>
                  When a listener opts in at membership checkout, which mailing list they join.
                  General is the same list as Get Alerts on the public page.
                </span>
              </div>
              <div className={styles.segmented} role="group" aria-label="Checkout list">
                <button
                  type="button"
                  className={
                    settings.episodeAlertsCheckoutList === 'general'
                      ? styles.segmentedActive
                      : styles.segmentedBtn
                  }
                  disabled={readOnly || settingsMutation.isPending}
                  onClick={() =>
                    settingsMutation.mutate({
                      episodeAlertsCheckoutList: 'general' satisfies EpisodeAlertList,
                    })
                  }
                >
                  General
                </button>
                <button
                  type="button"
                  className={
                    settings.episodeAlertsCheckoutList === 'subscribers'
                      ? styles.segmentedActive
                      : styles.segmentedBtn
                  }
                  disabled={readOnly || settingsMutation.isPending}
                  onClick={() =>
                    settingsMutation.mutate({
                      episodeAlertsCheckoutList: 'subscribers' satisfies EpisodeAlertList,
                    })
                  }
                >
                  Subscribers
                </button>
              </div>
            </div>

            <div className={styles.plansSetting}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Mailing address / PO Box (optional)</span>
                <input
                  className={styles.input}
                  disabled={readOnly}
                  placeholder="e.g. PO Box 123, City, ST 00000"
                  defaultValue={settings.episodeAlertsMailingAddress ?? ''}
                  onBlur={(e) => {
                    const next = e.target.value.trim() || null;
                    if (next !== (settings.episodeAlertsMailingAddress ?? null)) {
                      settingsMutation.mutate({ episodeAlertsMailingAddress: next });
                    }
                  }}
                />
                <span className={styles.plansSettingHint}>
                  Shown in email footers. Recommended for US commercial email (CAN-SPAM physical
                  address).{' '}
                  <a
                    href="https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business"
                    target="_blank"
                    rel="noreferrer"
                  >
                    FTC guide <ExternalLink size={12} style={{ display: 'inline' }} />
                  </a>
                </span>
              </label>
            </div>
          </div>

          <div className={styles.exportHeader} style={{ marginTop: '0.5rem' }}>
            <h3 className={styles.sectionTitle} style={{ fontSize: '1rem' }}>
              Destinations
            </h3>
            {!readOnly && !adding && !editingId && (
              <button type="button" className={styles.secondaryBtn} onClick={startAdd}>
                <Plus size={16} aria-hidden /> Add destination
              </button>
            )}
          </div>

          {(adding || editingId) && (
            <div className={styles.formPanel} style={{ marginBottom: '0.75rem' }}>
              <h3 className={styles.sectionTitle} style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
                {editingId ? 'Edit destination' : 'New destination'}
              </h3>

              {!editingId && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Notification Type</span>
                  <select
                    className={styles.select}
                    value={form.type}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        type: e.target.value as EpisodeAlertDestinationType,
                        config: {},
                      }))
                    }
                  >
                    {(Object.keys(TYPE_LABELS) as EpisodeAlertDestinationType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  {typeHelp && (
                    <span className={styles.plansSettingHint}>
                      {typeHelp.text}{' '}
                      {typeHelp.href && (
                        <a href={typeHelp.href} target="_blank" rel="noreferrer">
                          Docs <ExternalLink size={12} style={{ display: 'inline' }} />
                        </a>
                      )}
                    </span>
                  )}
                </label>
              )}

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Display name</span>
                <input
                  className={styles.input}
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={TYPE_LABELS[form.type]}
                />
              </label>

              <label className="toggle" style={{ marginBottom: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                />
                <span className="toggle__track" aria-hidden="true" />
                <span>Enabled</span>
              </label>

              <div className={styles.plansSetting} style={{ marginBottom: '0.85rem' }}>
                <div className={styles.plansSettingText}>
                  <span className={styles.plansSettingLabel}>Which episodes</span>
                </div>
                <div className={styles.segmented} role="group" aria-label="Destination episode scope">
                  <button
                    type="button"
                    className={
                      form.episodeScope === 'all' ? styles.segmentedActive : styles.segmentedBtn
                    }
                    onClick={() =>
                      setForm((p) => ({ ...p, episodeScope: 'all' satisfies EpisodeAlertScope }))
                    }
                  >
                    All Episodes
                  </button>
                  <button
                    type="button"
                    className={
                      form.episodeScope === 'premium' ? styles.segmentedActive : styles.segmentedBtn
                    }
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        episodeScope: 'premium' satisfies EpisodeAlertScope,
                      }))
                    }
                  >
                    Premium only
                  </button>
                </div>
              </div>

              <DestinationConfigFields
                type={editingId ? (destinations.find((d) => d.id === editingId)?.type ?? form.type) : form.type}
                config={form.config}
                onChange={setConfig}
              />

              {(form.type === 'json_webhook' ||
                form.type === 'discord' ||
                form.type === 'slack' ||
                form.type === 'telegram' ||
                form.type === 'mastodon' ||
                form.type === 'matrix' ||
                form.type === 'bluesky' ||
                form.type === 'lemmy') && (
                <p className={styles.varCheat}>
                  Template variables: {TEMPLATE_VARS.split(' ').map((v) => (
                    <code key={v}>{v}</code>
                  ))}
                </p>
              )}

              {error && (
                <p style={{ color: 'var(--danger, #e74c3c)', fontSize: '0.875rem' }}>{error}</p>
              )}

              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryBtn} onClick={cancelForm}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={saveDestMutation.isPending}
                  onClick={() => saveDestMutation.mutate()}
                >
                  {editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {destinations.length === 0 && !adding && (
            <div className={styles.pdCardEmptyState}>No destinations yet.</div>
          )}

          <div className={styles.destList}>
            {destinations.map((d) => (
              <div key={d.id} className={styles.destItem}>
                <div className={styles.destMeta}>
                  <p className={styles.destName}>{d.name || TYPE_LABELS[d.type]}</p>
                  <p className={styles.destType}>
                    {TYPE_LABELS[d.type]} · {d.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                    {d.episodeScope === 'premium' ? 'Premium only' : 'All episodes'}
                  </p>
                </div>
                {!readOnly && (
                  <div className={styles.destActions}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => startEdit(d)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.tokenDeleteBtn}
                      aria-label={`Delete destination ${d.name || TYPE_LABELS[d.type]}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => setPendingDelete(d)}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <StripeConfirmDialog
        open={pendingDelete != null}
        title="Delete destination?"
        description={
          pendingDelete
            ? `Delete “${pendingDelete.name || TYPE_LABELS[pendingDelete.type]}”? This destination will stop receiving episode alerts.`
            : ''
        }
        pending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}

function DestinationConfigFields({
  type,
  config,
  onChange,
}: {
  type: EpisodeAlertDestinationType;
  config: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const field = (key: string, label: string, opts?: { secret?: boolean; textarea?: boolean; placeholder?: string }) => (
    <label key={key} className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {opts?.textarea ? (
        <textarea
          className={styles.textarea}
          value={config[key] ?? ''}
          placeholder={opts.placeholder}
          onChange={(e) => onChange(key, e.target.value)}
        />
      ) : (
        <input
          className={styles.input}
          type={opts?.secret ? 'password' : 'text'}
          value={config[key] ?? ''}
          placeholder={opts?.secret ? '(set)' : opts?.placeholder}
          onChange={(e) => onChange(key, e.target.value)}
          autoComplete="off"
        />
      )}
    </label>
  );

  switch (type) {
    case 'builtin':
      return null;
    case 'byo_email':
      return (
        <>
          {field('smtpHost', 'SMTP host')}
          {field('smtpPort', 'SMTP port', { placeholder: '587' })}
          {field('smtpUser', 'SMTP user')}
          {field('smtpPassword', 'SMTP password', { secret: true })}
          {field('smtpFrom', 'From address')}
          <label className="toggle" style={{ marginBottom: '0.85rem' }}>
            <input
              type="checkbox"
              checked={config.smtpSecure === 'true'}
              onChange={(e) => onChange('smtpSecure', e.target.checked ? 'true' : 'false')}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Use TLS (secure)</span>
          </label>
        </>
      );
    case 'byo_sendgrid':
      return (
        <>
          {field('sendgridApiKey', 'SendGrid API key', { secret: true })}
          {field('sendgridFrom', 'From address')}
        </>
      );
    case 'discord':
      return (
        <>
          {field('webhookUrl', 'Webhook URL')}
          {field('messageTemplate', 'Custom message (optional)', {
            textarea: true,
            placeholder:
              'Leave blank for a rich embed with artwork and description. Or write your own, e.g. New episode: {{title}}\n{{episodeUrl}}',
          })}
        </>
      );
    case 'slack':
      return (
        <>
          {field('webhookUrl', 'Webhook URL')}
          {field('messageTemplate', 'Custom message (optional)', {
            textarea: true,
            placeholder:
              'Leave blank for a rich Block Kit post with artwork and description. Or write your own, e.g. {{title}}\n{{episodeUrl}}',
          })}
        </>
      );
    case 'telegram':
      return (
        <>
          {field('botToken', 'Bot token', { secret: true })}
          {field('chatId', 'Chat / channel ID')}
          {field('messageTemplate', 'Custom message (optional)', {
            textarea: true,
            placeholder:
              'Leave blank for a photo caption (when artwork exists) with title, description, and listen link.',
          })}
        </>
      );
    case 'mastodon':
      return (
        <>
          {field('instanceUrl', 'Instance URL', { placeholder: 'https://mastodon.social' })}
          {field('accessToken', 'Access token', { secret: true })}
          {field('statusTemplate', 'Custom status (optional)', {
            textarea: true,
            placeholder:
              'Leave blank for a default status with title, description, and episode link.',
          })}
        </>
      );
    case 'matrix':
      return (
        <>
          {field('homeserverUrl', 'Homeserver URL', { placeholder: 'https://matrix.org' })}
          {field('accessToken', 'Access token', { secret: true })}
          {field('roomId', 'Room ID', { placeholder: '!room:matrix.org' })}
          {field('messageTemplate', 'Custom message (optional)', {
            textarea: true,
            placeholder:
              'Leave blank for a default message with title, description, and listen link.',
          })}
        </>
      );
    case 'lemmy':
      return (
        <>
          {field('instanceUrl', 'Instance URL')}
          {field('community', 'Community name or ID')}
          {field('jwt', 'JWT (optional if using username/password)', { secret: true })}
          {field('username', 'Username (optional)')}
          {field('password', 'Password (optional)', { secret: true })}
          {field('titleTemplate', 'Custom title (optional)', {
            placeholder: 'Leave blank for podcast: episode title',
          })}
          {field('bodyTemplate', 'Custom body (optional)', {
            textarea: true,
            placeholder: 'Leave blank for description and listen link',
          })}
        </>
      );
    case 'bluesky':
      return (
        <>
          {field('handle', 'Handle', { placeholder: 'you.bsky.social' })}
          {field('appPassword', 'App password', { secret: true })}
          {field('postTemplate', 'Custom post (optional)', {
            textarea: true,
            placeholder:
              'Leave blank for a default post with an episode link card and artwork thumb when available.',
          })}
        </>
      );
    case 'json_webhook':
      return (
        <>
          {field('url', 'URL')}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Method</span>
            <select
              className={styles.select}
              value={config.method || 'POST'}
              onChange={(e) => onChange('method', e.target.value)}
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </label>
          {field('headersJson', 'Headers JSON (optional)', {
            textarea: true,
            placeholder: '{"Authorization":"Bearer …"}',
          })}
          {field('bodyTemplate', 'JSON body template (optional)', {
            textarea: true,
            placeholder: `{
  "title": "{{title}}",
  "description": "{{description}}",
  "episodeUrl": "{{episodeUrl}}",
  "rssUrl": "{{rssUrl}}",
  "publishAt": "{{publishAt}}",
  "premium": "{{premium}}",
  "podcastTitle": "{{podcastTitle}}",
  "artworkUrl": "{{artworkUrl}}",
  "seasonEpisode": "{{seasonEpisode}}"
}`,
          })}
        </>
      );
    default:
      return null;
  }
}
