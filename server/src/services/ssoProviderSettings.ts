import { readFileSync, existsSync } from "fs";
import { drizzleDb } from "../db/drizzle.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { sqlNow } from "../db/utils.js";
import {
  SSO_SECRETS_AAD,
  SSO_PROVIDERS_INIT_JSON_PATH,
  SSO_OIDC_PROVIDERS_INIT,
  SSO_SAML_PROVIDERS_INIT,
} from "../config.js";
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
    if (!id || !name || !entryPoint) {
      return {
        ok: false,
        error: `SAML provider ${i}: id, name, entryPoint required`,
      };
    }
    const out: Record<string, unknown> = {
      ...p,
      id,
      name,
      entryPoint,
      ...(issuer && { issuer }),
      ...(callbackUrl && { callbackUrl }),
    };
    for (const key of ["cert", "idpCert"] as const) {
      const encKey =
        key === "cert"
          ? "certEnc"
          : "idpCertEnc";
      const val = String(p[key] ?? "").trim();
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

function getRawOidcProviders(): Array<Record<string, unknown>> {
  try {
    const row = drizzleDb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "sso_oidc_providers"))
      .limit(1)
      .get() as { value: string } | undefined;
    if (!row?.value?.trim()) return [];
    const arr = JSON.parse(row.value) as Array<Record<string, unknown>>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function getRawSamlProviders(): Array<Record<string, unknown>> {
  try {
    const row = drizzleDb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "sso_saml_providers"))
      .limit(1)
      .get() as { value: string } | undefined;
    if (!row?.value?.trim()) return [];
    const arr = JSON.parse(row.value) as Array<Record<string, unknown>>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Merge initial SSO providers from env (or file) into DB. For each provider from init,
 * if a provider with the same id already exists in DB, skip it; otherwise add it (secrets encrypted).
 * Call after DB is ready (e.g. from migrate step).
 */
export function migrateSsoProvidersFromEnv(): void {
  let initOidc: Array<Record<string, unknown>> = [];
  let initSaml: Array<Record<string, unknown>> = [];

  if (SSO_PROVIDERS_INIT_JSON_PATH && existsSync(SSO_PROVIDERS_INIT_JSON_PATH)) {
    try {
      const raw = readFileSync(SSO_PROVIDERS_INIT_JSON_PATH, "utf-8");
      const parsed = JSON.parse(raw) as {
        oidc?: Array<Record<string, unknown>>;
        saml?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(parsed.oidc)) initOidc = parsed.oidc;
      if (Array.isArray(parsed.saml)) initSaml = parsed.saml;
    } catch (err) {
      console.warn("Could not parse SSO_PROVIDERS_INIT_JSON_PATH:", err);
      return;
    }
  } else {
    if (SSO_OIDC_PROVIDERS_INIT) {
      try {
        const arr = JSON.parse(SSO_OIDC_PROVIDERS_INIT) as unknown;
        initOidc = Array.isArray(arr) ? arr : [];
      } catch (err) {
        console.warn("Could not parse SSO_OIDC_PROVIDERS_INIT:", err);
      }
    }
    if (SSO_SAML_PROVIDERS_INIT) {
      try {
        const arr = JSON.parse(SSO_SAML_PROVIDERS_INIT) as unknown;
        initSaml = Array.isArray(arr) ? arr : [];
      } catch (err) {
        console.warn("Could not parse SSO_SAML_PROVIDERS_INIT:", err);
      }
    }
  }

  if (initOidc.length === 0 && initSaml.length === 0) return;

  try {
    const currentOidc = getRawOidcProviders();
    const currentSaml = getRawSamlProviders();
    const existingOidcIds = new Set(
      currentOidc.map((p) => String(p.id ?? "").trim()),
    );
    const existingSamlIds = new Set(
      currentSaml.map((p) => String(p.id ?? "").trim()),
    );
    const toAddOidc = initOidc.filter(
      (p) => !existingOidcIds.has(String(p.id ?? "").trim()),
    );
    const toAddSaml = initSaml.filter(
      (p) => !existingSamlIds.has(String(p.id ?? "").trim()),
    );
    if (toAddOidc.length > 0) {
      const currentForWrite = currentOidc.map((p) => ({
        ...p,
        clientSecret: (p.clientSecretEnc ?? p.clientSecret) ? "(set)" : undefined,
      }));
      const merged = [...currentForWrite, ...toAddOidc];
      const result = writeSsoOidcProviders(merged);
      if (result.ok) {
        console.log(
          `Migrated ${toAddOidc.length} initial OIDC provider(s) from env to database`,
        );
      } else {
        console.warn("migrateSsoProvidersFromEnv OIDC:", result.error);
      }
    }
    if (toAddSaml.length > 0) {
      const currentForWrite = currentSaml.map((p) => {
        const out = { ...p };
        if (out.certEnc || out.cert) out.cert = "(set)";
        if (out.idpCertEnc || out.idpCert) out.idpCert = "(set)";
        return out;
      });
      const merged = [...currentForWrite, ...toAddSaml];
      const result = writeSsoSamlProviders(merged);
      if (result.ok) {
        console.log(
          `Migrated ${toAddSaml.length} initial SAML provider(s) from env to database`,
        );
      } else {
        console.warn("migrateSsoProvidersFromEnv SAML:", result.error);
      }
    }
  } catch (err) {
    if ((err as Error).message?.includes("no such table")) return;
    console.warn("Could not migrate SSO providers from env:", err);
  }
}
