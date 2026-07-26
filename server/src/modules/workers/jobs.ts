import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  statSync,
  createReadStream,
  rmSync,
} from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { getDataDir } from "../../services/paths.js";
import type { ComputeJobKind } from "./protocol.js";

export type JobFileRef = {
  name: string;
  absolutePath: string;
};

type ChunkUploadState = {
  nextIndex: number;
  totalChunks: number;
  totalBytes: number;
  receivedBytes: number;
  tmpPath: string;
};

export type ActiveJob = {
  id: string;
  kind: ComputeJobKind;
  token: string;
  inputs: JobFileRef[];
  outputs: JobFileRef[];
  params: Record<string, unknown>;
  workDir: string;
  workerId: string | null;
  /** Worker display name used to reclaim jobs after a brief reconnect. */
  workerName: string | null;
  createdAt: number;
  acceptResolve: ((ok: boolean) => void) | null;
  doneResolve: (() => void) | null;
  doneReject: ((err: Error) => void) | null;
  /** Timer that fails the job if the worker does not reconnect in time. */
  disconnectGraceTimer: ReturnType<typeof setTimeout> | null;
  /** In-progress chunked output uploads, keyed by output name. */
  chunkUploads: Map<string, ChunkUploadState>;
  /** Bytes the worker downloaded from HarborFM (inputs). */
  bytesDownloaded: number;
  /** Bytes the worker uploaded to HarborFM (outputs). */
  bytesUploaded: number;
  /** Wall-clock start when the worker accepted the job (ms since epoch). */
  acceptedAt: number | null;
};

const jobs = new Map<string, ActiveJob>();

function workersRoot(): string {
  const dir = join(getDataDir(), "_workers");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function createJob(opts: {
  kind: ComputeJobKind;
  inputs: JobFileRef[];
  outputs: JobFileRef[];
  params: Record<string, unknown>;
}): ActiveJob {
  const id = nanoid();
  const token = nanoid(48);
  const workDir = join(workersRoot(), id);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(join(workDir, "out"), { recursive: true });
  const job: ActiveJob = {
    id,
    kind: opts.kind,
    token,
    inputs: opts.inputs,
    outputs: opts.outputs,
    params: opts.params,
    workDir,
    workerId: null,
    workerName: null,
    createdAt: Date.now(),
    acceptResolve: null,
    doneResolve: null,
    doneReject: null,
    disconnectGraceTimer: null,
    chunkUploads: new Map(),
    bytesDownloaded: 0,
    bytesUploaded: 0,
    acceptedAt: null,
  };
  jobs.set(id, job);
  return job;
}

export function addJobBytesDownloaded(job: ActiveJob, bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  job.bytesDownloaded += Math.trunc(bytes);
}

export function addJobBytesUploaded(job: ActiveJob, bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  job.bytesUploaded += Math.trunc(bytes);
}

export function getJob(jobId: string): ActiveJob | undefined {
  return jobs.get(jobId);
}

export function listJobs(): ActiveJob[] {
  return [...jobs.values()];
}

export function listJobsForWorker(workerId: string): ActiveJob[] {
  return [...jobs.values()].filter((j) => j.workerId === workerId);
}

export function clearJobDisconnectGrace(job: ActiveJob): void {
  if (job.disconnectGraceTimer) {
    clearTimeout(job.disconnectGraceTimer);
    job.disconnectGraceTimer = null;
  }
}

export function getJobByToken(
  jobId: string,
  token: string,
): ActiveJob | undefined {
  const job = jobs.get(jobId);
  if (!job || job.token !== token) return undefined;
  return job;
}

export function removeJob(jobId: string): void {
  const job = jobs.get(jobId);
  jobs.delete(jobId);
  if (!job) return;
  clearJobDisconnectGrace(job);
  try {
    rmSync(job.workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function stagingOutputPath(job: ActiveJob, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(job.workDir, "out", safe);
}

export function resolveInputPath(
  job: ActiveJob,
  name: string,
): string | null {
  const ref = job.inputs.find((i) => i.name === name);
  if (!ref) return null;
  if (!existsSync(ref.absolutePath)) return null;
  return ref.absolutePath;
}

export function openInputReadStream(job: ActiveJob, name: string) {
  const path = resolveInputPath(job, name);
  if (!path) return null;
  const size = statSync(path).size;
  return { stream: createReadStream(path), size, path };
}

/** Stream request body to staging file. Returns bytes written. */
export async function writeStagingOutputFromStream(
  job: ActiveJob,
  name: string,
  body: NodeJS.ReadableStream,
  expectedLength?: number,
): Promise<{ bytes: number; path: string }> {
  if (!job.outputs.some((o) => o.name === name)) {
    throw new Error(`Unknown output file: ${name}`);
  }
  job.chunkUploads.delete(name);
  const dest = stagingOutputPath(job, name);
  const tmp = `${dest}.partial`;
  const hash = createHash("sha256");
  let bytes = 0;
  const out = createWriteStream(tmp);
  await new Promise<void>((resolve, reject) => {
    body.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buf.length;
      hash.update(buf);
    });
    body.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
    body.pipe(out);
  });
  if (expectedLength != null && expectedLength > 0 && bytes !== expectedLength) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Upload size mismatch for ${name}: expected ${expectedLength}, got ${bytes}`,
    );
  }
  renameSync(tmp, dest);
  void hash;
  return { bytes, path: dest };
}

function pipeBodyToWriteStream(
  body: NodeJS.ReadableStream,
  out: ReturnType<typeof createWriteStream>,
): Promise<number> {
  let bytes = 0;
  return new Promise<void>((resolve, reject) => {
    body.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buf.length;
    });
    body.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
    body.pipe(out);
  }).then(() => bytes);
}

/**
 * Append one sequential chunk of an output upload.
 * Chunks must arrive in order (0..totalChunks-1). The last chunk finalizes the file.
 */
export async function writeStagingOutputChunk(
  job: ActiveJob,
  name: string,
  opts: {
    chunkIndex: number;
    totalChunks: number;
    totalBytes: number;
    body: NodeJS.ReadableStream;
    chunkLength?: number;
  },
): Promise<{
  bytes: number;
  receivedBytes: number;
  complete: boolean;
  path: string;
}> {
  if (!job.outputs.some((o) => o.name === name)) {
    throw new Error(`Unknown output file: ${name}`);
  }
  const { chunkIndex, totalChunks, totalBytes, body, chunkLength } = opts;
  if (
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    chunkIndex >= totalChunks ||
    !Number.isFinite(totalBytes) ||
    totalBytes < 0
  ) {
    throw new Error("Invalid chunk upload metadata");
  }

  const dest = stagingOutputPath(job, name);
  const tmp = `${dest}.partial`;
  let state = job.chunkUploads.get(name);

  if (chunkIndex === 0) {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
    if (existsSync(dest)) {
      try {
        unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
    state = {
      nextIndex: 0,
      totalChunks,
      totalBytes,
      receivedBytes: 0,
      tmpPath: tmp,
    };
    job.chunkUploads.set(name, state);
  } else {
    if (!state) {
      throw new Error(`Chunk upload for ${name} has not started (expected chunk 0 first)`);
    }
    if (
      state.totalChunks !== totalChunks ||
      state.totalBytes !== totalBytes ||
      state.tmpPath !== tmp
    ) {
      throw new Error(`Chunk upload metadata mismatch for ${name}`);
    }
  }

  if (!state || state.nextIndex !== chunkIndex) {
    throw new Error(
      `Out-of-order chunk for ${name}: expected ${state?.nextIndex ?? 0}, got ${chunkIndex}`,
    );
  }

  const out = createWriteStream(tmp, { flags: chunkIndex === 0 ? "w" : "a" });
  const bytes = await pipeBodyToWriteStream(body, out);
  if (chunkLength != null && chunkLength > 0 && bytes !== chunkLength) {
    job.chunkUploads.delete(name);
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Chunk size mismatch for ${name}#${chunkIndex}: expected ${chunkLength}, got ${bytes}`,
    );
  }

  state.receivedBytes += bytes;
  state.nextIndex = chunkIndex + 1;

  const complete = chunkIndex === totalChunks - 1;
  if (complete) {
    if (state.receivedBytes !== totalBytes) {
      job.chunkUploads.delete(name);
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw new Error(
        `Upload size mismatch for ${name}: expected ${totalBytes}, got ${state.receivedBytes}`,
      );
    }
    renameSync(tmp, dest);
    job.chunkUploads.delete(name);
    return {
      bytes,
      receivedBytes: state.receivedBytes,
      complete: true,
      path: dest,
    };
  }

  return {
    bytes,
    receivedBytes: state.receivedBytes,
    complete: false,
    path: tmp,
  };
}

/** Promote staged outputs into final absolute paths. */
export function promoteJobOutputs(job: ActiveJob): void {
  for (const out of job.outputs) {
    const staged = stagingOutputPath(job, out.name);
    if (!existsSync(staged)) {
      throw new Error(`Worker did not upload required output: ${out.name}`);
    }
    const parent = dirname(out.absolutePath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    try {
      renameSync(staged, out.absolutePath);
    } catch {
      copyFileSync(staged, out.absolutePath);
      try {
        unlinkSync(staged);
      } catch {
        /* ignore */
      }
    }
  }
}
