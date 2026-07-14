export type HrefTextItem = {
  href: string;
  text: string;
};

/** Drop blank hrefs and normalize text for API payloads. */
export function normalizeHrefTextList(
  items: HrefTextItem[],
): Array<{ href: string; text?: string | null }> {
  const out: Array<{ href: string; text?: string | null }> = [];
  for (const item of items) {
    const href = item.href.trim();
    if (!href) continue;
    const text = item.text.trim();
    out.push(text ? { href, text } : { href, text: null });
  }
  return out;
}
