#!/usr/bin/env node
/**
 * FlareVault redeem helper: POST redeemToken + instancePublicKey, decrypt sealed response, output payload JSON to stdout.
 * Usage: node flarevault-redeem.mjs <url> <redeem_token>
 * Exit 0 on success; non-zero on HTTP error or decrypt failure.
 */
import { createECDH, createDecipheriv, hkdfSync } from "crypto";

const FLAREVAULT_URL = (process.argv[2] || "").replace(/\/+$/, "");
const REDEEM_TOKEN = process.argv[3] || "";

function base64urlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64");
}

async function main() {
  if (!FLAREVAULT_URL || !REDEEM_TOKEN) {
    console.error("flarevault-redeem: usage: node flarevault-redeem.mjs <url> <redeem_token>");
    process.exit(1);
  }

  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const publicKeyRaw = ecdh.getPublicKey(null, "uncompressed");
  if (publicKeyRaw.length !== 65) {
    console.error("flarevault-redeem: unexpected public key length");
    process.exit(1);
  }
  const instancePublicKey = base64urlEncode(publicKeyRaw);

  const redeemUrl = `${FLAREVAULT_URL}/v1/redeem`;
  let res;
  try {
    res = await fetch(redeemUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redeemToken: REDEEM_TOKEN, instancePublicKey }),
    });
  } catch (e) {
    console.error("flarevault-redeem: fetch failed", e?.message || e);
    process.exit(1);
  }

  if (!res.ok) {
    console.error("flarevault-redeem: HTTP", res.status, await res.text());
    process.exit(1);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error("flarevault-redeem: invalid JSON response");
    process.exit(1);
  }

  const { packageId, expiresAt, serverPublicKey, salt, nonce, ciphertext } = data;
  if (!packageId || expiresAt == null || !serverPublicKey || !salt || !nonce || !ciphertext) {
    console.error("flarevault-redeem: missing fields in response");
    process.exit(1);
  }

  const serverPubBuf = base64urlDecode(serverPublicKey);
  const saltBuf = base64urlDecode(salt);
  const nonceBuf = base64urlDecode(nonce);
  const ciphertextBuf = base64urlDecode(ciphertext);

  if (serverPubBuf.length !== 65) {
    console.error("flarevault-redeem: invalid server public key length");
    process.exit(1);
  }
  if (nonceBuf.length !== 12) {
    console.error("flarevault-redeem: invalid nonce length");
    process.exit(1);
  }

  let sharedSecret;
  try {
    sharedSecret = ecdh.computeSecret(serverPubBuf);
  } catch (e) {
    console.error("flarevault-redeem: ECDH computeSecret failed", e?.message || e);
    process.exit(1);
  }

  const info = Buffer.from(`FlareVault sealed v1|${packageId}`, "utf8");
  let aesKey;
  try {
    aesKey = hkdfSync("sha256", sharedSecret, saltBuf, info, 32);
  } catch (e) {
    console.error("flarevault-redeem: HKDF failed", e?.message || e);
    process.exit(1);
  }

  const aad = Buffer.from(`${packageId}|${expiresAt}`, "utf8");
  const tagLength = 16;
  if (ciphertextBuf.length < tagLength) {
    console.error("flarevault-redeem: ciphertext too short");
    process.exit(1);
  }
  const encryptedPart = ciphertextBuf.subarray(0, ciphertextBuf.length - tagLength);
  const authTag = ciphertextBuf.subarray(-tagLength);

  let decipher;
  try {
    decipher = createDecipheriv("aes-256-gcm", aesKey, nonceBuf);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
  } catch (e) {
    console.error("flarevault-redeem: createDecipheriv failed", e?.message || e);
    process.exit(1);
  }

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(encryptedPart), decipher.final()]);
  } catch (e) {
    console.error("flarevault-redeem: decrypt failed (wrong key or tampered)");
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    console.error("flarevault-redeem: decrypted payload is not JSON");
    process.exit(1);
  }

  console.log(JSON.stringify(payload));
}

main().catch((err) => {
  console.error("flarevault-redeem:", err?.message || err);
  process.exit(1);
});
