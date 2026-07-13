import { useRef, useEffect, useCallback } from 'react';
import {
  isInTrimRange,
  getTrimmedDuration,
  toEffectiveTime,
  toActualTime,
} from './waveformUtils';
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

export interface WaveformMarker {
  time: number;
  title?: string;
  color?: string;
}

export interface WaveformCanvasProps {
  data: WaveformData;
  durationSec: number;
  currentTime: number;
  /** Visible time window. When provided, only this range is drawn. */
  viewStartSec?: number;
  viewEndSec?: number;
  /** Trim ranges [start, end] in seconds - these sections are not drawn. */
  trimRanges?: Array<[number, number]>;
  /** Chapter markers; time in seconds. Rendered as vertical lines when present. */
  markers?: WaveformMarker[];
  onSeek: (timeSec: number) => void;
  onPlayPause?: () => void;
  className?: string;
}

const WAVEFORM_HEIGHT = 32;
const MIN_BAR_WIDTH_PX = 3; // With few samples (e.g. 6/sec), bars stay visible

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

export function WaveformCanvas({ data, durationSec, currentTime, viewStartSec = 0, viewEndSec, trimRanges = [], markers = [], onSeek, onPlayPause, className }: WaveformCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewEnd = viewEndSec ?? durationSec;
  const viewWindow = Math.max(0.01, viewEnd - viewStartSec);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !data.data.length) return;

    const bits = data.bits ?? 8;
    const channels = Math.max(1, data.channels ?? 1);
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
    const bgColor = getThemeColor('--bg-elevated', '#1e293b');
    const accentColor = getThemeColor('--accent', '#0ea5e9');
    const mutedColor = getThemeColor('--text-muted', '#94a3b8');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const effectiveDuration = durationSec - getTrimmedDuration(trimRanges);
    const useCollapsed = trimRanges.length > 0 && effectiveDuration > 0;

    const timeToX = (t: number) => {
      if (useCollapsed) {
        const eff = toEffectiveTime(t, trimRanges);
        return (eff / effectiveDuration) * width;
      }
      return ((t - viewStartSec) / viewWindow) * width;
    };

    for (let i = 0; i < pairsPerChannel; i++) {
      const time = (i / pairsPerChannel) * durationSec;
      if (time < viewStartSec - 0.001 || time > viewEnd + 0.001) continue;
      if (useCollapsed && isInTrimRange(time, trimRanges)) continue;

      const base = i * 2 * channels;
      const min = data.data[base] ?? 0;
      const max = data.data[base + 1] ?? 0;
      const nMin = min / scale;
      const nMax = max / scale;
      const x = timeToX(time);
      let drawWidth: number;
      if (useCollapsed) {
        let nextI = i + 1;
        while (nextI < pairsPerChannel && isInTrimRange((nextI / pairsPerChannel) * durationSec, trimRanges)) nextI++;
        const nextTime = nextI < pairsPerChannel ? (nextI / pairsPerChannel) * durationSec : durationSec;
        const nextX = nextI < pairsPerChannel ? timeToX(nextTime) : width;
        drawWidth = Math.max(MIN_BAR_WIDTH_PX, (nextX - x) + 0.5);
      } else {
        const nextTime = ((i + 1) / pairsPerChannel) * durationSec;
        const nextX = timeToX(nextTime);
        drawWidth = Math.max(MIN_BAR_WIDTH_PX, (nextX - x) + 0.5);
      }

      const topY = halfH - nMax * halfH;
      const bottomY = halfH - nMin * halfH;
      const barTop = Math.min(topY, bottomY);
      const barHeight = Math.max(1, Math.abs(bottomY - topY));

      const isPlayed = time <= currentTime;
      ctx.fillStyle = isPlayed ? accentColor : mutedColor;
      ctx.fillRect(x, barTop, drawWidth, barHeight);
    }

    const headX = timeToX(currentTime);
    if (headX >= -2 && headX <= width + 2) {
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(headX, 0);
      ctx.lineTo(headX, height);
      ctx.stroke();
    }
  }, [data, durationSec, currentTime, viewStartSec, viewEnd, viewWindow, trimRanges]);

  useEffect(() => {
    draw();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek) return;
    const container = containerRef.current;
    if (!container || durationSec <= 0) return;
    const rect = container.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const effectiveDuration = durationSec - getTrimmedDuration(trimRanges);
    const useCollapsed = trimRanges.length > 0 && effectiveDuration > 0;
    const time = useCollapsed
      ? toActualTime(frac * effectiveDuration, trimRanges, durationSec)
      : viewStartSec + frac * viewWindow;
    onSeek(Math.max(0, Math.min(durationSec, time)));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== ' ' || !onPlayPause) return;
    e.preventDefault();
    onPlayPause();
  }

  const markersList = markers ?? [];

  return (
    <div
      ref={containerRef}
      className={className ?? styles.waveformTrack}
      style={{ position: 'relative' }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="progressbar"
      aria-valuenow={Math.round(currentTime)}
      aria-valuemin={0}
      aria-valuemax={durationSec}
      aria-label={'Playback position'}
    >
      <canvas ref={canvasRef} className={styles.waveformCanvas} />
      {markersList.length > 0 &&
        markersList.map((m, i) => (
          <div
            key={`${m.time}-${i}`}
            className={styles.timelineMarker}
            style={{
              left: durationSec > 0 ? `${(m.time / durationSec) * 100}%` : 0,
              background: m.color ?? '#3b82f6',
            }}
            title={m.title ?? `Marker at ${m.time.toFixed(1)}s`}
          />
        ))}
    </div>
  );
}
