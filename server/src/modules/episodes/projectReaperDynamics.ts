/**
 * Best-effort ReaGate / ReaComp (Cockos) VST chunk encode/decode for RPP
 * round-trip. Chunk layout observed from Reaper 7.x project files
 * (undocumented). Prefer raw base64 for bit-identical export.
 */

export type ReaperGateParams = {
  /** Linear threshold 0..1 (ffmpeg agate). */
  threshold: number;
  attackMs: number;
  holdMs?: number;
  releaseMs: number;
  /** Closed-gate attenuation 0..1 (0 = mute). */
  range?: number;
};

export type ReaperCompParams = {
  /** Linear threshold 0..1 (ffmpeg acompressor). */
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb?: number;
  kneeDb?: number;
};

const GATE_MAGIC = Buffer.from("tger", "ascii");
/** Reverse of Cockos 4-char id "recp". */
const COMP_MAGIC = Buffer.from("pcer", "ascii");
const PARAM_MAGIC = Buffer.from([0xef, 0xbe, 0xad, 0xde, 0x0d, 0xf0, 0xad, 0xde]);
const VST_FOOTER_B64 = "AAAQAAAA";

/** ReaGate header from fixture (76 bytes); stateSize at offset 64 patched on encode. */
const GATE_HEADER_TEMPLATE = Buffer.from(
  "74676572ef5eedfe04000000010000000000000002000000000000000400000000000000080000000000000002000000010000000000000002000000000000005c0000000000000000001000",
  "hex",
);

/** Minimal ReaComp header (same layout as gate, magic pcer). */
const COMP_HEADER_TEMPLATE = Buffer.from(
  "70636572ef5eedfe04000000010000000000000002000000000000000400000000000000080000000000000002000000010000000000000002000000000000005c0000000000000000001000",
  "hex",
);

const GATE_PARAM_COUNT = 21;
const COMP_PARAM_COUNT = 21;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function stripVstFooter(b64: string): string {
  let cleaned = b64.replace(/\s+/g, "");
  if (
    cleaned.endsWith(VST_FOOTER_B64) &&
    cleaned.length > VST_FOOTER_B64.length
  ) {
    cleaned = cleaned.slice(0, -VST_FOOTER_B64.length);
  }
  return cleaned;
}

/**
 * Format Cockos dual-chunk VST (76-byte header line + param blob lines).
 * `b64` must be a single base64 encoding of header||state (not string-joined
 * per-chunk base64, which breaks on `=` padding).
 */
export function formatDualChunkVstB64Lines(b64: string): string[] {
  const cleaned = stripVstFooter(b64);
  if (!cleaned) return [];
  try {
    const buf = Buffer.from(cleaned, "base64");
    if (buf.length >= 76 + 8 && buf.subarray(76, 84).equals(PARAM_MAGIC)) {
      const headerB64 = buf.subarray(0, 76).toString("base64");
      const stateB64 = buf.subarray(76).toString("base64");
      const lines = [headerB64];
      for (let i = 0; i < stateB64.length; i += 128) {
        lines.push(stateB64.slice(i, i + 128));
      }
      lines.push(VST_FOOTER_B64);
      return lines;
    }
  } catch {
    // fall through
  }
  // Single blob fallback (80 + 128), same as ReaEQ.
  const lines: string[] = [];
  if (cleaned.length <= 80) {
    lines.push(cleaned);
  } else {
    lines.push(cleaned.slice(0, 80));
    const rest = cleaned.slice(80);
    for (let i = 0; i < rest.length; i += 128) {
      lines.push(rest.slice(i, i + 128));
    }
  }
  lines.push(VST_FOOTER_B64);
  return lines;
}

function readParamFloats(state: Buffer): number[] | null {
  if (state.length < 8 + 4) return null;
  if (!state.subarray(0, 8).equals(PARAM_MAGIC)) return null;
  const floats: number[] = [];
  for (let o = 8; o + 4 <= state.length; o += 4) {
    const v = state.readFloatLE(o);
    if (!Number.isFinite(v)) return null;
    floats.push(v);
  }
  return floats.length > 0 ? floats : null;
}

function writeParamBlock(floats: number[]): Buffer {
  const count = Math.max(GATE_PARAM_COUNT, floats.length);
  const out = Buffer.alloc(8 + count * 4);
  PARAM_MAGIC.copy(out, 0);
  for (let i = 0; i < count; i++) {
    out.writeFloatLE(floats[i] ?? 0, 8 + i * 4);
  }
  return out;
}

function splitHeaderAndState(buf: Buffer): { header: Buffer; state: Buffer } | null {
  // Dual-chunk plugins: 76-byte header then param block.
  if (buf.length >= 76 + 8 && buf.subarray(76, 84).equals(PARAM_MAGIC)) {
    return { header: buf.subarray(0, 76), state: buf.subarray(76) };
  }
  // Joined base64 may have been decoded from headerB64+stateB64 without
  // knowing sizes; try finding PARAM_MAGIC.
  const idx = buf.indexOf(PARAM_MAGIC);
  if (idx > 0 && idx + 8 < buf.length) {
    return { header: buf.subarray(0, idx), state: buf.subarray(idx) };
  }
  return null;
}

function decodeJoinedBuffer(buf: Buffer): number[] | null {
  const split = splitHeaderAndState(buf);
  if (split) return readParamFloats(split.state);
  // State-only buffer
  return readParamFloats(buf);
}

/** Decode ReaGate state (header+params base64, footer optional). */
export function decodeReaGateBase64(b64: string): ReaperGateParams | null {
  try {
    const cleaned = stripVstFooter(b64);
    if (!cleaned) return null;
    const buf = Buffer.from(cleaned, "base64");
    if (buf.length < 16) return null;
    if (buf.subarray(0, 4).equals(GATE_MAGIC) || buf.subarray(0, 8).equals(PARAM_MAGIC)) {
      const floats = decodeJoinedBuffer(buf);
      if (!floats || floats.length < 3) return null;
      const threshold = clamp(floats[0] ?? 0.125, 0.0001, 1);
      const attackMs = clamp((floats[1] ?? 0.02) * 1000, 0.01, 9000);
      const holdMs = clamp((floats[2] ?? 0) * 1000, 0, 9000);
      const releaseSec = floats[3] ?? 0;
      const releaseMs = clamp(
        releaseSec > 0 ? releaseSec * 1000 : 100,
        0.01,
        9000,
      );
      return { threshold, attackMs, holdMs, releaseMs, range: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

/** Decode ReaComp state (header+params base64, footer optional). */
export function decodeReaCompBase64(b64: string): ReaperCompParams | null {
  try {
    const cleaned = stripVstFooter(b64);
    if (!cleaned) return null;
    const buf = Buffer.from(cleaned, "base64");
    if (buf.length < 16) return null;
    if (
      buf.subarray(0, 4).equals(COMP_MAGIC) ||
      buf.subarray(0, 8).equals(PARAM_MAGIC)
    ) {
      const floats = decodeJoinedBuffer(buf);
      if (!floats || floats.length < 5) return null;
      // Best-effort layout parallel to ReaGate / common Cockos order:
      // thresh, ratio-ish, attack, release, makeup, knee...
      const threshold = clamp(floats[0] ?? 0.125, 0.0001, 1);
      let ratio = floats[1] ?? 2;
      // Some presets store ratio as normalized; if tiny, treat as attack seconds.
      let attackMs: number;
      let releaseMs: number;
      let makeupDb = 0;
      let kneeDb = 2.828;
      if (ratio > 0 && ratio <= 1.0001 && (floats[2] ?? 0) > 1) {
        // Alternate layout: thresh, attackSec, releaseSec, ratio, ...
        attackMs = clamp((floats[1] ?? 0.02) * 1000, 0.01, 2000);
        releaseMs = clamp((floats[2] ?? 0.25) * 1000, 0.01, 9000);
        ratio = clamp(floats[3] ?? 2, 1, 20);
        makeupDb = floats[4] ?? 0;
        kneeDb = floats[5] ?? 2.828;
      } else {
        ratio = clamp(ratio, 1, 20);
        attackMs = clamp((floats[2] ?? 0.02) * 1000, 0.01, 2000);
        releaseMs = clamp((floats[3] ?? 0.25) * 1000, 0.01, 9000);
        makeupDb = floats[4] ?? 0;
        kneeDb = floats[5] ?? 2.828;
      }
      return {
        threshold,
        ratio,
        attackMs,
        releaseMs,
        makeupDb,
        kneeDb: clamp(kneeDb, 1, 8),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function patchStateSize(header: Buffer, stateLen: number): Buffer {
  const out = Buffer.from(header);
  if (out.length >= 68) {
    out.writeUInt32LE(stateLen, 64);
  }
  return out;
}

function encodeDualChunk(
  headerTemplate: Buffer,
  floats: number[],
): { joinedB64: string; lines: string[] } {
  const state = writeParamBlock(floats);
  const header = patchStateSize(headerTemplate, state.length);
  const joinedB64 = Buffer.concat([header, state]).toString("base64");
  const headerB64 = header.toString("base64");
  const stateB64 = state.toString("base64");
  const lines = [headerB64];
  for (let i = 0; i < stateB64.length; i += 128) {
    lines.push(stateB64.slice(i, i + 128));
  }
  lines.push(VST_FOOTER_B64);
  return { joinedB64, lines };
}

export function encodeReaGateChunkToBase64Lines(
  gate: ReaperGateParams,
): string[] {
  const floats = new Array(GATE_PARAM_COUNT).fill(0);
  floats[0] = clamp(gate.threshold, 0.0001, 1);
  floats[1] = clamp(gate.attackMs, 0.01, 9000) / 1000;
  floats[2] = clamp(gate.holdMs ?? 0, 0, 9000) / 1000;
  floats[3] = clamp(gate.releaseMs, 0.01, 9000) / 1000;
  floats[5] = 1; // wet-ish default from fixture
  floats[10] = 1;
  floats[12] = 1;
  floats[16] = 0.5433070659637451;
  return encodeDualChunk(GATE_HEADER_TEMPLATE, floats).lines;
}

export function encodeReaGateJoinedBase64(gate: ReaperGateParams): string {
  const floats = new Array(GATE_PARAM_COUNT).fill(0);
  floats[0] = clamp(gate.threshold, 0.0001, 1);
  floats[1] = clamp(gate.attackMs, 0.01, 9000) / 1000;
  floats[2] = clamp(gate.holdMs ?? 0, 0, 9000) / 1000;
  floats[3] = clamp(gate.releaseMs, 0.01, 9000) / 1000;
  floats[5] = 1;
  floats[10] = 1;
  floats[12] = 1;
  floats[16] = 0.5433070659637451;
  return encodeDualChunk(GATE_HEADER_TEMPLATE, floats).joinedB64;
}

export function encodeReaCompChunkToBase64Lines(
  comp: ReaperCompParams,
): string[] {
  const floats = new Array(COMP_PARAM_COUNT).fill(0);
  floats[0] = clamp(comp.threshold, 0.0001, 1);
  floats[1] = clamp(comp.ratio, 1, 20);
  floats[2] = clamp(comp.attackMs, 0.01, 2000) / 1000;
  floats[3] = clamp(comp.releaseMs, 0.01, 9000) / 1000;
  floats[4] = comp.makeupDb ?? 0;
  floats[5] = clamp(comp.kneeDb ?? 2.828, 1, 8);
  floats[10] = 1;
  floats[12] = 1;
  return encodeDualChunk(COMP_HEADER_TEMPLATE, floats).lines;
}

export function encodeReaCompJoinedBase64(comp: ReaperCompParams): string {
  const floats = new Array(COMP_PARAM_COUNT).fill(0);
  floats[0] = clamp(comp.threshold, 0.0001, 1);
  floats[1] = clamp(comp.ratio, 1, 20);
  floats[2] = clamp(comp.attackMs, 0.01, 2000) / 1000;
  floats[3] = clamp(comp.releaseMs, 0.01, 9000) / 1000;
  floats[4] = comp.makeupDb ?? 0;
  floats[5] = clamp(comp.kneeDb ?? 2.828, 1, 8);
  floats[10] = 1;
  floats[12] = 1;
  return encodeDualChunk(COMP_HEADER_TEMPLATE, floats).joinedB64;
}

/**
 * Join rppp VST b64Chunks into one base64 blob of concatenated decoded bytes.
 * Drop AAAQAAAA footer. Do not string-concatenate chunk base64 (padding breaks
 * decode for dual-chunk plugins like ReaGate).
 */
export function joinVstStateChunks(chunks: unknown[]): string | null {
  const parts = chunks.filter((c): c is string => typeof c === "string");
  if (parts.length === 0) return null;
  const stateParts =
    parts.length >= 2 && parts[parts.length - 1] === VST_FOOTER_B64
      ? parts.slice(0, -1)
      : parts;
  try {
    const bufs = stateParts.map((p) => Buffer.from(p.replace(/\s+/g, ""), "base64"));
    const joined = Buffer.concat(bufs);
    if (joined.length === 0) return null;
    return joined.toString("base64");
  } catch {
    return null;
  }
}

export function buildGateFilterParts(
  gate: ReaperGateParams | undefined,
): string[] {
  if (!gate) return [];
  const threshold = clamp(gate.threshold, 0.0001, 1);
  const attack = clamp(gate.attackMs, 0.01, 9000);
  const release = clamp(gate.releaseMs, 0.01, 9000);
  const range = clamp(gate.range ?? 0, 0, 1);
  return [
    `agate=threshold=${threshold.toFixed(6)}:attack=${attack.toFixed(3)}:release=${release.toFixed(3)}:range=${range.toFixed(6)}`,
  ];
}

export function buildCompFilterParts(
  comp: ReaperCompParams | undefined,
): string[] {
  if (!comp) return [];
  const threshold = clamp(comp.threshold, 0.0001, 1);
  const ratio = clamp(comp.ratio, 1, 20);
  const attack = clamp(comp.attackMs, 0.01, 2000);
  const release = clamp(comp.releaseMs, 0.01, 9000);
  const makeupLinear =
    typeof comp.makeupDb === "number" && Number.isFinite(comp.makeupDb)
      ? Math.pow(10, comp.makeupDb / 20)
      : 1;
  const knee = clamp(comp.kneeDb ?? 2.828, 1, 8);
  return [
    `acompressor=threshold=${threshold.toFixed(6)}:ratio=${ratio.toFixed(3)}:attack=${attack.toFixed(3)}:release=${release.toFixed(3)}:makeup=${clamp(makeupLinear, 1, 64).toFixed(4)}:knee=${knee.toFixed(3)}`,
  ];
}
