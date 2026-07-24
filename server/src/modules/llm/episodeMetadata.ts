/**
 * Generate episode description / subtitle / summary text from a transcript.
 */

import { compactTranscriptForChapters } from "./chapters.js";
import type { LlmEpisodeMetadataField } from "@harborfm/shared";

const TRANSCRIPT_CHAR_BUDGET = 14_000;

export type EpisodeMetadataContext = {
  episodeTitle?: string;
  existingDescription?: string;
  existingSubtitle?: string;
  existingSummary?: string;
};

const FIELD_INSTRUCTIONS: Record<
  LlmEpisodeMetadataField,
  { label: string; guidance: string }
> = {
  subtitle: {
    label: "subtitle",
    guidance:
      "Write a single itunes:subtitle line for podcast app listings. " +
      "About 80-120 characters. One sentence or phrase. No quotes around the result.",
  },
  description: {
    label: "description",
    guidance:
      "Write the primary RSS description blurb for this episode. " +
      "1-3 sentences, plain text, suitable for podcast apps. No HTML. No quotes around the result.",
  },
  summary: {
    label: "summary",
    guidance:
      "Write an itunes:summary for this episode. " +
      "A short paragraph (longer and more detailed than a typical description). " +
      "Plain text, no HTML. No quotes around the result.",
  },
};

function truncateTranscript(compact: string, budget: number): string {
  if (compact.length <= budget) return compact;
  return `${compact.slice(0, budget)}\n...[transcript truncated]`;
}

/** Prefer spoken text only (drop timestamps) for metadata prompts. */
export function plainTranscriptForMetadata(transcript: string): string {
  const compact = compactTranscriptForChapters(transcript);
  if (!compact) return transcript.replace(/\r\n/g, "\n").trim();
  const lines = compact.split("\n").map((line) => {
    const pipe = line.indexOf("|");
    if (pipe > 0) return line.slice(pipe + 1).trim();
    return line.trim();
  });
  return lines.filter(Boolean).join(" ");
}

function parseTextJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
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
  const text = (obj as Record<string, unknown>).text;
  if (typeof text !== "string") return null;
  const out = text.trim();
  return out || null;
}

function stripWrappingQuotes(text: string): string {
  const t = text.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function buildEpisodeMetadataPrompt(
  field: LlmEpisodeMetadataField,
  transcript: string,
  context: EpisodeMetadataContext = {},
): string {
  const { label, guidance } = FIELD_INSTRUCTIONS[field];
  const plain = truncateTranscript(
    plainTranscriptForMetadata(transcript),
    TRANSCRIPT_CHAR_BUDGET,
  );

  const contextLines: string[] = [];
  const title = context.episodeTitle?.trim();
  if (title) contextLines.push(`Episode title: ${title}`);

  const others: string[] = [];
  if (field !== "description") {
    const d = context.existingDescription?.trim();
    if (d) others.push(`Existing description: ${d}`);
  }
  if (field !== "subtitle") {
    const s = context.existingSubtitle?.trim();
    if (s) others.push(`Existing subtitle: ${s}`);
  }
  if (field !== "summary") {
    const s = context.existingSummary?.trim();
    if (s) others.push(`Existing summary: ${s}`);
  }
  if (others.length) {
    contextLines.push(
      "Other episode fields (keep your answer distinct; do not copy them):\n" +
        others.join("\n"),
    );
  }

  const contextBlock =
    contextLines.length > 0 ? `\n${contextLines.join("\n")}\n` : "\n";

  return (
    `You write podcast episode metadata for RSS / Apple Podcasts.\n` +
    `Return a JSON object with a single key "text" whose value is the ${label}.\n` +
    `${guidance}\n` +
    `Do not include markdown, labels, or preamble outside the JSON.\n` +
    contextBlock +
    `\n--- Transcript ---\n${plain}\n--- End transcript ---`
  );
}

export async function generateEpisodeFieldFromTranscript(
  field: LlmEpisodeMetadataField,
  transcript: string,
  askFn: (prompt: string) => Promise<string>,
  context: EpisodeMetadataContext = {},
): Promise<string> {
  const prompt = buildEpisodeMetadataPrompt(field, transcript, context);
  const raw = await askFn(prompt);
  const fromJson = parseTextJson(raw);
  if (fromJson) return stripWrappingQuotes(fromJson);
  // Fallback if the model ignored JSON mode
  const cleaned = stripWrappingQuotes(
    raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim(),
  );
  if (!cleaned || cleaned === "(No response)") {
    throw new Error("LLM returned empty episode metadata.");
  }
  return cleaned;
}
