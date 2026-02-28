import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "../config.js";
import {
  getManagerKey,
  encryptSecret,
  decryptSecret,
  isEncrypted,
} from "../secrets.js";
import { DEFAULT_CONFIG, type ConfigState } from "../types.js";

const AAD_CONFIG = "instance-manager-config";
const AAD_DATA = "instance-manager-data";

const CONFIG_KEYS = [
  "plan", "os_id", "os", "region", "cloudflare_zone_name", "ssh_allowed_cidr", "ssh_public_key",
  "backups", "harborfm_repo", "harborfm_branch", "setup_id", "cookie_secure", "deploy_type",
  "data_volume_size", "instance_type", "certbot_email", "script_url",
  "generate_admin_api_key_by_default",
  "default_admin_email",
] as const;

function loadConfig(): ConfigState {
  if (!existsSync(config.paths.configJson)) {
    const cfg: ConfigState = { ...DEFAULT_CONFIG };
    if (config.defaultSshPublicKey && !cfg.ssh_public_key) cfg.ssh_public_key = config.defaultSshPublicKey;
    return cfg;
  }
  const raw = readFileSync(config.paths.configJson, "utf-8");
  let parsed: Partial<ConfigState>;
  const key = getManagerKey();
  if (key && isEncrypted(raw)) {
    try {
      const plain = decryptSecret(raw, AAD_CONFIG);
      parsed = JSON.parse(plain) as Partial<ConfigState>;
    } catch (e) {
      console.error(
        "[instance-manager] MANAGER_SECRET is set but decryption of config.json failed:",
        e instanceof Error ? e.message : e,
        ". Wrong key or corrupted file."
      );
      process.exit(1);
    }
  } else {
    try {
      parsed = JSON.parse(raw) as Partial<ConfigState>;
    } catch {
      const cfg: ConfigState = { ...DEFAULT_CONFIG };
      if (config.defaultSshPublicKey && !cfg.ssh_public_key) cfg.ssh_public_key = config.defaultSshPublicKey;
      return cfg;
    }
  }
  const out: ConfigState = { ...DEFAULT_CONFIG, ...parsed };
  if (config.defaultSshPublicKey && (out.ssh_public_key === "" || out.ssh_public_key === undefined)) {
    out.ssh_public_key = config.defaultSshPublicKey;
  }
  return out;
}

function saveConfig(data: Partial<ConfigState>): void {
  const cfg = loadConfig();
  const out: Record<string, string | number | boolean> = { ...cfg };
  for (const key of CONFIG_KEYS) {
    const v = data[key as keyof ConfigState];
    if (v !== undefined && v !== null) {
      out[key] = typeof v === "boolean" ? v : typeof v === "number" ? v : String(v);
    }
  }
  const key = getManagerKey();
  const content = key
    ? encryptSecret(JSON.stringify(out, null, 2), AAD_CONFIG)
    : JSON.stringify(out, null, 2);
  writeFileSync(config.paths.configJson, content, "utf-8");
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
  cookie_secure?: boolean;
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
  const raw = readFileSync(config.paths.dataJson, "utf-8");
  const key = getManagerKey();
  if (key && isEncrypted(raw)) {
    try {
      const plain = decryptSecret(raw, AAD_DATA);
      return { ...DEFAULT_DATA, ...JSON.parse(plain) } as DataShape;
    } catch (e) {
      console.error(
        "[instance-manager] MANAGER_SECRET is set but decryption of data.json failed:",
        e instanceof Error ? e.message : e,
        ". Wrong key or corrupted file."
      );
      process.exit(1);
    }
  }
  try {
    return { ...DEFAULT_DATA, ...JSON.parse(raw) } as DataShape;
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function saveData(data: DataShape): void {
  const key = getManagerKey();
  const content = key
    ? encryptSecret(JSON.stringify(data, null, 2), AAD_DATA)
    : JSON.stringify(data, null, 2);
  writeFileSync(config.paths.dataJson, content, "utf-8");
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config", async (_request, reply) => {
    const cfg = loadConfig();
    if (config.defaultSshPublicKey && !cfg.ssh_public_key) {
      cfg.ssh_public_key = config.defaultSshPublicKey;
    }
    return reply.send(cfg);
  });

  app.put<{ Body: Partial<ConfigState> }>("/api/config", async (request, reply) => {
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
