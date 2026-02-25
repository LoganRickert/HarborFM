import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "../config.js";

const CONFIG_KEYS = [
  "plan", "os_id", "os", "region", "cloudflare_zone_name", "ssh_allowed_cidr", "ssh_public_key",
  "backups", "harborfm_repo", "harborfm_branch", "setup_id", "cookie_secure", "deploy_type",
  "data_volume_size", "instance_type", "certbot_email", "script_url", "default_admin_api_key",
] as const;

const DEFAULT_CONFIG: Record<string, string | number> = {
  plan: "vhf-2c-2gb",
  os_id: "2136",
  os: "debian-12",
  region: "ewr",
  cloudflare_zone_name: "",
  ssh_allowed_cidr: "192.168.1.1/32",
  ssh_public_key: "",
  backups: "enabled",
  harborfm_repo: "loganrickert/harborfm",
  harborfm_branch: "main",
  setup_id: "",
  cookie_secure: "",
  deploy_type: "pm2",
  data_volume_size: 0,
  instance_type: "t3.small",
  certbot_email: "",
  script_url: "",
  default_admin_api_key: "",
};

function loadConfig(): Record<string, string | number> {
  if (!existsSync(config.paths.configJson)) return applyConfigEnv({ ...DEFAULT_CONFIG });
  try {
    const raw = readFileSync(config.paths.configJson, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, string | number>;
    const out = applyConfigEnv({ ...DEFAULT_CONFIG, ...parsed });
    if (config.defaultSshPublicKey && (out.ssh_public_key === "" || out.ssh_public_key === undefined)) {
      out.ssh_public_key = config.defaultSshPublicKey;
    }
    return out;
  } catch {
    return applyConfigEnv({ ...DEFAULT_CONFIG });
  }
}

function applyConfigEnv(cfg: Record<string, string | number>): Record<string, string | number> {
  const envKey = process.env.DEFAULT_ADMIN_API_KEY;
  if (envKey !== undefined && envKey !== "") {
    cfg.default_admin_api_key = envKey;
  }
  return cfg;
}

function saveConfig(data: Record<string, unknown>): void {
  const out: Record<string, string | number> = {};
  for (const key of CONFIG_KEYS) {
    if (data[key] !== undefined && data[key] !== null) {
      const v = data[key];
      out[key] = typeof v === "number" ? v : String(v);
    }
  }
  const merged = { ...loadConfig(), ...out };
  writeFileSync(config.paths.configJson, JSON.stringify(merged, null, 2), "utf-8");
}

export interface TrackedInstance {
  id: string;
  name: string;
  url: string;
  publicIp?: string;
  adminApiKey?: string;
  harborfm_repo?: string;
  harborfm_branch?: string;
  script_url?: string;
}

/** Stored deploy inputs for Terraform (no ssh_public_key or admin_password). Used to duplicate a deploy. */
export interface TerraformDeployInputs {
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
  cookie_secure?: string;
  script_url?: string;
}

export interface DataShape {
  k8s?: Record<string, {
    kubeconfig?: string;
    harborfm_repo?: string;
    harborfm_branch?: string;
    script_url?: string;
    admin_api_key?: string;
  }>;
  tracked?: TrackedInstance[];
  terraform_deploy_meta?: Record<string, {
    harborfm_repo: string;
    harborfm_branch: string;
    script_url: string;
    inputs?: TerraformDeployInputs;
    admin_api_key?: string;
  }>;
}

const DEFAULT_DATA: DataShape = { k8s: {} };

function loadData(): DataShape {
  if (!existsSync(config.paths.dataJson)) return { ...DEFAULT_DATA };
  try {
    const raw = readFileSync(config.paths.dataJson, "utf-8");
    return { ...DEFAULT_DATA, ...JSON.parse(raw) } as DataShape;
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function saveData(data: DataShape): void {
  writeFileSync(config.paths.dataJson, JSON.stringify(data, null, 2), "utf-8");
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config", async (_request, reply) => {
    const cfg = loadConfig();
    if (config.defaultSshPublicKey && !cfg.ssh_public_key) {
      cfg.ssh_public_key = config.defaultSshPublicKey;
    }
    return reply.send(cfg);
  });

  app.put<{ Body: Record<string, unknown> }>("/api/config", async (request, reply) => {
    saveConfig(request.body);
    return reply.send(loadConfig());
  });

  app.get("/api/data", async (_request, reply) => {
    return reply.send(loadData());
  });

  app.put<{ Body: DataShape }>("/api/data", async (request, reply) => {
    saveData(request.body);
    return reply.send(loadData());
  });
}

export { loadConfig, loadData, saveData };
