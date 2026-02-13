import { createHash } from "crypto";
import { readFileSync } from "fs";
import { extname, join } from "path";
import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { RSS_FEED_FILENAME } from "../config.js";
import { assertPathUnder, getDataDir } from "./paths.js";
import { EXT_DOT_TO_EXT, EXT_TO_MIMETYPE } from "../utils/artwork.js";

export interface S3Config {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string | null;
  accessKeyId: string;
  secretAccessKey: string;
}

function fullKey(config: S3Config, key: string): string {
  return config.prefix ? `${config.prefix.replace(/\/$/, "")}/${key}` : key;
}

function md5Hex(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}

/** Returns object ETag (without quotes) or null if not found. Used to skip upload when content unchanged. */
export async function getObjectETag(
  config: S3Config,
  key: string,
): Promise<string | null> {
  const client = createS3Client(config);
  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: fullKey(config, key),
      }),
    );
    const etag = res.ETag;
    if (etag == null) return null;
    return etag.replace(/^"|"$/g, "").trim();
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      e.name === "NotFound" ||
      e.name === "NoSuchKey" ||
      e.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}

export function createS3Client(config: S3Config): S3Client {
  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  if (config.endpoint?.trim()) {
    clientConfig.endpoint = config.endpoint.trim();
  }
  return new S3Client(clientConfig);
}

function s3ErrorMessage(err: unknown): string {
  const o = err as {
    message?: string;
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const msg = typeof o?.message === "string" ? o.message.trim() : "";
  if (msg && msg !== "Unknown") {
    const code = o?.$metadata?.httpStatusCode;
    return code ? `HTTP ${code}: ${msg}` : msg;
  }
  if (err instanceof Error) {
    const name = (err as { name?: string }).name;
    if (name) return `${name}${msg ? `: ${msg}` : ""}`;
  }
  if (o?.Code) return o.Code + (o.message ? `: ${o.message}` : "");
  if (typeof o?.message === "string" && o.message.trim())
    return o.message.trim();
  if (o?.name) return o.name;
  const status = o?.$metadata?.httpStatusCode;
  if (status) return `HTTP ${status} (check server logs for full error)`;
  const s = String(err);
  const out =
    s && s !== "[object Object]" ? s : "S3 request failed (check server logs)";
  return out === "Unknown"
    ? "S3 request failed (check server terminal for details)"
    : out;
}

export async function testS3Access(
  config: S3Config,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = createS3Client(config);
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { ok: true };
  } catch (err) {
    const displayed = s3ErrorMessage(err);
    const e = err as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    console.error(
      "[S3 test]",
      e?.name ?? "Error",
      e?.message ?? "",
      e?.$metadata?.httpStatusCode != null
        ? `(HTTP ${e.$metadata.httpStatusCode})`
        : "",
    );
    return { ok: false, error: displayed };
  }
}

export async function uploadFile(
  config: S3Config,
  key: string,
  body: Buffer | string,
  contentType?: string,
): Promise<void> {
  const client = createS3Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: fullKey(config, key),
      Body: body,
      ContentType:
        contentType ??
        (key.endsWith(".xml") ? "application/xml" : "audio/mpeg"),
    }),
  );
}

export async function deployPodcastToS3(
  config: S3Config,
  _publicBaseUrl: string | null,
  rssXml: string,
  episodes: {
    id: string;
    audio_final_path: string | null;
    audio_mime?: string | null;
    artwork_path?: string | null;
    transcript_srt_path?: string | null;
  }[],
  artworkPath?: string | null,
): Promise<{ uploaded: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  const artworkBase = join(getDataDir(), "artwork");

  const feedBody = Buffer.from(rssXml, "utf8");
  const feedHash = md5Hex(feedBody);
  const existingFeedETag = await getObjectETag(config, RSS_FEED_FILENAME);
  if (existingFeedETag === feedHash) {
    skipped += 1;
  } else {
    await uploadFile(config, RSS_FEED_FILENAME, feedBody, "application/xml");
    uploaded += 1;
  }

  if (artworkPath) {
    try {
      const safePath = assertPathUnder(artworkPath, artworkBase);
      const body = readFileSync(safePath);
      const extFromPath = extname(safePath).toLowerCase();
      const ext = EXT_DOT_TO_EXT[extFromPath] ?? "jpg";
      const key = `cover.${ext}`;
      const contentType = EXT_TO_MIMETYPE[ext] ?? "image/jpeg";
      const contentHash = md5Hex(body);
      const existingETag = await getObjectETag(config, key);
      if (existingETag === contentHash) {
        skipped += 1;
      } else {
        await uploadFile(config, key, body, contentType);
        uploaded += 1;
      }
    } catch (e) {
      errors.push(`Cover image: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const ep of episodes) {
    if (ep.audio_final_path) {
      try {
        const body = readFileSync(ep.audio_final_path);
        const ext = extname(ep.audio_final_path || "") || ".mp3";
        const key = `episodes/${ep.id}${ext}`;
        const contentHash = md5Hex(body);
        const existingETag = await getObjectETag(config, key);
        if (existingETag === contentHash) {
          skipped += 1;
        } else {
          await uploadFile(config, key, body, ep.audio_mime ?? undefined);
          uploaded += 1;
        }
      } catch (e) {
        errors.push(
          `Episode ${ep.id} audio: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (ep.artwork_path) {
      try {
        const safePath = assertPathUnder(ep.artwork_path, artworkBase);
        const body = readFileSync(safePath);
        const extFromPath = extname(safePath).toLowerCase();
        const ext = EXT_DOT_TO_EXT[extFromPath] ?? "jpg";
        const key = `episodes/${ep.id}.${ext}`;
        const contentType = EXT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const contentHash = md5Hex(body);
        const existingETag = await getObjectETag(config, key);
        if (existingETag === contentHash) {
          skipped += 1;
        } else {
          await uploadFile(config, key, body, contentType);
          uploaded += 1;
        }
      } catch (e) {
        errors.push(
          `Episode ${ep.id} artwork: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (ep.transcript_srt_path) {
      try {
        const processedBase = join(getDataDir(), "processed");
        const safePath = assertPathUnder(ep.transcript_srt_path, processedBase);
        const body = readFileSync(safePath);
        const key = `episodes/${ep.id}.srt`;
        const contentHash = md5Hex(body);
        const existingETag = await getObjectETag(config, key);
        if (existingETag === contentHash) {
          skipped += 1;
        } else {
          await uploadFile(config, key, body, "application/srt");
          uploaded += 1;
        }
      } catch (e) {
        errors.push(
          `Episode ${ep.id} transcript: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return { uploaded, skipped, errors };
}
