import type { FastifyInstance } from "fastify";
import { listTerraformInstances, destroyTerraformVultr, applyTerraform } from "../runners/terraform.js";
import type { TerraformProvider } from "../runners/terraform.js";
import { listHelmReleases } from "../runners/helm.js";
import { loadData, saveData, loadConfig, type TerraformDeployInputs } from "./config.js";
import type { TrackedInstance } from "./config.js";
import { config } from "../config.js";

export interface InstanceItem {
  id: string;
  name: string;
  orchestrator: "terraform" | "kubernetes" | "manual";
  provider?: "aws" | "vultr";
  workspace?: string;
  namespace?: string;
  url?: string;
  publicIp?: string;
  publicDns?: string;
  setupUrl?: string;
  status?: string;
  tracked?: boolean;
  harborfm_repo?: string;
  harborfm_branch?: string;
  script_url?: string;
  /** True when instance was destroyed but state (e.g. block storage) remains; show "Create" to reapply. */
  instanceGone?: boolean;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** Public config returned by GET /api/public/config on a HarborFM instance. */
export interface PublicConfig {
  publicFeedsEnabled: boolean;
  webrtcEnabled?: boolean;
  reviewsEnabled?: boolean;
  gdprConsentBannerEnabled?: boolean;
}

/** Setup status from GET /api/setup/status on a HarborFM instance (requires admin API key). */
export interface SetupStatus {
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

async function pingUrl(url: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "HarborFM-InstanceManager/1.0" },
    });
    clearTimeout(timeout);
    return { ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch {
    return { ok: false };
  }
}

async function fetchPublicConfig(baseUrl: string): Promise<PublicConfig | { error: string }> {
  try {
    const url = baseUrl.replace(/\/+$/, "") + "/api/public/config";
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "Invalid URL" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "HarborFM-InstanceManager/1.0" },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as PublicConfig;
    if (typeof data?.publicFeedsEnabled !== "boolean") {
      return { error: "Invalid response" };
    }
    return {
      publicFeedsEnabled: data.publicFeedsEnabled,
      webrtcEnabled: data.webrtcEnabled,
      reviewsEnabled: data.reviewsEnabled,
      gdprConsentBannerEnabled: data.gdprConsentBannerEnabled,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Request failed" };
  }
}

/** Build full instance list (no filter). Used for public-config batch fetch. */
async function buildFullInstanceList(): Promise<InstanceItem[]> {
  const data = loadData();
  const deployMeta = data.terraform_deploy_meta || {};
  const items: InstanceItem[] = [];
  try {
    const [awsList, vultrList] = await Promise.all([
      listTerraformInstances("aws").catch(() => []),
      listTerraformInstances("vultr").catch(() => []),
    ]);
    for (const i of [...awsList, ...vultrList]) {
      const item: InstanceItem = { ...i, setupUrl: i.setupUrl ?? undefined };
      const meta = deployMeta[i.id];
      if (meta) {
        item.harborfm_repo = meta.harborfm_repo;
        item.harborfm_branch = meta.harborfm_branch;
        item.script_url = meta.script_url;
      }
      items.push(item);
    }
  } catch {
    // continue
  }
  try {
    const kubeconfigPaths: string[] = [];
    if (config.kubeconfig) kubeconfigPaths.push(config.kubeconfig);
    for (const r of Object.values(data.k8s || {})) {
      if (r?.kubeconfig) kubeconfigPaths.push(r.kubeconfig);
    }
    const list = await listHelmReleases(kubeconfigPaths.length > 0 ? kubeconfigPaths : undefined);
    for (const r of list) {
      const k8sEntry = data.k8s?.[r.name];
      items.push({
        id: r.id,
        name: r.name,
        orchestrator: "kubernetes",
        namespace: r.namespace,
        status: r.status,
        harborfm_repo: k8sEntry?.harborfm_repo,
        harborfm_branch: k8sEntry?.harborfm_branch,
        script_url: k8sEntry?.script_url,
      });
    }
  } catch {
    // continue
  }
  for (const t of data.tracked || []) {
    items.push({
      id: t.id,
      name: t.name,
      orchestrator: "manual",
      url: t.url,
      publicIp: t.publicIp,
      tracked: true,
      harborfm_repo: t.harborfm_repo,
      harborfm_branch: t.harborfm_branch,
      script_url: t.script_url,
    });
  }
  return items;
}

interface ResolvedInstance {
  item: InstanceItem;
  adminApiKey?: string;
}

async function resolveInstance(id: string): Promise<ResolvedInstance | null> {
  const data = loadData();
  if (id.startsWith("manual:")) {
    const t = (data.tracked || []).find((x) => x.id === id);
    if (!t) return null;
    return {
      item: {
        id: t.id,
        name: t.name,
        orchestrator: "manual",
        url: t.url,
        publicIp: t.publicIp,
        tracked: true,
        harborfm_repo: t.harborfm_repo,
        harborfm_branch: t.harborfm_branch,
        script_url: t.script_url,
      },
      adminApiKey: t.adminApiKey,
    };
  }
  if (id.startsWith("aws:") || id.startsWith("vultr:")) {
    const provider = id.split(":")[0] as "aws" | "vultr";
    const list = await listTerraformInstances(provider);
    const found = list.find((i) => i.id === id);
    if (!found) return null;
    const deployMeta = data.terraform_deploy_meta || {};
    const meta = deployMeta[id];
    return {
      item: {
        ...found,
        setupUrl: found.setupUrl ?? undefined,
        harborfm_repo: meta?.harborfm_repo,
        harborfm_branch: meta?.harborfm_branch,
        script_url: meta?.script_url,
      },
      adminApiKey: meta?.admin_api_key,
    };
  }
  if (id.startsWith("k8s:")) {
    const kubeconfigPaths: string[] = [];
    if (config.kubeconfig) kubeconfigPaths.push(config.kubeconfig);
    for (const r of Object.values(data.k8s || {})) {
      if (r?.kubeconfig) kubeconfigPaths.push(r.kubeconfig);
    }
    const list = await listHelmReleases(kubeconfigPaths.length > 0 ? kubeconfigPaths : undefined);
    const found = list.find((i) => i.id === id);
    if (!found) return null;
    const k8sEntry = data.k8s?.[found.name];
    return {
      item: {
        ...found,
        harborfm_repo: k8sEntry?.harborfm_repo,
        harborfm_branch: k8sEntry?.harborfm_branch,
        script_url: k8sEntry?.script_url,
      },
      adminApiKey: k8sEntry?.admin_api_key,
    };
  }
  return null;
}

async function fetchSystemInfo(
  baseUrl: string,
  apiKey: string
): Promise<{ commands: Record<string, boolean>; memory?: { usedBytes: number; totalBytes: number }; cpus?: number; disk?: { usedBytes: number; totalBytes: number } } | { error: string }> {
  const base = baseUrl.replace(/\/+$/, "") + "/api";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const headers: Record<string, string> = {
      "User-Agent": "HarborFM-InstanceManager/1.0",
      Authorization: `Bearer ${apiKey}`,
    };
    const [commandsRes, statsRes] = await Promise.all([
      fetch(`${base}/settings/commands`, { signal: controller.signal, headers }),
      fetch(`${base}/settings/system-stats`, { signal: controller.signal, headers }),
    ]);
    clearTimeout(timeout);
    if (!commandsRes.ok) {
      return { error: `commands: HTTP ${commandsRes.status}` };
    }
    if (!statsRes.ok) {
      return { error: `system-stats: HTTP ${statsRes.status}` };
    }
    const commandsData = (await commandsRes.json()) as { commands?: Record<string, boolean> };
    const statsData = (await statsRes.json()) as {
      memory?: { usedBytes: number; totalBytes: number };
      cpus?: number;
      disk?: { usedBytes: number; totalBytes: number };
    };
    return {
      commands: commandsData.commands || {},
      memory: statsData.memory,
      cpus: statsData.cpus,
      disk: statsData.disk,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Request failed" };
  }
}

async function fetchSetupStatus(
  baseUrl: string,
  apiKey: string
): Promise<SetupStatus | { error: string }> {
  const url = baseUrl.replace(/\/+$/, "") + "/api/setup/status";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "HarborFM-InstanceManager/1.0",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as SetupStatus;
    if (typeof data?.setupRequired !== "boolean") {
      return { error: "Invalid response" };
    }
    return {
      setupRequired: data.setupRequired,
      registrationEnabled: data.registrationEnabled,
      publicFeedsEnabled: data.publicFeedsEnabled,
      captchaProvider: data.captchaProvider,
      captchaSiteKey: data.captchaSiteKey,
      emailConfigured: data.emailConfigured,
      welcomeBanner: data.welcomeBanner,
      twoFactorEnabled: data.twoFactorEnabled,
      twoFactorEnforced: data.twoFactorEnforced,
      twoFactorMethods: data.twoFactorMethods,
      emailSigninDisabled: data.emailSigninDisabled,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Request failed" };
  }
}

export async function registerInstancesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { url: string } }>("/api/health-check", async (request, reply) => {
    const url = request.query.url;
    if (!url || typeof url !== "string") {
      return reply.status(400).send({ error: "url query parameter required" });
    }
    const result = await pingUrl(url);
    return reply.send(result);
  });

  app.get<{
    Querystring: { provider?: string; orchestrator?: string };
  }>("/api/instances", async (request, reply) => {
    const { provider, orchestrator } = request.query;
    const data = loadData();
    const items: InstanceItem[] = [];
    const deployMeta = data.terraform_deploy_meta || {};

    if (!orchestrator || orchestrator === "terraform") {
      if (!provider || provider === "aws") {
        try {
          const list = await listTerraformInstances("aws");
          for (const i of list) {
            const item: InstanceItem = { ...i, setupUrl: i.setupUrl ?? undefined };
            const meta = deployMeta[i.id];
            if (meta) {
              item.harborfm_repo = meta.harborfm_repo;
              item.harborfm_branch = meta.harborfm_branch;
              item.script_url = meta.script_url;
            }
            items.push(item);
          }
        } catch (err) {
          request.log.warn({ err }, "Failed to list Terraform AWS instances");
        }
      }
      if (!provider || provider === "vultr") {
        try {
          const list = await listTerraformInstances("vultr");
          for (const i of list) {
            const item: InstanceItem = { ...i, setupUrl: i.setupUrl ?? undefined };
            const meta = deployMeta[i.id];
            if (meta) {
              item.harborfm_repo = meta.harborfm_repo;
              item.harborfm_branch = meta.harborfm_branch;
              item.script_url = meta.script_url;
            }
            items.push(item);
          }
        } catch (err) {
          request.log.warn({ err }, "Failed to list Terraform Vultr instances");
        }
      }
    }

    if (!orchestrator || orchestrator === "kubernetes") {
      try {
        const kubeconfigPaths: string[] = [];
        if (config.kubeconfig) kubeconfigPaths.push(config.kubeconfig);
        for (const r of Object.values(data.k8s || {})) {
          if (r?.kubeconfig) kubeconfigPaths.push(r.kubeconfig);
        }
        const list = await listHelmReleases(kubeconfigPaths.length > 0 ? kubeconfigPaths : undefined);
        for (const r of list) {
          const k8sEntry = data.k8s?.[r.name];
          items.push({
            id: r.id,
            name: r.name,
            orchestrator: "kubernetes",
            namespace: r.namespace,
            status: r.status,
            harborfm_repo: k8sEntry?.harborfm_repo,
            harborfm_branch: k8sEntry?.harborfm_branch,
            script_url: k8sEntry?.script_url,
          });
        }
      } catch (err) {
        request.log.warn({ err }, "Failed to list Helm releases");
      }
    }

    if (!orchestrator || orchestrator === "manual") {
      for (const t of data.tracked || []) {
        items.push({
          id: t.id,
          name: t.name,
          orchestrator: "manual",
          url: t.url,
          publicIp: t.publicIp,
          tracked: true,
          harborfm_repo: t.harborfm_repo,
          harborfm_branch: t.harborfm_branch,
          script_url: t.script_url,
        });
      }
    }

    return reply.send({ instances: items });
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/instances/public-config", async (request, reply) => {
    const list = await buildFullInstanceList();
    const withUrl = list.filter((i): i is InstanceItem & { url: string } => !!i.url);
    const result: Record<string, PublicConfig | { error: string }> = {};
    await Promise.all(
      withUrl.map(async (inst) => {
        result[inst.id] = await fetchPublicConfig(inst.url);
      })
    );
    return reply.send(result);
  });

  app.post<{
    Body: {
      name?: string;
      url?: string;
      publicIp?: string;
      adminApiKey?: string;
      harborfm_repo?: string;
      harborfm_branch?: string;
      script_url?: string;
    };
  }>("/api/instances/tracked", async (request, reply) => {
    const body = request.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!name) return reply.status(400).send({ error: "name is required" });
    if (!url) return reply.status(400).send({ error: "url is required" });
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reply.status(400).send({ error: "url must be http or https" });
    }
    const idSlug = slug(name);
    if (!idSlug) return reply.status(400).send({ error: "name must contain at least one alphanumeric character" });
    const id = `manual:${idSlug}`;
    const data = loadData();
    if (!data.tracked) data.tracked = [];
    if (data.tracked.some((t) => t.id === id)) {
      return reply.status(409).send({ error: "An instance with this name already exists" });
    }
    const entry: TrackedInstance = {
      id,
      name: name || idSlug,
      url,
      publicIp: typeof body.publicIp === "string" ? body.publicIp.trim() || undefined : undefined,
      adminApiKey: typeof body.adminApiKey === "string" ? body.adminApiKey.trim() || undefined : undefined,
      harborfm_repo: typeof body.harborfm_repo === "string" ? body.harborfm_repo.trim() || undefined : undefined,
      harborfm_branch: typeof body.harborfm_branch === "string" ? body.harborfm_branch.trim() || undefined : undefined,
      script_url: typeof body.script_url === "string" ? body.script_url.trim() || undefined : undefined,
    };
    data.tracked.push(entry);
    saveData(data);
    const item: InstanceItem = {
      id: entry.id,
      name: entry.name,
      orchestrator: "manual",
      url: entry.url,
      publicIp: entry.publicIp,
      tracked: true,
      harborfm_repo: entry.harborfm_repo,
      harborfm_branch: entry.harborfm_branch,
      script_url: entry.script_url,
    };
    return reply.status(201).send(item);
  });

  app.delete<{ Params: { id: string } }>("/api/instances/tracked/:id", async (request, reply) => {
    const { id } = request.params;
    if (!id.startsWith("manual:")) {
      return reply.status(400).send({ error: "Only manually tracked instances can be removed" });
    }
    const data = loadData();
    if (!data.tracked) data.tracked = [];
    const before = data.tracked.length;
    data.tracked = data.tracked.filter((t) => t.id !== id);
    if (data.tracked.length === before) {
      return reply.status(404).send({ error: "Instance not found" });
    }
    saveData(data);
    return reply.send({ success: true });
  });

  app.get<{ Params: { id: string } }>("/api/instances/:id/deploy-inputs", async (request, reply) => {
    const { id } = request.params;
    const resolved = await resolveInstance(id);
    if (!resolved || resolved.item.orchestrator !== "terraform") {
      return reply.status(404).send({ error: "Instance not found or deploy inputs not available" });
    }
    const data = loadData();
    const inputs = data.terraform_deploy_meta?.[id]?.inputs as TerraformDeployInputs | undefined;
    if (!inputs) {
      return reply.status(404).send({ error: "No saved deploy inputs for this instance" });
    }
    return reply.send(inputs);
  });

  /** GET editable fields for instance (for edit modal). Only admin API key is editable. */
  app.get<{ Params: { id: string } }>("/api/instances/:id/edit", async (request, reply) => {
    const { id } = request.params;
    const resolved = await resolveInstance(id);
    if (!resolved) return reply.status(404).send({ error: "Instance not found" });
    const { item, adminApiKey } = resolved;
    const editable: Record<string, string> = { adminApiKey: adminApiKey ?? "" };
    return reply.send({ id: item.id, name: item.name, orchestrator: item.orchestrator, editable });
  });

  app.patch<{
    Params: { id: string };
    Body: { adminApiKey?: string };
  }>("/api/instances/:id/edit", async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const resolved = await resolveInstance(id);
    if (!resolved) return reply.status(404).send({ error: "Instance not found" });
    const { item } = resolved;
    const data = loadData();
    const key = typeof body.adminApiKey === "string" ? body.adminApiKey.trim() || undefined : undefined;

    if (item.orchestrator === "manual" && id.startsWith("manual:")) {
      const t = (data.tracked || []).find((x) => x.id === id);
      if (!t) return reply.status(404).send({ error: "Instance not found" });
      t.adminApiKey = key;
      saveData(data);
      return reply.send({ success: true });
    }

    if (item.orchestrator === "terraform") {
      if (!data.terraform_deploy_meta) data.terraform_deploy_meta = {};
      const meta = data.terraform_deploy_meta[id];
      if (!meta) return reply.status(404).send({ error: "No meta for this instance" });
      meta.admin_api_key = key;
      saveData(data);
      return reply.send({ success: true });
    }

    if (item.orchestrator === "kubernetes") {
      if (!data.k8s) data.k8s = {};
      const entry = data.k8s[item.name] || {};
      entry.admin_api_key = key;
      data.k8s[item.name] = entry;
      saveData(data);
      return reply.send({ success: true });
    }

    return reply.status(400).send({ error: "Instance type not editable" });
  });

  app.get<{ Params: { id: string } }>("/api/instances/:id/system-info", async (request, reply) => {
    const { id } = request.params;
    const resolved = await resolveInstance(id);
    if (!resolved) return reply.status(404).send({ error: "Instance not found" });
    const { item, adminApiKey } = resolved;
    if (!item.url) {
      return reply.status(400).send({ error: "Instance has no URL configured" });
    }
    const apiKey = adminApiKey || (loadConfig().default_admin_api_key as string | undefined) || "";
    if (!apiKey.trim()) {
      return reply.status(400).send({
        error: "Admin API key required. Add a default key in Settings or set one when adding the tracked instance.",
      });
    }
    const result = await fetchSystemInfo(item.url, apiKey.trim());
    if ("error" in result) {
      return reply.status(502).send({ error: result.error });
    }
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>("/api/instances/:id/setup-status", async (request, reply) => {
    const { id } = request.params;
    const resolved = await resolveInstance(id);
    if (!resolved) return reply.status(404).send({ error: "Instance not found" });
    const { item, adminApiKey } = resolved;
    if (!item.url) {
      return reply.status(400).send({ error: "Instance has no URL configured" });
    }
    const apiKey = adminApiKey || (loadConfig().default_admin_api_key as string | undefined) || "";
    if (!apiKey.trim()) {
      return reply.status(400).send({
        error: "Admin API key required.",
      });
    }
    const result = await fetchSetupStatus(item.url, apiKey.trim());
    if ("error" in result) {
      return reply.status(502).send({ error: result.error });
    }
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>("/api/instances/:id/stats", async (request, reply) => {
    const { id } = request.params;
    if (id.startsWith("aws:") || id.startsWith("vultr:")) {
      const [provider] = id.split(":");
      const list = await listTerraformInstances(provider as "aws" | "vultr");
      const found = list.find((i) => i.id === id);
      if (!found) return reply.status(404).send({ error: "Instance not found" });
      return reply.send(found);
    }
    if (id.startsWith("k8s:")) {
      const data = loadData();
      const kubeconfigPaths: string[] = [];
      if (config.kubeconfig) kubeconfigPaths.push(config.kubeconfig);
      for (const r of Object.values(data.k8s || {})) {
        if (r?.kubeconfig) kubeconfigPaths.push(r.kubeconfig);
      }
      const list = await listHelmReleases(kubeconfigPaths.length > 0 ? kubeconfigPaths : undefined);
      const found = list.find((i) => i.id === id);
      if (!found) return reply.status(404).send({ error: "Instance not found" });
      return reply.send(found);
    }
    return reply.status(400).send({ error: "Invalid instance id" });
  });

  app.post<{ Params: { id: string }; Body?: { destroyStorage?: boolean } }>("/api/instances/:id/destroy", async (request, reply) => {
    const { id } = request.params;
    if (!id.startsWith("vultr:")) {
      return reply.status(400).send({
        error: "Destroy via API is only supported for Vultr Terraform instances. Use run.sh destroy in terraform/vultr for other providers.",
      });
    }
    const body = (request.body as { destroyStorage?: boolean } | undefined) ?? {};
    const workspace = id.slice("vultr:".length);
    const result = await destroyTerraformVultr(workspace, { destroyStorage: body.destroyStorage });
    if (result.success && body.destroyStorage) {
      const data = loadData();
      if (data.terraform_deploy_meta && data.terraform_deploy_meta[id]) {
        delete data.terraform_deploy_meta[id];
        saveData(data);
      }
    }
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>("/api/instances/:id/apply", async (request, reply) => {
    const { id } = request.params;
    if (!id.startsWith("vultr:") && !id.startsWith("aws:")) {
      return reply.status(400).send({ error: "Apply is only supported for Terraform instances (vultr: or aws:)." });
    }
    const [provider, workspace] = id.split(":") as [TerraformProvider, string];
    const data = loadData();
    const meta = data.terraform_deploy_meta?.[id];
    const inputs = meta?.inputs as TerraformDeployInputs | undefined;
    if (!inputs) {
      return reply.status(404).send({
        error: "No saved deploy inputs for this instance. Use the Deploy form to create it with the same name.",
      });
    }
    const cfg = loadConfig();
    const vars: Record<string, string | number | boolean | string[]> = {
      deploy_type: inputs.deploy_type || "pm2",
      domain: inputs.domain || "localhost",
      webrtc_enabled: inputs.webrtc_enabled || "0",
      admin_email: inputs.admin_email || "",
      admin_password: "",
      certbot_email: inputs.certbot_email || "",
      region: inputs.region || (provider === "vultr" ? "ewr" : "us-east-1"),
      harborfm_repo: inputs.harborfm_repo || "loganrickert/harborfm",
      harborfm_branch: inputs.harborfm_branch || "main",
      cloudflare_zone_name: inputs.cloudflare_zone_name ?? "",
      ssh_allowed_cidr: inputs.ssh_allowed_cidr ?? "192.168.1.1/32",
      ssh_public_key: (cfg.ssh_public_key as string) ?? "",
      setup_id: inputs.setup_id ?? "",
      cookie_secure: inputs.cookie_secure ?? "",
      script_url: inputs.script_url ?? "",
    };
    if (provider === "vultr") {
      vars.plan = inputs.plan || "vhf-2c-2gb";
      vars.os_id = inputs.os_id || "2136";
      vars.backups = inputs.backups ?? "enabled";
      const dataVolumeSize = Math.max(0, Number(inputs.data_volume_size) || 0);
      vars.data_volume_size = dataVolumeSize;
      if (dataVolumeSize > 0) vars.attach_data_volume = true;
    }
    if (provider === "aws") {
      vars.instance_type = inputs.instance_type || "t3.small";
      vars.os = inputs.os || "debian-12";
      if (inputs.ami_id) vars.ami_id = inputs.ami_id;
      if (inputs.key_name) vars.key_name = inputs.key_name;
    }
    const result = await applyTerraform(provider, workspace, vars);
    return reply.send(result);
  });
}
