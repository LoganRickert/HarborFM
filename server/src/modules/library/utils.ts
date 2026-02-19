import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, basename } from "path";
import send from "@fastify/send";
import type { FastifyReply, FastifyRequest } from "fastify";
import { assertPathUnder } from "../../services/paths.js";
import { normalizeHostname } from "../../utils/url.js";
import { WAVEFORM_EXTENSION } from "../../config.js";

export const ALLOWED_MIME = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "audio/ogg",
];

export function libraryWaveformPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
}

export function sendLibraryWaveform(
  reply: FastifyReply,
  audioPath: string,
  baseDir: string,
): FastifyReply {
  const wavPath = libraryWaveformPath(audioPath);
  if (!existsSync(wavPath))
    return reply.status(404).send({ error: "Waveform not found" });
  assertPathUnder(wavPath, baseDir);
  const json = readFileSync(wavPath, "utf-8");
  reply
    .header("Content-Type", "application/json")
    .header("Cache-Control", "private, max-age=3600");
  return reply.send(json);
}

export function fetchPixabayHtml(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.origin !== "https://pixabay.com") {
    throw new Error("URL must be from https://pixabay.com");
  }
  const args = [
    "-q",
    "-O",
    "-",
    "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "--header=Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "--header=Accept-Language: en-US,en;q=0.9",
    "--header=Cache-Control: no-cache",
    "--header=Pragma: no-cache",
    "--header=Upgrade-Insecure-Requests: 1",
    "--compression=auto",
    url,
  ];
  try {
    return execFileSync("wget", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? (e as { status?: number }).status
        : undefined;
    if (status !== undefined)
      throw new Error(`Failed to fetch page (exit ${status})`);
    throw e;
  }
}

export function extractPixabayLdJson(html: string): {
  name?: string;
  contentUrl?: string;
  creator?: { name?: string };
  datePublished?: string;
} {
  const regex =
    /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(regex)];
  for (const m of matches) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as {
        "@type"?: string;
        contentUrl?: string;
        name?: string;
        creator?: { name?: string };
        datePublished?: string;
      };
      if (data["@type"] === "AudioObject" && data.contentUrl) return data;
    } catch {
      // skip invalid JSON
    }
  }
  throw new Error("No AudioObject ld+json with contentUrl found in page");
}

export function pixabayLdToAsset(
  ld: {
    name?: string;
    contentUrl?: string;
    creator?: { name?: string };
    datePublished?: string;
  },
  sourceUrl: string,
): {
  name: string;
  tag: string;
  copyright: string;
  license: string;
  download: string;
  source: string;
} {
  const year = ld.datePublished ? new Date(ld.datePublished).getFullYear() : "";
  const creatorName =
    ld.creator && typeof ld.creator === "object" ? ld.creator.name : "";
  const copyright = [creatorName, year].filter(Boolean).join(" ") || "Pixabay";
  return {
    name: ld.name ?? "Untitled",
    tag: "Bumper",
    copyright,
    license: "Pixabay Content License",
    download: (ld.contentUrl ?? "").split("?")[0],
    source: normalizeHostname(sourceUrl),
  };
}

export async function sendLibraryStream(
  request: FastifyRequest,
  reply: FastifyReply,
  safePath: string,
  contentType: string,
) {
  const result = await send(request.raw, basename(safePath), {
    root: dirname(safePath),
    contentType: false,
    acceptRanges: true,
    cacheControl: false,
  });

  if (result.type === "error") {
    const err = result.metadata.error as Error & { status?: number };
    return reply
      .status((err.status ?? 500) as 404 | 500)
      .send({ error: err.message ?? "Internal Server Error" });
  }

  reply.code(result.statusCode as 200 | 206 | 404 | 500);
  const headers = result.headers as Record<string, string>;
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) reply.header(key, value);
  }
  reply.header("Content-Type", contentType);
  return reply.send(result.stream);
}
