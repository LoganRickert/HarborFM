import { useState, useEffect } from "react";
import { ToggleGroup } from "./ToggleGroup";
import { VULTR_OS_OPTIONS, AWS_OS_OPTIONS, VULTR_REGIONS } from "./constants";
import type { ConfigState } from "@shared/types";
import styles from "./Settings.module.css";

export function Settings() {
  const [config, setConfig] = useState<Partial<ConfigState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: ConfigState) => {
        setConfig({
          ...c,
          generate_admin_api_key_by_default: c.generate_admin_api_key_by_default ?? true,
        });
      })
      .catch(() => setMessage({ type: "error", text: "Failed to load config" }))
      .finally(() => setLoading(false));
  }, []);

  const update = (key: keyof ConfigState, value: ConfigState[keyof ConfigState]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: "Settings saved." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className={styles.loading}>Loading settings…</p>;

  return (
    <section>
      <h2 className={styles.pageTitle}>Settings (defaults for Deploy)</h2>

      <form onSubmit={handleSave} className={styles.form}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Basics</h3>
          <div className={styles.sectionFields}>
            <ToggleGroup
              label="Deploy type"
              value={String(config.deploy_type ?? "pm2")}
              options={[
                { value: "pm2", label: "PM2" },
                { value: "nginx", label: "Nginx" },
                { value: "caddy", label: "Caddy" },
              ]}
              onChange={(v) => update("deploy_type", v)}
            />
            <ToggleGroup
              label="Default region (Vultr)"
              value={VULTR_REGIONS.includes(String(config.region ?? "ewr") as (typeof VULTR_REGIONS)[number]) ? String(config.region) : "ewr"}
              options={[...VULTR_REGIONS]}
              onChange={(v) => update("region", v)}
            />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Cloud (Vultr)</h3>
          <div className={styles.sectionFields}>
            <div className={styles.fieldRow}>
              <label className={styles.label}>
                <span className={styles.labelText}>Plan</span>
                <input
                  type="text"
                  className={styles.input}
                  value={String(config.plan ?? "")}
                  onChange={(e) => update("plan", e.target.value)}
                />
              </label>
              <label className={styles.label}>
                <span className={styles.labelText}>Data volume size (GB)</span>
                <input
                  type="number"
                  className={styles.input}
                  min={0}
                  value={String(config.data_volume_size ?? "0")}
                  onChange={(e) => update("data_volume_size", e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </label>
            </div>
            <ToggleGroup
              label="OS (Vultr os_id)"
              value={String(config.os_id ?? "2136")}
              options={VULTR_OS_OPTIONS}
              onChange={(v) => update("os_id", v)}
            />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Cloud (AWS)</h3>
          <div className={styles.sectionFields}>
            <ToggleGroup
              label="OS (AWS)"
              value={String(config.os ?? "debian-12")}
              options={AWS_OS_OPTIONS}
              onChange={(v) => update("os", v)}
            />
            <label className={styles.label}>
              <span className={styles.labelText}>Instance type</span>
              <input
                type="text"
                className={styles.input}
                value={String(config.instance_type ?? "")}
                onChange={(e) => update("instance_type", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>DNS & Cloudflare</h3>
          <div className={styles.fieldRow}>
            <label className={styles.label}>
              <span className={styles.labelText}>Cloudflare zone name</span>
              <input
                type="text"
                className={styles.input}
                value={String(config.cloudflare_zone_name ?? "")}
                onChange={(e) => update("cloudflare_zone_name", e.target.value)}
              />
            </label>
            <label className={styles.label}>
              <span className={styles.labelText}>Certbot email</span>
              <input
                type="email"
                className={styles.input}
                value={String(config.certbot_email ?? "")}
                onChange={(e) => update("certbot_email", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>SSH</h3>
          <div className={styles.sectionFields}>
            <label className={styles.label}>
              <span className={styles.labelText}>SSH allowed CIDR</span>
              <input
                type="text"
                className={styles.input}
                value={String(config.ssh_allowed_cidr ?? "")}
                onChange={(e) => update("ssh_allowed_cidr", e.target.value)}
              />
            </label>
            <label className={styles.label}>
              <span className={styles.labelText}>SSH public key (default)</span>
              <textarea
                className={styles.textarea}
                value={String(config.ssh_public_key ?? "")}
                onChange={(e) => update("ssh_public_key", e.target.value)}
                rows={4}
                placeholder="ssh-rsa AAAAB3..."
              />
            </label>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Instance manager</h3>
          <div className={styles.sectionFields}>
            <label className={styles.label}>
              <span className={styles.labelText}>Admin email (optional)</span>
              <input
                type="email"
                className={styles.input}
                value={String(config.default_admin_email ?? "")}
                onChange={(e) => update("default_admin_email", e.target.value)}
                placeholder="Default for Deploy form"
              />
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={config.generate_admin_api_key_by_default ?? true}
                onChange={(e) => update("generate_admin_api_key_by_default", e.target.checked)}
              />
              <span className={styles.labelText}>Generate admin API key when deploying (saved per instance)</span>
            </label>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>App options</h3>
          <div className={styles.sectionFields}>
            <ToggleGroup
              label="Vultr backups"
              value={String(config.backups ?? "enabled")}
              options={[
                { value: "enabled", label: "Enabled" },
                { value: "disabled", label: "Disabled" },
              ]}
              onChange={(v) => update("backups", v)}
            />
            <div className={styles.fieldRow}>
              <label className={styles.label}>
                <span className={styles.labelText}>HarborFM repo</span>
                <input
                  type="text"
                  className={styles.input}
                  value={String(config.harborfm_repo ?? "")}
                  onChange={(e) => update("harborfm_repo", e.target.value)}
                />
              </label>
              <label className={styles.label}>
                <span className={styles.labelText}>HarborFM branch</span>
                <input
                  type="text"
                  className={styles.input}
                  value={String(config.harborfm_branch ?? "")}
                  onChange={(e) => update("harborfm_branch", e.target.value)}
                />
              </label>
            </div>
            <label className={styles.label}>
              <span className={styles.labelText}>Setup ID</span>
              <input
                type="text"
                className={styles.input}
                value={String(config.setup_id ?? "")}
                onChange={(e) => update("setup_id", e.target.value)}
              />
            </label>
            <label className={styles.label}>
              <span className={styles.labelText}>Script URL (default: None)</span>
              <input
                type="text"
                className={styles.input}
                value={String(config.script_url ?? "")}
                onChange={(e) => update("script_url", e.target.value)}
                placeholder="None (use repo/branch)"
              />
            </label>
            <ToggleGroup
              label="Cookie secure"
              value={config.cookie_secure ? "true" : "false"}
              options={[
                { value: "false", label: "false" },
                { value: "true", label: "true" },
              ]}
              onChange={(v) => update("cookie_secure", v === "true")}
            />
          </div>
        </div>

        <button type="submit" disabled={saving} className={styles.submitBtn}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      {message && (
        <p className={message.type === "success" ? styles.messageSuccess : styles.messageError}>
          {message.text}
        </p>
      )}
    </section>
  );
}
