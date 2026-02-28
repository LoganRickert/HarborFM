import { useState, useEffect, useRef } from "react";
import { ToggleGroup } from "./ToggleGroup";
import {
  VULTR_OS_OPTIONS,
  AWS_OS_OPTIONS,
  VULTR_REGIONS,
  AWS_REGIONS,
} from "./constants";
import type { ConfigState } from "@shared/types";
import styles from "./DeployForm.module.css";

/** Saved deploy inputs from GET /api/instances/:id/deploy-inputs (no secrets). */
export interface TerraformDeployInputsPrefill {
  name: string;
  provider: "aws" | "vultr";
  domain?: string;
  deploy_type?: string;
  webrtc_enabled?: string;
  admin_email?: string;
  certbot_email?: string;
  region?: string;
  plan?: string;
  os_id?: string;
  os?: string;
  ami_id?: string;
  key_name?: string;
  data_volume_size?: number | string;
  instance_type?: string;
  cloudflare_zone_name?: string;
  ssh_allowed_cidr?: string;
  backups?: string;
  harborfm_repo?: string;
  harborfm_branch?: string;
  setup_id?: string;
  cookie_secure?: boolean;
  script_url?: string;
}

interface DeployFormProps {
  onDeployed: () => void;
  prefill?: TerraformDeployInputsPrefill | null;
  onClearPrefill?: () => void;
}

export function DeployForm({ onDeployed, prefill, onClearPrefill }: DeployFormProps) {
  const prefillAppliedRef = useRef(false);
  const [orchestrator, setOrchestrator] = useState<"terraform" | "kubernetes">("terraform");
  const [provider, setProvider] = useState<"aws" | "vultr">("vultr");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [deployType, setDeployType] = useState<"pm2" | "nginx" | "caddy">("pm2");
  const [webrtc, setWebrtc] = useState<"0" | "1">("0");
  const [region, setRegion] = useState("ewr");
  const [plan, setPlan] = useState("vhf-2c-2gb");
  const [osId, setOsId] = useState("2136");
  const [os, setOs] = useState("debian-12");
  const [instanceType, setInstanceType] = useState("t3.small");
  const [amiId, setAmiId] = useState("");
  const [keyName, setKeyName] = useState("");
  const [dataVolumeSize, setDataVolumeSize] = useState("0");
  const [cloudflareZoneName, setCloudflareZoneName] = useState("");
  const [certbotEmail, setCertbotEmail] = useState("");
  const [sshAllowedCidr, setSshAllowedCidr] = useState("192.168.1.1/32");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [backups, setBackups] = useState<"enabled" | "disabled">("enabled");
  const [harborfmRepo, setHarborfmRepo] = useState("loganrickert/harborfm");
  const [harborfmBranch, setHarborfmBranch] = useState("main");
  const [setupId, setSetupId] = useState("");
  const [cookieSecure, setCookieSecure] = useState(false);
  const [scriptUrl, setScriptUrl] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [generateAdminApiKey, setGenerateAdminApiKey] = useState(true);
  const [kubeconfig, setKubeconfig] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const outputPreRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: ConfigState) => {
        if (c.plan != null) setPlan(String(c.plan));
        if (c.os_id != null) setOsId(String(c.os_id));
        if (c.os != null) setOs(String(c.os));
        if (c.region != null) setRegion(String(c.region));
        if (c.deploy_type != null) setDeployType(String(c.deploy_type) as "pm2" | "nginx" | "caddy");
        if (c.cloudflare_zone_name != null) setCloudflareZoneName(String(c.cloudflare_zone_name));
        if (c.cloudflare_zone_name != null && String(c.cloudflare_zone_name).trim() !== "") {
          setDomain(`.${String(c.cloudflare_zone_name).trim()}`);
        }
        if (c.certbot_email != null) setCertbotEmail(String(c.certbot_email));
        if (c.ssh_allowed_cidr != null) setSshAllowedCidr(String(c.ssh_allowed_cidr));
        if (c.ssh_public_key != null) setSshPublicKey(String(c.ssh_public_key));
        if (c.backups != null) setBackups(String(c.backups) === "disabled" ? "disabled" : "enabled");
        if (c.harborfm_repo != null) setHarborfmRepo(String(c.harborfm_repo));
        if (c.harborfm_branch != null) setHarborfmBranch(String(c.harborfm_branch));
        if (c.setup_id != null) setSetupId(String(c.setup_id));
        if (c.cookie_secure != null) setCookieSecure(c.cookie_secure);
        if (c.script_url != null) setScriptUrl(String(c.script_url));
        if (c.instance_type != null) setInstanceType(String(c.instance_type));
        if (c.data_volume_size != null) setDataVolumeSize(String(c.data_volume_size));
        if (c.generate_admin_api_key_by_default != null) setGenerateAdminApiKey(Boolean(c.generate_admin_api_key_by_default));
        if (c.default_admin_email != null) setAdminEmail(String(c.default_admin_email));
        setConfigLoaded(true);
      })
      .catch(() => setConfigLoaded(true));
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    const vultrRegions = [...VULTR_REGIONS];
    const awsRegions = [...AWS_REGIONS];
    if (provider === "vultr" && !vultrRegions.includes(region as (typeof vultrRegions)[number])) setRegion("ewr");
    if (provider === "aws" && !awsRegions.includes(region as (typeof awsRegions)[number])) setRegion("us-east-1");
  }, [provider, configLoaded, region]);

  useEffect(() => {
    if (!prefill) prefillAppliedRef.current = false;
  }, [prefill]);

  // Apply prefill once when config is loaded (for "Duplicate deploy" flow). All values filled including name (user can change name for duplicate).
  useEffect(() => {
    if (!configLoaded || !prefill || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    setOrchestrator("terraform");
    setProvider(prefill.provider);
    setName(prefill.name ?? "");
    setDomain(prefill.domain ?? "");
    setDeployType((prefill.deploy_type as "pm2" | "nginx" | "caddy") ?? "pm2");
    setWebrtc((prefill.webrtc_enabled as "0" | "1") ?? "0");
    setRegion(prefill.region ?? (prefill.provider === "vultr" ? "ewr" : "us-east-1"));
    setPlan(prefill.plan ?? "vhf-2c-2gb");
    setOsId(prefill.os_id ?? "2136");
    setOs(prefill.os ?? "debian-12");
    setInstanceType(prefill.instance_type ?? "t3.small");
    setAmiId(prefill.ami_id ?? "");
    setKeyName(prefill.key_name ?? "");
    setDataVolumeSize(String(prefill.data_volume_size ?? "0"));
    setCloudflareZoneName(prefill.cloudflare_zone_name ?? "");
    setCertbotEmail(prefill.certbot_email ?? "");
    setSshAllowedCidr(prefill.ssh_allowed_cidr ?? "192.168.1.1/32");
    setBackups((prefill.backups as "enabled" | "disabled") ?? "enabled");
    setHarborfmRepo(prefill.harborfm_repo ?? "loganrickert/harborfm");
    setHarborfmBranch(prefill.harborfm_branch ?? "main");
    setSetupId(prefill.setup_id ?? "");
    setCookieSecure(prefill.cookie_secure ?? false);
    setScriptUrl(prefill.script_url ?? "");
    setAdminEmail(prefill.admin_email ?? "");
    setAdminPassword("");
    // Clear prefill after React has applied the state updates so the form shows all values
    const clear = onClearPrefill;
    if (clear) queueMicrotask(() => clear());
  }, [configLoaded, prefill, onClearPrefill]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setOutput("");
    try {
      const body: Record<string, string | number | boolean> = {
        orchestrator,
        name: name.trim(),
        domain: domain || "localhost",
        deploy_type: deployType,
        webrtc_enabled: webrtc,
        admin_email: adminEmail,
        admin_password: adminPassword,
        certbot_email: certbotEmail,
        cloudflare_zone_name: cloudflareZoneName,
        ssh_allowed_cidr: sshAllowedCidr,
        ssh_public_key: sshPublicKey,
        harborfm_repo: harborfmRepo,
        harborfm_branch: harborfmBranch,
        setup_id: setupId,
        cookie_secure: cookieSecure,
        script_url: scriptUrl.trim(),
        generate_admin_api_key: generateAdminApiKey,
      };
      if (orchestrator === "terraform") {
        body.provider = provider;
        body.region = region;
        body.plan = plan;
        body.data_volume_size = dataVolumeSize;
        if (provider === "vultr") {
          body.os_id = osId;
          body.backups = backups;
        }
        if (provider === "aws") {
          body.os = os;
          body.instance_type = instanceType;
          if (amiId) body.ami_id = amiId;
          if (keyName) body.key_name = keyName;
        }
      }
      if (orchestrator === "kubernetes" && kubeconfig.trim()) body.kubeconfig = kubeconfig.trim();
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(body),
      });
      const contentType = res.headers.get("content-type") ?? "";
      const isStream = res.ok && contentType.includes("text/plain");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setOutput(data.error ?? data.message ?? `Request failed: ${res.status}`);
        return;
      }
      if (isStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            setOutput(buffer);
            if (outputPreRef.current) outputPreRef.current.scrollTop = outputPreRef.current.scrollHeight;
            const lines = buffer.split("\n");
            const last = lines[lines.length - 1];
            if (last.trimStart().startsWith('{"done":true')) {
              try {
                const result = JSON.parse(last.trim()) as { done: boolean; success: boolean; message?: string };
                if (result.done) {
                  const logOnly = lines.slice(0, -1).join("\n");
                  setOutput(logOnly + (result.success ? "" : "\n" + (result.message ?? "")));
                  if (result.success) onDeployed();
                  break;
                }
              } catch {
                // not the final line yet, keep reading
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        return;
      }
      const data = await res.json();
      setOutput(data.output ?? data.error ?? JSON.stringify(data));
      if (data.success) onDeployed();
    } catch (err) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const regionOptions = provider === "vultr" ? VULTR_REGIONS : AWS_REGIONS;

  return (
    <section>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h2 className={styles.pageTitle}>Deploy new instance</h2>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Basics</h3>
          <div className={styles.sectionFields}>
            <ToggleGroup
              label="Orchestrator"
              value={orchestrator}
              options={[
                { value: "terraform", label: "Terraform" },
                { value: "kubernetes", label: "Kubernetes" },
              ]}
              onChange={(v) => setOrchestrator(v)}
            />
            {orchestrator === "terraform" && (
              <ToggleGroup
                label="Cloud"
                value={provider}
                options={[
                  { value: "aws", label: "AWS" },
                  { value: "vultr", label: "Vultr" },
                ]}
                onChange={(v) => setProvider(v)}
              />
            )}
            <div className={styles.fieldRow}>
              <label className={styles.label}>
                <span className={styles.labelText}>Name (workspace or release name) *</span>
                <input
                  type="text"
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={orchestrator === "terraform" ? "e.g. dev, prod" : "e.g. harborfm"}
                  required
                />
              </label>
              <label className={styles.label}>
                <span className={styles.labelText}>Domain</span>
                <input
                  type="text"
                  className={styles.input}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="localhost or example.com"
                />
              </label>
            </div>
            <ToggleGroup label="Deploy type" value={deployType} options={[{ value: "pm2", label: "PM2" }, { value: "nginx", label: "Nginx" }, { value: "caddy", label: "Caddy" }]} onChange={(v) => setDeployType(v)} />
            <ToggleGroup label="WebRTC" value={webrtc} options={[{ value: "0", label: "Disabled" }, { value: "1", label: "Enabled" }]} onChange={(v) => setWebrtc(v)} />
          </div>
        </div>

        {orchestrator === "terraform" && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Cloud & region</h3>
            <div className={styles.sectionFields}>
              <ToggleGroup label="Region" value={region} options={regionOptions} onChange={setRegion} />
              {provider === "vultr" && (
                <>
                  <div className={styles.fieldRow}>
                    <label className={styles.label}>
                      <span className={styles.labelText}>Plan</span>
                      <input type="text" className={styles.input} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="vhf-2c-2gb" />
                    </label>
                    <label className={styles.label}>
                      <span className={styles.labelText}>Data volume size (GB, 0 = none)</span>
                      <input type="number" className={styles.input} min={0} value={dataVolumeSize} onChange={(e) => setDataVolumeSize(e.target.value)} />
                    </label>
                  </div>
                  <ToggleGroup label="Operating system" value={osId} options={VULTR_OS_OPTIONS} onChange={setOsId} />
                </>
              )}
              {provider === "aws" && (
                <div className={styles.sectionFields}>
                  <ToggleGroup label="Operating system" value={os} options={AWS_OS_OPTIONS} onChange={setOs} />
                  <div className={styles.fieldRow}>
                    <label className={styles.label}>
                      <span className={styles.labelText}>Instance type</span>
                      <input type="text" className={styles.input} value={instanceType} onChange={(e) => setInstanceType(e.target.value)} placeholder="t3.small" />
                    </label>
                    <label className={styles.label}>
                      <span className={styles.labelText}>AMI ID (required for AWS)</span>
                      <input type="text" className={styles.input} value={amiId} onChange={(e) => setAmiId(e.target.value)} placeholder="ami-xxxxxxxx" />
                    </label>
                  </div>
                  <label className={styles.label}>
                    <span className={styles.labelText}>Key name (SSH, optional)</span>
                    <input type="text" className={styles.input} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="my-key" />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>DNS & Cloudflare</h3>
          <div className={styles.fieldRow}>
            <label className={styles.label}>
              <span className={styles.labelText}>Cloudflare zone name (optional)</span>
              <input type="text" className={styles.input} value={cloudflareZoneName} onChange={(e) => setCloudflareZoneName(e.target.value)} placeholder="example.com" />
            </label>
            <label className={styles.label}>
              <span className={styles.labelText}>Certbot email (Let's Encrypt, optional)</span>
              <input type="email" className={styles.input} value={certbotEmail} onChange={(e) => setCertbotEmail(e.target.value)} />
            </label>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>SSH</h3>
          <div className={styles.fieldRow}>
            <label className={styles.label}>
              <span className={styles.labelText}>SSH allowed CIDR</span>
              <input type="text" className={styles.input} value={sshAllowedCidr} onChange={(e) => setSshAllowedCidr(e.target.value)} placeholder="0.0.0.0/0 or 1.2.3.4/32" />
            </label>
            <label className={styles.label}>
              <span className={styles.labelText}>SSH public key (optional)</span>
              <textarea className={styles.textarea} value={sshPublicKey} onChange={(e) => setSshPublicKey(e.target.value)} rows={3} placeholder="ssh-rsa AAAAB3..." />
            </label>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>App options</h3>
          <div className={styles.sectionFields}>
            {orchestrator === "terraform" && provider === "vultr" && (
              <ToggleGroup label="Vultr backups" value={backups} options={[{ value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }]} onChange={(v) => setBackups(v)} />
            )}
            <div className={styles.fieldRow}>
              <label className={styles.label}>
                <span className={styles.labelText}>HarborFM repo</span>
                <input type="text" className={styles.input} value={harborfmRepo} onChange={(e) => setHarborfmRepo(e.target.value)} placeholder="loganrickert/harborfm" />
              </label>
              <label className={styles.label}>
                <span className={styles.labelText}>HarborFM branch</span>
                <input type="text" className={styles.input} value={harborfmBranch} onChange={(e) => setHarborfmBranch(e.target.value)} placeholder="main" />
              </label>
            </div>
            <label className={styles.label}>
              <span className={styles.labelText}>Setup ID (optional)</span>
              <input type="text" className={styles.input} value={setupId} onChange={(e) => setSetupId(e.target.value)} placeholder="Pre-set setup token" />
            </label>
            <label className={styles.label}>
              <span className={styles.labelText}>Script URL (default: None)</span>
              <input
                type="text"
                className={styles.input}
                value={scriptUrl}
                onChange={(e) => setScriptUrl(e.target.value)}
                placeholder="None (use repo/branch)"
              />
            </label>
            <ToggleGroup label="Cookie secure" value={cookieSecure ? "true" : "false"} options={[{ value: "false", label: "false (HTTP ok)" }, { value: "true", label: "true (HTTPS only)" }]} onChange={(v) => setCookieSecure(v === "true")} />
            {orchestrator === "kubernetes" && (
              <label className={styles.label}>
                <span className={styles.labelText}>Kubeconfig path (optional, saved per release)</span>
                <input type="text" className={styles.input} value={kubeconfig} onChange={(e) => setKubeconfig(e.target.value)} placeholder="/path/to/kubeconfig" />
              </label>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Admin</h3>
          <div className={styles.sectionFields}>
            <div className={styles.fieldRow}>
              <label className={styles.label}>
                <span className={styles.labelText}>Admin email (optional)</span>
                <input type="email" className={styles.input} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              </label>
              <label className={styles.label}>
                <span className={styles.labelText}>Admin password (optional)</span>
                <input type="password" className={styles.input} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
              </label>
            </div>
            {orchestrator === "terraform" && (
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={generateAdminApiKey}
                  onChange={(e) => setGenerateAdminApiKey(e.target.checked)}
                />
                <span className={styles.labelText}>Generate admin API key and save in instance manager</span>
              </label>
            )}
          </div>
        </div>

        <button type="submit" disabled={loading} className={styles.submitBtn}>
          {loading ? "Deploying…" : "Deploy"}
        </button>
      </form>

      {output !== "" && <pre ref={outputPreRef} className={styles.outputPre}>{output}</pre>}
    </section>
  );
}
