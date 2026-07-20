import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { drizzleDb } from "../db/drizzle.js";
import { userIdentities, users } from "../db/schema.js";
import { readSettings } from "../modules/settings/index.js";

export type ProviderType = "oidc" | "saml";

export interface SSOProvider {
  id: string;
  name: string;
  type: ProviderType;
  trustEmail?: boolean;
}

export interface OIDCProviderConfig extends SSOProvider {
  type: "oidc";
  discoveryUrl?: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId: string;
  clientSecretEnc?: string;
  scopes?: string;
}

export interface SAMLProviderConfig extends SSOProvider {
  type: "saml";
  entryPoint: string;
  issuer: string;
  certEnc?: string;
  idpCertEnc?: string;
  callbackUrl: string;
  subjectAttribute?: string;
  emailAttribute?: string;
  trustEmail?: boolean;
}

/** Look up user_id by issuer+subject. */
export function lookupIdentity(
  issuer: string,
  subject: string,
): string | null {
  const row = drizzleDb
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.issuer, issuer),
        eq(userIdentities.subject, subject),
      ),
    )
    .limit(1)
    .get() as { userId: string } | undefined;
  return row?.userId ?? null;
}

/** Link an identity to an existing user. */
export function linkIdentity(
  userId: string,
  providerType: ProviderType,
  issuer: string,
  subject: string,
): void {
  const id = nanoid();
  drizzleDb.insert(userIdentities).values({
    id,
    userId,
    providerType,
    issuer,
    subject,
  }).run();
}

/** Create a federated user with no email/password/username. */
export function createFederatedUser(): string {
  const id = nanoid();
  const limits = getDefaultUserLimits();
  drizzleDb.insert(users).values({
    id,
    email: null,
    passwordHash: null,
    username: null,
    role: "user",
    maxPodcasts: limits.max_podcasts,
    maxStorageMb: limits.max_storage_mb,
    maxEpisodes: limits.max_episodes,
    maxCollaborators: limits.max_collaborators,
    maxSubscriberTokens: limits.max_subscriber_tokens,
    canTranscribe: limits.can_transcribe,
    canGenerateVideo: limits.can_generate_video,
    canStripe: limits.can_stripe,
    canEpisodeAlert: limits.can_episode_alert,
    canUploadEpisodeFiles: limits.can_upload_episode_files,
    canImportTheme: limits.can_import_theme,
    emailVerified: true,
  }).run();
  return id;
}

/** Create a federated user with email (username = user_{nanoid}). */
export function createFederatedUserWithEmail(
  email: string,
  emailVerified: boolean,
): string {
  const id = nanoid();
  const canonicalEmail = email.trim().toLowerCase();
  const defaultUsername = `user_${nanoid()}`;
  const limits = getDefaultUserLimits();
  drizzleDb.insert(users).values({
    id,
    email: canonicalEmail,
    passwordHash: null,
    username: defaultUsername,
    role: "user",
    maxPodcasts: limits.max_podcasts,
    maxStorageMb: limits.max_storage_mb,
    maxEpisodes: limits.max_episodes,
    maxCollaborators: limits.max_collaborators,
    maxSubscriberTokens: limits.max_subscriber_tokens,
    canTranscribe: limits.can_transcribe,
    canGenerateVideo: limits.can_generate_video,
    canStripe: limits.can_stripe,
    canEpisodeAlert: limits.can_episode_alert,
    canUploadEpisodeFiles: limits.can_upload_episode_files,
    canImportTheme: limits.can_import_theme,
    emailVerified,
  }).run();
  return id;
}

/** Find user by email (case-insensitive). */
export function findUserByEmail(email: string): { id: string } | null {
  const canonical = email.trim().toLowerCase();
  const row = drizzleDb
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(${users.email}) = ${canonical}`)
    .limit(1)
    .get() as { id: string } | undefined;
  return row ?? null;
}

export interface ResolveOrCreateResult {
  userId: string;
  needsCompleteAccount: boolean;
}

/**
 * Resolve or create user from SSO callback.
 * Only auto-links by email when the provider has trustEmail explicitly enabled in config
 * and we have an email from the assertion; emailVerified is respected when not trusting.
 *
 * SAML: By default emailVerified is false. Configure emailVerifiedAttribute on the provider
 * to read IdP-verified status from the assertion. trustEmail for SAML is an explicit trust
 * that the IdP verifies emails - only enable with trusted IdPs to prevent account takeover
 * via unverified email assertion.
 */
export function resolveOrCreateUser(
  providerType: ProviderType,
  issuer: string,
  subject: string,
  options: {
    email?: string | null;
    emailVerified?: boolean;
    trustEmail: boolean;
  },
): ResolveOrCreateResult {
  const existing = lookupIdentity(issuer, subject);
  if (existing) {
    return { userId: existing, needsCompleteAccount: false };
  }

  const { email, emailVerified = false, trustEmail } = options;
  // Only link by email when provider is explicitly configured with trustEmail === true.
  const canAutoLinkByEmail =
    trustEmail === true && email?.trim() && (emailVerified || trustEmail);

  if (canAutoLinkByEmail) {
    const canonicalEmail = email!.trim().toLowerCase();
    const user = findUserByEmail(canonicalEmail);
    if (user) {
      linkIdentity(user.id, providerType, issuer, subject);
      return { userId: user.id, needsCompleteAccount: false };
    }
    const userId = createFederatedUserWithEmail(
      canonicalEmail,
      emailVerified,
    );
    linkIdentity(userId, providerType, issuer, subject);
    return { userId, needsCompleteAccount: false };
  }

  const userId = createFederatedUser();
  linkIdentity(userId, providerType, issuer, subject);
  return { userId, needsCompleteAccount: true };
}

function getDefaultUserLimits(): {
  max_podcasts: number | null;
  max_storage_mb: number | null;
  max_episodes: number | null;
  max_collaborators: number | null;
  max_subscriber_tokens: number | null;
  can_transcribe: number;
  can_generate_video: number;
  can_stripe: number;
  can_episode_alert: number;
  can_upload_episode_files: number;
  can_import_theme: number;
} {
  try {
    const s = readSettings();
    return {
      max_podcasts:
        s.default_max_podcasts == null || s.default_max_podcasts === 0
          ? null
          : s.default_max_podcasts,
      max_storage_mb:
        s.default_storage_mb == null || s.default_storage_mb === 0
          ? null
          : s.default_storage_mb,
      max_episodes:
        s.default_max_episodes == null || s.default_max_episodes === 0
          ? null
          : s.default_max_episodes,
      max_collaborators:
        s.default_max_collaborators == null || s.default_max_collaborators === 0
          ? null
          : s.default_max_collaborators,
      max_subscriber_tokens:
        s.default_max_subscriber_tokens == null ||
        s.default_max_subscriber_tokens === 0
          ? null
          : s.default_max_subscriber_tokens,
      can_transcribe: s.default_can_transcribe ? 1 : 0,
      can_generate_video: s.default_can_generate_video ? 1 : 0,
      can_stripe: s.default_can_stripe ? 1 : 0,
      can_episode_alert: s.default_can_episode_alert ? 1 : 0,
      can_upload_episode_files: s.default_can_upload_episode_files ? 1 : 0,
      can_import_theme: s.default_can_import_theme ? 1 : 0,
    };
  } catch (_err) {
    return {
      max_podcasts: null,
      max_storage_mb: null,
      max_episodes: null,
      max_collaborators: null,
      max_subscriber_tokens: null,
      can_transcribe: 0,
      can_generate_video: 0,
      can_stripe: 0,
      can_episode_alert: 0,
      can_upload_episode_files: 0,
      can_import_theme: 0,
    };
  }
}
