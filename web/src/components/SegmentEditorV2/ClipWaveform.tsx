import { useEffect, useRef } from 'react';
import type { WaveformData } from '../../pages/EpisodeEditor/WaveformCanvas';
import styles from '../../pages/EpisodeEditor.module.css';

/** Estimate take duration from audiowaveform JSON. */
function takeDurationSecFromWaveform(data: WaveformData): number {
  const pairs = data.length > 0 ? data.length : Math.floor((data.data?.length ?? 0) / 2);
  const spp = data.samples_per_pixel ?? 0;
  const sr = data.sample_rate ?? 0;
  if (pairs > 0 && spp > 0 && sr > 0) {
    return (pairs * spp) / sr;
  }
  return 0;
}

type ClipWaveformProps = {
  data: WaveformData;
  /** Source in-point on the take (seconds). */
  sourceStartSec: number;
  /** Source out-point on the take (seconds). */
  sourceEndSec: number;
};

/** Draws the take waveform slice that a clip plays. */
export function ClipWaveform({ data, sourceStartSec, sourceEndSec }: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const w = Math.max(1, Math.floor(parent.clientWidth));
      const h = Math.max(1, Math.floor(parent.clientHeight));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const raw = data.data;
      if (!Array.isArray(raw) || raw.length < 2) return;
      const pairs = data.length > 0 ? data.length : Math.floor(raw.length / 2);
      const takeDur = takeDurationSecFromWaveform(data);
      if (takeDur <= 0 || pairs <= 0) return;

      const startSec = Math.max(0, sourceStartSec);
      const endSec = Math.max(startSec + 0.001, sourceEndSec);
      const startPair = Math.max(0, Math.floor((startSec / takeDur) * pairs));
      const endPair = Math.min(pairs, Math.ceil((endSec / takeDur) * pairs));
      const span = Math.max(1, endPair - startPair);

      ctx.strokeStyle = 'rgba(0, 212, 170, 0.95)';
      ctx.lineWidth = 1;
      const mid = h / 2;
      // Match WaveformCanvas signed scaling; keep peaks ~half of lane height.
      const bits = data.bits ?? 8;
      const scale = 2 ** (bits - 1);
      const amp = h * 0.22;

      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const pair = startPair + Math.floor((x / w) * span);
        const i = pair * 2;
        if (i + 1 >= raw.length) break;
        let minV = raw[i]! / scale;
        let maxV = raw[i + 1]! / scale;
        if (minV > maxV) {
          const tmp = minV;
          minV = maxV;
          maxV = tmp;
        }
        const y0 = Math.min(h - 1, Math.max(0, mid - maxV * amp));
        const y1 = Math.min(h - 1, Math.max(0, mid - minV * amp));
        ctx.moveTo(x + 0.5, y0);
        ctx.lineTo(x + 0.5, y1);
      }
      ctx.stroke();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [data, sourceStartSec, sourceEndSec]);

  return <canvas className={styles.segmentEditorV2ClipWave} aria-hidden ref={canvasRef} />;
}
