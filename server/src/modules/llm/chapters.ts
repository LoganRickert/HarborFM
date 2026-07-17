/**
 * Compact transcript + character-buffer chapter generation for podcast markers.
 */

export type ChapterLlmBudget = {
  chunkChars: number;
  promptChars: number;
};

export type GeneratedChapter = {
  startSec: number;
  start: string;
  title: string;
};

const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})(?:[,.]\d{1,3})?$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatHhMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(r)}`;
}

export function parseHhMmSs(ts: string): number | null {
  const m = TIME_RE.exec(ts.trim());
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  const sec = parseInt(m[3]!, 10);
  if (min > 59 || sec > 59) return null;
  return h * 3600 + min * 60 + sec;
}

/** Convert SRT or already-compact transcript into HH:MM:SS | text lines (no ms). */
export function compactTranscriptForChapters(transcript: string): string {
  const raw = transcript.replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  if (raw.includes("-->")) {
    const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const out: string[] = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      const timeIdx = lines.findIndex((l) => l.includes("-->"));
      if (timeIdx < 0) continue;
      const startRaw = lines[timeIdx]!.split("-->")[0]!.trim();
      const startSec = parseHhMmSs(startRaw);
      if (startSec == null) continue;
      const spoken = lines
        .slice(timeIdx + 1)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
      if (!spoken) continue;
      out.push(`${formatHhMmSs(startSec)} | ${spoken}`);
    }
    return out.join("\n");
  }

  // Already compact or plain lines with optional leading timestamps
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pipe = trimmed.indexOf("|");
    if (pipe > 0) {
      const left = trimmed.slice(0, pipe).trim();
      const right = trimmed.slice(pipe + 1).trim();
      const sec = parseHhMmSs(left);
      if (sec != null && right) {
        out.push(`${formatHhMmSs(sec)} | ${right}`);
        continue;
      }
    }
    const m = trimmed.match(/^(\d{1,2}:\d{2}:\d{2})(?:[,.]\d{1,3})?\s+(.+)$/);
    if (m) {
      const sec = parseHhMmSs(m[1]!);
      if (sec != null && m[2]!.trim()) {
        out.push(`${formatHhMmSs(sec)} | ${m[2]!.trim()}`);
      }
    }
  }
  return out.join("\n");
}

function parseBillionSize(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse size from model tag like llama3.2:1b, qwen3:8b. */
export function parseModelSizeFromName(model: string): number | null {
  const name = model.trim().toLowerCase();
  if (!name) return null;
  // Prefer size after colon (tag), else anywhere
  const afterColon = name.includes(":") ? name.split(":").pop()! : name;
  return parseBillionSize(afterColon) ?? parseBillionSize(name);
}

/**
 * Ask Ollama /api/show for parameter_size when possible.
 * Returns billions (e.g. 3.2) or null.
 */
export async function fetchOllamaParameterSizeB(
  baseUrl: string,
  model: string,
): Promise<number | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/api/show`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      details?: { parameter_size?: string };
      model_info?: Record<string, unknown>;
    };
    const fromDetails = data.details?.parameter_size;
    if (typeof fromDetails === "string") {
      const n = parseBillionSize(fromDetails);
      if (n != null) return n;
    }
    // Some builds expose general.parameter_count
    const info = data.model_info;
    if (info && typeof info === "object") {
      for (const [k, v] of Object.entries(info)) {
        if (/parameter/i.test(k) && (typeof v === "string" || typeof v === "number")) {
          const n =
            typeof v === "number"
              ? v >= 1e9
                ? v / 1e9
                : v
              : parseBillionSize(v);
          if (n != null && n > 0) return n;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function budgetFromParamSizeB(sizeB: number): ChapterLlmBudget {
  if (sizeB < 2) return { chunkChars: 1500, promptChars: 2000 };
  if (sizeB < 5) return { chunkChars: 2500, promptChars: 3500 };
  if (sizeB < 14) return { chunkChars: 4000, promptChars: 6000 };
  return { chunkChars: 6000, promptChars: 9000 };
}

export function budgetForOpenaiModel(model: string): ChapterLlmBudget {
  const m = model.trim().toLowerCase();
  const isMini =
    !m ||
    m.includes("mini") ||
    m.includes("gpt5-mini") ||
    m.includes("gpt-5-mini") ||
    m.includes("gpt-4o-mini") ||
    m.includes("4o-mini");
  if (isMini) return { chunkChars: 2500, promptChars: 3500 };
  return { chunkChars: 4000, promptChars: 6000 };
}

export async function resolveChapterLlmBudget(opts: {
  provider: "ollama" | "openai";
  model: string;
  ollamaUrl?: string;
}): Promise<ChapterLlmBudget> {
  if (opts.provider === "openai") {
    return budgetForOpenaiModel(opts.model);
  }
  const fromShow =
    opts.ollamaUrl != null
      ? await fetchOllamaParameterSizeB(opts.ollamaUrl, opts.model)
      : null;
  const fromName = parseModelSizeFromName(opts.model);
  // :latest / unknown > assume ~3B
  const sizeB = fromShow ?? fromName ?? 3;
  return budgetFromParamSizeB(sizeB);
}

/** Split compact transcript by character budget; cuts only at newlines. */
export function splitTranscriptByCharBudget(
  text: string,
  chunkChars: number,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const target = Math.max(500, chunkChars);
  if (normalized.length <= target) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    if (normalized.length - start <= target) {
      chunks.push(normalized.slice(start).trim());
      break;
    }
    let end = start + target;
    // Prefer cut at last newline before target
    const slice = normalized.slice(start, end);
    const lastNl = slice.lastIndexOf("\n");
    if (lastNl > 0) {
      end = start + lastNl;
    } else {
      // No newline in window: advance to next newline after target
      const nextNl = normalized.indexOf("\n", end);
      end = nextNl >= 0 ? nextNl : normalized.length;
    }
    const part = normalized.slice(start, end).trim();
    if (part) chunks.push(part);
    start = end;
    while (start < normalized.length && normalized[start] === "\n") start += 1;
  }
  return chunks.filter(Boolean);
}

/** Evenly sample whole lines so prompt stays under promptChars. */
export function sampleChunkForPrompt(chunk: string, promptChars: number): string {
  const limit = Math.max(200, promptChars);
  if (chunk.length <= limit) return chunk;
  const lines = chunk.split("\n").filter((l) => l.trim());
  if (lines.length <= 2) return chunk.slice(0, limit);

  const out: string[] = [];
  let size = 0;
  const push = (line: string) => {
    const add = (out.length ? 1 : 0) + line.length;
    if (size + add > limit && out.length > 0) return false;
    out.push(line);
    size += add;
    return true;
  };

  push(lines[0]!);
  const mid = lines.slice(1, -1);
  if (mid.length > 0) {
    const budgetLeft = Math.max(0, limit - size - lines[lines.length - 1]!.length - 1);
    // Approximate how many mid lines fit
    const avg = Math.max(
      1,
      Math.floor(mid.reduce((a, l) => a + l.length, 0) / mid.length),
    );
    const maxMid = Math.max(1, Math.floor(budgetLeft / (avg + 1)));
    const step = Math.max(1, Math.ceil(mid.length / maxMid));
    for (let i = 0; i < mid.length; i += step) {
      if (!push(mid[i]!)) break;
    }
  }
  push(lines[lines.length - 1]!);
  return out.join("\n");
}

function timestampsInChunk(chunk: string): string[] {
  const out: string[] = [];
  for (const line of chunk.split("\n")) {
    const left = line.split("|")[0]?.trim() ?? "";
    if (parseHhMmSs(left) != null) out.push(formatHhMmSs(parseHhMmSs(left)!));
  }
  return out;
}

function parseChapterJson(raw: string): { start: string; title: string } | null {
  const trimmed = raw.trim();
  let obj: unknown = null;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]!);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  // Allow { chapter: {...} } wrappers
  const inner =
    rec.start != null
      ? rec
      : rec.chapter && typeof rec.chapter === "object"
        ? (rec.chapter as Record<string, unknown>)
        : null;
  if (!inner) return null;
  const start = String(inner.start ?? "").trim();
  const title = String(inner.title ?? "").trim();
  if (!start || !title) return null;
  return { start, title };
}

export type AskJsonFn = (prompt: string) => Promise<string>;

/**
 * Generate chapter candidates from a transcript using char-buffer chunks.
 */
export async function generateChaptersFromTranscript(
  transcript: string,
  budget: ChapterLlmBudget,
  askJson: AskJsonFn,
): Promise<GeneratedChapter[]> {
  const compact = compactTranscriptForChapters(transcript);
  if (!compact.trim()) return [];

  const chunks = splitTranscriptByCharBudget(compact, budget.chunkChars);
  const chapters: GeneratedChapter[] = [];
  const seen = new Set<number>();

  for (const chunk of chunks) {
    const valid = new Set(timestampsInChunk(chunk));
    const first = [...valid][0];
    if (!first) continue;
    const sample = sampleChunkForPrompt(chunk, budget.promptChars);
    const prompt =
      `Pick the best podcast chapter start for this transcript chunk.\n` +
      `Default to ${first} if unsure.\n` +
      `Return a JSON object with keys "start" and "title".\n` +
      `start must be an exact timestamp from the transcript lines (HH:MM:SS).\n` +
      `title: 3 to 7 words summarizing the topic.\n\n` +
      `Transcript:\n${sample}\n`;

    let parsed: { start: string; title: string } | null = null;
    try {
      const raw = await askJson(prompt);
      parsed = parseChapterJson(raw);
    } catch {
      parsed = null;
    }

    let start = "";
    let title = parsed?.title?.trim() || "";
    if (parsed?.start) {
      const sec = parseHhMmSs(parsed.start);
      if (sec != null) {
        const normalized = formatHhMmSs(sec);
        if (valid.has(normalized)) start = normalized;
      }
    }
    if (!start || !title) {
      start = first;
      title = title || "Chapter";
    }
    const startSec = parseHhMmSs(start);
    if (startSec == null || seen.has(startSec)) continue;
    seen.add(startSec);
    chapters.push({ startSec, start: formatHhMmSs(startSec), title });
  }

  chapters.sort((a, b) => a.startSec - b.startSec);
  return chapters;
}
