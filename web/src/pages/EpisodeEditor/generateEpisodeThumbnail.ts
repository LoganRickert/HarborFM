export type ThumbnailAspect = '16:9' | '9:16' | '1:1';

const SQUARE = 2000;
const COVER_OPACITY = 0.7;
const BLUR_OPACITY = 0.5;
const BLUR_PX = 80;
const PHOTO_GAP = 10;
const PHOTO_RADIUS = 10;
const TITLE_BOX = { x: 100, y: 80, w: 1800, h: 400 };
const TITLE_MAX_SIZE = 130;
const TITLE_MIN_SIZE = 24;
const TITLE_FONT = '700 {size}px "Segoe UI", system-ui, -apple-system, sans-serif';
const JPEG_QUALITY = 0.7;

export interface GenerateEpisodeThumbnailInput {
  title: string;
  coverUrl: string | null;
  /** Already sorted hosts-then-guests A-Z, capped at 6, with resolvable photo URLs. */
  castPhotoUrls: string[];
  aspect: ThumbnailAspect;
  showTitle: boolean;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadImageFromUrl(url: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = objectUrl;
      });
      return img;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/** Center-crop draw into a destination rect (cover-fit). */
function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** Stretch-fill (may distort) into a destination rect. */
function drawStretch(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawRoundedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.clip();
  drawCoverFit(ctx, img, x, y, size, size);
  ctx.restore();
}

function photoSizeForCount(count: number): number {
  if (count <= 2) return 750;
  return 600;
}

/** Returns top-left positions for each photo, centered in the square. */
function layoutPhotoPositions(count: number, size: number): Array<{ x: number; y: number }> {
  const gap = PHOTO_GAP;
  const positions: Array<{ x: number; y: number }> = [];

  if (count <= 0) return positions;

  if (count === 1) {
    positions.push({ x: (SQUARE - size) / 2, y: (SQUARE - size) / 2 });
    return positions;
  }

  if (count === 2) {
    const rowW = size * 2 + gap;
    const startX = (SQUARE - rowW) / 2;
    const y = (SQUARE - size) / 2;
    positions.push({ x: startX, y }, { x: startX + size + gap, y });
    return positions;
  }

  if (count === 3) {
    const rowW = size * 3 + gap * 2;
    const startX = (SQUARE - rowW) / 2;
    const y = (SQUARE - size) / 2;
    for (let i = 0; i < 3; i++) {
      positions.push({ x: startX + i * (size + gap), y });
    }
    return positions;
  }

  if (count === 4) {
    const gridW = size * 2 + gap;
    const gridH = size * 2 + gap;
    const startX = (SQUARE - gridW) / 2;
    const startY = (SQUARE - gridH) / 2;
    positions.push(
      { x: startX, y: startY },
      { x: startX + size + gap, y: startY },
      { x: startX, y: startY + size + gap },
      { x: startX + size + gap, y: startY + size + gap },
    );
    return positions;
  }

  if (count === 5) {
    const topW = size * 3 + gap * 2;
    const botW = size * 2 + gap;
    const gridH = size * 2 + gap;
    const topStartX = (SQUARE - topW) / 2;
    const botStartX = (SQUARE - botW) / 2;
    const startY = (SQUARE - gridH) / 2;
    for (let i = 0; i < 3; i++) {
      positions.push({ x: topStartX + i * (size + gap), y: startY });
    }
    positions.push(
      { x: botStartX, y: startY + size + gap },
      { x: botStartX + size + gap, y: startY + size + gap },
    );
    return positions;
  }

  // 6: 3x2
  const rowW = size * 3 + gap * 2;
  const gridH = size * 2 + gap;
  const startX = (SQUARE - rowW) / 2;
  const startY = (SQUARE - gridH) / 2;
  for (let i = 0; i < 3; i++) {
    positions.push({ x: startX + i * (size + gap), y: startY });
  }
  for (let i = 0; i < 3; i++) {
    positions.push({ x: startX + i * (size + gap), y: startY + size + gap });
  }
  return positions;
}

function wrapTitleLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0]!;

  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    const trial = `${current} ${word}`;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        // Remaining words go on the last line (may overflow; caller shrinks font)
        const rest = [current, ...words.slice(i + 1)].join(' ');
        lines.push(rest);
        return lines;
      }
    }
  }
  lines.push(current);
  return lines.slice(0, maxLines);
}

function titleFits(
  ctx: CanvasRenderingContext2D,
  title: string,
  fontSize: number,
  boxW: number,
  boxH: number,
): { ok: boolean; lines: string[]; lineHeight: number } {
  ctx.font = TITLE_FONT.replace('{size}', String(fontSize));
  const lineHeight = fontSize * 1.15;
  const lines = wrapTitleLines(ctx, title, boxW, 2);
  if (lines.length === 0) return { ok: true, lines, lineHeight };
  const totalH = lines.length * lineHeight;
  if (totalH > boxH) return { ok: false, lines, lineHeight };
  for (const line of lines) {
    if (ctx.measureText(line).width > boxW) return { ok: false, lines, lineHeight };
  }
  return { ok: true, lines, lineHeight };
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;

  const { x, y, w, h } = TITLE_BOX;
  let lo = TITLE_MIN_SIZE;
  let hi = TITLE_MAX_SIZE;
  let bestSize = TITLE_MIN_SIZE;
  let best = titleFits(ctx, trimmed, bestSize, w, h);

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const fit = titleFits(ctx, trimmed, mid, w, h);
    if (fit.ok) {
      best = fit;
      bestSize = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  ctx.font = TITLE_FONT.replace('{size}', String(bestSize));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;

  const centerX = x + w / 2;
  let textY = y;
  for (const line of best.lines) {
    ctx.fillText(line, centerX, textY);
    textY += best.lineHeight;
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function composeSquare(
  cover: HTMLImageElement | null,
  castImages: HTMLImageElement[],
  title: string,
  showTitle: boolean,
): HTMLCanvasElement {
  const canvas = createCanvas(SQUARE, SQUARE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, SQUARE, SQUARE);

  if (cover) {
    ctx.save();
    ctx.globalAlpha = COVER_OPACITY;
    drawCoverFit(ctx, cover, 0, 0, SQUARE, SQUARE);
    ctx.restore();
  }

  const count = castImages.length;
  if (count > 0) {
    const size = photoSizeForCount(count);
    const positions = layoutPhotoPositions(count, size);
    for (let i = 0; i < count; i++) {
      const img = castImages[i]!;
      const pos = positions[i]!;
      drawRoundedImage(ctx, img, pos.x, pos.y, size, PHOTO_RADIUS);
    }
  }

  if (showTitle) drawTitle(ctx, title);
  return canvas;
}

function extendAspect(
  square: HTMLCanvasElement,
  cover: HTMLImageElement | null,
  aspect: '16:9' | '9:16',
): HTMLCanvasElement {
  const width = aspect === '16:9' ? Math.round(SQUARE * (16 / 9)) : SQUARE;
  const height = aspect === '9:16' ? Math.round(SQUARE * (16 / 9)) : SQUARE;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  // Black base under everything
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  if (cover) {
    // Draw stretched + blurred cover at 50% opacity onto full canvas
    const off = createCanvas(width, height);
    const offCtx = off.getContext('2d');
    if (offCtx) {
      offCtx.filter = `blur(${BLUR_PX}px)`;
      // Scale up slightly so blur edges don't show empty margins
      const pad = BLUR_PX * 2;
      drawStretch(offCtx, cover, -pad, -pad, width + pad * 2, height + pad * 2);
      offCtx.filter = 'none';
      ctx.save();
      ctx.globalAlpha = BLUR_OPACITY;
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
  }

  const ox = Math.round((width - SQUARE) / 2);
  const oy = Math.round((height - SQUARE) / 2);

  // Opaque black mask so blur does not show through the square region
  ctx.fillStyle = '#000000';
  ctx.fillRect(ox, oy, SQUARE, SQUARE);

  ctx.drawImage(square, ox, oy);

  return canvas;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode JPEG'));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export function sanitizeThumbnailFilename(title: string, aspect: ThumbnailAspect): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'episode';
  const suffix = aspect === '16:9' ? '16x9' : aspect === '9:16' ? '9x16' : '1x1';
  return `${base}-${suffix}.jpg`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function generateEpisodeThumbnail(
  input: GenerateEpisodeThumbnailInput,
): Promise<{ blob: Blob; filename: string }> {
  const cover = input.coverUrl ? await loadImageFromUrl(input.coverUrl) : null;

  const castImages: HTMLImageElement[] = [];
  for (const url of input.castPhotoUrls.slice(0, 6)) {
    const img = await loadImageFromUrl(url);
    if (img) castImages.push(img);
  }

  const square = composeSquare(cover, castImages, input.title, input.showTitle);
  const finalCanvas =
    input.aspect === '1:1' ? square : extendAspect(square, cover, input.aspect);

  const blob = await canvasToJpegBlob(finalCanvas);
  const filename = sanitizeThumbnailFilename(input.title, input.aspect);
  return { blob, filename };
}
