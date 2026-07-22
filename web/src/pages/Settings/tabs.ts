/**
 * Tab registry for the Settings page. Each tab corresponds to one section (card).
 * searchTerms are used for the global search: section title, subtitle, and control labels.
 */

export const SETTINGS_TAB_IDS = [
  'system',
  'access',
  'default-limits',
  'final-output',
  'geolite',
  'transcription',
  'llm',
  'captcha',
  'webrtc',
  'email',
  'two-factor',
  'sso',
  'dns',
  'custom-legal',
  'reviews',
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export interface SettingsTabDef {
  id: SettingsTabId;
  label: string;
  searchTerms: string[];
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  {
    id: 'system',
    label: 'System',
    searchTerms: ['System', 'version', 'commands', 'disk', 'memory', 'RAM', 'CPU', 'ffmpeg', 'ffprobe', 'audiowaveform', 'geoipupdate', 'smbclient'],
  },
  {
    id: 'access',
    label: 'Access & General',
    searchTerms: [
      'Access & General',
      'Control who can sign up',
      'public feeds',
      'Enable Account Registration',
      'Enable Public Feeds',
      'Cookie',
      'Tracking Consent',
      'GDPR',
      'Hostname',
      'WebSub',
      'Welcome Banner',
      'White Label',
    ],
  },
  {
    id: 'default-limits',
    label: 'Default Limits',
    searchTerms: [
      'Default Limits for New Users',
      'Default max podcasts',
      'Default Max Episodes',
      'Default Storage Space',
      'Default Max Collaborators',
      'Default Max Subscriber Tokens',
    ],
  },
  {
    id: 'final-output',
    label: 'Final Output',
    searchTerms: ['Final Episode Output', 'format', 'bitrate', 'channels', 'mp3', 'final audio'],
  },
  {
    id: 'geolite',
    label: 'GeoLite2',
    searchTerms: ['GeoLite2', 'MaxMind', 'GeoIP', 'geolocation'],
  },
  {
    id: 'transcription',
    label: 'Transcription',
    searchTerms: ['Transcription', 'transcript', 'Whisper', 'OpenAI', 'ASR', 'Self-Hosted'],
  },
  {
    id: 'llm',
    label: 'LLM',
    searchTerms: ['LLM', 'Ollama', 'OpenAI', 'AI', 'chapter', 'summarization', 'model'],
  },
  {
    id: 'captcha',
    label: 'CAPTCHA',
    searchTerms: ['CAPTCHA', 'Sign-In', 'Registration', 'reCAPTCHA', 'hCaptcha', 'Turnstile'],
  },
  {
    id: 'webrtc',
    label: 'WebRTC',
    searchTerms: [
      'WebRTC',
      'Group Calls',
      'Recording',
      'mediasoup',
      'callback',
      'dial-in',
      'phone',
      'Telnyx',
      'Public Key',
      'HarborFM',
    ],
  },
  {
    id: 'email',
    label: 'Email',
    searchTerms: [
      'Email',
      'SMTP',
      'SendGrid',
      'webhook',
      'password reset',
      'Registration Verification',
      'Admin Welcome',
      'New Show',
      'Invite',
      'Contact',
      'Review Verification',
    ],
  },
  {
    id: 'two-factor',
    label: 'Two-Factor',
    searchTerms: ['Two-Factor', '2FA', 'TOTP', 'authenticator', 'enforced'],
  },
  {
    id: 'sso',
    label: 'SSO',
    searchTerms: ['SSO', 'OIDC', 'SAML', 'single sign-on', 'login'],
  },
  {
    id: 'dns',
    label: 'DNS',
    searchTerms: ['DNS', 'CloudFlare', 'custom domains', 'CNAME', 'Link Domain', 'Managed Domain'],
  },
  {
    id: 'custom-legal',
    label: 'Terms & Privacy',
    searchTerms: ['Custom Terms', 'Privacy', 'Terms of Service', 'Privacy Policy', 'Markdown'],
  },
  {
    id: 'reviews',
    label: 'Reviews',
    searchTerms: ['Review Settings', 'reviews', 'publish', 'verified', 'spam', 'LLM'],
  },
];

/** Normalize query for matching: lowercase, trim, collapse spaces */
export function normalizeSearchQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Return tab ids that have at least one searchTerm matching the query */
export function filterTabsBySearch(tabs: SettingsTabDef[], query: string): SettingsTabId[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return SETTINGS_TAB_IDS.slice();
  return tabs
    .filter((tab) =>
      tab.searchTerms.some((term) => term.toLowerCase().includes(normalized))
    )
    .map((t) => t.id);
}

