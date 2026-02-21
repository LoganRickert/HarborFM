import { OPENAI_CHAT_COMPLETIONS_URL } from "../../config.js";

export const OPENAI_DEFAULT_MODEL = "gpt5-mini";

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type LlmPromptParams = {
  segmentName?: string;
  durationSec?: number;
  markers: Array<{ time: number; title?: string }>;
  transcript: string;
  question: string;
};

export function buildLlmPrompt(params: LlmPromptParams): string {
  const {
    segmentName,
    durationSec,
    markers,
    transcript,
    question,
  } = params;
  const contextParts: string[] = [];
  contextParts.push(
    "You are an AI assistant helping a podcast host or creator review an audio segment. " +
      "Your role is to give feedback on speaking patterns (pace, clarity, filler words, tone), " +
      "suggest follow-up questions or topics for future segments, and answer questions about the content. " +
      "Be constructive, specific, and actionable."
  );
  if (segmentName) {
    contextParts.push(`Segment name: "${segmentName}"`);
  }
  if (typeof durationSec === "number" && durationSec > 0) {
    contextParts.push(`Segment length: ${formatDuration(durationSec)}`);
  }
  if (markers.length > 0) {
    const markerLines = markers.map((m) => {
      const label = m.title?.trim() || "marker";
      return `  ${formatDuration(m.time)} – ${label}`;
    });
    contextParts.push(
      `Markers (chapter/timeline points):\n${markerLines.join("\n")}`
    );
  }
  const contextBlock = contextParts.join("\n");
  const transcriptBlock = transcript
    ? `\n\n--- Transcript ---\n${transcript}\n--- End transcript ---`
    : "\n\nThe user has no transcript for this section.";
  return `${contextBlock}${transcriptBlock}\n\nUser question: ${question}`;
}

export async function askOllama(
  baseUrl: string,
  model: string,
  prompt: string,
): Promise<string> {
  const url = `${baseUrl}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `Ollama returned ${res.status}`);
  }
  const data = (await res.json()) as { response?: string };
  const response =
    typeof data?.response === "string" ? data.response.trim() : "";
  return response || "(No response)";
}

export async function askOpenai(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user" as const, content: prompt }],
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      (await res.text()) ||
      `OpenAI returned ${res.status}`;
    throw new Error(msg);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "(No response)";
}

/**
 * Ask the LLM if the given review text is spam. Strict prompt for consistent YES/NO.
 * Returns true only if the model clearly answers YES (spam). Fail open: on error or unclear, return false.
 */
export async function spamCheckReview(
  text: string,
  askFn: (prompt: string) => Promise<string>,
): Promise<boolean> {
  const prompt = `You are a STRICT review quality + spam detector.

Output EXACTLY one token: YES or NO.

Answer YES if the review is any of the following:
- nonsense / gibberish / keyboard smash (random letters, meaningless filler)
- repeated words/phrases with no meaningful content
- off-topic (not about the product/service)
- promotional, link, coupon, contact info, solicitation
- abusive/hate/harassment
- scam/phishing or requests for money

Answer NO only if it is a genuine review with meaningful feedback.

Examples:
Review: "asdfasdf asdf asdf qwerqwer" -> YES
Review: "👍👍👍" -> YES
Review: "Great pizza, fast delivery." -> NO
Review: "Buy followers at example.com" -> YES
Review: "Terrible service, waiter was rude." -> NO

Review text:
---
${text.slice(0, 2000)}
---

Answer (YES or NO):`;
  console.log("spamCheckReview prompt", prompt);
  try {
    const answer = await askFn(prompt);
    console.log("spamCheckReview answer", answer);
    const normalized = answer.toUpperCase().trim().replace(/\s+/g, " ");
    console.log("spamCheckReview normalized", normalized);
    return normalized.startsWith("YES");
  } catch {
    console.log("spamCheckReview error");
    return false;
  }
}
