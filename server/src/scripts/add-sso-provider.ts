/**
 * Interactive script to add an OIDC or SAML SSO provider to the database.
 * Prompts for required configuration and creates the provider in settings.
 */
import "dotenv/config";
import * as readline from "readline";
import { API_PREFIX } from "../config.js";
import "../db/migrate.js";
import { db, closeDb } from "../db/index.js";
import {
  writeSsoOidcProviders,
  writeSsoSamlProviders,
} from "../services/ssoProviderSettings.js";
import { readSettings } from "../modules/settings/index.js";
import { normalizeHostname } from "../utils/url.js";

function prompt(question: string, defaultValue = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const def = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${def}: `, (answer) => {
      rl.close();
      resolve((answer || defaultValue).trim());
    });
  });
}

function promptRequired(
  question: string,
  defaultValue = "",
): Promise<string> {
  return prompt(question, defaultValue).then((v) => {
    if (!v) {
      console.error("This field is required.");
      process.exit(1);
    }
    return v;
  });
}

async function addOidcProvider(): Promise<void> {
  console.log("\n--- OIDC Provider ---\n");

  const id = await promptRequired(
    "Provider ID (e.g. okta, azure, google)",
  );
  const name = await promptRequired(
    "Display name (e.g. Okta, Azure AD)",
  );

  const useDiscovery = (
    await prompt(
      "Use OpenID discovery URL? (y/n). If y, you only need discoveryUrl; if n, you need authorization/token endpoints",
      "y",
    )
  ).toLowerCase()
    .startsWith("y");

  let discoveryUrl = "";
  let authorizationEndpoint = "";
  let tokenEndpoint = "";
  let userinfoEndpoint = "";

  if (useDiscovery) {
    discoveryUrl = await promptRequired(
      "Discovery URL (e.g. https://example.com/.well-known/openid-configuration)",
    );
  } else {
    authorizationEndpoint = await promptRequired(
      "Authorization endpoint URL",
    );
    tokenEndpoint = await promptRequired("Token endpoint URL");
    userinfoEndpoint = (
      await prompt("UserInfo endpoint URL (optional)", "")
    ).trim();
  }

  const clientId = await promptRequired("Client ID");
  const clientSecret = (
    await prompt("Client secret (optional for public clients)", "")
  ).trim();
  const scopes = (
    await prompt("Scopes (e.g. openid profile email)", "openid profile email")
  ).trim();

  const provider: Record<string, unknown> = {
    id,
    name,
    clientId,
    ...(scopes && { scopes }),
  };
  if (useDiscovery) {
    provider.discoveryUrl = discoveryUrl;
  } else {
    provider.authorizationEndpoint = authorizationEndpoint;
    provider.tokenEndpoint = tokenEndpoint;
    if (userinfoEndpoint) provider.userinfoEndpoint = userinfoEndpoint;
  }
  if (clientSecret) provider.clientSecret = clientSecret;

  const existing = (
    db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("sso_oidc_providers") as { value: string } | undefined
  )?.value;
  const existingArr = existing
    ? (JSON.parse(existing) as Array<Record<string, unknown>>)
    : [];
  const withPreservedSecrets = existingArr.map((p) => {
    const out = { ...p };
    if (out.clientSecretEnc || out.clientSecret) {
      out.clientSecret = "(set)";
      delete out.clientSecretEnc;
    }
    return out;
  });
  const result = writeSsoOidcProviders([...withPreservedSecrets, provider]);
  if (!result.ok) {
    console.error("Error:", result.error);
    process.exit(1);
  }
  console.log(`\nOIDC provider "${name}" (id: ${id}) added successfully.`);
}

async function addSamlProvider(): Promise<void> {
  console.log("\n--- SAML Provider ---\n");

  const settings = readSettings();
  const hostname = settings.hostname || "";
  const baseUrl =
    hostname?.trim() && hostname !== "localhost"
      ? `https://${normalizeHostname(hostname)}`
      : "http://localhost:3001";

  const id = await promptRequired(
    "Provider ID (e.g. okta-saml, adfs)",
  );
  const name = await promptRequired(
    "Display name (e.g. Okta SAML, ADFS)",
  );
  const entryPoint = await promptRequired(
    "IdP SSO URL (entry point)",
  );
  const issuer = await promptRequired(
    "Entity ID / Issuer (our app's audience, e.g. https://example.com/api)",
  );
  const defaultCallbackUrl = `${baseUrl}/${API_PREFIX}/auth/sso/saml/callback/${id}`;
  const callbackUrl = await promptRequired(
    "Callback URL (ACS URL)",
    defaultCallbackUrl,
  );

  const certPrompt = await prompt(
    "SP private key (optional, for signed requests). Paste PEM or leave empty",
  );
  const idpCertPrompt = await promptRequired(
    "IdP certificate (X.509 PEM). Paste full certificate including -----BEGIN/END-----",
  );

  const provider: Record<string, unknown> = {
    id,
    name,
    entryPoint,
    issuer,
    callbackUrl,
  };
  if (certPrompt.trim()) provider.cert = certPrompt.trim();
  if (idpCertPrompt.trim()) provider.idpCert = idpCertPrompt.trim();

  const existing = (
    db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("sso_saml_providers") as { value: string } | undefined
  )?.value;
  const existingArr = existing
    ? (JSON.parse(existing) as Array<Record<string, unknown>>)
    : [];
  const withPreservedSecrets = existingArr.map((p) => {
    const out = { ...p };
    if (out.certEnc || (out.cert && out.cert !== "(set)")) {
      out.cert = "(set)";
    }
    delete out.certEnc;
    if (out.idpCertEnc || (out.idpCert && out.idpCert !== "(set)")) {
      out.idpCert = "(set)";
    }
    delete out.idpCertEnc;
    return out;
  });
  const result = writeSsoSamlProviders([...withPreservedSecrets, provider]);
  if (!result.ok) {
    console.error("Error:", result.error);
    process.exit(1);
  }
  console.log(`\nSAML provider "${name}" (id: ${id}) added successfully.`);
}

async function main(): Promise<void> {
  const existingOidc = (
    db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("sso_oidc_providers") as { value: string } | undefined
  )?.value;
  const existingSaml = (
    db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("sso_saml_providers") as { value: string } | undefined
  )?.value;

  const oidcCount = existingOidc
    ? (JSON.parse(existingOidc) as unknown[]).length
    : 0;
  const samlCount = existingSaml
    ? (JSON.parse(existingSaml) as unknown[]).length
    : 0;

  console.log("Add SSO Provider");
  console.log(`Current: ${oidcCount} OIDC, ${samlCount} SAML providers`);

  const choice = (
    await prompt("Add OIDC or SAML provider? (oidc/saml)", "oidc")
  ).toLowerCase()
    .trim();

  if (choice === "oidc" || choice === "o") {
    await addOidcProvider();
  } else if (choice === "saml" || choice === "s") {
    await addSamlProvider();
  } else {
    console.error("Please choose 'oidc' or 'saml'.");
    process.exit(1);
  }

  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
