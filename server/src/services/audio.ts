import { execFile } from 'child_process';
import { promisify } from 'util';
import { statSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, extname, basename, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { processedDir, uploadsDir, getDataDir, assertPathUnder, ensureDir, assertResolvedPathUnder } from './paths.js';

/** Allow output to allowedBaseDir or to os.tmpdir(); ensures output dir is under one of them. */
function prepareOutputPath(outputPath: string, allowedBaseDir: string): void {
  const outDir = dirname(outputPath);
  const resolvedOut = resolve(outDir);
  const resolvedTmp = resolve(tmpdir());
  if (resolvedOut === resolvedTmp || resolvedOut.startsWith(resolvedTmp + sep)) {
    assertResolvedPathUnder(outDir, tmpdir());
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }
    return;
  }
  ensureDir(outDir);
  assertPathUnder(outDir, allowedBaseDir);
}

const exec = promisify(execFile);
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const AUDIOWAVEFORM = process.env.AUDIOWAVEFORM_PATH ?? 'audiowaveform';

/** Loudness target for final episode (LUFS). Will be configurable per-user later. */
const DEFAULT_LOUDNESS_TARGET_LUFS = -14;

export interface ProbeResult {
  durationSec: number;
  format: string;
  sizeBytes: number;
  mime?: string;
}

export type FinalAudioFormat = 'mp3' | 'm4a';
export type FinalAudioChannels = 'mono' | 'stereo';

/** Allowed base for probe: must be under data dir. Pass the base dir (e.g. uploadsDir or processedDir result). */
export async function probeAudio(filePath: string, allowedBaseDir: string): Promise<ProbeResult> {
  const resolvedPath = assertPathUnder(filePath, allowedBaseDir);
  const { stdout } = await exec(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    resolvedPath,
  ], { maxBuffer: 2 * 1024 * 1024 });
  const info = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ duration?: string; codec_type?: string }>;
  };
  const format = info.format;
  if (!format) throw new Error('No format info');
  let durationSec = Math.round(parseFloat(format.duration ?? '0'));
  if (durationSec <= 0 && Array.isArray(info.streams)) {
    const audioStream = info.streams.find((s) => s.codec_type === 'audio');
    if (audioStream?.duration) {
      const d = parseFloat(audioStream.duration);
      if (!Number.isNaN(d)) durationSec = Math.round(d);
    }
  }
  if (durationSec <= 0) {
    try {
      const { stdout: durationOut } = await exec(FFPROBE, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        resolvedPath,
      ], { maxBuffer: 64 * 1024 });
      const raw = durationOut.trim();
      if (raw && raw !== 'N/A') {
        const d = parseFloat(raw);
        if (!Number.isNaN(d) && d > 0) durationSec = Math.round(d);
      }
    } catch {
      // try next fallback
    }
  }
  if (durationSec <= 0) {
    try {
      const { stderr } = await exec(FFMPEG, [
        '-i', resolvedPath,
        '-c', 'copy',
        '-f', 'null',
        '-',
      ], { maxBuffer: 1024 * 1024 });
      const timeMatches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+)\.(\d+)/g)];
      const timeMatch = timeMatches[timeMatches.length - 1];
      if (timeMatch) {
        const [, h, m, s, frac] = timeMatch;
        durationSec = Math.round(
          parseInt(h!, 10) * 3600 +
          parseInt(m!, 10) * 60 +
          parseInt(s!, 10) +
          parseInt(frac!, 10) / 100
        );
      }
    } catch {
      // keep 0
    }
  }
  const stat = statSync(resolvedPath);
  const formatName = (format.format_name ?? '').toLowerCase();
  let mime = 'audio/mpeg';
  if (formatName.includes('wav')) mime = 'audio/wav';
  else if (formatName.includes('mp3')) mime = 'audio/mpeg';
  else if (formatName.includes('webm')) mime = 'audio/webm';
  else if (formatName.includes('m4a') || formatName.includes('mp4') || formatName.includes('mov')) mime = 'audio/mp4';
  return {
    durationSec,
    format: formatName,
    sizeBytes: stat.size,
    mime,
  };
}

/**
 * Normalize an uploaded audio file: if it's not MP3 or WAV, re-encode to MP3 with ffmpeg
 * and return the path to the MP3 (original file is removed). If it's already MP3 or WAV,
 * return the path unchanged.
 */
export async function normalizeUploadToMp3OrWav(
  inputPath: string,
  inputExt: string,
  allowedBaseDir: string
): Promise<{ path: string; mime: string; ext: string }> {
  const ext = inputExt.toLowerCase().replace(/^\./, '');
  if (ext === 'mp3') {
    return { path: assertPathUnder(inputPath, allowedBaseDir), mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (ext === 'wav') {
    return { path: assertPathUnder(inputPath, allowedBaseDir), mime: 'audio/wav', ext: 'wav' };
  }
  const safeIn = assertPathUnder(inputPath, allowedBaseDir);
  const outPath = join(dirname(safeIn), basename(safeIn, extname(safeIn)) + '.mp3');
  ensureDir(dirname(outPath));
  await exec(FFMPEG, [
    '-i', safeIn,
    '-acodec', 'libmp3lame',
    '-b:a', '128k',
    '-y',
    outPath,
  ], { maxBuffer: 1024 * 1024 });
  try {
    unlinkSync(safeIn);
  } catch {
    // best-effort remove original
  }
  return { path: assertPathUnder(outPath, allowedBaseDir), mime: 'audio/mpeg', ext: 'mp3' };
}

/**
 * Generate a waveform JSON file alongside an audio file using audiowaveform.
 * Output path: same directory, same base name, extension .waveform.json.
 * Input path must be under allowedBaseDir; output is validated the same way.
 */
export async function generateWaveformFile(audioPath: string, allowedBaseDir: string): Promise<string> {
  const safeIn = assertPathUnder(audioPath, allowedBaseDir);
  const outPath = join(dirname(safeIn), basename(safeIn, extname(safeIn)) + '.waveform.json');
  assertPathUnder(dirname(outPath), allowedBaseDir);
  await exec(AUDIOWAVEFORM, [
    '-i', safeIn,
    '-o', outPath,
    '--pixels-per-second', '4',
    '--bits', '8',
  ], { maxBuffer: 4 * 1024 * 1024 });
  return assertPathUnder(outPath, allowedBaseDir);
}

export function getFinalOutputPath(podcastId: string, episodeId: string, format: FinalAudioFormat): string {
  const outDir = processedDir(podcastId, episodeId);
  const ext = format === 'm4a' ? 'm4a' : 'mp3';
  return join(outDir, `final.${ext}`);
}

export async function transcodeToFinal(
  sourcePath: string,
  podcastId: string,
  episodeId: string,
  opts: { format: FinalAudioFormat; bitrateKbps: number; channels: FinalAudioChannels }
): Promise<string> {
  const uploadBase = uploadsDir(podcastId, episodeId);
  const safeSource = assertPathUnder(sourcePath, uploadBase);
  const outPath = getFinalOutputPath(podcastId, episodeId, opts.format);
  const channels = opts.channels === 'stereo' ? 2 : 1;
  const bitrate = `${Math.max(16, opts.bitrateKbps)}k`;
  const loudnormFilter = `loudnorm=I=${DEFAULT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=11`;
  const args = [
    '-i', safeSource,
    '-af', loudnormFilter,
    '-ac', String(channels),
  ];
  if (opts.format === 'm4a') {
    args.push(
      '-c:a', 'aac',
      '-b:a', bitrate,
      '-movflags', '+faststart'
    );
  } else {
    args.push(
      '-acodec', 'libmp3lame',
      '-b:a', bitrate
    );
  }
  args.push('-y', outPath);
  await exec(FFMPEG, args, { maxBuffer: 1024 * 1024 });
  return outPath;
}

export async function getAudioMetaAfterProcess(
  podcastId: string,
  episodeId: string,
  format: FinalAudioFormat
): Promise<{ sizeBytes: number; durationSec: number; mime: string }> {
  const procBase = processedDir(podcastId, episodeId);
  const outPath = getFinalOutputPath(podcastId, episodeId, format);
  const stat = statSync(outPath);
  const probe = await probeAudio(outPath, procBase);
  return {
    sizeBytes: stat.size,
    durationSec: probe.durationSec,
    mime: probe.mime ?? 'audio/mpeg',
  };
}

const DATA_DIR = getDataDir();

/**
 * Extract a time range from an audio file to an MP3 chunk.
 * @param sourcePath - Full path to source audio (must be under allowedBaseDir)
 * @param allowedBaseDir - Base directory for source (and output must be under same or we allow output under dirname(source))
 * @param startSec - Start time in seconds
 * @param durationSec - Duration in seconds
 * @param outputPath - Full path for output MP3 (must be under allowedBaseDir)
 */
export async function extractSegment(
  sourcePath: string,
  allowedBaseDir: string,
  startSec: number,
  durationSec: number,
  outputPath: string
): Promise<string> {
  const safeSource = assertPathUnder(sourcePath, allowedBaseDir);
  const safeOut = assertPathUnder(outputPath, allowedBaseDir);
  await exec(FFMPEG, [
    '-ss', String(startSec),
    '-i', safeSource,
    '-t', String(durationSec),
    '-acodec', 'libmp3lame',
    '-b:a', '64k',
    '-y',
    safeOut,
  ], { maxBuffer: 1024 * 1024 });
  return safeOut;
}

/** Concatenate multiple audio files into final output format. Paths must be under DATA_DIR. */
export async function concatToFinal(
  segmentPaths: string[],
  outputPath: string,
  opts: { format: FinalAudioFormat; bitrateKbps: number; channels: FinalAudioChannels }
): Promise<string> {
  if (segmentPaths.length === 0) throw new Error('At least one segment required');
  for (const p of segmentPaths) {
    assertPathUnder(p, DATA_DIR);
  }
  const n = segmentPaths.length;
  const loudnormFilter = `loudnorm=I=${DEFAULT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=11`;
  const filter =
    segmentPaths.map((_, i) => `[${i}:a]`).join('') +
    `concat=n=${n}:v=0:a=1[concat];[concat]${loudnormFilter}[out]`;
  const channels = opts.channels === 'stereo' ? 2 : 1;
  const bitrate = `${Math.max(16, opts.bitrateKbps)}k`;
  const args = segmentPaths.flatMap((p) => ['-i', p]).concat([
    '-filter_complex', filter,
    '-map', '[out]',
    '-ac', String(channels),
  ]);
  if (opts.format === 'm4a') {
    args.push('-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart');
  } else {
    args.push('-acodec', 'libmp3lame', '-b:a', bitrate);
  }
  args.push('-y', outputPath);
  await exec(FFMPEG, args, { maxBuffer: 1024 * 1024 });
  return outputPath;
}

/**
 * Remove a segment from audio and export to WAV.
 * Creates a new file with segments before and after the removed range.
 * @param sourcePath - Full path to source audio (must be under allowedBaseDir)
 * @param allowedBaseDir - Base directory for source
 * @param removeStartSec - Start time of segment to remove (in seconds)
 * @param removeEndSec - End time of segment to remove (in seconds)
 * @param outputPath - Full path for output WAV (must be under allowedBaseDir)
 */
export async function removeSegmentAndExportToWav(
  sourcePath: string,
  allowedBaseDir: string,
  removeStartSec: number,
  removeEndSec: number,
  outputPath: string
): Promise<string> {
  const safeSource = assertPathUnder(sourcePath, allowedBaseDir);
  // Ensure output directory exists and assert it's under allowedBaseDir
  const outDir = dirname(outputPath);
  ensureDir(outDir);
  assertPathUnder(outDir, allowedBaseDir);
  const safeOut = outputPath; // Use outputPath directly since we've validated the directory
  
  // Get total duration
  const probe = await probeAudio(safeSource, allowedBaseDir);
  const totalDurationSec = probe.durationSec;
  
  // Build filter_complex to extract two segments and concatenate
  // Segment 1: 0 to removeStartSec
  // Segment 2: removeEndSec to end
  const segments: Array<{ start: number; end: number }> = [];
  if (removeStartSec > 0) {
    segments.push({ start: 0, end: removeStartSec });
  }
  if (removeEndSec < totalDurationSec) {
    segments.push({ start: removeEndSec, end: totalDurationSec });
  }
  
  if (segments.length === 0) {
    throw new Error('Cannot remove entire audio file');
  }
  
  if (segments.length === 1) {
    // Only one segment, just extract it
    const seg = segments[0];
    await exec(FFMPEG, [
      '-ss', String(seg.start),
      '-i', safeSource,
      '-t', String(seg.end - seg.start),
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-y',
      safeOut,
    ], { maxBuffer: 1024 * 1024 });
  } else {
    // Multiple segments, need to concatenate
    // Create temporary files for each segment
    const tempFiles: string[] = [];
    const { nanoid } = await import('nanoid');
    const tempDir = dirname(safeOut);
    
    try {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const tempPath = join(tempDir, `temp_${nanoid()}.wav`);
        tempFiles.push(tempPath);
        await exec(FFMPEG, [
          '-ss', String(seg.start),
          '-i', safeSource,
          '-t', String(seg.end - seg.start),
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-y',
          tempPath,
        ], { maxBuffer: 1024 * 1024 });
      }
      
      // Concatenate all temp files
      const n = tempFiles.length;
      const filter = tempFiles.map((_, i) => `[${i}:a]`).join('') + `concat=n=${n}:v=0:a=1[out]`;
      const args = tempFiles.flatMap((p) => ['-i', p]).concat([
        '-filter_complex', filter,
        '-map', '[out]',
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-y',
        safeOut,
      ]);
      await exec(FFMPEG, args, { maxBuffer: 1024 * 1024 });
    } finally {
      // Clean up temp files
      const { unlinkSync } = await import('fs');
      for (const tempFile of tempFiles) {
        try {
          unlinkSync(tempFile);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
  
  return safeOut;
}

/**
 * Trim audio file - extract from startSec to endSec and export to WAV.
 * @param sourcePath - Full path to source audio (must be under allowedBaseDir)
 * @param allowedBaseDir - Base directory for source
 * @param startSec - Start time in seconds (0 if not provided)
 * @param endSec - End time in seconds (end of file if not provided)
 * @param outputPath - Full path for output WAV (must be under allowedBaseDir)
 */
export async function trimAudioToWav(
  sourcePath: string,
  allowedBaseDir: string,
  startSec: number | undefined,
  endSec: number | undefined,
  outputPath: string
): Promise<string> {
  const safeSource = assertPathUnder(sourcePath, allowedBaseDir);
  prepareOutputPath(outputPath, allowedBaseDir);
  const safeOut = outputPath;

  // Get total duration if we need to calculate endSec
  let totalDurationSec: number | undefined;
  if (endSec === undefined) {
    const probe = await probeAudio(safeSource, allowedBaseDir);
    totalDurationSec = probe.durationSec;
  }
  
  const start = startSec ?? 0;
  const end = endSec ?? totalDurationSec;
  
  if (end === undefined || end <= start) {
    throw new Error('Invalid trim range: end must be greater than start');
  }
  
  const duration = end - start;
  
  await exec(FFMPEG, [
    '-ss', String(start),
    '-i', safeSource,
    '-t', String(duration),
    '-acodec', 'pcm_s16le',
    '-ar', '44100',
    '-y',
    safeOut,
  ], { maxBuffer: 1024 * 1024 });
  
  return safeOut;
}

/**
 * Remove silence periods longer than thresholdSeconds from audio file.
 * Uses FFmpeg's silencedetect to find silence, then removes those periods.
 * @param sourcePath - Full path to source audio (must be under allowedBaseDir)
 * @param allowedBaseDir - Base directory for source
 * @param thresholdSeconds - Minimum silence duration to remove (default: 2.0)
 * @param silenceThresholdDb - Silence threshold in dB (default: -60)
 * @param outputPath - Full path for output WAV (must be under allowedBaseDir)
 */
export async function removeSilenceFromWav(
  sourcePath: string,
  allowedBaseDir: string,
  thresholdSeconds: number,
  silenceThresholdDb: number,
  outputPath: string
): Promise<string> {
  const safeSource = assertPathUnder(sourcePath, allowedBaseDir);
  prepareOutputPath(outputPath, allowedBaseDir);
  const safeOut = outputPath;

  // First, detect silence periods using silencedetect filter
  // silencedetect outputs: silence_start, silence_end, silence_duration
  const { stderr } = await exec(FFMPEG, [
    '-i', safeSource,
    '-af', `silencedetect=noise=${silenceThresholdDb}dB:d=${thresholdSeconds}`,
    '-f', 'null',
    '-',
  ], { maxBuffer: 10 * 1024 * 1024 });
  
  // Parse silence periods from stderr
  // Format: silence_start: 10.5 | silence_end: 12.8 | silence_duration: 2.3
  const silencePeriods: Array<{ start: number; end: number; duration: number }> = [];
  const lines = stderr.split('\n');
  let currentStart: number | null = null;
  
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    const durationMatch = line.match(/silence_duration:\s*([\d.]+)/);
    
    if (startMatch) {
      currentStart = parseFloat(startMatch[1]);
    }
    if (endMatch && currentStart !== null) {
      const end = parseFloat(endMatch[1]);
      const duration = durationMatch ? parseFloat(durationMatch[1]) : (end - currentStart);
      if (duration >= thresholdSeconds) {
        silencePeriods.push({ start: currentStart, end, duration });
      }
      currentStart = null;
    }
  }
  
  // Get total duration
  const probe = await probeAudio(safeSource, allowedBaseDir);
  const totalDurationSec = probe.durationSec;
  
  if (silencePeriods.length === 0) {
    // No silence to remove, just copy the file
    await exec(FFMPEG, [
      '-i', safeSource,
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-y',
      safeOut,
    ], { maxBuffer: 1024 * 1024 });
    return safeOut;
  }
  
  // Build list of segments to keep (non-silent parts)
  const segments: Array<{ start: number; end: number }> = [];
  let segmentStart = 0;
  
  for (const silence of silencePeriods) {
    if (silence.start > segmentStart) {
      // Add segment before this silence
      segments.push({ start: segmentStart, end: silence.start });
    }
    segmentStart = silence.end;
  }
  
  // Add final segment if there's audio after the last silence
  if (segmentStart < totalDurationSec) {
    segments.push({ start: segmentStart, end: totalDurationSec });
  }
  
  if (segments.length === 0) {
    throw new Error('All audio is silence');
  }
  
  // Extract and concatenate non-silent segments
  if (segments.length === 1) {
    // Only one segment, just extract it
    const seg = segments[0];
    await exec(FFMPEG, [
      '-ss', String(seg.start),
      '-i', safeSource,
      '-t', String(seg.end - seg.start),
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-y',
      safeOut,
    ], { maxBuffer: 1024 * 1024 });
  } else {
    // Multiple segments, need to concatenate
    const tempFiles: string[] = [];
    const { nanoid } = await import('nanoid');
    const tempDir = dirname(safeOut);
    
    try {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const tempPath = join(tempDir, `temp_${nanoid()}.wav`);
        tempFiles.push(tempPath);
        await exec(FFMPEG, [
          '-ss', String(seg.start),
          '-i', safeSource,
          '-t', String(seg.end - seg.start),
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-y',
          tempPath,
        ], { maxBuffer: 1024 * 1024 });
      }
      
      // Concatenate all temp files
      const n = tempFiles.length;
      const filter = tempFiles.map((_, i) => `[${i}:a]`).join('') + `concat=n=${n}:v=0:a=1[out]`;
      const args = tempFiles.flatMap((p) => ['-i', p]).concat([
        '-filter_complex', filter,
        '-map', '[out]',
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-y',
        safeOut,
      ]);
      await exec(FFMPEG, args, { maxBuffer: 1024 * 1024 });
    } finally {
      // Clean up temp files
      const { unlinkSync } = await import('fs');
      for (const tempFile of tempFiles) {
        try {
          unlinkSync(tempFile);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
  
  return safeOut;
}

/** Noise floor (nf) in dB for afftdn. Allowed -80 to -20. */
const AFFTDN_NF_MIN = -80;
const AFFTDN_NF_MAX = -20;

/**
 * FFmpeg encoding args for a given output extension (afftdn filter is applied before encoding).
 * Preserves format so e.g. webm stays webm, wav stays wav.
 */
function encodingArgsForExtension(ext: string): string[] {
  const lower = ext.toLowerCase();
  if (lower === '.wav') return ['-acodec', 'pcm_s16le', '-ar', '44100'];
  if (lower === '.webm') return ['-acodec', 'libopus', '-b:a', '128k'];
  if (lower === '.mp3') return ['-acodec', 'libmp3lame', '-b:a', '128k'];
  if (lower === '.m4a' || lower === '.mp4') return ['-acodec', 'aac', '-b:a', '128k'];
  // default to WAV for unknown formats
  return ['-acodec', 'pcm_s16le', '-ar', '44100'];
}

/**
 * Apply FFT-based noise suppression to audio using ffmpeg afftdn filter.
 * Output format is derived from outputPath extension (e.g. .wav, .webm, .mp3) so the
 * source format can be preserved.
 * @param sourcePath - Full path to source audio (must be under allowedBaseDir)
 * @param allowedBaseDir - Base directory for source
 * @param nf - Noise floor in dB (default -25, range -80 to -20)
 * @param outputPath - Full path for output (must be under allowedBaseDir); extension determines format
 */
export async function applyNoiseSuppressionToWav(
  sourcePath: string,
  allowedBaseDir: string,
  nf: number,
  outputPath: string
): Promise<string> {
  const safeSource = assertPathUnder(sourcePath, allowedBaseDir);
  prepareOutputPath(outputPath, allowedBaseDir);
  const safeOut = outputPath;
  const clampedNf = Math.max(AFFTDN_NF_MIN, Math.min(AFFTDN_NF_MAX, nf));
  const ext = extname(outputPath);
  const encoding = encodingArgsForExtension(ext);

  await exec(FFMPEG, [
    '-i', safeSource,
    '-af', `afftdn=nf=${clampedNf}`,
    ...encoding,
    '-y',
    safeOut,
  ], { maxBuffer: 1024 * 1024 });

  return safeOut;
}
