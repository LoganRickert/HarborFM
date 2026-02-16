#!/usr/bin/env node
/**
 * Reads JSON { "password": "..." } from stdin, outputs { "hash": "argon2..." } to stdout.
 * Used by Terraform external data source to hash the admin password without sending it to the instance.
 */
import argon2 from "argon2";
import { readFileSync } from "fs";

async function main() {
  const raw = readFileSync(0, "utf8");
  const input = JSON.parse(raw);
  const password = input?.password;
  if (typeof password !== "string" || !password) {
    console.error(JSON.stringify({ hash: "", error: "Missing or invalid password" }));
    process.exit(1);
  }
  if (password.length < 8) {
    console.error(JSON.stringify({ hash: "", error: "Password must be at least 8 characters" }));
    process.exit(1);
  }
  const hash = await argon2.hash(password);
  console.log(JSON.stringify({ hash }));
}

main().catch((err) => {
  console.error(JSON.stringify({ hash: "", error: String(err?.message || err) }));
  process.exit(1);
});
