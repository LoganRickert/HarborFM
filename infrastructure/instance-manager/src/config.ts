import "dotenv/config";
import { resolve } from "path";

const repoRoot = process.env.INFRASTRUCTURE_ROOT || resolve(process.cwd(), "../..");

export const config = {
  port: Number(process.env.PORT) || 3999,
  isDev: process.env.NODE_ENV !== "production",
  repoRoot,
  paths: {
    terraformAws: resolve(repoRoot, "infrastructure/terraform/aws"),
    terraformVultr: resolve(repoRoot, "infrastructure/terraform/vultr"),
    helm: resolve(repoRoot, "infrastructure/helm"),
    frontendDist: resolve(process.cwd(), "dist"),
    configJson: resolve(process.cwd(), "config.json"),
    dataJson: resolve(process.cwd(), "data.json"),
  },
  kubeconfig: process.env.KUBECONFIG || undefined,
  defaultSshPublicKey: process.env.DEFAULT_SSH_PUBLIC_KEY || process.env.SSH_PUBLIC_KEY || undefined,
} as const;
