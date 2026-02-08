import { useRef, useEffect, useCallback } from 'react';
import styles from '../EpisodeEditor.module.css';

/** Audiowaveform v2 JSON: data is interleaved [min, max, min, max, ...] per pixel; 8-bit values. */
export interface WaveformData {
  version?: number;
  channels?: number;
  sample_rate?: number;
  samples_per_pixel?: number;
  bits?: number;
  length: number;
  data: number[];
}

export interface WaveformCanvasProps {
  data: WaveformData;
  durationSec: number;
  currentTime: number;
  onSeek: (timeSec: number) => void;
  className?: string;
}

const WAVEFORM_HEIGHT = 32;
const MIN_BAR_WIDTH_PX = 3; // With few samples (e.g. 4/sec), bars stay visible

/** 8-bit signed: -128..127. Scale so full range maps to ±halfHeight. */
function getScale(bits: number): number {
  return 2 ** (bits - 1);
}

/** Canvas 2D doesn't resolve CSS variables; read computed color from the document. */
function getThemeColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

export function WaveformCanvas({ data, durationSec, currentTime, onSeek, className }: WaveformCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !data.data.length) return;

    const bits = data.bits ?? 8;
    const channels = Math.max(1, data.channels ?? 1);
    /** Length = number of min/max pairs per channel; data is interleaved [min,max] per index per channel. */
    const pairsPerChannel = typeof data.length === 'number' && data.length >= 0
      ? data.length
      : Math.floor(data.data.length / (2 * channels));
    if (pairsPerChannel <= 0) return;

    const scale = getScale(bits);
    const dpr = window.devicePixelRatio ?? 1;
    const width = container.clientWidth;
    const height = WAVEFORM_HEIGHT;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    const halfH = height / 2;
    const barWidth = width / pairsPerChannel;
    const drawWidth = Math.max(MIN_BAR_WIDTH_PX, barWidth + 0.5);
    const progress = durationSec > 0 ? Math.min(1, Math.max(0, currentTime / durationSec)) : 0;

    // Canvas 2D doesn't resolve var(--x); use computed theme colors
    const bgColor = getThemeColor('--bg-elevated', '#1e293b');
    const accentColor = getThemeColor('--accent', '#0ea5e9');
    const mutedColor = getThemeColor('--text-muted', '#94a3b8');

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Waveform: one bar per index; for multi-channel we use channel 0 (first min/max per index)
    for (let i = 0; i < pairsPerChannel; i++) {
      const base = i * 2 * channels;
      const min = data.data[base] ?? 0;
      const max = data.data[base + 1] ?? 0;
      const nMin = min / scale;
      const nMax = max / scale;
      const x = (i / pairsPerChannel) * width;
      // Canvas y: 0 = top. Center at halfH. Normalized +1 = top, -1 = bottom.
      const topY = halfH - nMax * halfH;
      const bottomY = halfH - nMin * halfH;
      const barTop = Math.min(topY, bottomY);
      const barHeight = Math.max(1, Math.abs(bottomY - topY));

      const isPlayed = (i / pairsPerChannel) <= progress;
      ctx.fillStyle = isPlayed ? accentColor : mutedColor;
      ctx.fillRect(x, barTop, drawWidth, barHeight);
    }

    // Playhead line
    const headX = progress * width;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(headX, 0);
    ctx.lineTo(headX, height);
    ctx.stroke();
  }, [data, durationSec, currentTime]);

  useEffect(() => {
    draw();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container || durationSec <= 0) return;
    const rect = container.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac * durationSec);
  }

  return (
    <div
      ref={containerRef}
      className={className ?? styles.waveformTrack}
      onClick={handleClick}
      role="progressbar"
      aria-valuenow={Math.round(currentTime)}
      aria-valuemin={0}
      aria-valuemax={durationSec}
      aria-label="Playback position"
    >
      <canvas ref={canvasRef} className={styles.waveformCanvas} />
    </div>
  );
}
