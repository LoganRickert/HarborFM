import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { stringify } from "yaml";
import { execa } from "execa";
import { config } from "../config.js";

const helmCwd = config.paths.helm;
const chartPath = "./harborfm";

function helmEnv(kubeconfigPath?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const path = kubeconfigPath ?? config.kubeconfig;
  if (path) env.KUBECONFIG = path;
  return env;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  status: string;
  chart: string;
  app_version?: string;
}

export interface K8sInstance {
  id: string;
  name: string;
  orchestrator: "kubernetes";
  namespace: string;
  status: string;
  chart?: string;
}

export async function listHelmReleases(kubeconfigPaths?: string[]): Promise<K8sInstance[]> {
  const paths = kubeconfigPaths && kubeconfigPaths.length > 0 ? kubeconfigPaths : [undefined];
  const seen = new Set<string>();
  const result: K8sInstance[] = [];
  for (const kubeconfig of paths) {
    try {
      const { stdout } = await execa(
        "helm",
        ["list", "-A", "-o", "json", "--no-color"],
        { cwd: helmCwd, env: helmEnv(kubeconfig), timeout: 15000 }
      );
      const releases = JSON.parse(stdout) as HelmRelease[];
      for (const r of releases) {
        const id = `k8s:${r.namespace}:${r.name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({
          id,
          name: r.name,
          orchestrator: "kubernetes",
          namespace: r.namespace,
          status: r.status,
          chart: r.chart,
        });
      }
    } catch {
      // skip this kubeconfig
    }
  }
  return result;
}

export async function helmUpgradeInstall(
  releaseName: string,
  values: Record<string, unknown>,
  kubeconfigPath?: string
): Promise<{ success: boolean; output: string }> {
  const env = helmEnv(kubeconfigPath);
  const tmpDir = join(config.repoRoot, "infrastructure", "instance-manager", "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const valuesPath = join(tmpDir, `values-${releaseName}-${Date.now()}.yaml`);
  writeFileSync(valuesPath, stringify(values), "utf-8");
  try {
    const run = await execa(
      "helm",
      ["upgrade", "--install", releaseName, chartPath, "-f", "harborfm/values.yaml", "-f", valuesPath, "--wait", "--timeout", "5m"],
      { cwd: helmCwd, env, timeout: 360000, all: true }
    );
    const outStr = Array.isArray(run.all) ? run.all.join("\n") : typeof run.all === "string" ? run.all : run.stdout + "\n" + run.stderr;
    return { success: true, output: outStr };
  } catch (err: unknown) {
    const errObj = err as { all?: string[] | string; message?: string };
    const out = Array.isArray(errObj.all) ? errObj.all.join("\n") : typeof errObj.all === "string" ? errObj.all : err instanceof Error ? err.message : String(err);
    return { success: false, output: out };
  }
}
