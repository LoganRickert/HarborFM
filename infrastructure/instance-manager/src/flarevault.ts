/**
 * FlareVault helpers: hash password (via server script), create package, PATCH allowedCidr.
 * Used when FLAREVAULT_URL and FLAREVAULT_ADMIN_TOKEN are set for Terraform deploys.
 */
import { execa } from "execa";
import { resolve } from "path";
import { config } from "./config.js";

const serverDir = resolve(config.repoRoot, "server");

export async function hashAdminPassword(password: string): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "node",
      ["scripts/hash-admin-password.mjs"],
      {
        cwd: serverDir,
        input: JSON.stringify({ password }),
        timeout: 15000,
      }
    );
    const out = JSON.parse(stdout) as { hash?: string };
    return out.hash ?? null;
  } catch {
    return null;
  }
}

export async function createFlareVaultPackage(
  baseUrl: string,
  adminBearerToken: string,
  instanceId: string,
  payload: { admin_email: string; admin_password_hash: string; initial_admin_api_token?: string }
): Promise<{ redeemToken: string } | null> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/packages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminBearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instanceId,
        payload,
        expiresInSeconds: 1800,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { redeemToken?: string };
    return data.redeemToken ? { redeemToken: data.redeemToken } : null;
  } catch {
    return null;
  }
}

export async function patchFlareVaultCidr(
  baseUrl: string,
  adminBearerToken: string,
  redeemToken: string,
  allowedCidr: string
): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/packages`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminBearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ redeemToken, allowedCidr }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
