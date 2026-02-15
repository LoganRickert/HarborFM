import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

type StreamSpec = { rtpPort: number; rtcpPort: number; payloadType: number };

function createSingleStreamSdp(spec: StreamSpec): string {
  const parts = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=-",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
    `m=audio ${spec.rtpPort} RTP/AVP ${spec.payloadType}`,
    `a=rtcp:${spec.rtcpPort}`,
    `a=rtpmap:${spec.payloadType} opus/48000/2`,
    "a=sendonly",
  ];
  return parts.join("\n") + "\n";
}

export type SegmentRecorderOptions = {
  segmentId: string;
  producerId: string;
  recordingDataDir: string;
  /** Folder name under recordings/ (e.g. 2025-02-15_14-30-00_episodeId) */
  recordingDirName: string;
};

/**
 * SegmentRecorder: RTP → MP3 per producer. Writes to .mp3.part, renames to .mp3 on clean stop.
 * Uses SDP temp file so stdin stays available for graceful shutdown ('q' command).
 */
export class SegmentRecorder {
  private ffmpeg: ChildProcess | null = null;
  private partPath: string;
  private finalPath: string;
  private sdpPath: string;
  private options: SegmentRecorderOptions;

  constructor(options: SegmentRecorderOptions) {
    this.options = options;
    const dir = join(options.recordingDataDir, "recordings", options.recordingDirName);
    mkdirSync(dir, { recursive: true });
    const base = `segment_${options.segmentId}`;
    this.partPath = join(dir, `${base}.mp3.part`);
    this.finalPath = join(dir, `${base}.mp3`);
    this.sdpPath = join(dir, `_sdp_${options.segmentId}.sdp`);
  }

  /**
   * Start FFmpeg recording RTP to MP3. Returns the ChildProcess.
   */
  start(rtpPort: number, rtcpPort: number, payloadType: number): ChildProcess {
    const sdp = createSingleStreamSdp({ rtpPort, rtcpPort, payloadType });
    writeFileSync(this.sdpPath, sdp, "utf8");
    const ffmpegArgs = [
      "-loglevel",
      "warning",
      "-rw_timeout",
      "15000000",
      "-protocol_whitelist",
      "file,udp,rtp",
      "-reorder_queue_size",
      "500",
      "-f",
      "sdp",
      "-i",
      this.sdpPath,
      "-map",
      "0:a:0",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "256k",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-f",
      "mp3",
      "-y",
      this.partPath,
    ];
    const ff = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
    this.ffmpeg = ff;
    return ff;
  }

  /**
   * Stop recording: send 'q' to stdin for graceful flush, fallback to SIGINT. Rename .part → .mp3 on success.
   */
  stop(graceMs: number): Promise<{ success: boolean; filePath: string | null }> {
    return new Promise((resolve) => {
      const ff = this.ffmpeg;
      this.ffmpeg = null;
      if (!ff) {
        resolve({ success: false, filePath: null });
        return;
      }

      const cleanupSdp = () => {
        try {
          if (existsSync(this.sdpPath)) unlinkSync(this.sdpPath);
        } catch {
          /* ignore */
        }
      };

      const timeout = setTimeout(() => {
        try {
          ff.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        cleanupSdp();
        resolve({ success: false, filePath: null });
      }, graceMs);

      ff.once("close", (code) => {
        clearTimeout(timeout);
        cleanupSdp();
        if (code === 0 && existsSync(this.partPath) && statSync(this.partPath).size > 0) {
          try {
            renameSync(this.partPath, this.finalPath);
            const rel = `recordings/${this.options.recordingDirName}/segment_${this.options.segmentId}.mp3`;
            resolve({ success: true, filePath: rel });
          } catch (err) {
            console.log("[SegmentRecorder] rename failed:", err);
            resolve({ success: false, filePath: null });
          }
        } else {
          resolve({ success: false, filePath: null });
        }
      });

      if (ff.stdin?.writable) {
        ff.stdin.write("q");
        ff.stdin.end();
      } else {
        ff.kill("SIGINT");
      }
    });
  }

  getPartPath(): string {
    return this.partPath;
  }

  getFinalPath(): string {
    return this.finalPath;
  }

  getRelativePath(): string {
    return `recordings/${this.options.recordingDirName}/segment_${this.options.segmentId}.mp3`;
  }
}
