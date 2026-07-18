/**
 * Best-effort ReaEQ (Cockos) VST chunk encode/decode for RPP round-trip.
 * Chunk layout observed from Reaper 7.x project files (undocumented).
 */

export type ReaperEqBandType =
  | "hipass"
  | "loshelf"
  | "band"
  | "notch"
  | "hishelf"
  | "lopass"
  | "bandpass";

export type ReaperEqBand = {
  type: ReaperEqBandType;
  freqHz: number;
  gainDb: number;
  q: number;
  enabled?: boolean;
};

const MAGIC = Buffer.from("qeer", "ascii");
const BAND_SIZE = 33;
const BANDS_OFFSET = 76;
const BAND_COUNT_OFFSET = 64;

/** File-format type byte → our band type (byte 1 of the 9-byte meta trailer). */
const TYPE_FROM_BYTE: Record<number, ReaperEqBandType> = {
  0: "hipass",
  1: "loshelf",
  2: "band",
  3: "notch",
  4: "hishelf",
  5: "lopass",
  6: "bandpass",
  7: "bandpass",
  8: "band",
};

const TYPE_TO_BYTE: Record<ReaperEqBandType, number> = {
  hipass: 0,
  loshelf: 1,
  band: 2,
  notch: 3,
  hishelf: 4,
  lopass: 5,
  bandpass: 6,
};

/** Minimal valid header prefix (bytes 0..75) from a Reaper 7 ReaEQ chunk. */
const HEADER_TEMPLATE = Buffer.from(
  "71656572ee5eedfe02000000010000000000000002000000000000000200000001000000000000000200000000000000cd000000010000000000100021000000050000000000000001000000",
  "hex",
);

function linearGainToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return 0;
  return (20 * Math.log10(linear) * 1000) / 1000;
}

function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

/**
 * Decode a ReaEQ VST state buffer into bands.
 * Returns null if the chunk is not a recognizable ReaEQ blob.
 */
export function decodeReaEqChunk(buf: Buffer): ReaperEqBand[] | null {
  if (buf.length < BANDS_OFFSET + BAND_SIZE) return null;
  if (!buf.subarray(0, 4).equals(MAGIC)) return null;

  const count = buf.readUInt32LE(BAND_COUNT_OFFSET);
  if (count <= 0 || count > 64) return null;
  if (buf.length < BANDS_OFFSET + count * BAND_SIZE) return null;

  const bands: ReaperEqBand[] = [];
  for (let i = 0; i < count; i++) {
    const o = BANDS_OFFSET + i * BAND_SIZE;
    const freqHz = buf.readDoubleLE(o);
    const linearGain = buf.readDoubleLE(o + 8);
    const q = buf.readDoubleLE(o + 16);
    const typeByte = buf[o + 25] ?? 2;
    const enabledFlag = buf[o + 29] ?? 1;
    if (!Number.isFinite(freqHz) || freqHz <= 0 || freqHz > 96000) continue;
    if (!Number.isFinite(q) || q <= 0) continue;
    const type = TYPE_FROM_BYTE[typeByte] ?? "band";
    bands.push({
      type,
      freqHz,
      gainDb: linearGainToDb(linearGain),
      q,
      enabled: enabledFlag !== 0,
    });
  }
  return bands.length > 0 ? bands : null;
}

/** Encode bands into a ReaEQ VST state buffer Reaper can load. */
export function encodeReaEqChunk(bands: ReaperEqBand[]): Buffer {
  const active = bands.filter(
    (b) =>
      Number.isFinite(b.freqHz) &&
      b.freqHz > 0 &&
      Number.isFinite(b.q) &&
      b.q > 0,
  );
  const count = Math.max(1, Math.min(64, active.length || 1));
  const out = Buffer.alloc(BANDS_OFFSET + count * BAND_SIZE);
  HEADER_TEMPLATE.copy(out, 0, 0, Math.min(HEADER_TEMPLATE.length, BANDS_OFFSET));
  out.writeUInt32LE(count, BAND_COUNT_OFFSET);

  for (let i = 0; i < count; i++) {
    const b =
      active[i] ??
      ({
        type: "band",
        freqHz: 1000,
        gainDb: 0,
        q: 2,
        enabled: false,
      } satisfies ReaperEqBand);
    const o = BANDS_OFFSET + i * BAND_SIZE;
    out.writeDoubleLE(b.freqHz, o);
    out.writeDoubleLE(dbToLinearGain(b.gainDb ?? 0), o + 8);
    out.writeDoubleLE(b.q, o + 16);
    out[o + 24] = 1;
    out[o + 25] = TYPE_TO_BYTE[b.type] ?? 2;
    out[o + 26] = 0;
    out[o + 27] = 0;
    out[o + 28] = 0;
    out[o + 29] = b.enabled === false ? 0 : 1;
    out[o + 30] = 0;
    out[o + 31] = 0;
    out[o + 32] = 0;
  }
  return out;
}

/**
 * Base64 lines as Reaper / rppp write inside a VST block:
 * 80-char first line, then 128-char lines, then AAAQAAAA footer.
 */
export function encodeReaEqChunkToBase64Lines(bands: ReaperEqBand[]): string[] {
  const b64 = encodeReaEqChunk(bands).toString("base64");
  const lines: string[] = [];
  if (b64.length <= 80) {
    lines.push(b64);
  } else {
    lines.push(b64.slice(0, 80));
    const rest = b64.slice(80);
    for (let i = 0; i < rest.length; i += 128) {
      lines.push(rest.slice(i, i + 128));
    }
  }
  lines.push("AAAQAAAA");
  return lines;
}

export function decodeReaEqBase64(b64: string): ReaperEqBand[] | null {
  try {
    let cleaned = b64.replace(/\s+/g, "");
    if (!cleaned) return null;
    // Drop Reaper's trailing VST size footer (e.g. AAAQAAAA) after = padding.
    const pad = cleaned.match(/=+(.*)$/);
    if (pad && pad[1] && /^[A-Za-z0-9+/]+$/.test(pad[1])) {
      cleaned = cleaned.slice(0, cleaned.length - pad[1].length);
    }
    return decodeReaEqChunk(Buffer.from(cleaned, "base64"));
  } catch {
    return null;
  }
}

/** Build ffmpeg filter fragments for eqBands (empty if none / all flat). */
export function buildEqFilterParts(bands: ReaperEqBand[] | undefined): string[] {
  if (!bands || bands.length === 0) return [];
  const parts: string[] = [];
  for (const b of bands) {
    if (b.enabled === false) continue;
    const f = Math.min(20000, Math.max(20, b.freqHz));
    const q = Math.min(100, Math.max(0.01, b.q));
    const g = b.gainDb ?? 0;
    switch (b.type) {
      case "hipass":
        parts.push(`highpass=f=${f.toFixed(2)}:poles=2`);
        break;
      case "lopass":
        parts.push(`lowpass=f=${f.toFixed(2)}:poles=2`);
        break;
      case "loshelf":
        if (Math.abs(g) < 0.05) break;
        parts.push(
          `equalizer=f=${f.toFixed(2)}:width_type=q:width=${q.toFixed(3)}:g=${g.toFixed(3)}`,
        );
        // ffmpeg has bass= for shelf-ish; equalizer is acceptable approximation
        break;
      case "hishelf":
        if (Math.abs(g) < 0.05) break;
        parts.push(
          `equalizer=f=${f.toFixed(2)}:width_type=q:width=${q.toFixed(3)}:g=${g.toFixed(3)}`,
        );
        break;
      case "notch":
        parts.push(
          `equalizer=f=${f.toFixed(2)}:width_type=q:width=${q.toFixed(3)}:g=${(-Math.abs(g) || -20).toFixed(3)}`,
        );
        break;
      case "bandpass":
        parts.push(`bandpass=f=${f.toFixed(2)}:width_type=q:width=${q.toFixed(3)}`);
        break;
      case "band":
      default:
        if (Math.abs(g) < 0.05) break;
        parts.push(
          `equalizer=f=${f.toFixed(2)}:width_type=q:width=${q.toFixed(3)}:g=${g.toFixed(3)}`,
        );
        break;
    }
  }
  return parts;
}
