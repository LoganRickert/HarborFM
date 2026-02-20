import type { FastifyInstance } from "fastify";
import {
  discovery,
  Configuration,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  randomState,
  randomNonce,
  ClientSecretPost,
} from "openid-client";
import {
  SAML,
  type SamlConfig,
  ValidateInResponseTo,
} from "@node-saml/node-saml";
import { and, eq, lt, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  settings,
  ssoOauthState,
  ssoSamlState,
  users,
} from "../../db/schema.js";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import { getBaseUrl } from "./shared.js";
import { API_PREFIX, SSO_SECRETS_AAD } from "../../config.js";
import { lookupIdentity, resolveOrCreateUser } from "../../services/sso.js";
import { samlDbCacheProvider } from "../../services/samlCache.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  buildAuthJwtPayload,
  create2FAChallenge,
  buildSetupMethods,
  resolve2FAMethod,
  newCsrfToken,
  TWOFA_CHALLENGE_COOKIE_OPTS,
} from "./shared.js";
import {
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  JWT_SESSION_EXPIRY,
  TWOFA_CHALLENGE_COOKIE_NAME,
} from "../../config.js";
import { parseTwoFactorMethods } from "@harborfm/shared";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import { getLocationForIp } from "../../services/geolocation.js";
import { sqlNow } from "../../db/utils.js";
import { parseDatetimeToMs } from "../../utils/datetime.js";

interface OIDCProviderConfig {
  id: string;
  name: string;
  discoveryUrl?: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId: string;
  clientSecretEnc?: string;
  clientSecret?: string;
  scopes?: string;
  trustEmail?: boolean;
  iconSlug?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
}

interface SAMLProviderConfig {
  id: string;
  name: string;
  entryPoint: string;
  issuer: string;
  certEnc?: string;
  cert?: string;
  idpCertEnc?: string;
  idpCert?: string;
  callbackUrl: string;
  subjectAttribute?: string;
  emailAttribute?: string;
  /** Optional. Attribute name for IdP-verified email flag (e.g. "email_verified", "emailVerified"). Values "true"/"1"/"yes" (case-insensitive) = verified. */
  emailVerifiedAttribute?: string;
  /** When true, allows auto-linking by email. For SAML: only enable with trusted IdPs that verify emails. Consider emailVerifiedAttribute for defense-in-depth. */
  trustEmail?: boolean;
  /** When true, require the IdP to sign the assertion and validate with idpCert. Default false for compatibility (e.g. Keycloak). */
  wantAssertionsSigned?: boolean;
  iconSlug?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
}

function discoveryUrlToIssuer(discoveryUrl: string): URL {
  let s =
    discoveryUrl.replace(/\/\.well-known\/.*$/i, "") || discoveryUrl;
  s = s.replace(/\/+$/, "");
  return new URL(s);
}

function getSsoOidcProviders(): OIDCProviderConfig[] {
  try {
    const row = drizzleDb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "sso_oidc_providers"))
      .limit(1)
      .get();
    if (!row?.value?.trim()) return [];
    return JSON.parse(row.value) as OIDCProviderConfig[];
  } catch {
    return [];
  }
}

function getSsoSamlProviders(): SAMLProviderConfig[] {
  try {
    const row = drizzleDb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "sso_saml_providers"))
      .limit(1)
      .get();
    if (!row?.value?.trim()) return [];
    return JSON.parse(row.value) as SAMLProviderConfig[];
  } catch {
    return [];
  }
}

/** Turn raw base64 private key into PEM. Uses RSA PRIVATE KEY (PKCS#1) for decryption (xml-encryption). */
function normalizePrivateKeyToPem(raw: string): string {
  const base64 = raw.replace(/\s/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!base64.length) return raw;
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN RSA PRIVATE KEY-----\n${lines.join("\n")}\n-----END RSA PRIVATE KEY-----`;
}

/** Turn raw base64 private key into PEM with PRIVATE KEY (PKCS#8). Use for signing; Node's Sign and node-saml expect this. */
function normalizePrivateKeyToPemPkcs8(raw: string): string {
  const base64 = raw.replace(/\s/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!base64.length) return raw;
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

/** Normalize certificate PEM (e.g. from X509Certificate in XML) to canonical form for signature verification. */
function normalizeCertToPem(raw: string): string {
  const trimmed = raw.trim();
  const base64 = trimmed
    .replace(/-----BEGIN CERTIFICATE-----/gi, "")
    .replace(/-----END CERTIFICATE-----/gi, "")
    .replace(/\s/g, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  if (!base64.length) return trimmed;
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

/** Parse IdP cert field into array of PEMs (supports pasting both signing + encryption certs from descriptor). */
function parseIdpCerts(raw: string): string[] {
  const out: string[] = [];
  const re = /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push(normalizeCertToPem(m[0]));
  if (out.length > 0) return out;
  const single = raw.replace(/\s/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (single.length > 0) return [normalizeCertToPem(raw)];
  return [];
}

function getCallbackBaseUrl(): string {
  return getBaseUrl();
}

export async function registerSsoRoutes(app: FastifyInstance) {
  app.get(
    "/auth/sso/providers",
    {
      schema: {
        tags: ["Auth"],
        summary: "List SSO providers",
        description:
          "Returns configured OIDC and SAML providers for the login page.",
        security: [],
        response: {
          200: {
            description: "List of providers",
            type: "object",
            properties: {
              providers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    type: { type: "string", enum: ["oidc", "saml"] },
                    iconSlug: { type: "string" },
                    buttonBgColor: { type: "string" },
                    buttonTextColor: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const oidc = getSsoOidcProviders().map((p) => ({
        id: p.id,
        name: p.name,
        type: "oidc" as const,
        ...(p.iconSlug && { iconSlug: p.iconSlug }),
        ...(p.buttonBgColor && { buttonBgColor: p.buttonBgColor }),
        ...(p.buttonTextColor && { buttonTextColor: p.buttonTextColor }),
      }));
      const saml = getSsoSamlProviders().map((p) => ({
        id: p.id,
        name: p.name,
        type: "saml" as const,
        ...(p.iconSlug && { iconSlug: p.iconSlug }),
        ...(p.buttonBgColor && { buttonBgColor: p.buttonBgColor }),
        ...(p.buttonTextColor && { buttonTextColor: p.buttonTextColor }),
      }));
      return reply.send({ providers: [...oidc, ...saml] });
    },
  );

  app.get(
    "/auth/sso/oidc/:providerId",
    {
      schema: {
        tags: ["Auth"],
        summary: "Initiate OIDC login",
        security: [],
        params: {
          type: "object",
          properties: { providerId: { type: "string" } },
          required: ["providerId"],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };
      const providers = getSsoOidcProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        return reply.status(404).send({ error: "SSO provider not found" });
      }

      const baseUrl = getCallbackBaseUrl();
      const callbackUrl = `${baseUrl}/${API_PREFIX}/auth/sso/oidc/callback/${providerId}`;

      const clientSecret =
        provider.clientSecretEnc && provider.clientSecretEnc.startsWith("v1:")
          ? (await import("../../services/secrets.js")).decryptSecret(provider.clientSecretEnc, SSO_SECRETS_AAD)
          : provider.clientSecret;

      let config: InstanceType<typeof Configuration>;
      if (provider.discoveryUrl) {
        const issuerUrl = provider.issuer
          ? discoveryUrlToIssuer(provider.issuer)
          : discoveryUrlToIssuer(provider.discoveryUrl);
        config = await discovery(
          issuerUrl,
          provider.clientId,
          {
            redirect_uris: [callbackUrl],
            client_secret: clientSecret,
          },
          clientSecret ? ClientSecretPost(clientSecret) : undefined,
        );
      } else if (
        provider.authorizationEndpoint &&
        provider.tokenEndpoint
      ) {
        const server = {
          issuer: provider.issuer || provider.authorizationEndpoint,
          authorization_endpoint: provider.authorizationEndpoint,
          token_endpoint: provider.tokenEndpoint,
          userinfo_endpoint: provider.userinfoEndpoint,
        };
        config = new Configuration(server, provider.clientId, {
          redirect_uris: [callbackUrl],
          client_secret: clientSecret,
        });
      } else {
        return reply
          .status(500)
          .send({ error: "OIDC provider missing discovery URL or endpoints" });
      }

      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const state = randomState();
      const nonce = randomNonce();

      const scopes =
        provider.scopes?.split(/[\s,]+/).filter(Boolean).join(" ") ||
        "openid profile email";

      try {
        const authUrl = buildAuthorizationUrl(config, {
          redirect_uri: callbackUrl,
          scope: scopes,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          nonce,
        });

        drizzleDb
          .delete(ssoOauthState)
          .where(lt(ssoOauthState.createdAt, sql`datetime('now', '-10 minutes')`))
          .run();
        drizzleDb.insert(ssoOauthState).values({
          state,
          codeVerifier,
          providerId,
          nonce,
        }).run();

        return reply.redirect(authUrl.toString());
      } catch (err) {
        request.log.error({ err, providerId }, "OIDC initiate failed");
        return reply
          .status(500)
          .send({ error: "Failed to initiate OIDC login" });
      }
    },
  );

  app.get(
    "/auth/sso/oidc/callback/:providerId",
    {
      schema: {
        tags: ["Auth"],
        summary: "OIDC callback",
        security: [],
        params: {
          type: "object",
          properties: { providerId: { type: "string" } },
          required: ["providerId"],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };
      const providers = getSsoOidcProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        return reply.status(404).send({ error: "SSO provider not found" });
      }

      const baseUrl = getCallbackBaseUrl();
      const callbackUrl = `${baseUrl}/${API_PREFIX}/auth/sso/oidc/callback/${providerId}`;

      const params = request.query as Record<string, string>;
      const state = params.state;
      const code = params.code;
      const errorParam = params.error;

      if (errorParam) {
        request.log.warn({ providerId, error: errorParam }, "OIDC callback error");
        return reply.redirect(`/login?error=sso`);
      }

      if (!code || !state) {
        return reply.redirect(`/login?error=sso`);
      }

      const stateRow = drizzleDb
        .select({
          codeVerifier: ssoOauthState.codeVerifier,
          nonce: ssoOauthState.nonce,
          createdAt: ssoOauthState.createdAt,
        })
        .from(ssoOauthState)
        .where(
          and(
            eq(ssoOauthState.state, state),
            eq(ssoOauthState.providerId, providerId),
          ),
        )
        .limit(1)
        .get();
      const codeVerifier = stateRow?.codeVerifier;
      const storedNonce = stateRow?.nonce ?? undefined;
      if (codeVerifier) {
        drizzleDb
          .delete(ssoOauthState)
          .where(
            and(
              eq(ssoOauthState.state, state),
              eq(ssoOauthState.providerId, providerId),
            ),
          )
          .run();
      }

      const SSO_STATE_MAX_AGE_MINUTES = 10;
      const createdAtMs = parseDatetimeToMs(stateRow?.createdAt);
      const cutoffMs = Date.now() - SSO_STATE_MAX_AGE_MINUTES * 60 * 1000;
      const isExpired =
        !stateRow?.createdAt ||
        Number.isNaN(createdAtMs) ||
        createdAtMs < cutoffMs;

      if (!codeVerifier || isExpired) {
        request.log.warn(
          { providerId },
          "OIDC callback: missing or expired state",
        );
        return reply.redirect(`/login?error=sso`);
      }

      const clientSecret =
        provider.clientSecretEnc && provider.clientSecretEnc.startsWith("v1:")
          ? (await import("../../services/secrets.js")).decryptSecret(provider.clientSecretEnc, SSO_SECRETS_AAD)
          : provider.clientSecret;

      let config: InstanceType<typeof Configuration>;
      if (provider.discoveryUrl) {
        const issuerUrl = provider.issuer
          ? discoveryUrlToIssuer(provider.issuer)
          : discoveryUrlToIssuer(provider.discoveryUrl);
        config = await discovery(
          issuerUrl,
          provider.clientId,
          {
            redirect_uris: [callbackUrl],
            client_secret: clientSecret,
          },
          clientSecret ? ClientSecretPost(clientSecret) : undefined,
        );
      } else if (
        provider.authorizationEndpoint &&
        provider.tokenEndpoint
      ) {
        const server = {
          issuer: provider.issuer || provider.authorizationEndpoint,
          authorization_endpoint: provider.authorizationEndpoint,
          token_endpoint: provider.tokenEndpoint,
          userinfo_endpoint: provider.userinfoEndpoint,
        };
        config = new Configuration(server, provider.clientId, {
          redirect_uris: [callbackUrl],
          client_secret: clientSecret,
        });
      } else {
        return reply.redirect(`/login?error=sso`);
      }

      try {
        const callbackUrlWithParams = new URL(callbackUrl);
        callbackUrlWithParams.search = new URLSearchParams(params).toString();
        const tokenResponse = await authorizationCodeGrant(
          config,
          callbackUrlWithParams,
          {
            pkceCodeVerifier: codeVerifier,
            expectedState: state,
            expectedNonce: storedNonce,
          },
        );

        const idClaims = tokenResponse.claims() as
          | { iss?: string; sub?: string; email?: string; email_verified?: boolean | string }
          | undefined;
        const iss = (idClaims?.iss ?? config.serverMetadata().issuer ?? "").trim();
        const sub = (idClaims?.sub ?? "").trim();
        if (!iss || !sub) {
          request.log.warn(
            { providerId, hasIss: Boolean(iss), hasSub: Boolean(sub) },
            "OIDC callback: missing iss or sub",
          );
          return reply.redirect(`/login?error=sso`);
        }
        const email = idClaims?.email;
        const emailVerified =
          idClaims?.email_verified === true ||
          idClaims?.email_verified === "true" ||
          idClaims?.email_verified === "1";

        let userId: string;
        let needsCompleteAccount = false;

        const existing = lookupIdentity(iss, sub);
        const isNewUser = !existing;
        if (existing) {
          userId = existing;
        } else {
          const result = resolveOrCreateUser("oidc", iss, sub, {
            email: email?.trim() || null,
            emailVerified,
            trustEmail: provider.trustEmail ?? false,
          });
          userId = result.userId;
          needsCompleteAccount = result.needsCompleteAccount;
        }

        if (needsCompleteAccount) {
          console.log(
            `[OIDC] userId=${userId} isNewUser=${isNewUser} → redirect /complete-account`,
          );
          const token = app.jwt.sign(
            buildAuthJwtPayload({ id: userId, email: null, username: null }),
            { expiresIn: JWT_SESSION_EXPIRY },
          );
          return reply
            .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
            .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
            .redirect("/complete-account");
        }

        const row = drizzleDb
          .select({
            id: users.id,
            email: users.email,
            username: users.username,
            disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
            read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
            twoFactorMethod: users.twoFactorMethod,
            totpSecretEnc: users.totpSecretEnc,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .get();

        if (!row || row.disabled === 1) {
          return reply.redirect(`/login?error=disabled`);
        }

        const ip = getClientIp(request);
        const userAgent = getUserAgent(request);
        try {
          const location = await getLocationForIp(ip).catch(() => null);
          drizzleDb
            .update(users)
            .set({
              lastLoginAt: sqlNow(),
              lastLoginIp: ip,
              lastLoginUserAgent: userAgent,
              lastLoginLocation: location ?? null,
            })
            .where(eq(users.id, row.id))
            .run();
        } catch {
          /* ignore */
        }

        const settings = readSettings();
        const twoFactorEnabled = Boolean(settings.two_factor_enabled);
        const twoFactorEnforced = Boolean(settings.two_factor_enforced);
        const userHas2FA = Boolean(row.twoFactorMethod?.trim());
        const allowedMethods = parseTwoFactorMethods(
          settings.two_factor_methods || "totp",
        );
        const emailProviderConfigured = isEmailProviderConfigured(settings);
        const setupMethods = buildSetupMethods(
          allowedMethods,
          emailProviderConfigured,
          row,
        );

        // 2FA enforced and user has no 2FA: must setup before proceeding (skip read-only)
        if (
          twoFactorEnabled &&
          twoFactorEnforced &&
          !userHas2FA &&
          row.read_only !== 1
        ) {
          console.log(
            `[OIDC] userId=${row.id} isNewUser=${isNewUser} userHas2FA=false → redirect /login/2fa-setup (methods=${setupMethods.join(",")})`,
          );
          const { challengeToken } = create2FAChallenge(
            row.id,
            setupMethods[0] ?? "totp",
          );
          const methodsParam = setupMethods.join(",");
          const redirectUrl = `/login/2fa-setup?methods=${encodeURIComponent(methodsParam)}`;
          return reply
            .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
            .header("Cache-Control", "no-store")
            .redirect(redirectUrl);
        }

        if (twoFactorEnabled && userHas2FA) {
          console.log(
            `[OIDC] userId=${row.id} isNewUser=${isNewUser} userHas2FA=true method=${resolve2FAMethod(row, allowedMethods, emailProviderConfigured)} → redirect /login?method=...`,
          );
          const method = resolve2FAMethod(
            row,
            allowedMethods,
            emailProviderConfigured,
          );
          const { challengeToken } = create2FAChallenge(row.id, method);
          const redirectUrl = `/login?method=${encodeURIComponent(method)}`;
          return reply
            .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
            .header("Cache-Control", "no-store")
            .redirect(redirectUrl);
        }

        console.log(
          `[OIDC] userId=${row.id} isNewUser=${isNewUser} → redirect / (no 2FA or 2FA not enforced)`,
        );
        const token = app.jwt.sign(
          buildAuthJwtPayload(row),
          { expiresIn: JWT_SESSION_EXPIRY },
        );
        return reply
          .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
          .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
          .redirect("/");
      } catch (err) {
        request.log.error({ err, providerId }, "OIDC callback failed");
        return reply.redirect(`/login?error=sso`);
      }
    },
  );

  app.get(
    "/auth/sso/saml/:providerId",
    {
      schema: {
        tags: ["Auth"],
        summary: "Initiate SAML login",
        security: [],
        params: {
          type: "object",
          properties: { providerId: { type: "string" } },
          required: ["providerId"],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };
      const providers = getSsoSamlProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        return reply.status(404).send({ error: "SSO provider not found" });
      }

      const baseUrl = getCallbackBaseUrl();
      const callbackUrl = `${baseUrl}/${API_PREFIX}/auth/sso/saml/callback/${providerId}`;

      const idpCert =
        provider.idpCert ??
        (provider.idpCertEnc && provider.idpCertEnc.startsWith("v1:")
          ? (await import("../../services/secrets.js")).decryptSecret(provider.idpCertEnc, SSO_SECRETS_AAD)
          : undefined);
      if (!idpCert?.trim()) {
        return reply.status(500).send({ error: "SAML provider missing IdP certificate" });
      }

      const cert =
        provider.cert ??
        (provider.certEnc && provider.certEnc.startsWith("v1:")
          ? (await import("../../services/secrets.js")).decryptSecret(provider.certEnc, SSO_SECRETS_AAD)
          : undefined);

      const relayState = randomState();
      const SAML_STATE_MAX_AGE_MINUTES = 10;
      drizzleDb
        .delete(ssoSamlState)
        .where(lt(ssoSamlState.createdAt, sql`datetime('now', '-10 minutes')`))
        .run();
      drizzleDb.insert(ssoSamlState).values({
        relayState,
        providerId,
      }).run();

      const defaultIssuer = `${baseUrl}/${API_PREFIX}/auth/sso/saml`;
      const issuer = (provider.issuer && provider.issuer.trim()) ? provider.issuer.trim() : defaultIssuer;

      const rawKey = cert?.trim();
      const keyWasRaw = Boolean(rawKey && !/-----BEGIN\s/i.test(rawKey));
      const privateKeyPem =
        rawKey && keyWasRaw
          ? normalizePrivateKeyToPemPkcs8(rawKey)
          : rawKey;

      const buildSamlOptions = (keyPem: string | undefined): SamlConfig => ({
        callbackUrl,
        entryPoint: provider.entryPoint,
        issuer,
        idpCert,
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
        ...(keyPem
          ? {
              privateKey: keyPem,
              signatureAlgorithm: "sha256" as const,
            }
          : {}),
        validateInResponseTo: ValidateInResponseTo.ifPresent,
        requestIdExpirationPeriodMs: SAML_STATE_MAX_AGE_MINUTES * 60 * 1000,
        cacheProvider: samlDbCacheProvider,
      });

      const samlOptions = buildSamlOptions(privateKeyPem);

      request.log.info(
        {
          providerId,
          issuer,
          callbackUrl,
          entryPoint: provider.entryPoint,
          hasSigningKey: Boolean(privateKeyPem),
          signingKeyLength: privateKeyPem?.length ?? 0,
          signingKeyFormat: keyWasRaw ? "normalized-from-raw" : (rawKey ? "PEM" : "none"),
          keyWasRaw,
          idpCertPresent: Boolean(idpCert?.trim()),
          idpCertLength: idpCert?.trim().length ?? 0,
          relayStatePrefix: relayState.slice(0, 8),
        },
        "SAML initiate: values sent in request (match these in Keycloak)",
      );

      const isKeyFormatError = (e: unknown) => {
        const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
        const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "";
        return code === "ERR_OSSL_UNSUPPORTED" || /DECODER routines|unsupported|decod/i.test(msg);
      };

      try {
        request.log.info(
          { providerId, hasPrivateKey: Boolean(samlOptions.privateKey), hasIdpCert: Boolean(samlOptions.idpCert) },
          "SAML initiate: building auth URL",
        );
        const saml = new SAML(samlOptions);
        const authUrl = await saml.getAuthorizeUrlAsync(
          relayState,
          undefined,
          {},
        );
        request.log.info({ providerId, authUrlLength: authUrl?.length }, "SAML initiate: redirecting to IdP");
        return reply.redirect(authUrl);
      } catch (err) {
        if (isKeyFormatError(err) && keyWasRaw && rawKey) {
          try {
            const pkcs1Pem = normalizePrivateKeyToPem(rawKey);
            const samlRetry = new SAML(buildSamlOptions(pkcs1Pem));
            const authUrl = await samlRetry.getAuthorizeUrlAsync(relayState, undefined, {});
            request.log.info({ providerId, authUrlLength: authUrl?.length }, "SAML initiate: redirecting to IdP (PKCS#1 key)");
            return reply.redirect(authUrl);
          } catch (retryErr) {
            request.log.warn({ err: retryErr, providerId }, "SAML initiate: PKCS#1 fallback failed");
          }
        }
        if (isKeyFormatError(err)) {
          request.log.warn({ err, providerId }, "SAML initiate failed: SP private key format unsupported");
          return reply.status(400).send({
            error: "SAML signing failed: SP private key format unsupported. Use an unencrypted PEM key (e.g. -----BEGIN PRIVATE KEY----- or -----BEGIN RSA PRIVATE KEY-----). If the key is password-protected, export it without a passphrase: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-nocrypt.pem",
          });
        }
        request.log.error({ err, providerId }, "SAML initiate failed");
        return reply.status(500).send({ error: "Failed to initiate SAML login" });
      }
    },
  );

  app.post(
    "/auth/sso/saml/callback/:providerId",
    {
      schema: {
        tags: ["Auth"],
        summary: "SAML callback",
        security: [],
        params: {
          type: "object",
          properties: { providerId: { type: "string" } },
          required: ["providerId"],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };
      request.log.info({ providerId, bodyKeys: Object.keys((request.body as object) || {}) }, "SAML callback: request received");
      const providers = getSsoSamlProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        request.log.warn({ providerId }, "SAML callback: provider not found");
        return reply.status(404).send({ error: "SSO provider not found" });
      }

      const baseUrl = getCallbackBaseUrl();
      const callbackUrl = `${baseUrl}/${API_PREFIX}/auth/sso/saml/callback/${providerId}`;

      const body = request.body as Record<string, string>;
      const samlResponse = body?.SAMLResponse;
      const relayState = (body?.RelayState ?? "").trim();

      let samlResponsePreview: Record<string, unknown> = {};
      try {
        if (samlResponse) {
          const decoded = Buffer.from(samlResponse, "base64").toString("utf8");
          const allAlgorithms = decoded.match(/Algorithm="([^"]+)"/g) ?? [];
          const allDigestMethods = decoded.match(/DigestMethod[^>]*Algorithm="([^"]+)"/g) ?? [];
          samlResponsePreview = {
            decodedLength: decoded.length,
            hasEncryptedAssertion: /EncryptedAssertion/i.test(decoded),
            hasEncryptedData: /EncryptedData/i.test(decoded),
            keyEncryptionAlgMatch: decoded.match(/Algorithm="([^"]*xmlenc[^"]*)"/)?.[1] ?? null,
            digestMethodMatch: decoded.match(/DigestMethod[^>]*Algorithm="([^"]+)"/)?.[1] ?? null,
            allAlgorithmAttrs: allAlgorithms.slice(0, 10),
            allDigestMethodAlgorithms: allDigestMethods.slice(0, 5),
            decodedSnippet: decoded.replace(/\s+/g, " ").trim().slice(0, 380) + (decoded.length > 380 ? "..." : ""),
          };
        }
      } catch {
        samlResponsePreview = { decodeError: true };
      }
      request.log.info(
        {
          providerId,
          hasSamlResponse: Boolean(samlResponse),
          samlResponseLength: samlResponse?.length ?? 0,
          hasRelayState: Boolean(relayState),
          relayStateLength: relayState.length,
          ...samlResponsePreview,
        },
        "SAML callback: body parsed",
      );

      if (!samlResponse) {
        request.log.warn({ providerId }, "SAML callback: missing SAMLResponse in body");
        return reply.redirect(`/login?error=sso`);
      }

      const SAML_STATE_MAX_AGE_MINUTES = 10;
      const stateRow = drizzleDb
        .select({
          providerId: ssoSamlState.providerId,
          createdAt: ssoSamlState.createdAt,
        })
        .from(ssoSamlState)
        .where(eq(ssoSamlState.relayState, relayState))
        .limit(1)
        .get();
      if (stateRow) {
        drizzleDb
          .delete(ssoSamlState)
          .where(eq(ssoSamlState.relayState, relayState))
          .run();
      }

      const samlCreatedAtMs = parseDatetimeToMs(stateRow?.createdAt);
      const samlCutoffMs = Date.now() - SAML_STATE_MAX_AGE_MINUTES * 60 * 1000;
      const relayStateExpired =
        !stateRow?.createdAt ||
        Number.isNaN(samlCreatedAtMs) ||
        samlCreatedAtMs < samlCutoffMs;

      if (
        !stateRow ||
        relayStateExpired ||
        stateRow.providerId !== providerId
      ) {
        request.log.warn(
          {
            providerId,
            hasRelayState: Boolean(relayState),
            hasStoredState: Boolean(stateRow),
            providerMatch: stateRow?.providerId === providerId,
            relayStateExpired,
          },
          "SAML callback: invalid or expired RelayState",
        );
        return reply.redirect(`/login?error=sso`);
      }

      request.log.info({ providerId, relayStateValid: true }, "SAML callback: RelayState valid");

      const idpCertRaw =
        provider.idpCert ??
        (provider.idpCertEnc && provider.idpCertEnc.startsWith("v1:")
          ? (await import("../../services/secrets.js")).decryptSecret(provider.idpCertEnc, SSO_SECRETS_AAD)
          : undefined);
      if (!idpCertRaw?.trim()) {
        request.log.warn({ providerId }, "SAML provider missing idpCert");
        return reply.status(500).send({ error: "SAML provider misconfigured" });
      }
      const idpCerts = parseIdpCerts(idpCertRaw.trim());
      const idpCert: string | string[] =
        idpCerts.length === 0
          ? normalizeCertToPem(idpCertRaw.trim())
          : idpCerts.length === 1
            ? idpCerts[0]
            : idpCerts;

      request.log.info(
        { providerId, idpCertsCount: idpCerts.length, idpCertLength: typeof idpCert === "string" ? idpCert.length : idpCert.map((c) => c.length) },
        "SAML callback: IdP cert resolved",
      );

      const cert =
        provider.cert ??
        (provider.certEnc && provider.certEnc.startsWith("v1:")
          ? (await import("../../services/secrets.js")).decryptSecret(provider.certEnc, SSO_SECRETS_AAD)
          : undefined);

      const defaultIssuerCallback = `${baseUrl}/${API_PREFIX}/auth/sso/saml`;
      const issuerForValidation = (provider.issuer && provider.issuer.trim()) ? provider.issuer.trim() : defaultIssuerCallback;

      const samlOptions: SamlConfig = {
        callbackUrl,
        entryPoint: provider.entryPoint,
        issuer: issuerForValidation,
        idpCert,
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
        wantAuthnResponseSigned: false,
        wantAssertionsSigned: provider.wantAssertionsSigned ?? false,
        ...(cert && { privateKey: cert }),
        validateInResponseTo: ValidateInResponseTo.ifPresent,
        requestIdExpirationPeriodMs: SAML_STATE_MAX_AGE_MINUTES * 60 * 1000,
        cacheProvider: samlDbCacheProvider,
      };

      request.log.info(
        {
          providerId,
          callbackUrl,
          issuerForValidation,
          wantAssertionsSigned: provider.wantAssertionsSigned ?? false,
          hasSigningKey: Boolean(cert),
          samlResponseLength: samlResponse?.length ?? 0,
          relayStateLength: relayState.length,
        },
        "SAML callback: validating response",
      );

      try {
        const saml = new SAML(samlOptions);
        const response = await saml.validatePostResponseAsync({
          SAMLResponse: samlResponse,
          RelayState: relayState,
        });

        if (response.loggedOut || !response.profile) {
          request.log.warn(
            { providerId, loggedOut: response.loggedOut, hasProfile: Boolean(response.profile) },
            "SAML callback: loggedOut or no profile in response",
          );
          return reply.redirect(`/login?error=sso`);
        }

        const profile = response.profile;
        request.log.info(
          {
            providerId,
            profileIssuer: profile?.issuer,
            hasNameID: Boolean(profile?.nameID),
            profileKeys: profile ? Object.keys(profile as object).filter((k) => typeof (profile as Record<string, unknown>)[k] !== "function") : [],
          },
          "SAML callback: profile received",
        );
        const resolvedIssuer =
          profile?.issuer ??
          ((provider.issuer && provider.issuer.trim()) || defaultIssuerCallback) ??
          provider.entryPoint;
        const issuer = typeof resolvedIssuer === "string" ? resolvedIssuer.trim() : String(resolvedIssuer ?? "");
        if (!profile?.issuer) {
          request.log.warn(
            { providerId, issuer },
            "SAML callback: using configured issuer/entryPoint fallback (profile.issuer missing)",
          );
        }

        const getProfileAttr = (key: string): string | null => {
          const p = profile as Record<string, unknown> | undefined;
          if (!p) return null;
          const v = p[key] ?? (p.attributes as Record<string, unknown>)?.[key];
          if (Array.isArray(v)) return String(v[0] ?? "").trim();
          if (typeof v === "string") return v.trim() || null;
          if (v && typeof v === "object" && "_" in v && typeof (v as { _: unknown })._ === "string")
            return ((v as { _: string })._).trim() || null;
          return null;
        };

        const rawNameId = profile?.nameID;
        const nameIdStr =
          typeof rawNameId === "string"
            ? rawNameId.trim()
            : rawNameId && typeof rawNameId === "object" && "_" in rawNameId && typeof (rawNameId as { _: unknown })._ === "string"
              ? String((rawNameId as { _: string })._).trim()
              : getProfileAttr("nameID");

        const fromSubjectAttr =
          provider.subjectAttribute ? getProfileAttr(provider.subjectAttribute) : null;
        const subjectRaw =
          (fromSubjectAttr && fromSubjectAttr.trim()) ? fromSubjectAttr.trim() : (nameIdStr ?? "");
        const subject = String(subjectRaw).trim();

        request.log.info(
          {
            providerId,
            rawNameIdType: rawNameId == null ? "null" : typeof rawNameId,
            nameIdStr: nameIdStr ?? null,
            fromSubjectAttr: fromSubjectAttr ?? null,
            subjectPresent: Boolean(subject),
          },
          "SAML callback: subject resolved",
        );

        if (!subject) {
          request.log.warn(
            { providerId, profileKeys: profile ? Object.keys(profile as object) : [] },
            "SAML callback: no subject (nameID or subjectAttribute)",
          );
          return reply.redirect(`/login?error=sso`);
        }

        const emailAttr = provider.emailAttribute || "email";
        const emailVal =
          getProfileAttr(emailAttr) ??
          (profile as { email?: string; mail?: string })?.email ??
          (profile as { email?: string; mail?: string })?.mail;
        const emailStr =
          (typeof emailVal === "string" ? emailVal : "").trim() || null;

        let samlEmailVerified = false;
        if (provider.emailVerifiedAttribute) {
          const verifiedVal = getProfileAttr(provider.emailVerifiedAttribute);
          const v = String(verifiedVal ?? "").toLowerCase();
          samlEmailVerified =
            v === "true" || v === "1" || v === "yes" || v === "on";
        }

        let userId: string;
        let needsCompleteAccount = false;

        const existing = lookupIdentity(issuer, subject);
        if (existing) {
          userId = existing;
          request.log.info({ providerId, userId: existing, email: emailStr ?? null }, "SAML callback: existing user");
        } else {
          const result = resolveOrCreateUser("saml", issuer, subject, {
            email: emailStr?.trim() || null,
            emailVerified: samlEmailVerified,
            trustEmail: provider.trustEmail ?? false,
          });
          userId = result.userId;
          needsCompleteAccount = result.needsCompleteAccount;
          request.log.info(
            { providerId, userId: result.userId, needsCompleteAccount: result.needsCompleteAccount, email: emailStr ?? null },
            "SAML callback: user resolved or created",
          );
        }

        if (needsCompleteAccount) {
          const token = app.jwt.sign(
            buildAuthJwtPayload({ id: userId, email: null, username: null }),
            { expiresIn: JWT_SESSION_EXPIRY },
          );
          return reply
            .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
            .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
            .redirect("/complete-account");
        }

        const row = drizzleDb
          .select({
            id: users.id,
            email: users.email,
            username: users.username,
            disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
            read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
            twoFactorMethod: users.twoFactorMethod,
            totpSecretEnc: users.totpSecretEnc,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .get();

        if (!row || row.disabled === 1) {
          return reply.redirect(`/login?error=disabled`);
        }

        const settings = readSettings();
        const twoFactorEnabled = Boolean(settings.two_factor_enabled);
        const twoFactorEnforced = Boolean(settings.two_factor_enforced);
        const userHas2FA = Boolean(row.twoFactorMethod?.trim());
        const allowedMethods = parseTwoFactorMethods(
          settings.two_factor_methods || "totp",
        );
        const emailProviderConfigured = isEmailProviderConfigured(settings);
        const setupMethods = buildSetupMethods(
          allowedMethods,
          emailProviderConfigured,
          row,
        );

        if (
          twoFactorEnabled &&
          twoFactorEnforced &&
          !userHas2FA &&
          row.read_only !== 1
        ) {
          const { challengeToken } = create2FAChallenge(
            row.id,
            setupMethods[0] ?? "totp",
          );
          const methodsParam = setupMethods.join(",");
          const redirectUrl = `/login/2fa-setup?methods=${encodeURIComponent(methodsParam)}`;
          return reply
            .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
            .header("Cache-Control", "no-store")
            .redirect(redirectUrl);
        }

        if (twoFactorEnabled && userHas2FA) {
          const method = resolve2FAMethod(
            row,
            allowedMethods,
            emailProviderConfigured,
          );
          const { challengeToken } = create2FAChallenge(row.id, method);
          const redirectUrl = `/login?method=${encodeURIComponent(method)}`;
          return reply
            .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
            .header("Cache-Control", "no-store")
            .redirect(redirectUrl);
        }

        const ip = getClientIp(request);
        const userAgent = getUserAgent(request);
        try {
          const location = await getLocationForIp(ip).catch(() => null);
          drizzleDb
            .update(users)
            .set({
              lastLoginAt: sqlNow(),
              lastLoginIp: ip,
              lastLoginUserAgent: userAgent,
              lastLoginLocation: location ?? null,
            })
            .where(eq(users.id, row.id))
            .run();
        } catch {
          /* ignore */
        }

        const token = app.jwt.sign(
          buildAuthJwtPayload({
            id: row.id,
            email: row.email,
            username: row.username,
          }),
          { expiresIn: JWT_SESSION_EXPIRY },
        );
        request.log.info(
          { providerId, userId: row.id, username: row.username },
          "SAML callback: login success, redirecting to /",
        );
        return reply
          .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
          .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
          .redirect("/");
      } catch (err) {
        const errMsg = err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err);
        const xmlStatus = err && typeof err === "object" && "xmlStatus" in err ? (err as { xmlStatus?: string }).xmlStatus : undefined;
        const errCode = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
        const errLibrary = err && typeof err === "object" && "library" in err ? (err as { library?: string }).library : undefined;
        const errReason = err && typeof err === "object" && "reason" in err ? (err as { reason?: string }).reason : undefined;
        const opensslStack = err && typeof err === "object" && "opensslErrorStack" in err ? (err as { opensslErrorStack?: string[] }).opensslErrorStack : undefined;
        const hint =
          /invalid signature/i.test(errMsg)
            ? " IdP certificate (PEM) must match the key Keycloak uses to sign the assertion. Get it from Keycloak Admin → Realm settings → Keys → click the RS256 (SIG) key → Certificate (copy PEM). In the SAML client, ensure 'Sign assertions' (or similar) is ON."
            : /oaep decoding|ERR_OSSL_RSA_OAEP/i.test(errMsg)
              ? " Key encryption may use a different OAEP hash (SHA-1 vs SHA-256). Ensure the SP decryption key matches the cert uploaded to Keycloak for encryption."
              : "";
        const errStack = err && typeof err === "object" && "stack" in err ? String((err as Error).stack) : undefined;
        request.log.error(
          {
            err,
            providerId,
            message: errMsg,
            code: errCode,
            library: errLibrary,
            reason: errReason,
            xmlStatus,
            name: err && typeof err === "object" && "name" in err ? (err as Error).name : undefined,
            stack: errStack ? errStack.split("\n").slice(0, 12).join("\n") : undefined,
            opensslErrorStack: opensslStack,
          },
          `SAML callback failed.${hint}`,
        );
        return reply.redirect(`/login?error=sso`);
      }
    },
  );
}
