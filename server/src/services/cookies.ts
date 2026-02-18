import { COOKIE_SECURE, IS_PRODUCTION } from "../config.js";

export function getCookieSecureFlag(): boolean {
  if (COOKIE_SECURE !== undefined && COOKIE_SECURE !== "") {
    return COOKIE_SECURE === "true" || COOKIE_SECURE === "1";
  }
  return IS_PRODUCTION;
}
