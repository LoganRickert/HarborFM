import { execa } from "execa";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "../config.js";

export type TerraformProvider = "aws" | "vultr";

const providerDirs: Record<TerraformProvider, string> = {
  aws: config.paths.terraformAws,
  vultr: config.paths.terraformVultr,
};

function loadEnv(provider: TerraformProvider): NodeJS.ProcessEnv {
  const envPath = resolve(providerDirs[provider], ".env");
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) env[key] = value;
  }
  if (env.CLOUDFLARE_API_TOKEN) env.TF_VAR_cloudflare_api_token = env.CLOUDFLARE_API_TOKEN;
  return env;
}

export async function listWorkspaces(provider: TerraformProvider): Promise<string[]> {
  const cwd = providerDirs[provider];
  const env = loadEnv(provider);
  const { stdout } = await execa("terraform", ["workspace", "list", "-no-color"], {
    cwd,
    env,
    timeout: 15000,
  });
  const lines = stdout.trim().split("\n").filter(Boolean);
  return lines
    .map((line) => {
      const match = line.match(/^\*\s+(.+)$/) || line.match(/^\s+(.+)$/);
      return match ? match[1].trim() : null;
    })
    .filter((w): w is string => w !== null);
}

export interface TerraformOutputs {
  instance_id?: { value: string };
  public_ip?: { value: string };
  public_dns?: { value: string };
  url?: { value: string };
  setup_id?: { value: string | null };
  setup_url?: { value: string | null };
}

export async function getOutputs(
  provider: TerraformProvider,
  workspace: string
): Promise<TerraformOutputs | null> {
  const cwd = providerDirs[provider];
  const env = loadEnv(provider);
  try {
    await execa("terraform", ["workspace", "select", workspace, "-no-color"], { cwd, env, timeout: 10000 });
    const { stdout } = await execa("terraform", ["output", "-json", "-no-color"], {
      cwd,
      env,
      timeout: 15000,
    });
    return JSON.parse(stdout) as TerraformOutputs;
  } catch {
    return null;
  }
}

/** Resource address we use to detect if the instance exists in state (vultr_instance.harborfm / aws_instance.harborfm). */
const INSTANCE_RESOURCE: Record<TerraformProvider, string> = {
  vultr: "vultr_instance.harborfm",
  aws: "aws_instance.harborfm",
};

async function getStateList(provider: TerraformProvider, workspace: string): Promise<string[]> {
  const cwd = providerDirs[provider];
  const env = loadEnv(provider);
  try {
    await execa("terraform", ["workspace", "select", workspace, "-no-color"], { cwd, env, timeout: 10000 });
    const { stdout } = await execa("terraform", ["state", "list", "-no-color"], { cwd, env, timeout: 15000 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function workspaceHasInstanceInState(provider: TerraformProvider, workspace: string): Promise<boolean> {
  const list = await getStateList(provider, workspace);
  const prefix = INSTANCE_RESOURCE[provider];
  return list.some((addr) => addr === prefix || addr.startsWith(prefix + "["));
}

export interface TerraformInstance {
  id: string;
  name: string;
  provider: TerraformProvider;
  orchestrator: "terraform";
  workspace: string;
  url?: string;
  publicIp?: string;
  publicDns?: string;
  setupUrl?: string | null;
  /** True when the instance was destroyed but state (e.g. block storage) remains; show "Create" to reapply. */
  instanceGone?: boolean;
}

export async function listTerraformInstances(provider: TerraformProvider): Promise<TerraformInstance[]> {
  const workspaces = await listWorkspaces(provider);
  const instances: TerraformInstance[] = [];
  const name = (w: string) => (w === "default" ? provider : w);
  for (const workspace of workspaces) {
    const hasInstance = await workspaceHasInstanceInState(provider, workspace);
    if (hasInstance) {
      const outputs = await getOutputs(provider, workspace);
      if (!outputs?.instance_id?.value && !outputs?.public_ip?.value) continue;
      instances.push({
        id: `${provider}:${workspace}`,
        name: name(workspace),
        provider,
        orchestrator: "terraform",
        workspace,
        url: outputs?.url?.value,
        publicIp: outputs?.public_ip?.value,
        publicDns: outputs?.public_dns?.value,
        setupUrl: outputs?.setup_url?.value ?? undefined,
      });
      continue;
    }
    const stateList = await getStateList(provider, workspace);
    if (stateList.length > 0) {
      instances.push({
        id: `${provider}:${workspace}`,
        name: name(workspace),
        provider,
        orchestrator: "terraform",
        workspace,
        instanceGone: true,
      });
    }
  }
  return instances;
}

export async function applyTerraform(
  provider: TerraformProvider,
  workspace: string,
  vars: Record<string, string | number | boolean | string[]>
): Promise<{ success: boolean; output: string }> {
  const cwd = providerDirs[provider];
  const env = loadEnv(provider);
  const varArgs: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      varArgs.push(`-var`, `${k}=${JSON.stringify(v)}`);
    } else {
      varArgs.push("-var", `${k}=${String(v)}`);
    }
  }
  try {
    await execa("terraform", ["workspace", "select", workspace, "-no-color"], { cwd, env, timeout: 10000 });
  } catch {
    await execa("terraform", ["workspace", "new", workspace, "-no-color"], { cwd, env, timeout: 10000 });
  }
  const applyEnv = { ...env, INSTANCE_MANAGER: "1" };
  try {
    const run = await execa("bash", ["./run.sh", "apply", "-auto-approve", ...varArgs], {
      cwd,
      env: applyEnv,
      timeout: 600000,
      all: true,
    });
    const outStr = Array.isArray(run.all) ? run.all.join("\n") : typeof run.all === "string" ? run.all : run.stdout + "\n" + run.stderr;
    return { success: true, output: outStr };
  } catch (err: unknown) {
    const errObj = err as { all?: string[] | string };
    const out = Array.isArray(errObj.all) ? errObj.all.join("\n") : typeof errObj.all === "string" ? errObj.all : err instanceof Error ? err.message : String(err);
    return { success: false, output: out };
  }
}

/**
 * Destroy a Vultr instance using run.sh destroy so block storage is never in the
 * destroy plan (detached via API first, then instance/dependents destroyed).
 * Block storage remains in state and in Vultr for future reattach unless destroyStorage is true.
 */
export async function destroyTerraformVultr(
  workspace: string,
  options?: { destroyStorage?: boolean }
): Promise<{ success: boolean; output: string }> {
  const cwd = providerDirs.vultr;
  const env = { ...loadEnv("vultr"), ...(options?.destroyStorage ? { DESTROY_STORAGE: "1" } : {}) };
  try {
    await execa("terraform", ["workspace", "select", workspace, "-no-color"], { cwd, env, timeout: 10000 });
  } catch {
    return { success: false, output: `Workspace '${workspace}' does not exist.` };
  }
  try {
    const run = await execa("bash", ["./run.sh", "destroy"], {
      cwd,
      env,
      timeout: 300000,
      all: true,
    });
    const outStr = Array.isArray(run.all) ? run.all.join("\n") : typeof run.all === "string" ? run.all : run.stdout + "\n" + run.stderr;
    if (options?.destroyStorage) {
      await deleteTerraformWorkspace("vultr", workspace);
    }
    return { success: true, output: outStr };
  } catch (err: unknown) {
    const errObj = err as { all?: string[] | string };
    const out = Array.isArray(errObj.all) ? errObj.all.join("\n") : typeof errObj.all === "string" ? errObj.all : err instanceof Error ? err.message : String(err);
    return { success: false, output: out };
  }
}

/** Delete a Terraform workspace (e.g. after destroy+storage so it no longer appears in the list). */
export async function deleteTerraformWorkspace(
  provider: TerraformProvider,
  workspace: string
): Promise<{ success: boolean; output: string }> {
  const cwd = providerDirs[provider];
  const env = loadEnv(provider);
  if (workspace === "default") {
    return { success: false, output: "Cannot delete the default workspace." };
  }
  try {
    await execa("terraform", ["workspace", "select", "default", "-no-color"], { cwd, env, timeout: 10000 });
  } catch {
    return { success: false, output: "Could not select default workspace." };
  }
  try {
    await execa("terraform", ["workspace", "delete", workspace, "-force", "-no-color"], { cwd, env, timeout: 10000 });
    return { success: true, output: "" };
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    return { success: false, output: e.stderr ?? String(err) };
  }
}
