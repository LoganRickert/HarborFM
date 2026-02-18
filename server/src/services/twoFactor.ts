import { generateSecret, verify, generateURI } from "otplib";
import QRCode from "qrcode";
import { encryptSecret, decryptSecret } from "./secrets.js";

const TOTP_AAD = "harborfm-totp";

export type TwoFactorMethod = "totp" | "email";

/** Generate a new TOTP secret (base32). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Verify a TOTP code. Secret should be plain base32. */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  if (!secret?.trim() || !token?.trim()) return false;
  try {
    const result = await verify({ secret: secret.trim(), token: token.trim() });
    return "valid" in result && result.valid === true;
  } catch {
    return false;
  }
}

/** Encrypt TOTP secret for storage. */
export function encryptTotpSecret(plaintext: string): string {
  return encryptSecret(plaintext, TOTP_AAD);
}

/** Decrypt TOTP secret from storage. */
export function decryptTotpSecret(payload: string): string {
  return decryptSecret(payload, TOTP_AAD);
}

/** Generate otpauth:// URI for QR code (used by Authy, Microsoft Authenticator, 1Password, etc.). */
export function getTotpUri(opts: {
  secret: string;
  label: string;
  issuer?: string;
}): string {
  return generateURI({
    secret: opts.secret,
    label: opts.label,
    issuer: opts.issuer ?? "HarborFM",
  });
}

/** Generate QR code as data URL (PNG) for the otpauth URI. */
export async function getTotpQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, { margin: 2 });
}
