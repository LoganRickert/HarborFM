import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Upload, ImageIcon } from 'lucide-react';
import {
  startGenerateVideo,
  getVideoStatus,
  uploadEpisodeVideoCover,
  getVideoCoverUrl,
} from '../../api/segments';
import type { VideoResolution, VideoOrientation, VideoWaveformType } from '@harborfm/shared';
import styles from '../EpisodeEditor.module.css';

const RESOLUTIONS: { value: VideoResolution; label: string }[] = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];

const WAVEFORM_TYPES: { value: VideoWaveformType; label: string }[] = [
  { value: 'sine', label: 'Sine' },
  { value: 'bars', label: 'Bars' },
  { value: 'circle', label: 'Circle' },
  { value: 'dots', label: 'Dots' },
];

const DEFAULT_BOX = { x: 0.25, y: 0.375, width: 0.5, height: 0.25 };
const MIN_BOX_SIZE = 0.05;

export interface GenerateVideoModalProps {
  episodeId: string;
  onClose: () => void;
  /** Episode artwork URL for fallback background when no cover uploaded. */
  artworkUrl?: string | null;
  /** Called when video is generated so parent can close modal. */
  onSuccess?: () => void;
}

export function GenerateVideoModal({
  episodeId,
  onClose,
  artworkUrl,
  onSuccess,
}: GenerateVideoModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [resolution, setResolution] = useState<VideoResolution>('720p');
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [useLastThumbnail, setUseLastThumbnail] = useState(false);
  const [hasVideoCover, setHasVideoCover] = useState(false);

  const [waveformType, setWaveformType] = useState<VideoWaveformType>('sine');
  const [color, setColor] = useState('#ffffff');
  const [thickness, setThickness] = useState(5);
  const [box, setBox] = useState(DEFAULT_BOX);

  const [submitted, setSubmitted] = useState(false);
  const [dragHandle, setDragHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | 'move' | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; box: typeof DEFAULT_BOX } | null>(null);

  useEffect(() => {
    setStep(1);
    setSubmitted(false);
    setCoverFile(null);
    setUseLastThumbnail(false);
    setResolution('720p');
    setOrientation('landscape');
    setWaveformType('sine');
    setColor('#ffffff');
    setThickness(5);
    setBox(DEFAULT_BOX);
    setDragHandle(null);
    setDragStart(null);
  }, [episodeId]);

  useEffect(() => {
    if (step === 1 && (hasVideoCover || artworkUrl) && !coverFile) {
      setUseLastThumbnail(true);
    }
  }, [step, hasVideoCover, artworkUrl, coverFile]);

  useEffect(() => {
    if (waveformType === 'sine' || waveformType === 'circle') {
      setThickness((t) => Math.max(1, Math.min(8, t)));
    }
  }, [waveformType]);

  const { data: videoStatus } = useQuery({
    queryKey: ['video-status', episodeId],
    queryFn: () => getVideoStatus(episodeId),
    enabled: true,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'generating' ? 1500 : false;
    },
  });

  const [coverObjectUrl, setCoverObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!coverFile) {
      setCoverObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const backgroundImageUrl = useMemo(() => {
    if (coverObjectUrl) return coverObjectUrl;
    if (useLastThumbnail && hasVideoCover) return getVideoCoverUrl(episodeId);
    if (useLastThumbnail && artworkUrl) return artworkUrl ?? '';
    return artworkUrl ?? '';
  }, [coverObjectUrl, useLastThumbnail, hasVideoCover, episodeId, artworkUrl]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (coverFile) {
        await uploadEpisodeVideoCover(episodeId, coverFile);
      }
      return startGenerateVideo(episodeId, {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        width: box.width,
        amplitude: box.height,
        resolution,
        orientation,
        waveformType,
        color,
        strokeWidth: thickness,
      });
    },
    onSuccess: (result) => {
      if (result.status === 'generating' || result.status === 'already_generating') {
        queryClient.setQueryData(['video-status', episodeId], { status: 'generating' as const });
        setSubmitted(true);
        onSuccess?.();
        onClose();
      }
    },
  });

  const isGenerating = submitted && videoStatus?.status === 'generating';
  const errorMessage =
    videoStatus?.error ??
    (generateMutation.error != null
      ? generateMutation.error instanceof Error
        ? generateMutation.error.message
        : String(generateMutation.error)
      : null);

  const handleNext = () => {
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
    setWaveformType('sine');
    setColor('#ffffff');
    setThickness(5);
    setBox(DEFAULT_BOX);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    generateMutation.mutate();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSubmitted(false);
      queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
      onSuccess?.();
      onClose();
    }
  };

  const clampBox = useCallback((b: typeof box) => ({
    x: Math.max(0, Math.min(1 - b.width, b.x)),
    y: Math.max(0, Math.min(1 - b.height, b.y)),
    width: Math.max(MIN_BOX_SIZE, Math.min(1, b.width)),
    height: Math.max(MIN_BOX_SIZE, Math.min(1, b.height)),
  }), []);

  const handleCanvasPointerDown = (e: React.PointerEvent, handle: 'nw' | 'ne' | 'sw' | 'se' | 'move') => {
    e.preventDefault();
    if (handle !== 'move') e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY, box: { ...box } });
  };

  useEffect(() => {
    if (dragHandle == null || dragStart == null) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const el = canvasRef.current;
      if (!el) return;
      const dx = (e.clientX - dragStart.x) / el.offsetWidth;
      const dy = (e.clientY - dragStart.y) / el.offsetHeight;
      if (dragHandle === 'move') {
        setBox(clampBox({
          ...dragStart.box,
          x: dragStart.box.x + dx,
          y: dragStart.box.y + dy,
        }));
      } else {
        let { x, y, width, height } = dragStart.box;
        if (dragHandle === 'nw') {
          x += dx; y += dy; width -= dx; height -= dy;
        } else if (dragHandle === 'ne') {
          y += dy; width += dx; height -= dy;
        } else if (dragHandle === 'sw') {
          x += dx; width -= dx; height += dy;
        } else {
          width += dx; height += dy;
        }
        if (width < MIN_BOX_SIZE) { x = x + width - MIN_BOX_SIZE; width = MIN_BOX_SIZE; }
        if (height < MIN_BOX_SIZE) { y = y + height - MIN_BOX_SIZE; height = MIN_BOX_SIZE; }
        setBox(clampBox({ x, y, width, height }));
      }
    };
    const onUp = () => {
      setDragHandle(null);
      setDragStart(null);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragHandle, dragStart, clampBox]);

  const aspectRatio =
    orientation === 'portrait'
      ? 9 / 16
      : 16 / 9;

  return (
    <Dialog.Root open onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable} ${styles.generateVideoWizard}`}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Generate Video Version</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={isGenerating}
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {step === 1 && (
            <div className={styles.generateVideoStep}>
              <div className={styles.generateVideoField}>
                <span className={styles.generateVideoLabel}>Resolution</span>
                <div className={styles.generateVideoPills}>
                  {RESOLUTIONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      className={resolution === r.value ? styles.generateVideoPillActive : styles.generateVideoPill}
                      onClick={() => setResolution(r.value)}
                      disabled={isGenerating}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.generateVideoField}>
                <span className={styles.generateVideoLabel}>Orientation</span>
                <div className={styles.generateVideoOrientation}>
                  <button
                    type="button"
                    className={orientation === 'landscape' ? styles.generateVideoOrientationActive : styles.generateVideoOrientationBtn}
                    onClick={() => setOrientation('landscape')}
                    disabled={isGenerating}
                    aria-pressed={orientation === 'landscape'}
                  >
                    <span className={styles.generateVideoOrientationPreview} style={{ aspectRatio: '16/9', width: '2.5rem' }} />
                    <span>Landscape</span>
                  </button>
                  <button
                    type="button"
                    className={orientation === 'portrait' ? styles.generateVideoOrientationActive : styles.generateVideoOrientationBtn}
                    onClick={() => setOrientation('portrait')}
                    disabled={isGenerating}
                    aria-pressed={orientation === 'portrait'}
                  >
                    <span className={styles.generateVideoOrientationPreview} style={{ aspectRatio: '9/16', width: '1.5rem' }} />
                    <span>Portrait</span>
                  </button>
                </div>
              </div>
              <div className={styles.generateVideoField}>
                <span className={styles.generateVideoLabel}>Thumbnail</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setCoverFile(f);
                    if (f) setUseLastThumbnail(false);
                  }}
                />
                <button
                  type="button"
                  className={styles.episodeTranscriptUploadBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  aria-label="Upload thumbnail"
                >
                  <Upload size={18} strokeWidth={2} aria-hidden />
                  {coverFile ? coverFile.name : 'Upload thumbnail'}
                </button>
              </div>
              {(hasVideoCover || artworkUrl) && (
                <div className={`${styles.generateVideoField} ${styles.generateVideoThumbnailField}`}>
                  <span className={styles.generateVideoLabel}>
                    {hasVideoCover ? 'Or use last thumbnail' : 'Or use episode artwork'}
                  </span>
                  <button
                    type="button"
                    className={`${styles.generateVideoThumbnailCard} ${useLastThumbnail && !coverFile ? styles.generateVideoThumbnailCardActive : ''}`}
                    onClick={() => {
                      setUseLastThumbnail(!!hasVideoCover);
                      setCoverFile(null);
                    }}
                    disabled={isGenerating}
                  >
                    {hasVideoCover ? (
                      <img
                        src={getVideoCoverUrl(episodeId, Date.now())}
                        alt="Last video cover"
                        className={styles.generateVideoThumbnailImg}
                        onLoad={() => setHasVideoCover(true)}
                        onError={() => setHasVideoCover(false)}
                      />
                    ) : artworkUrl ? (
                      <img src={artworkUrl} alt="Episode artwork" className={styles.generateVideoThumbnailImg} />
                    ) : null}
                    {!hasVideoCover && artworkUrl && <span className={styles.generateVideoThumbnailFallback}>Episode artwork</span>}
                  </button>
                </div>
              )}
              <div className={styles.generateVideoLastThumbnailRef} aria-hidden>
                <img
                  src={getVideoCoverUrl(episodeId)}
                  alt=""
                  onLoad={() => {
                    setHasVideoCover(true);
                    setUseLastThumbnail(true);
                  }}
                  onError={() => setHasVideoCover(false)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className={styles.generateVideoStep}>
              {errorMessage && (
                <p className={styles.error} role="alert" style={{ marginTop: 0 }}>
                  {errorMessage}
                </p>
              )}
              <div className={styles.generateVideoField}>
                <span className={styles.generateVideoLabel}>Waveform type</span>
                <div className={styles.generateVideoPills}>
                  {WAVEFORM_TYPES.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      className={waveformType === w.value ? styles.generateVideoPillActive : styles.generateVideoPill}
                      onClick={() => setWaveformType(w.value)}
                      disabled={isGenerating}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.generateVideoFieldRow}>
                <div className={styles.generateVideoField}>
                  <label htmlFor="generate-video-color">Color</label>
                  <input
                    id="generate-video-color"
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="#fff, rgba(0,0,0,0.5)"
                    disabled={isGenerating}
                    className={styles.generateVideoHexInput}
                  />
                </div>
                <div className={styles.generateVideoField}>
                  <label htmlFor="generate-video-thickness">
                    {waveformType === 'bars' || waveformType === 'dots'
                      ? 'Count (1–30)'
                      : 'Thickness (1–8 px)'}
                  </label>
                  <input
                    id="generate-video-thickness"
                    type="number"
                    min={waveformType === 'sine' || waveformType === 'circle' ? 1 : 1}
                    max={waveformType === 'sine' || waveformType === 'circle' ? 8 : 30}
                    step={1}
                    value={thickness}
                    onChange={(e) => setThickness(Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)))}
                    disabled={isGenerating}
                  />
                </div>
              </div>
              <div className={styles.generateVideoField}>
                <span className={styles.generateVideoLabel}>Position & size</span>
                <div className={styles.generateVideoCanvasWrap}>
                  <div
                    ref={canvasRef}
                    className={styles.generateVideoCanvas}
                  style={{
                    aspectRatio: String(aspectRatio),
                    ...(orientation === 'portrait' && { maxWidth: 'calc(280px * 9 / 16)' }),
                  }}
                >
                  {backgroundImageUrl && (
                    <img
                      src={backgroundImageUrl}
                      alt=""
                      className={styles.generateVideoCanvasBg}
                    />
                  )}
                  {!backgroundImageUrl && (
                    <div className={styles.generateVideoCanvasPlaceholder}>
                      <ImageIcon size={32} strokeWidth={1.5} aria-hidden />
                      <span>Background from step 1</span>
                    </div>
                  )}
                  <div
                    className={styles.generateVideoBox}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
                    onPointerDown={(e) => handleCanvasPointerDown(e, 'move')}
                  >
                    <div
                      className={`${styles.generateVideoBoxHandle} ${styles.generateVideoBoxHandleNw}`}
                      onPointerDown={(e) => handleCanvasPointerDown(e, 'nw')}
                    />
                    <div
                      className={`${styles.generateVideoBoxHandle} ${styles.generateVideoBoxHandleNe}`}
                      onPointerDown={(e) => handleCanvasPointerDown(e, 'ne')}
                    />
                    <div
                      className={`${styles.generateVideoBoxHandle} ${styles.generateVideoBoxHandleSw}`}
                      onPointerDown={(e) => handleCanvasPointerDown(e, 'sw')}
                    />
                    <div
                      className={`${styles.generateVideoBoxHandle} ${styles.generateVideoBoxHandleSe}`}
                      onPointerDown={(e) => handleCanvasPointerDown(e, 'se')}
                    />
                    <div className={styles.generateVideoWaveformPreview}>
                      <WaveformPreview type={waveformType} color={color} thickness={thickness} />
                    </div>
                  </div>
                </div>
                </div>
              </div>

              {isGenerating && (
                <p className={styles.generateVideoStatus} role="status">
                  Generating video…
                </p>
              )}

              <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
                <button type="button" className={styles.cancel} onClick={handleBack} disabled={isGenerating}>
                  Back
                </button>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={isGenerating || generateMutation.isPending}
                  aria-label="Generate video"
                >
                  {generateMutation.isPending ? 'Starting…' : isGenerating ? 'Generating…' : 'Generate'}
                </button>
              </div>
            </form>
          )}

          {step === 1 && (
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={isGenerating}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.submit}
                onClick={handleNext}
                disabled={isGenerating}
                aria-label="Next"
              >
                Next
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WaveformPreview({
  type,
  color,
  thickness,
}: {
  type: VideoWaveformType;
  color: string;
  thickness: number;
}) {
  const w = 120;
  const h = 40;
  const halfH = h / 2;
  const strokeW = Math.max(1, Math.min(8, thickness));
  const barCount = type === 'bars' ? Math.max(1, Math.min(30, thickness)) : 8;
  const dotCount = type === 'dots' ? Math.max(1, Math.min(30, thickness)) : 9;
  const amp = halfH - strokeW;

  const isSquareView = type === 'circle' || type === 'dots';
  const viewBox = type === 'circle' ? '0 0 40 40' : type === 'dots' ? '0 0 40 40' : `0 0 ${w} ${h}`;
  const preserveAspectRatio = isSquareView ? 'xMidYMid meet' : 'none';

  return (
    <svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio={preserveAspectRatio} className={styles.generateVideoWaveformSvg}>
      {type === 'sine' && (
        <path
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          d={Array.from({ length: w + 1 }, (_, i) => {
            const y = halfH + amp * Math.sin((2 * Math.PI * 2 * i) / w);
            return `${i === 0 ? 'M' : 'L'} ${i} ${y}`;
          }).join(' ')}
        />
      )}
      {type === 'bars' && (
        <g fill={color}>
          {Array.from({ length: barCount }, (_, i) => {
            const phase = barCount > 1 ? (2 * Math.PI * 2 * i) / barCount : 0;
            const barH = Math.max(2, halfH * 0.3 + amp * (0.5 + 0.5 * Math.sin(phase)));
            const barW = barCount > 0 ? (w - 4 - (barCount - 1) * 2) / barCount : w / 8;
            return (
              <rect
                key={i}
                x={4 + i * (barW + 2)}
                y={h - barH}
                width={barW}
                height={barH}
                rx={2}
              />
            );
          })}
        </g>
      )}
      {type === 'circle' && (
        <circle cx={20} cy={20} r={Math.min(18, 20 - strokeW)} fill="none" stroke={color} strokeWidth={strokeW} />
      )}
      {type === 'dots' && (
        <g fill={color}>
          {(() => {
            const viewW = 40;
            const gap = 2;
            let r = Math.max(0.8, Math.min(8, strokeW)) * 0.5;
            const n = dotCount;
            const totalUsed = n * 2 * r + (n - 1) * gap;
            if (totalUsed > viewW) {
              r = Math.max(0.5, (viewW - (n - 1) * gap) / (2 * n));
            }
            const padding = (viewW - (n * 2 * r + (n - 1) * gap)) / 2;
            return Array.from({ length: dotCount }, (_, i) => {
              const x = padding + r + i * (2 * r + gap);
              const y = 20;
              return <circle key={i} cx={x} cy={y} r={r} />;
            });
          })()}
        </g>
      )}
    </svg>
  );
}
