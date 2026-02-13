export function getCookieSecureFlag(): boolean {
  // Correct env var name
  const correct = process.env.COOKIE_SECURE?.trim();
  if (correct !== undefined && correct !== "") {
    return correct === "true" || correct === "1";
  }

  // Production defaults to Secure cookies
  return process.env.NODE_ENV === "production";
}
