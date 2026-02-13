import SftpClient from "ssh2-sftp-client";
import { readFileSync } from "fs";
import { extname, join } from "path";
import { RSS_FEED_FILENAME } from "../config.js";
import { getDataDir } from "./paths.js";
import { assertPathUnder } from "./paths.js";
import { EXT_DOT_TO_EXT } from "../utils/artwork.js";
import { md5Hex, MD5_SUFFIX } from "../utils/hash.js";
import type { DeployEpisode, DeployResult } from "./deploy-types.js";

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  private_key?: string;
  path: string;
}

function joinPath(base: string, ...parts: string[]): string {
  const normalized = base.replace(/\/+$/, "");
  const joined = [normalized, ...parts].join("/").replace(/\/+/g, "/");
  return joined.replace(/^\//, "") || "";
}

export async function testSftpAccess(
  config: SftpConfig,
): Promise<{ ok: boolean; error?: string }> {
  const sftp = new SftpClient();
  try {
    const connectOpts: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.username,
    };
    if (config.private_key?.trim()) {
      connectOpts.privateKey = config.private_key.trim();
    } else if (config.password != null && config.password !== "") {
      connectOpts.password = config.password;
    } else {
      return { ok: false, error: "Provide either password or private_key" };
    }
    await sftp.connect(connectOpts);
    if (config.path) {
      await sftp.mkdir(config.path, true);
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    await sftp.end();
  }
}

/** Read remote file to buffer. Returns null if file does not exist or read fails. */
async function getSftpFile(
  sftp: SftpClient,
  remotePath: string,
): Promise<Buffer | null> {
  try {
    const data = await sftp.get(remotePath);
    return Buffer.isBuffer(data) ? data : null;
  } catch {
    return null;
  }
}

export async function deployPodcastToSftp(
  config: SftpConfig,
  _publicBaseUrl: string | null,
  rssXml: string,
  episodes: DeployEpisode[],
  artworkPath?: string | null,
): Promise<DeployResult> {
  const errors: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  const artworkBase = join(getDataDir(), "artwork");
  const sftp = new SftpClient();

  try {
    const connectOpts: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.username,
    };
    if (config.private_key?.trim()) {
      connectOpts.privateKey = config.private_key.trim();
    } else if (config.password != null && config.password !== "") {
      connectOpts.password = config.password;
    } else {
      return {
        uploaded: 0,
        skipped: 0,
        errors: ["Provide either password or private_key"],
      };
    }
    await sftp.connect(connectOpts);

    const basePath = config.path ? joinPath(config.path) : "";
    if (config.path) await sftp.mkdir(config.path, true);

    const upload = async (remotePath: string, body: Buffer) => {
      const full = basePath ? joinPath(basePath, remotePath) : remotePath;
      const hash = md5Hex(body);
      const md5Buf = await getSftpFile(sftp, full + MD5_SUFFIX);
      if (md5Buf != null && md5Buf.toString("utf8").trim() === hash) {
        skipped += 1;
        return;
      }
      const dir = full.includes("/") ? full.replace(/\/[^/]+$/, "") : "";
      if (dir) await sftp.mkdir(dir, true);
      await sftp.put(body, full);
      await sftp.put(Buffer.from(hash, "utf8"), full + MD5_SUFFIX);
      uploaded += 1;
    };

    const feedBody = Buffer.from(rssXml, "utf8");
    await upload(RSS_FEED_FILENAME, feedBody);

    if (artworkPath) {
      try {
        const safePath = assertPathUnder(artworkPath, artworkBase);
        const body = readFileSync(safePath);
        const extFromPath = extname(safePath).toLowerCase();
        const ext = EXT_DOT_TO_EXT[extFromPath] ?? "jpg";
        await upload(`cover.${ext}`, body);
      } catch (e) {
        errors.push(
          `Cover image: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    for (const ep of episodes) {
      if (ep.audio_final_path) {
        try {
          const body = readFileSync(ep.audio_final_path);
          const ext = extname(ep.audio_final_path || "") || ".mp3";
          await upload(`episodes/${ep.id}${ext}`, body);
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
          await upload(`episodes/${ep.id}.${ext}`, body);
        } catch (e) {
          errors.push(
            `Episode ${ep.id} artwork: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (ep.transcript_srt_path) {
        try {
          const processedBase = join(getDataDir(), "processed");
          const safePath = assertPathUnder(
            ep.transcript_srt_path,
            processedBase,
          );
          const body = readFileSync(safePath);
          await upload(`episodes/${ep.id}.srt`, body);
        } catch (e) {
          errors.push(
            `Episode ${ep.id} transcript: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await sftp.end();
  }

  return { uploaded, skipped, errors };
}
