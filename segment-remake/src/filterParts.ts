/** ffmpeg filter fragments for track-level EQ / gate / compressor. */

export type RemakeEqBandType =
  | "hipass"
  | "loshelf"
  | "band"
  | "notch"
  | "hishelf"
  | "lopass"
  | "bandpass";

export type RemakeEqBand = {
  type: RemakeEqBandType;
  freqHz: number;
  gainDb: number;
  q: number;
  enabled?: boolean;
};

export type RemakeGateParams = {
  threshold: number;
  attackMs: number;
  holdMs?: number;
  releaseMs: number;
  range?: number;
};

export type RemakeCompParams = {
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb?: number;
  kneeDb?: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function buildEqFilterParts(bands: RemakeEqBand[] | undefined): string[] {
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
        parts.push(
          `bandpass=f=${f.toFixed(2)}:width_type=q:width=${q.toFixed(3)}`,
        );
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

export function buildGateFilterParts(
  gate: RemakeGateParams | undefined,
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
  comp: RemakeCompParams | undefined,
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
