import { desc, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { workerJobStats } from "../../db/schema.js";

const MAX_RETAINED_ROWS = 200;

export type WorkerJobStatRow = {
  id: string;
  workerId: string | null;
  workerName: string | null;
  kind: string;
  status: string;
  error: string | null;
  bytesDownloaded: number;
  bytesUploaded: number;
  durationMs: number | null;
  avgCpuPercent: number | null;
  peakCpuPercent: number | null;
  avgMemoryBytes: number | null;
  peakMemoryBytes: number | null;
  resourceSampleCount: number | null;
  resourceSource: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type InsertWorkerJobStat = {
  id: string;
  workerId: string | null;
  workerName: string | null;
  kind: string;
  status: "completed" | "failed";
  error?: string | null;
  bytesDownloaded: number;
  bytesUploaded: number;
  durationMs: number | null;
  avgCpuPercent?: number | null;
  peakCpuPercent?: number | null;
  avgMemoryBytes?: number | null;
  peakMemoryBytes?: number | null;
  resourceSampleCount?: number | null;
  resourceSource?: string | null;
  startedAt: string;
  finishedAt: string;
};

function pruneOldStats(): void {
  drizzleDb.run(sql`
    DELETE FROM worker_job_stats
    WHERE id NOT IN (
      SELECT id FROM worker_job_stats
      ORDER BY created_at DESC, rowid DESC
      LIMIT ${MAX_RETAINED_ROWS}
    )
  `);
}

function asOptionalNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Persist one finished worker job and keep only the newest rows. */
export function insertWorkerJobStat(row: InsertWorkerJobStat): void {
  drizzleDb
    .insert(workerJobStats)
    .values({
      id: row.id,
      workerId: row.workerId,
      workerName: row.workerName,
      kind: row.kind,
      status: row.status,
      error: row.error ?? null,
      bytesDownloaded: row.bytesDownloaded,
      bytesUploaded: row.bytesUploaded,
      durationMs: row.durationMs,
      avgCpuPercent: row.avgCpuPercent ?? null,
      peakCpuPercent: row.peakCpuPercent ?? null,
      avgMemoryBytes: row.avgMemoryBytes ?? null,
      peakMemoryBytes: row.peakMemoryBytes ?? null,
      resourceSampleCount: row.resourceSampleCount ?? null,
      resourceSource: row.resourceSource ?? null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    })
    .run();
  try {
    pruneOldStats();
  } catch {
    /* non-fatal */
  }
}

export function listWorkerJobStats(limit = 50): WorkerJobStatRow[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  return drizzleDb
    .select({
      id: workerJobStats.id,
      workerId: workerJobStats.workerId,
      workerName: workerJobStats.workerName,
      kind: workerJobStats.kind,
      status: workerJobStats.status,
      error: workerJobStats.error,
      bytesDownloaded: workerJobStats.bytesDownloaded,
      bytesUploaded: workerJobStats.bytesUploaded,
      durationMs: workerJobStats.durationMs,
      avgCpuPercent: workerJobStats.avgCpuPercent,
      peakCpuPercent: workerJobStats.peakCpuPercent,
      avgMemoryBytes: workerJobStats.avgMemoryBytes,
      peakMemoryBytes: workerJobStats.peakMemoryBytes,
      resourceSampleCount: workerJobStats.resourceSampleCount,
      resourceSource: workerJobStats.resourceSource,
      startedAt: workerJobStats.startedAt,
      finishedAt: workerJobStats.finishedAt,
      createdAt: workerJobStats.createdAt,
    })
    .from(workerJobStats)
    .orderBy(desc(workerJobStats.createdAt))
    .limit(safeLimit)
    .all()
    .map((r) => ({
      ...r,
      bytesDownloaded: Number(r.bytesDownloaded) || 0,
      bytesUploaded: Number(r.bytesUploaded) || 0,
      durationMs:
        r.durationMs == null ? null : Number(r.durationMs) || 0,
      avgCpuPercent: asOptionalNumber(r.avgCpuPercent),
      peakCpuPercent: asOptionalNumber(r.peakCpuPercent),
      avgMemoryBytes: asOptionalNumber(r.avgMemoryBytes),
      peakMemoryBytes: asOptionalNumber(r.peakMemoryBytes),
      resourceSampleCount: asOptionalNumber(r.resourceSampleCount),
      resourceSource: r.resourceSource ?? null,
    }));
}
