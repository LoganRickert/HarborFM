import { useState, useEffect, useCallback } from "react";
import type { InstanceItem } from "./App";
import type { TerraformDeployInputsPrefill } from "./DeployForm";
import { AlertPopup, ConfirmPopup } from "./Popup";
import styles from "./InstanceList.module.css";

interface HealthState {
  online: boolean;
  lastCheck: number;
}

/** From GET /api/public/config on a HarborFM instance. */
interface PublicConfig {
  publicFeedsEnabled: boolean;
  webrtcEnabled?: boolean;
  reviewsEnabled?: boolean;
  gdprConsentBannerEnabled?: boolean;
}

/** From GET /api/setup/status on a HarborFM instance (requires admin API key). */
interface SetupStatus {
  setupRequired: boolean;
  registrationEnabled?: boolean;
  publicFeedsEnabled?: boolean;
  captchaProvider?: string;
  captchaSiteKey?: string;
  emailConfigured?: boolean;
  welcomeBanner?: string;
  twoFactorEnabled?: boolean;
  twoFactorEnforced?: boolean;
  twoFactorMethods?: string;
  emailSigninDisabled?: boolean;
}

function formatLastCheck(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min === 1) return "1m ago";
  return `${min}m ago`;
}

interface InstanceListProps {
  instances: InstanceItem[];
  loading: boolean;
  filter: { orchestrator?: string; provider?: string };
  onFilterChange: (f: { orchestrator?: string; provider?: string }) => void;
  onRefresh: () => void;
  onDuplicateInputs?: (inputs: TerraformDeployInputsPrefill) => void;
}

export function InstanceList({
  instances,
  loading,
  filter,
  onFilterChange,
  onRefresh,
  onDuplicateInputs,
}: InstanceListProps) {
  const [destroyingId, setDestroyingId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [duplicateLoadingId, setDuplicateLoadingId] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, HealthState>>({});
  const [publicConfigs, setPublicConfigs] = useState<Record<string, PublicConfig | { error: string }>>({});
  const [, setTick] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [systemInfo, setSystemInfo] = useState<Record<string, {
    commands: Record<string, boolean>;
    memory?: { usedBytes: number; totalBytes: number };
    cpus?: number;
    disk?: { usedBytes: number; totalBytes: number };
  }>>({});
  const [setupStatus, setSetupStatus] = useState<Record<string, SetupStatus>>({});
  const [addForm, setAddForm] = useState({
    name: "",
    url: "",
    publicIp: "",
    adminApiKey: "",
    harborfm_repo: "",
    harborfm_branch: "",
    script_url: "",
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{
    id: string;
    name: string;
    orchestrator: string;
    editable: Record<string, string>;
  } | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [alertPopup, setAlertPopup] = useState<{ message: string } | null>(null);
  const [confirmPopup, setConfirmPopup] = useState<{
    message: string;
    confirmLabel: string;
    variant: "danger" | "default";
    onConfirm: () => void;
  } | null>(null);

  const handleAddTracked = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.url.trim()) return;
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/instances/tracked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          url: addForm.url.trim(),
          publicIp: addForm.publicIp.trim() || undefined,
          adminApiKey: addForm.adminApiKey.trim() || undefined,
          harborfm_repo: addForm.harborfm_repo.trim() || undefined,
          harborfm_branch: addForm.harborfm_branch.trim() || undefined,
          script_url: addForm.script_url.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAlertPopup({ message: data.error || `Failed: ${res.status}` });
        return;
      }
      setAddForm({ name: "", url: "", publicIp: "", adminApiKey: "", harborfm_repo: "", harborfm_branch: "", script_url: "" });
      setShowAddForm(false);
      onRefresh();
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setAddSubmitting(false);
    }
  };

  const runHealthChecks = useCallback(async () => {
    const withUrl = instances.filter((i) => i.url);
    if (withUrl.length === 0) return;
    const next: Record<string, HealthState> = {};
    const now = Date.now();
    await Promise.all(
      withUrl.map(async (inst) => {
        try {
          const res = await fetch(
            `/api/health-check?url=${encodeURIComponent(inst.url!)}`
          );
          const data = await res.json();
          next[inst.id] = { online: data.ok === true, lastCheck: now };
        } catch {
          next[inst.id] = { online: false, lastCheck: now };
        }
      })
    );
    setHealth((prev) => ({ ...prev, ...next }));
  }, [instances]);

  const fetchPublicConfigs = useCallback(async () => {
    const withUrl = instances.filter((i) => i.url);
    if (withUrl.length === 0) return;
    try {
      const res = await fetch("/api/instances/public-config");
      const data = (await res.json()) as Record<string, PublicConfig | { error: string }>;
      setPublicConfigs(data ?? {});
    } catch {
      setPublicConfigs({});
    }
  }, [instances]);

  useEffect(() => {
    runHealthChecks();
  }, [runHealthChecks]);

  useEffect(() => {
    fetchPublicConfigs();
  }, [fetchPublicConfigs]);

  const fetchSystemInfos = useCallback(async () => {
    const withUrl = instances.filter((i) => i.url);
    if (withUrl.length === 0) return;
    const next: Record<string, { commands: Record<string, boolean>; memory?: { usedBytes: number; totalBytes: number }; cpus?: number; disk?: { usedBytes: number; totalBytes: number } }> = {};
    await Promise.all(
      withUrl.map(async (inst) => {
        try {
          const res = await fetch(`/api/instances/${encodeURIComponent(inst.id)}/system-info`);
          const data = await res.json();
          if (res.ok && data && !("error" in data)) {
            next[inst.id] = data;
          }
        } catch {
          // no api key or error – skip
        }
      })
    );
    setSystemInfo((prev) => ({ ...prev, ...next }));
  }, [instances]);

  const fetchSetupStatuses = useCallback(async () => {
    const withUrl = instances.filter((i) => i.url);
    if (withUrl.length === 0) return;
    const next: Record<string, SetupStatus> = {};
    await Promise.all(
      withUrl.map(async (inst) => {
        try {
          const res = await fetch(`/api/instances/${encodeURIComponent(inst.id)}/setup-status`);
          const data = await res.json();
          if (res.ok && data && typeof data.setupRequired === "boolean") {
            next[inst.id] = data as SetupStatus;
          }
        } catch {
          // no api key or error – skip
        }
      })
    );
    setSetupStatus((prev) => ({ ...prev, ...next }));
  }, [instances]);

  useEffect(() => {
    fetchSystemInfos();
  }, [fetchSystemInfos]);

  useEffect(() => {
    fetchSetupStatuses();
  }, [fetchSetupStatuses]);

  useEffect(() => {
    const id = setInterval(fetchSystemInfos, 60000);
    return () => clearInterval(id);
  }, [fetchSystemInfos]);

  useEffect(() => {
    const id = setInterval(fetchSetupStatuses, 60000);
    return () => clearInterval(id);
  }, [fetchSetupStatuses]);

  useEffect(() => {
    const id = setInterval(runHealthChecks, 60000);
    return () => clearInterval(id);
  }, [runHealthChecks]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const doDestroy = async (id: string, destroyStorage?: boolean) => {
    setDestroyingId(id);
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(id)}/destroy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destroyStorage: !!destroyStorage }),
      });
      const data = await res.json();
      if (data.success) {
        await onRefresh();
      } else {
        setAlertPopup({ message: data.output || data.error || "Destroy failed" });
      }
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Destroy failed" });
    } finally {
      setDestroyingId(null);
    }
  };

  const handleDestroy = (id: string) => {
    if (!id.startsWith("vultr:")) return;
    setConfirmPopup({
      message: "Destroy this Vultr instance? Block storage will be preserved.",
      confirmLabel: "Destroy",
      variant: "danger",
      onConfirm: () => doDestroy(id),
    });
  };

  const handleDestroyWithStorage = (id: string) => {
    if (!id.startsWith("vultr:")) return;
    setConfirmPopup({
      message: "Destroy this Vultr instance and its block storage? This cannot be undone.",
      confirmLabel: "Destroy + Storage",
      variant: "danger",
      onConfirm: () => doDestroy(id, true),
    });
  };

  const doCreate = async (id: string) => {
    setCreatingId(id);
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(id)}/apply`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        await onRefresh();
      } else {
        setAlertPopup({ message: data.output || data.error || "Create failed" });
      }
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Create failed" });
    } finally {
      setCreatingId(null);
    }
  };

  const doRemoveTracked = async (id: string) => {
    setDestroyingId(id);
    try {
      const res = await fetch(`/api/instances/tracked/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) onRefresh();
      else {
        const data = await res.json();
        setAlertPopup({ message: data.error || "Remove failed" });
      }
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Remove failed" });
    } finally {
      setDestroyingId(null);
    }
  };

  const handleRemoveTracked = (id: string) => {
    if (!id.startsWith("manual:")) return;
    setConfirmPopup({
      message: "Remove this instance from the list?",
      confirmLabel: "Remove",
      variant: "default",
      onConfirm: () => doRemoveTracked(id),
    });
  };

  const handleOpenEdit = async (id: string) => {
    setEditId(id);
    setEditLoading(true);
    setEditData(null);
    setEditForm({});
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(id)}/edit`);
      const data = await res.json();
      if (!res.ok) {
        setAlertPopup({ message: data.error || `Failed to load (${res.status})` });
        setEditId(null);
        return;
      }
      setEditData(data);
      setEditForm({ ...data.editable });
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Request failed" });
      setEditId(null);
    } finally {
      setEditLoading(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(editId)}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setAlertPopup({ message: data.error || `Failed to save (${res.status})` });
        return;
      }
      setEditId(null);
      setEditData(null);
      onRefresh();
      await fetchSystemInfos();
      await fetchSetupStatuses();
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    if (!onDuplicateInputs) return;
    setDuplicateLoadingId(id);
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(id)}/deploy-inputs`);
      const data = await res.json();
      if (!res.ok) {
        setAlertPopup({ message: data.error || `Failed to load deploy inputs (${res.status})` });
        return;
      }
      onDuplicateInputs(data as TerraformDeployInputsPrefill);
    } catch (e) {
      setAlertPopup({ message: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setDuplicateLoadingId(null);
    }
  };

  return (
    <section>
      <div className={styles.filters}>
        <label className={styles.filterLabel}>
          <span className={styles.filterText}>Orchestrator</span>
          <select
            className={styles.select}
            value={filter.orchestrator ?? ""}
            onChange={(e) => onFilterChange({ ...filter, orchestrator: e.target.value || undefined })}
          >
            <option value="">All</option>
            <option value="terraform">Terraform</option>
            <option value="kubernetes">Kubernetes</option>
            <option value="manual">Tracked</option>
          </select>
        </label>
        {(filter.orchestrator === "terraform" || !filter.orchestrator) && (
          <label className={styles.filterLabel}>
            <span className={styles.filterText}>Provider</span>
            <select
              className={styles.select}
              value={filter.provider ?? ""}
              onChange={(e) => onFilterChange({ ...filter, provider: e.target.value || undefined })}
            >
              <option value="">All</option>
              <option value="aws">AWS</option>
              <option value="vultr">Vultr</option>
            </select>
          </label>
        )}
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        {!showAddForm && (
          <div className={styles.filtersRight}>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => setShowAddForm(true)}
            >
              Add Instance
            </button>
          </div>
        )}
      </div>

      {showAddForm && (
        <form className={styles.addForm} onSubmit={handleAddTracked}>
          <h3 className={styles.addFormTitle}>Track instance</h3>
          <div className={styles.addFormGrid}>
            <label className={styles.addFormLabel}>Name <span className={styles.required}>*</span></label>
            <input
              type="text"
              className={styles.addFormInput}
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              required
              placeholder="My server"
            />
            <label className={styles.addFormLabel}>URL <span className={styles.required}>*</span></label>
            <input
              type="url"
              className={styles.addFormInput}
              value={addForm.url}
              onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
              required
              placeholder="https://harbor.example.com"
            />
            <label className={styles.addFormLabel}>IP</label>
            <input
              type="text"
              className={styles.addFormInput}
              value={addForm.publicIp}
              onChange={(e) => setAddForm((f) => ({ ...f, publicIp: e.target.value }))}
              placeholder="Optional"
            />
            <label className={styles.addFormLabel}>Admin API key</label>
            <input
              type="password"
              className={styles.addFormInput}
              value={addForm.adminApiKey}
              onChange={(e) => setAddForm((f) => ({ ...f, adminApiKey: e.target.value }))}
              placeholder="For system info"
              autoComplete="off"
            />
            <label className={styles.addFormLabel}>Repo</label>
            <input
              type="text"
              className={styles.addFormInput}
              value={addForm.harborfm_repo}
              onChange={(e) => setAddForm((f) => ({ ...f, harborfm_repo: e.target.value }))}
              placeholder="owner/repo"
            />
            <label className={styles.addFormLabel}>Branch</label>
            <input
              type="text"
              className={styles.addFormInput}
              value={addForm.harborfm_branch}
              onChange={(e) => setAddForm((f) => ({ ...f, harborfm_branch: e.target.value }))}
              placeholder="main"
            />
            <label className={styles.addFormLabel}>Setup script URL</label>
            <input
              type="url"
              className={styles.addFormInput}
              value={addForm.script_url}
              onChange={(e) => setAddForm((f) => ({ ...f, script_url: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className={styles.addFormActions}>
            <button type="button" className={styles.refreshBtn} onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
            <button type="submit" className={styles.addFormSubmit} disabled={addSubmitting}>
              {addSubmitting ? "Adding…" : "Add Instance"}
            </button>
          </div>
        </form>
      )}

      {loading && instances.length === 0 ? (
        <p className={styles.emptyMsg}>Loading instances…</p>
      ) : instances.length === 0 ? (
        <p className={styles.emptyMsg}>No instances found. Deploy one from the Deploy tab.</p>
      ) : (
        <ul className={styles.list}>
          {instances.map((inst) => {
            const h = health[inst.id];
            const hasUrl = !!inst.url;
            const isGone = !!inst.instanceGone;
            return (
              <li key={inst.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.cardTitleRow}>
                    <div className={styles.cardTitleGroup}>
                      <strong className={styles.cardTitle}>{inst.name}</strong>
                      {inst.tracked && <span className={styles.badgeTracked}>Tracked</span>}
                      {inst.instanceGone && <span className={styles.statusOther}>No instance</span>}
                      {inst.status && !inst.instanceGone && (
                        <span className={inst.status === "deployed" ? styles.statusDeployed : styles.statusOther}>
                          {inst.status}
                        </span>
                      )}
                    </div>
                    {!isGone && (
                      <button
                        type="button"
                        className={styles.editCardBtn}
                        onClick={() => handleOpenEdit(inst.id)}
                        title="Edit instance"
                        aria-label="Edit instance"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className={styles.cardMeta}>
                    {inst.orchestrator === "manual" ? "Tracked" : inst.orchestrator}
                    {inst.provider && ` · ${inst.provider}`}
                    {inst.workspace && inst.workspace !== "default" && ` · ${inst.workspace}`}
                    {inst.namespace && ` · ${inst.namespace}`}
                  </p>
                  {(inst.harborfm_repo != null || inst.harborfm_branch != null || inst.script_url != null) && (
                    <p className={styles.deployInfo}>
                      Repo: {inst.harborfm_repo || "—"}
                      {" · "}
                      Branch: {inst.harborfm_branch || "—"}
                      {" · "}
                      Script: {inst.script_url ? (inst.script_url.length > 40 ? inst.script_url.slice(0, 37) + "…" : inst.script_url) : "(none)"}
                    </p>
                  )}
                </div>

                {isGone && (
                  <p className={styles.cardMeta} style={{ marginTop: "0.25rem", marginBottom: "0.5rem" }}>
                    Instance destroyed. Block storage preserved. Create a new instance to reattach it.
                  </p>
                )}

                {!isGone && hasUrl && (
                  <div className={styles.healthRow}>
                    <span
                      className={h ? (h.online ? styles.dotOnline : styles.dotOffline) : styles.dotUnknown}
                      title={h ? (h.online ? "Online" : "Offline") : "Checking…"}
                      aria-hidden
                    />
                    <span className={styles.healthLabel}>
                      {h == null ? "Checking…" : h.online ? "Online" : "Offline"}
                    </span>
                    {h && (
                      <span className={styles.healthLastCheck}>
                        Last checked {formatLastCheck(h.lastCheck)}
                      </span>
                    )}
                  </div>
                )}

                {!isGone && (
                <div className={styles.cardLinks}>
                  {inst.url && (
                    <div className={styles.linkBlock}>
                      <span className={styles.linkBlockLabel}>App</span>
                      <a href={inst.url} target="_blank" rel="noreferrer" className={styles.linkUrl} title={inst.url}>
                        {inst.url}
                      </a>
                    </div>
                  )}
                  {inst.publicIp && (
                    <div className={styles.linkBlock}>
                      <span className={styles.linkBlockLabel}>IP</span>
                      <span className={styles.linkSecondary}>{inst.publicIp}</span>
                    </div>
                  )}
                  {inst.setupUrl && (
                    <div className={styles.linkBlock}>
                      <span className={styles.linkBlockLabel}>Setup</span>
                      <a href={inst.setupUrl} target="_blank" rel="noreferrer" className={styles.link} title={inst.setupUrl}>
                        Open setup
                      </a>
                    </div>
                  )}
                  {hasUrl && systemInfo[inst.id] && (() => {
                    const info = systemInfo[inst.id]!;
                    const hasStats = info.memory != null || info.disk != null || info.cpus != null;
                    if (!hasStats) return null;
                    return (
                      <div className={`${styles.linkBlock} ${styles.linkBlockSystem}`}>
                        <span className={styles.linkBlockLabel}>System</span>
                        <div className={styles.systemStatsContent}>
                          {info.disk != null && info.disk.totalBytes > 0 && (
                            <div className={styles.systemStat}>
                              <div className={styles.systemStatLabel}>
                                <span>Disk</span>
                                <span className={styles.systemStatValue}>
                                  {formatBytes(info.disk.usedBytes)} / {formatBytes(info.disk.totalBytes)}
                                </span>
                              </div>
                              <div className={styles.progressTrack} role="progressbar" aria-valuenow={Math.round((100 * info.disk.usedBytes) / info.disk.totalBytes)} aria-valuemin={0} aria-valuemax={100}>
                                <div
                                  className={styles.progressFill}
                                  style={{ width: `${Math.min(100, (100 * info.disk.usedBytes) / info.disk.totalBytes)}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {info.memory != null && info.memory.totalBytes > 0 && (
                            <div className={styles.systemStat}>
                              <div className={styles.systemStatLabel}>
                                <span>Memory</span>
                                <span className={styles.systemStatValue}>
                                  {formatBytes(info.memory.usedBytes)} / {formatBytes(info.memory.totalBytes)}
                                </span>
                              </div>
                              <div className={styles.progressTrack} role="progressbar" aria-valuenow={Math.round((100 * info.memory.usedBytes) / info.memory.totalBytes)} aria-valuemin={0} aria-valuemax={100}>
                                <div
                                  className={styles.progressFill}
                                  style={{ width: `${Math.min(100, (100 * info.memory.usedBytes) / info.memory.totalBytes)}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {info.cpus != null && (
                            <div className={styles.systemStatCpus}>
                              <span className={styles.systemStatLabel}>CPUs</span>
                              <span className={styles.systemStatValue}>{info.cpus}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {hasUrl && (setupStatus[inst.id] || publicConfigs[inst.id]) && (() => {
                    const s = setupStatus[inst.id];
                    const cfg = publicConfigs[inst.id];
                    const isCfgError = cfg && "error" in cfg;
                    const c = !cfg || isCfgError ? null : (cfg as PublicConfig);
                    const twoFactorMethods = s?.twoFactorMethods?.trim() || null;
                    return (
                      <div className={`${styles.linkBlock} ${styles.linkBlockStatus}`}>
                        <span className={styles.linkBlockLabel}>Status</span>
                        <div className={styles.statusGrid}>
                          {s != null && (
                            <>
                              <div className={styles.statusChip}>
                                <span
                                  className={s.setupRequired ? styles.dotOffline : styles.dotOnline}
                                  title={s.setupRequired ? "Setup required" : "Setup complete"}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>{s.setupRequired ? "Setup required" : "Ready"}</span>
                              </div>
                              <div className={styles.statusChip}>
                                <span
                                  className={s.registrationEnabled === true ? styles.dotOnline : s.registrationEnabled === false ? styles.dotOffline : styles.dotUnknown}
                                  title={`Registration: ${s.registrationEnabled === true ? "on" : s.registrationEnabled === false ? "off" : "unknown"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>Registration</span>
                              </div>
                              <div className={styles.statusChip}>
                                <span
                                  className={s.emailConfigured === true ? styles.dotOnline : s.emailConfigured === false ? styles.dotOffline : styles.dotUnknown}
                                  title={`Email: ${s.emailConfigured === true ? "configured" : s.emailConfigured === false ? "not configured" : "unknown"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>Email</span>
                              </div>
                              <div className={styles.statusChip}>
                                <span
                                  className={s.twoFactorEnabled === true ? styles.dotOnline : s.twoFactorEnabled === false ? styles.dotOffline : styles.dotUnknown}
                                  title={`2FA enabled: ${s.twoFactorEnabled === true ? "yes" : s.twoFactorEnabled === false ? "no" : "unknown"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>2FA Enabled</span>
                              </div>
                              <div className={styles.statusChip}>
                                <span
                                  className={s.twoFactorEnforced === true ? styles.dotOnline : s.twoFactorEnforced === false ? styles.dotOffline : styles.dotUnknown}
                                  title={`2FA enforced: ${s.twoFactorEnforced === true ? "yes" : s.twoFactorEnforced === false ? "no" : "unknown"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>2FA Enforced</span>
                              </div>
                              {twoFactorMethods && (
                                <div className={styles.statusChipValue} title="Two-factor methods">
                                  <span className={styles.statusChipLabel}>2FA methods</span>
                                  <span className={styles.statusChipValueText}>{twoFactorMethods.replace(/,/g, ", ")}</span>
                                </div>
                              )}
                            </>
                          )}
                          {c != null && (
                            <>
                              <div className={styles.statusChip}>
                                <span
                                  className={c.publicFeedsEnabled ? styles.dotOnline : styles.dotOffline}
                                  title={`Public feeds: ${c.publicFeedsEnabled ? "on" : "off"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>Public feeds</span>
                              </div>
                              <div className={styles.statusChip}>
                                <span
                                  className={c.webrtcEnabled === undefined ? styles.dotUnknown : c.webrtcEnabled ? styles.dotOnline : styles.dotOffline}
                                  title={c.webrtcEnabled === undefined ? "WebRTC: unknown" : `WebRTC: ${c.webrtcEnabled ? "on" : "off"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>WebRTC</span>
                              </div>
                              <div className={styles.statusChip}>
                                <span
                                  className={c.reviewsEnabled === undefined ? styles.dotUnknown : c.reviewsEnabled ? styles.dotOnline : styles.dotOffline}
                                  title={c.reviewsEnabled === undefined ? "Reviews: unknown" : `Reviews: ${c.reviewsEnabled ? "on" : "off"}`}
                                  aria-hidden
                                />
                                <span className={styles.statusChipLabel}>Reviews</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                )}

                <div className={styles.cardActions}>
                  {isGone && (inst.id.startsWith("vultr:") || inst.id.startsWith("aws:")) && (
                    <button
                      type="button"
                      className={styles.refreshBtn}
                      onClick={() => doCreate(inst.id)}
                      disabled={creatingId === inst.id}
                    >
                      {creatingId === inst.id ? "Creating…" : "Create"}
                    </button>
                  )}
                  {!isGone && inst.orchestrator === "terraform" && onDuplicateInputs && (
                    <button
                      type="button"
                      className={styles.refreshBtn}
                      onClick={() => handleDuplicate(inst.id)}
                      disabled={duplicateLoadingId === inst.id}
                    >
                      {duplicateLoadingId === inst.id ? "Loading…" : "Duplicate"}
                    </button>
                  )}
                  {inst.tracked && (
                    <button
                      type="button"
                      className={styles.removeTrackedBtn}
                      onClick={() => handleRemoveTracked(inst.id)}
                      disabled={destroyingId === inst.id}
                    >
                      {destroyingId === inst.id ? "Removing…" : "Remove"}
                    </button>
                  )}
                  {!isGone && inst.id.startsWith("vultr:") && inst.orchestrator === "terraform" && (
                    <>
                      <button
                        type="button"
                        className={styles.destroyBtn}
                        onClick={() => handleDestroy(inst.id)}
                        disabled={destroyingId === inst.id}
                      >
                        {destroyingId === inst.id ? "Destroying…" : "Destroy"}
                      </button>
                      <button
                        type="button"
                        className={styles.destroyBtn}
                        onClick={() => handleDestroyWithStorage(inst.id)}
                        disabled={destroyingId === inst.id}
                      >
                        {destroyingId === inst.id ? "Destroying…" : "Destroy + Storage"}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editId && (
        <div
          className={styles.modalOverlay}
          onClick={() => { if (!editSaving) { setEditId(null); setEditData(null); } }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-instance-title"
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="edit-instance-title" className={styles.modalTitle}>
                Edit {editData ? editData.name : editId}
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => { if (!editSaving) { setEditId(null); setEditData(null); } }}
                aria-label="Close"
                disabled={editSaving}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {editLoading ? (
                <p className={styles.editLoading}>Loading…</p>
              ) : editData ? (
                <form onSubmit={handleSaveEdit} className={styles.editForm}>
                  {[
                    { key: "url", label: "URL", type: "url" as const },
                    { key: "publicIp", label: "Public IP", type: "text" as const },
                    { key: "adminApiKey", label: "Admin API key", type: "password" as const },
                    { key: "harborfm_repo", label: "HarborFM repo", type: "text" as const },
                    { key: "harborfm_branch", label: "HarborFM branch", type: "text" as const },
                    { key: "script_url", label: "Script URL", type: "url" as const },
                    { key: "kubeconfig", label: "Kubeconfig path", type: "text" as const },
                  ]
                    .filter(({ key }) => key in editData.editable)
                    .map(({ key, label, type }) => (
                      <label key={key} className={styles.editFormLabel}>
                        <span className={styles.editFormLabelText}>{label}</span>
                        <input
                          type={type}
                          className={styles.editFormInput}
                          value={editForm[key] ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                          autoComplete={key === "adminApiKey" ? "off" : undefined}
                        />
                      </label>
                    ))}
                  <div className={styles.editFormActions}>
                    <button
                      type="button"
                      className={styles.refreshBtn}
                      onClick={() => { setEditId(null); setEditData(null); }}
                      disabled={editSaving}
                    >
                      Cancel
                    </button>
                    <button type="submit" className={styles.addFormSubmit} disabled={editSaving}>
                      {editSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <AlertPopup
        open={alertPopup !== null}
        message={alertPopup?.message ?? ""}
        onClose={() => setAlertPopup(null)}
      />
      <ConfirmPopup
        open={confirmPopup !== null}
        message={confirmPopup?.message ?? ""}
        confirmLabel={confirmPopup?.confirmLabel}
        variant={confirmPopup?.variant}
        onConfirm={() => confirmPopup?.onConfirm()}
        onCancel={() => setConfirmPopup(null)}
      />
    </section>
  );
}

function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const g = 1024 ** 3;
  const m = 1024 ** 2;
  if (n >= g) return `${(n / g).toFixed(1)} GB`;
  if (n >= m) return `${(n / m).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
