import type { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { applyTerraform, getOutputs, type TerraformProvider } from "../runners/terraform.js";
import { helmUpgradeInstall } from "../runners/helm.js";
import { loadData, saveData, type TerraformDeployInputs } from "./config.js";
import {
  hashAdminPassword,
  createFlareVaultPackage,
  patchFlareVaultCidr,
} from "../flarevault.js";

export interface DeployBody {
  orchestrator: "terraform" | "kubernetes";
  provider?: "aws" | "vultr";
  name: string;
  domain?: string;
  deploy_type?: string;
  webrtc_enabled?: string;
  admin_email?: string;
  admin_password?: string;
  certbot_email?: string;
  region?: string;
  plan?: string;
  instance_type?: string;
  os_id?: string;
  os?: string;
  ami_id?: string;
  key_name?: string;
  data_volume_size?: number | string;
  cloudflare_zone_name?: string;
  ssh_allowed_cidr?: string;
  ssh_public_key?: string;
  backups?: string;
  harborfm_repo?: string;
  harborfm_branch?: string;
  setup_id?: string;
  cookie_secure?: string;
  script_url?: string;
  kubeconfig?: string;
  [key: string]: string | number | boolean | string[] | undefined;
}

export async function registerDeployRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: DeployBody }>("/api/deploy", async (request, reply) => {
    const body = request.body;
    if (!body.name?.trim()) {
      return reply.status(400).send({ error: "name is required" });
    }
    const name = body.name.trim();

    if (body.orchestrator === "terraform") {
      const provider = (body.provider || "vultr") as TerraformProvider;
      const workspace = name === "default" ? "default" : name;
      const flarevaultUrl = process.env.FLAREVAULT_URL?.replace(/\/+$/, "");
      const adminBearerToken = process.env.FLAREVAULT_ADMIN_TOKEN ?? "";
      const useFlareVault =
        !!flarevaultUrl &&
        !!adminBearerToken &&
        !!body.admin_email?.trim() &&
        !!body.admin_password;

      let redeemTokenForPatch: string | null = null;

      const vars: Record<string, string | number | boolean | string[]> = {
        deploy_type: body.deploy_type || "pm2",
        domain: body.domain || "localhost",
        webrtc_enabled: body.webrtc_enabled || "0",
        admin_email: useFlareVault ? "" : (body.admin_email || ""),
        admin_password: useFlareVault ? "" : (body.admin_password || ""),
        certbot_email: body.certbot_email || "",
        region: body.region || (provider === "vultr" ? "ewr" : "us-east-1"),
        harborfm_repo: body.harborfm_repo || "loganrickert/harborfm",
        harborfm_branch: body.harborfm_branch || "main",
        cloudflare_zone_name: body.cloudflare_zone_name ?? "",
        ssh_allowed_cidr: body.ssh_allowed_cidr ?? "192.168.1.1/32",
        ssh_public_key: body.ssh_public_key ?? "",
        setup_id: body.setup_id ?? "",
        cookie_secure: body.cookie_secure ?? "",
        script_url: body.script_url ?? "",
      };

      if (useFlareVault) {
        const hash = await hashAdminPassword(body.admin_password!);
        if (hash) {
          const instanceId = `${provider}:${workspace}`;
          const initialToken = randomBytes(24).toString("hex");
          const payload: { admin_email: string; admin_password_hash: string; initial_admin_api_token?: string } = {
            admin_email: body.admin_email!.trim(),
            admin_password_hash: hash,
          };
          if (initialToken) payload.initial_admin_api_token = initialToken;
          const created = await createFlareVaultPackage(flarevaultUrl, adminBearerToken, instanceId, payload);
          if (created) {
            vars.flarevault_url = flarevaultUrl;
            vars.flarevault_redeem_token = created.redeemToken;
            redeemTokenForPatch = created.redeemToken;
          }
        }
      }

      if (provider === "vultr") {
        vars.plan = body.plan || "vhf-2c-2gb";
        vars.os_id = body.os_id || "2136";
        vars.backups = body.backups ?? "enabled";
        const dataVolumeSize = Math.max(0, Number(body.data_volume_size) || 0);
        vars.data_volume_size = dataVolumeSize;
        if (dataVolumeSize > 0) vars.attach_data_volume = true;
      }
      if (provider === "aws") {
        vars.instance_type = body.instance_type || "t3.small";
        vars.os = body.os || "debian-12";
        if (body.ami_id) vars.ami_id = body.ami_id;
        if (body.key_name) vars.key_name = body.key_name;
      }

      const result = await applyTerraform(provider, workspace, vars);

      if (result.success && redeemTokenForPatch && flarevaultUrl && adminBearerToken) {
        const outputs = await getOutputs(provider, workspace);
        const publicIp = outputs?.public_ip?.value;
        if (publicIp) {
          const cidr = `${publicIp}/32`;
          await patchFlareVaultCidr(flarevaultUrl, adminBearerToken, redeemTokenForPatch, cidr);
        }
      }

      if (result.success) {
        const data = loadData();
        if (!data.terraform_deploy_meta) data.terraform_deploy_meta = {};
        const instanceId = `${provider}:${workspace}`;
        const inputs: TerraformDeployInputs = {
          name,
          provider,
          domain: body.domain || "localhost",
          deploy_type: body.deploy_type || "pm2",
          webrtc_enabled: body.webrtc_enabled || "0",
          admin_email: body.admin_email || "",
          certbot_email: body.certbot_email || "",
          region: body.region || (provider === "vultr" ? "ewr" : "us-east-1"),
          cloudflare_zone_name: body.cloudflare_zone_name ?? "",
          ssh_allowed_cidr: body.ssh_allowed_cidr ?? "192.168.1.1/32",
          harborfm_repo: body.harborfm_repo || "loganrickert/harborfm",
          harborfm_branch: body.harborfm_branch || "main",
          setup_id: body.setup_id ?? "",
          cookie_secure: body.cookie_secure ?? "",
          script_url: body.script_url ?? "",
        };
        if (provider === "vultr") {
          inputs.plan = body.plan || "vhf-2c-2gb";
          inputs.os_id = body.os_id || "2136";
          inputs.backups = body.backups ?? "enabled";
          inputs.data_volume_size = body.data_volume_size ?? 0;
        }
        if (provider === "aws") {
          inputs.instance_type = body.instance_type || "t3.small";
          inputs.os = body.os || "debian-12";
          if (body.ami_id) inputs.ami_id = body.ami_id;
          if (body.key_name) inputs.key_name = body.key_name;
        }
        data.terraform_deploy_meta[instanceId] = {
          harborfm_repo: vars.harborfm_repo as string,
          harborfm_branch: vars.harborfm_branch as string,
          script_url: (vars.script_url as string) ?? "",
          inputs,
        };
        saveData(data);
      }
      return reply.send(result);
    }

    if (body.orchestrator === "kubernetes") {
      const kubeconfigPath = body.kubeconfig?.trim() || undefined;
      const data = loadData();
      if (!data.k8s) data.k8s = {};
      const entry = {
        ...data.k8s[name],
        harborfm_repo: body.harborfm_repo?.trim() || undefined,
        harborfm_branch: body.harborfm_branch?.trim() || undefined,
        script_url: body.script_url?.trim() || undefined,
      };
      if (kubeconfigPath) entry.kubeconfig = kubeconfigPath;
      data.k8s[name] = entry;
      saveData(data);
      const values: Record<string, unknown> = {
        domain: body.domain || "localhost",
        ingress: {
          enabled: true,
          host: body.domain || "localhost",
          className: "nginx",
          tls: { enabled: false },
        },
        webrtc: { enabled: body.webrtc_enabled === "1" },
        admin: {
          email: body.admin_email || "",
          registrationEnabled: "0",
          publicFeedsEnabled: "1",
          hostname: body.admin_hostname || "",
        },
        setupId: body.setup_id || "setup",
      };
      const result = await helmUpgradeInstall(name, values, kubeconfigPath ?? undefined);
      return reply.send(result);
    }

    return reply.status(400).send({ error: "orchestrator must be terraform or kubernetes" });
  });
}
