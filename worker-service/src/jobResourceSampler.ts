/**
 * Sample CPU/memory for this worker only (cgroup when in Docker, else process tree).
 * CPU percent is relative to one core and may exceed 100 when work is multi-threaded.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export type JobResourceStats = {
  avgCpuPercent: number | null;
  peakCpuPercent: number | null;
  avgMemoryBytes: number | null;
  peakMemoryBytes: number | null;
  sampleCount: number;
  source: "cgroup" | "proc" | null;
};

type SampleSnapshot = {
  /** Cumulative CPU time in microseconds. */
  cpuUsageUs: number;
  /** Wall clock ms (Date.now / performance). */
  wallMs: number;
  memoryBytes: number;
};

type ResourceSource = {
  source: "cgroup" | "proc";
  read(): SampleSnapshot | null;
};

const CLK_TCK = 100; // Linux default; used for /proc stat ticks -> seconds

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parseUsageUsec(cpuStat: string): number | null {
  const m = /^usage_usec\s+(\d+)/m.exec(cpuStat);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function resolveCgroupPaths(): { cpuStat: string; memoryCurrent: string } | null {
  const cgroup = readText("/proc/self/cgroup");
  if (!cgroup) return null;

  // cgroup v2: "0::/docker/..." or "0::/"
  const v2 = /^0::(.*)$/m.exec(cgroup);
  if (v2) {
    const rel = (v2[1] || "/").trim() || "/";
    const base =
      rel === "/"
        ? "/sys/fs/cgroup"
        : join("/sys/fs/cgroup", rel.replace(/^\//, ""));
    const cpuStat = join(base, "cpu.stat");
    const memoryCurrent = join(base, "memory.current");
    if (existsSync(cpuStat) && existsSync(memoryCurrent)) {
      return { cpuStat, memoryCurrent };
    }
    // Some runtimes mount the container root at /sys/fs/cgroup directly.
    if (
      existsSync("/sys/fs/cgroup/cpu.stat") &&
      existsSync("/sys/fs/cgroup/memory.current")
    ) {
      return {
        cpuStat: "/sys/fs/cgroup/cpu.stat",
        memoryCurrent: "/sys/fs/cgroup/memory.current",
      };
    }
  }

  // cgroup v1: separate hierarchies
  let cpuacctPath: string | null = null;
  let memoryPath: string | null = null;
  for (const line of cgroup.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 3) continue;
    const controllers = parts[1] ?? "";
    const path = parts[2] ?? "";
    if (controllers.split(",").includes("cpuacct") && !cpuacctPath) {
      cpuacctPath = join(
        "/sys/fs/cgroup/cpuacct",
        path.replace(/^\//, ""),
        "cpuacct.usage",
      );
    }
    if (controllers.split(",").includes("memory") && !memoryPath) {
      memoryPath = join(
        "/sys/fs/cgroup/memory",
        path.replace(/^\//, ""),
        "memory.usage_in_bytes",
      );
    }
  }
  if (
    cpuacctPath &&
    memoryPath &&
    existsSync(cpuacctPath) &&
    existsSync(memoryPath)
  ) {
    return { cpuStat: cpuacctPath, memoryCurrent: memoryPath };
  }
  return null;
}

function createCgroupSource(): ResourceSource | null {
  const paths = resolveCgroupPaths();
  if (!paths) return null;
  const isV1Nanos = paths.cpuStat.endsWith("cpuacct.usage");
  return {
    source: "cgroup",
    read() {
      const cpuRaw = readText(paths.cpuStat);
      const memRaw = readText(paths.memoryCurrent);
      if (cpuRaw == null || memRaw == null) return null;
      let cpuUsageUs: number | null;
      if (isV1Nanos) {
        const nanos = Number(cpuRaw.trim());
        cpuUsageUs = Number.isFinite(nanos) ? nanos / 1000 : null;
      } else {
        cpuUsageUs = parseUsageUsec(cpuRaw);
      }
      const memoryBytes = Number(memRaw.trim());
      if (cpuUsageUs == null || !Number.isFinite(memoryBytes)) return null;
      return {
        cpuUsageUs,
        wallMs: Date.now(),
        memoryBytes: Math.max(0, Math.trunc(memoryBytes)),
      };
    },
  };
}

function listChildPids(pid: number): number[] {
  const taskDir = `/proc/${pid}/task`;
  if (!existsSync(taskDir)) return [];
  const out: number[] = [];
  try {
    for (const tid of readdirSync(taskDir)) {
      const children = readText(join(taskDir, tid, "children"));
      if (!children) continue;
      for (const tok of children.trim().split(/\s+/)) {
        const n = Number(tok);
        if (Number.isFinite(n) && n > 0) out.push(n);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function collectProcessTree(rootPid: number): number[] {
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of listChildPids(pid)) {
      if (!seen.has(child)) queue.push(child);
    }
  }
  return [...seen];
}

/** utime+stime in clock ticks from /proc/<pid>/stat. */
function readProcCpuTicks(pid: number): number | null {
  const stat = readText(`/proc/${pid}/stat`);
  if (!stat) return null;
  const closeParen = stat.lastIndexOf(")");
  if (closeParen < 0) return null;
  const rest = stat.slice(closeParen + 2).split(/\s+/);
  // After comm: state(1) ... utime is field 14, stime 15 => indices 11,12 in rest
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return utime + stime;
}

function readProcRssBytes(pid: number): number | null {
  const status = readText(`/proc/${pid}/status`);
  if (!status) return null;
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
  if (!m) return null;
  const kb = Number(m[1]);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

function createProcSource(): ResourceSource | null {
  if (!existsSync("/proc/self/stat")) return null;
  return {
    source: "proc",
    read() {
      const pids = collectProcessTree(process.pid);
      let ticks = 0;
      let memoryBytes = 0;
      let any = false;
      for (const pid of pids) {
        const t = readProcCpuTicks(pid);
        const m = readProcRssBytes(pid);
        if (t != null) {
          ticks += t;
          any = true;
        }
        if (m != null) memoryBytes += m;
      }
      if (!any) return null;
      return {
        cpuUsageUs: (ticks / CLK_TCK) * 1_000_000,
        wallMs: Date.now(),
        memoryBytes,
      };
    },
  };
}

function resolveSource(): ResourceSource | null {
  return createCgroupSource() ?? createProcSource();
}

function emptyStats(): JobResourceStats {
  return {
    avgCpuPercent: null,
    peakCpuPercent: null,
    avgMemoryBytes: null,
    peakMemoryBytes: null,
    sampleCount: 0,
    source: null,
  };
}

/**
 * Start sampling this worker's CPU/memory. Call stop() when the job ends.
 */
export function startJobResourceSampler(intervalMs = 1000): {
  stop: () => JobResourceStats;
} {
  const source = resolveSource();
  if (!source) {
    return { stop: () => emptyStats() };
  }

  let prev = source.read();
  let cpuPercentSum = 0;
  let cpuSamples = 0;
  let peakCpuPercent = 0;
  let memorySum = 0;
  let memorySamples = 0;
  let peakMemoryBytes = 0;

  const tick = () => {
    try {
      const cur = source.read();
      if (!cur) return;
      if (prev && cur.wallMs > prev.wallMs) {
        const wallUs = (cur.wallMs - prev.wallMs) * 1000;
        if (wallUs > 0) {
          const cpuDeltaUs = Math.max(0, cur.cpuUsageUs - prev.cpuUsageUs);
          const pct = (cpuDeltaUs / wallUs) * 100;
          if (Number.isFinite(pct) && pct >= 0) {
            cpuPercentSum += pct;
            cpuSamples += 1;
            if (pct > peakCpuPercent) peakCpuPercent = pct;
          }
        }
      }
      if (Number.isFinite(cur.memoryBytes) && cur.memoryBytes >= 0) {
        memorySum += cur.memoryBytes;
        memorySamples += 1;
        if (cur.memoryBytes > peakMemoryBytes) {
          peakMemoryBytes = cur.memoryBytes;
        }
      }
      prev = cur;
    } catch {
      /* never fail the job over metrics */
    }
  };

  // Immediate baseline + interval samples.
  tick();
  const timer = setInterval(tick, Math.max(250, intervalMs));
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      clearInterval(timer);
      tick(); // final sample
      const sampleCount = Math.max(cpuSamples, memorySamples);
      if (sampleCount === 0) {
        return { ...emptyStats(), source: source.source };
      }
      return {
        avgCpuPercent:
          cpuSamples > 0
            ? Math.round((cpuPercentSum / cpuSamples) * 10) / 10
            : null,
        peakCpuPercent:
          cpuSamples > 0 ? Math.round(peakCpuPercent * 10) / 10 : null,
        avgMemoryBytes:
          memorySamples > 0
            ? Math.round(memorySum / memorySamples)
            : null,
        peakMemoryBytes: memorySamples > 0 ? peakMemoryBytes : null,
        sampleCount,
        source: source.source,
      };
    },
  };
}
