const SMALL = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'for',
  'nor',
  'on',
  'at',
  'to',
  'from',
  'by',
  'vs',
  'of',
  'in',
  'with',
  'as',
]);

const KEEP: Record<string, string> = {
  harborfm: 'HarborFM',
  https: 'HTTPS',
  http: 'HTTP',
  webrtc: 'WebRTC',
  aws: 'AWS',
  ec2: 'EC2',
  api: 'API',
  rss: 'RSS',
  sso: 'SSO',
  llm: 'LLM',
  oidc: 'OIDC',
  saml: 'SAML',
  pm2: 'PM2',
  faq: 'FAQ',
};

function titleWord(word: string, first: boolean, last: boolean): string {
  if (!word) return word;
  const low = word.toLowerCase();
  if (KEEP[low]) return KEEP[low];
  if (word === word.toUpperCase() && word.length >= 2 && word.length <= 5) return word;
  if (SMALL.has(low) && !first && !last) return low;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Title-case a heading or nav label (e.g. "Account & authentication" -> "Account & Authentication"). */
export function toTitleCase(text: string): string {
  const words = text.split(/(\s+)/);
  const contentIdx = words
    .map((w, i) => (/\S/.test(w) ? i : -1))
    .filter((i) => i >= 0);
  const first = contentIdx[0] ?? 0;
  const last = contentIdx[contentIdx.length - 1] ?? 0;

  return words
    .map((token, i) => {
      if (!/\S/.test(token)) return token;
      const m = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
      if (!m) return token;
      const [, pre, core, post] = m;
      if (!core) return token;
      if (core.includes('-')) {
        const titled = core
          .split('-')
          .map((part) => titleWord(part, true, true))
          .join('-');
        return pre + titled + post;
      }
      if (core.includes('/')) {
        const titled = core
          .split('/')
          .map((part, idx, arr) =>
            titleWord(part, idx === 0 && i === first, idx === arr.length - 1 && i === last),
          )
          .join('/');
        return pre + titled + post;
      }
      return pre + titleWord(core, i === first, i === last) + post;
    })
    .join('');
}

/** Title-case ATX headings (# ... ######) outside fenced code blocks. */
export function titleCaseMarkdownHeadings(source: string): string {
  let inFence = false;
  return source
    .split('\n')
    .map((line) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!m) return line;
      return `${m[1]} ${toTitleCase(m[2].trim())}`;
    })
    .join('\n');
}
