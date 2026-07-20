/** Sanitize theme text files: strip scripts, event handlers, javascript: URLs, unsafe Liquid. */

const SCRIPT_TAG_RE = /<\s*\/?\s*script\b[^>]*>/gi;
const EVENT_ATTR_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_RE = /(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:/gi;
const DATA_JS_URL_RE = /(href|src)\s*=\s*(["']?)\s*data:\s*text\/html/gi;
const RAW_FILTER_RE = /\|\s*raw\b/gi;
const UNSAFE_LIQUID_TAG_RE = /\{%\s*(include|render)\s+[^%]*['"][^'"]*\.\./gi;

export function sanitizeThemeText(input: string): string {
  let out = input;
  out = out.replace(SCRIPT_TAG_RE, "");
  out = out.replace(EVENT_ATTR_RE, "");
  out = out.replace(JS_URL_RE, "$1=$2#blocked:");
  out = out.replace(DATA_JS_URL_RE, "$1=$2#blocked:");
  out = out.replace(RAW_FILTER_RE, "| escape");
  out = out.replace(UNSAFE_LIQUID_TAG_RE, "{% # blocked path traversal %}");
  return out;
}

export function textContainsBlockedConstructs(input: string): string | null {
  if (/<\s*script\b/i.test(input)) return "Script tags are not allowed in themes";
  if (/\|\s*raw\b/i.test(input)) return "The | raw filter is not allowed in theme templates";
  if (/javascript\s*:/i.test(input)) return "javascript: URLs are not allowed";
  return null;
}
