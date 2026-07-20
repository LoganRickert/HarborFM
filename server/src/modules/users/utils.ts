export type RawUserRow = {
  id: string;
  email: string | null;
  username: string | null;
  createdAt: string;
  role: string | null;
  disabled: number | boolean;
  readOnly: number | boolean;
  diskBytesUsed: number;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastLoginLocation: string | null;
  maxPodcasts: number | null;
  maxEpisodes: number | null;
  maxStorageMb: number | null;
  maxCollaborators: number | null;
  maxSubscriberTokens: number | null;
  canTranscribe: number;
  canGenerateVideo: number;
  canStripe: number;
  canEpisodeAlert: number;
  canUploadEpisodeFiles: number;
  canImportTheme: number;
};

export interface User {
  id: string;
  email: string | null;
  username: string | null;
  createdAt: string;
  role: "user" | "admin";
  disabled: number;
  readOnly: number;
  diskBytesUsed: number;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastLoginLocation: string | null;
  maxPodcasts: number | null;
  maxEpisodes: number | null;
  maxStorageMb: number | null;
  maxCollaborators: number | null;
  maxSubscriberTokens: number | null;
  canTranscribe: number;
  canGenerateVideo: number;
  canStripe: number;
  canEpisodeAlert: number;
  canUploadEpisodeFiles: number;
  canImportTheme: number;
  federatedIdentities?: Array<{
    providerType: string;
    issuer: string;
    providerName?: string;
  }>;
}

export function toUser(
  r: RawUserRow,
  federatedIdentities?: User["federatedIdentities"],
): User {
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    createdAt: r.createdAt,
    role: (r.role === "admin" ? "admin" : "user") as "user" | "admin",
    disabled: r.disabled === true || r.disabled === 1 ? 1 : 0,
    readOnly: r.readOnly === true || r.readOnly === 1 ? 1 : 0,
    diskBytesUsed: r.diskBytesUsed,
    lastLoginAt: r.lastLoginAt,
    lastLoginIp: r.lastLoginIp,
    lastLoginLocation: r.lastLoginLocation,
    maxPodcasts: r.maxPodcasts,
    maxEpisodes: r.maxEpisodes,
    maxStorageMb: r.maxStorageMb,
    maxCollaborators: r.maxCollaborators,
    maxSubscriberTokens: r.maxSubscriberTokens,
    canTranscribe: r.canTranscribe,
    canGenerateVideo: r.canGenerateVideo,
    canStripe: r.canStripe,
    canEpisodeAlert: r.canEpisodeAlert,
    canUploadEpisodeFiles: r.canUploadEpisodeFiles,
    canImportTheme: r.canImportTheme,
    federatedIdentities: federatedIdentities ?? [],
  };
}

/** Escape % and _ for SQL LIKE. */
export function likeEscape(s: string): string {
  return s.replace(/%/g, "\\%").replace(/_/g, "\\_");
}
