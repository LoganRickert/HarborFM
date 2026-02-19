import { drizzleDb } from "../db/drizzle.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { sqlNow } from "../db/utils.js";
import { SSO_SECRETS_AAD } from "../config.js";
import { encryptSecret } from "./secrets.js";

/** Validate and persist SSO OIDC providers; encrypt client secrets. */
export function writeSsoOidcProviders(
  providers: Array<Record<string, unknown>>,
): { ok: boolean; error?: string } {
  if (!Array.isArray(providers))
    return { ok: false, error: "Invalid OIDC providers" };
  const processed: Array<Record<string, unknown>> = [];
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (!p || typeof p !== "object")
      return { ok: false, error: `OIDC provider ${i}: invalid` };
    const id = String(p.id ?? "").trim();
    const name = String(p.name ?? "").trim();
    const clientId = String(p.clientId ?? "").trim();
    if (!id || !name || !clientId) {
      return {
        ok: false,
        error: `OIDC provider ${i}: id, name, clientId required`,
      };
    }
    const hasDiscovery = Boolean(String(p.discoveryUrl ?? "").trim());
    const hasEndpoints =
      Boolean(String(p.authorizationEndpoint ?? "").trim()) &&
      Boolean(String(p.tokenEndpoint ?? "").trim());
    if (!hasDiscovery && !hasEndpoints) {
      return {
        ok: false,
        error: `OIDC provider ${id}: discoveryUrl or authorizationEndpoint+tokenEndpoint required`,
      };
    }
    const out: Record<string, unknown> = { ...p, id, name, clientId };
    const clientSecret = String(p.clientSecret ?? "").trim();
    if (clientSecret && clientSecret !== "(set)") {
      out.clientSecretEnc = encryptSecret(clientSecret, SSO_SECRETS_AAD);
      delete out.clientSecret;
    } else if (clientSecret === "(set)") {
      const existing = drizzleDb
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, "sso_oidc_providers"))
        .limit(1)
        .get() as { value: string } | undefined;
      const existingArr = existing?.value
        ? (JSON.parse(existing.value) as Array<Record<string, unknown>>)
        : [];
      const prev = Array.isArray(existingArr)
        ? existingArr.find((x) => String(x.id) === id)
        : undefined;
      const prevEnc = prev && (prev.clientSecretEnc ?? prev.clientSecret);
      if (
        prevEnc &&
        typeof prevEnc === "string" &&
        prevEnc.startsWith("v1:")
      ) {
        out.clientSecretEnc = prevEnc;
      }
      delete out.clientSecret;
    } else {
      delete out.clientSecret;
      delete out.clientSecretEnc;
    }
    processed.push(out);
  }
  const jsonString = JSON.stringify(processed);
  const now = sqlNow();
  drizzleDb
    .insert(settings)
    .values({
      key: "sso_oidc_providers",
      value: jsonString,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: jsonString, updatedAt: now },
    })
    .run();
  return { ok: true };
}

/** Validate and persist SSO SAML providers; encrypt certs. */
export function writeSsoSamlProviders(
  providers: Array<Record<string, unknown>>,
): { ok: boolean; error?: string } {
  if (!Array.isArray(providers))
    return { ok: false, error: "Invalid SAML providers" };
  const processed: Array<Record<string, unknown>> = [];
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (!p || typeof p !== "object")
      return { ok: false, error: `SAML provider ${i}: invalid` };
    const id = String(p.id ?? "").trim();
    const name = String(p.name ?? "").trim();
    const entryPoint = String(p.entryPoint ?? "").trim();
    const issuer = String(p.issuer ?? "").trim();
    const callbackUrl = String(p.callbackUrl ?? "").trim();
    if (!id || !name || !entryPoint || !issuer || !callbackUrl) {
      return {
        ok: false,
        error: `SAML provider ${i}: id, name, entryPoint, issuer, callbackUrl required`,
      };
    }
    const out: Record<string, unknown> = {
      ...p,
      id,
      name,
      entryPoint,
      issuer,
      callbackUrl,
    };
    for (const key of ["cert", "idpCert"] as const) {
      const val = String(p[key] ?? "").trim();
      const encKey = key === "cert" ? "certEnc" : "idpCertEnc";
      if (val && val !== "(set)") {
        out[encKey] = encryptSecret(val, SSO_SECRETS_AAD);
        delete out[key];
      } else if (val === "(set)") {
        const existing = drizzleDb
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, "sso_saml_providers"))
          .limit(1)
          .get() as { value: string } | undefined;
        const existingArr = existing?.value
          ? (JSON.parse(existing.value) as Array<Record<string, unknown>>)
          : [];
        const prev = Array.isArray(existingArr)
          ? existingArr.find((x) => String(x.id) === id)
          : undefined;
        const prevEnc = prev && (prev[encKey] ?? prev[key]);
        if (
          prevEnc &&
          typeof prevEnc === "string" &&
          prevEnc.startsWith("v1:")
        ) {
          out[encKey] = prevEnc;
        }
        delete out[key];
      } else {
        delete out[key];
        delete out[encKey];
      }
    }
    processed.push(out);
  }
  const jsonString = JSON.stringify(processed);
  const now = sqlNow();
  drizzleDb
    .insert(settings)
    .values({
      key: "sso_saml_providers",
      value: jsonString,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: jsonString, updatedAt: now },
    })
    .run();
  return { ok: true };
}
