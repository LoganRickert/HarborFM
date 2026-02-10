import type { FastifyInstance } from 'fastify';
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, extname, basename } from 'path';
import send from '@fastify/send';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth } from '../plugins/auth.js';
import { canAccessEpisode } from '../services/access.js';
import { readSettings } from './settings.js';
import { uploadsDir, segmentPath, getDataDir, libraryDir, processedDir, assertPathUnder } from '../services/paths.js';
import * as audioService from '../services/audio.js';
import { writeRssFile } from '../services/rss.js';
import { FileTooLargeError, streamToFileWithLimit, extensionFromAudioMimetype } from '../services/uploads.js';
import { userRateLimitPreHandler } from '../services/rateLimit.js';
import { wouldExceedStorageLimit } from '../services/storageLimit.js';

const exec = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';


function transcriptPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, '.txt');
}

function waveformPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, '.waveform.json');
}

function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function parseSrtTime(timeStr: string): number {
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] || '0');
  const minutes = parseFloat(parts[1] || '0');
  const seconds = parseFloat(parts[2] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

interface SrtEntry {
  index: number;
  start: string;
  end: string;
  text: string;
}

function parseSrt(srtText: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const indexStr = lines[0]?.trim();
    const timeLine = lines[1]?.trim();
    if (!indexStr || !timeLine || !timeLine.includes('-->')) continue;
    const [start, end] = timeLine.split('-->').map((s) => s.trim());
    const text = lines.slice(2).join('\n').trim();
    if (start && end && text) {
      const index = parseInt(indexStr, 10);
      if (!Number.isNaN(index)) {
        entries.push({ index, start, end, text });
      }
    }
  }
  return entries;
}

function removeSrtEntryAndAdjustTimings(entries: SrtEntry[], removeArrayIndex: number, removedDurationSec: number): string {
  // Remove the entry at the specified array index
  const removedEntry = entries[removeArrayIndex];
  if (!removedEntry) return entries.map((e, i) => `${i + 1}\n${e.start} --> ${e.end}\n${e.text}\n`).join('\n');
  
  const filtered = entries.filter((_, i) => i !== removeArrayIndex);
  
  // Adjust timings for entries after the removed one
  const removedStartSec = parseSrtTime(removedEntry.start);
  
  const adjusted = filtered.map((entry) => {
    const startSec = parseSrtTime(entry.start);
    const endSec = parseSrtTime(entry.end);
    
    if (startSec >= removedStartSec) {
      // This entry comes after the removed one, adjust timings
      return {
        ...entry,
        start: formatSrtTime(Math.max(0, startSec - removedDurationSec)),
        end: formatSrtTime(Math.max(0, endSec - removedDurationSec)),
      };
    }
    return entry;
  });
  
  // Renumber entries sequentially
  return adjusted
    .map((entry, i) => {
      return `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`;
    })
    .join('\n');
}

function getSegmentAudioPath(
  segment: Record<string, unknown>,
  podcastId: string,
  episodeId: string
): { path: string; base: string } | null {
  if (segment.type === 'recorded' && segment.audio_path) {
    return { path: segment.audio_path as string, base: uploadsDir(podcastId, episodeId) };
  }
  if (segment.type === 'reusable' && segment.reusable_asset_id) {
    const asset = db
      .prepare('SELECT audio_path, owner_user_id FROM reusable_assets WHERE id = ?')
      .get(segment.reusable_asset_id) as { audio_path: string; owner_user_id: string } | undefined;
    if (asset?.audio_path) return { path: asset.audio_path, base: libraryDir(asset.owner_user_id) };
  }
  return null;
}

const ALLOWED_MIME = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per segment

export async function segmentRoutes(app: FastifyInstance) {
  // Used by the web client to decide whether transcript viewing/generation should be shown.
  app.get('/api/asr/available', { preHandler: [requireAuth] }, async (_request, reply) => {
    const settings = readSettings();
    const available = Boolean(settings.whisper_asr_url && settings.whisper_asr_url.trim());
    return reply.send({ available });
  });

  app.get(
    '/api/episodes/:id/segments',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const rows = db
        .prepare(
          `SELECT s.id, s.episode_id, s.position, s.type, s.name, s.reusable_asset_id, s.audio_path, s.duration_sec, s.created_at,
                  a.name AS asset_name
           FROM episode_segments s
           LEFT JOIN reusable_assets a ON a.id = s.reusable_asset_id
           WHERE s.episode_id = ? ORDER BY s.position ASC, s.created_at ASC`
        )
        .all(episodeId) as Record<string, unknown>[];
      return { segments: rows };
    }
  );

  app.post(
    '/api/episodes/:id/segments',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const { podcastId } = access;

      const contentType = (request.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const body = request.body as { type?: string; reusable_asset_id?: string; name?: string };
        if (body?.type === 'reusable' && body?.reusable_asset_id) {
          const asset = db
            .prepare(
              'SELECT id, name FROM reusable_assets WHERE id = ? AND (owner_user_id = ? OR global_asset = 1)'
            )
            .get(body.reusable_asset_id, request.userId) as { name: string } | undefined;
          if (!asset) return reply.status(404).send({ error: 'Library asset not found' });
          const maxPos = db
            .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?')
            .get(episodeId) as { pos: number };
          const id = nanoid();
          const assetRow = db.prepare('SELECT duration_sec FROM reusable_assets WHERE id = ?').get(body.reusable_asset_id) as { duration_sec: number };
          const segmentName = (body.name && String(body.name).trim()) || asset.name;
          db.prepare(
            `INSERT INTO episode_segments (id, episode_id, position, type, name, reusable_asset_id, duration_sec)
             VALUES (?, ?, ?, 'reusable', ?, ?, ?)`
          ).run(id, episodeId, maxPos.pos, segmentName, body.reusable_asset_id, assetRow.duration_sec ?? 0);
          const row = db.prepare('SELECT * FROM episode_segments WHERE id = ?').get(id) as Record<string, unknown>;
          return reply.status(201).send(row);
        }
        return reply.status(400).send({ error: 'JSON body must include type: "reusable" and reusable_asset_id' });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'Send multipart file for recorded segment or JSON body type=reusable&reusable_asset_id=...' });
      }

      const mimetype = data.mimetype || '';
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith('audio/')) {
        return reply.status(400).send({ error: 'Invalid file type. Use WAV, MP3, or WebM.' });
      }
      const segmentName = (data.fields?.name as { value?: string })?.value?.trim() || null;
      const ext = extensionFromAudioMimetype(mimetype);
      const segmentId = nanoid();
      const destPath = segmentPath(podcastId, episodeId, segmentId, ext);
      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(data.file, destPath, MAX_FILE_BYTES);
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: 'File too large' });
        }
        request.log.error(err);
        return reply.status(500).send({ error: 'Upload failed' });
      }

      if (wouldExceedStorageLimit(db, request.userId, bytesWritten)) {
        try { unlinkSync(destPath); } catch { /* ignore */ }
        return reply.status(403).send({
          error: 'You have reached your storage limit. Delete some content to free space.',
        });
      }

      const segmentBase = uploadsDir(podcastId, episodeId);
      let finalPath = destPath;
      try {
        const normalized = await audioService.normalizeUploadToMp3OrWav(destPath, ext, segmentBase);
        finalPath = normalized.path;
        bytesWritten = statSync(finalPath).size;
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Failed to process audio file' });
      }

      try {
        await audioService.generateWaveformFile(finalPath, segmentBase);
      } catch (err) {
        request.log.warn({ err, finalPath }, 'Waveform generation failed (upload succeeded)');
      }

      let durationSec = 0;
      try {
        const probe = await audioService.probeAudio(finalPath, segmentBase);
        durationSec = Math.max(0, probe.durationSec);
      } catch {
        // keep 0 if probe fails
      }

      const maxPos = db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?')
        .get(episodeId) as { pos: number };
      db.prepare(
        `INSERT INTO episode_segments (id, episode_id, position, type, name, audio_path, duration_sec)
         VALUES (?, ?, ?, 'recorded', ?, ?, ?)`
      ).run(segmentId, episodeId, maxPos.pos, segmentName, finalPath, durationSec);

      // Track disk usage (best-effort)
      db.prepare(
        `UPDATE users
         SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ?
         WHERE id = ?`
      ).run(bytesWritten, request.userId);

      const row = db.prepare('SELECT * FROM episode_segments WHERE id = ?').get(segmentId) as Record<string, unknown>;
      return reply.status(201).send(row);
    }
  );

  app.put(
    '/api/episodes/:id/segments/reorder',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const body = request.body as { segment_ids: string[] };
      if (!Array.isArray(body?.segment_ids)) return reply.status(400).send({ error: 'segment_ids array required' });
      const ids = body.segment_ids as string[];
      for (let i = 0; i < ids.length; i++) {
        db.prepare('UPDATE episode_segments SET position = ? WHERE id = ? AND episode_id = ?').run(i, ids[i], episodeId);
      }
      const rows = db.prepare('SELECT * FROM episode_segments WHERE episode_id = ? ORDER BY position ASC').all(episodeId) as Record<string, unknown>[];
      return { segments: rows };
    }
  );

  app.patch(
    '/api/episodes/:episodeId/segments/:segmentId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const body = request.body as { name?: string };
      const name = body?.name !== undefined ? (body.name === null || body.name === '' ? null : String(body.name).trim()) : undefined;
      if (name === undefined) return reply.status(400).send({ error: 'name field required' });
      const row = db
        .prepare('SELECT id FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: 'Segment not found' });
      db.prepare('UPDATE episode_segments SET name = ? WHERE id = ? AND episode_id = ?').run(name, segmentId, episodeId);
      const updated = db.prepare('SELECT * FROM episode_segments WHERE id = ?').get(segmentId) as Record<string, unknown>;
      return updated;
    }
  );

  app.get(
    '/api/episodes/:episodeId/segments/:segmentId/stream',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      const safePath = assertPathUnder(audio.path, audio.base);
      const ext = audio.path.toLowerCase().endsWith('.webm') ? 'webm' : audio.path.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';
      const contentType = ext === 'webm' ? 'audio/webm' : ext === 'wav' ? 'audio/wav' : 'audio/mpeg';

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        acceptRanges: true,
        cacheControl: false,
      });

      if (result.type === 'error') {
        const err = result.metadata.error as Error & { status?: number };
        return reply.status(err.status ?? 500).send({ error: err.message ?? 'Internal Server Error' });
      }

      reply.code(result.statusCode);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header('Content-Type', contentType).header('Cache-Control', 'private, no-transform');
      return reply.send(result.stream);
    }
  );

  app.get(
    '/api/episodes/:episodeId/segments/:segmentId/waveform',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      const wavPath = waveformPath(audio.path);
      if (!existsSync(wavPath)) return reply.status(404).send({ error: 'Waveform not found' });
      assertPathUnder(wavPath, audio.base);
      const json = readFileSync(wavPath, 'utf-8');
      reply.header('Content-Type', 'application/json').header('Cache-Control', 'private, max-age=3600');
      return reply.send(json);
    }
  );

  app.get(
    '/api/episodes/:episodeId/segments/:segmentId/transcript',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      const txtPath = transcriptPath(audio.path);
      if (!existsSync(txtPath)) return reply.status(404).send({ error: 'Transcript not found' });
      assertPathUnder(txtPath, audio.base);
      const text = readFileSync(txtPath, 'utf-8');
      return reply.send({ text });
    }
  );

  app.post(
    '/api/episodes/:episodeId/segments/:segmentId/transcript',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'whisper', windowMs: 1000 })] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const query = request.query as { regenerate?: string } | undefined;
      const regenerate = query?.regenerate === 'true';
      
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      const txtPath = transcriptPath(audio.path);
      if (existsSync(txtPath) && !regenerate) {
        assertPathUnder(txtPath, audio.base);
        const text = readFileSync(txtPath, 'utf-8');
        return reply.send({ text });
      }
      const settings = readSettings();
      let whisperUrl = settings.whisper_asr_url?.trim();
      if (!whisperUrl) {
        return reply.status(400).send({ error: 'Set Whisper ASR URL in Settings to generate transcripts.' });
      }
      try {
        const u = new URL(whisperUrl);
        const pathname = u.pathname.replace(/\/$/, '') || '';
        if (!pathname.endsWith('asr')) {
          u.pathname = pathname ? `${pathname}/asr` : '/asr';
        }
        u.searchParams.set('output', 'srt');
        whisperUrl = u.toString();
        assertPathUnder(audio.path, audio.base);
        const buffer = readFileSync(audio.path);
        const ext = audio.path.toLowerCase().endsWith('.webm') ? 'webm' : audio.path.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';
        const mime = ext === 'webm' ? 'audio/webm' : ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
        const form = new FormData();
        form.append('audio_file', new Blob([new Uint8Array(buffer)], { type: mime }), `audio.${ext}`);
        const res = await fetch(whisperUrl, { method: 'POST', body: form });
        if (!res.ok) {
          const errText = await res.text();
          request.log.warn({ status: res.status, body: errText }, 'Whisper ASR request failed');
          if (res.status === 413) {
            return reply.status(413).send({
              error: 'Audio file is too large for the transcription service. Try a shorter section or increase the server upload limit.',
            });
          }
          return reply.status(502).send({ error: 'Transcription service failed. Check Settings and try again.' });
        }
        const contentType = res.headers.get('content-type') || '';
        let text: string;
        if (contentType.includes('application/json')) {
          const data = (await res.json()) as {
            text?: string;
            srt?: string;
            vtt?: string;
            segments?: Array<{ start?: number; end?: number; text?: string }>;
          };
          if (typeof data?.srt === 'string') {
            text = data.srt.trim();
          } else if (typeof data?.vtt === 'string') {
            text = data.vtt.trim();
          } else if (Array.isArray(data?.segments) && data.segments.length > 0) {
            text = data.segments
              .map((seg, i) => {
                const start = seg.start ?? 0;
                const end = seg.end ?? start + 1;
                const startTime = formatSrtTime(start);
                const endTime = formatSrtTime(end);
                return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text || ''}\n`;
              })
              .join('\n');
          } else if (typeof data?.text === 'string') {
            text = data.text.trim();
          } else {
            text = '';
          }
        } else {
          text = (await res.text()).trim();
        }

        if (!text) {
          return reply.status(502).send({ error: 'Transcription service failed. Check Settings and try again.' });
        }
        assertPathUnder(dirname(txtPath), audio.base);
        writeFileSync(txtPath, text, 'utf-8');
        return reply.send({ text });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'CHUNK_TOO_LARGE') {
          return reply.status(413).send({
            error: 'Audio file is too large for the transcription service. Try a shorter section or increase the server upload limit.',
          });
        }
        if (/certificate|cert|unable to verify|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(msg)) {
          request.log.warn({ url: whisperUrl }, 'Transcription service request failed (connection).');
        } else {
          request.log.error(err);
        }
        return reply.status(502).send({ error: 'Transcription service failed. Check the Whisper ASR URL and try again.' });
      }
    }
  );

  app.post(
    '/api/episodes/:episodeId/segments/:segmentId/trim',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'ffmpeg', windowMs: 1000 })] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const body = request.body as { start_sec?: number; end_sec?: number } | undefined;
      const startSec = typeof body?.start_sec === 'number' ? body.start_sec : undefined;
      const endSec = typeof body?.end_sec === 'number' ? body.end_sec : undefined;
      
      if (startSec === undefined && endSec === undefined) {
        return reply.status(400).send({ error: 'Either start_sec or end_sec must be provided' });
      }
      
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      
      // Only recorded segments can be trimmed
      if (segment.type !== 'recorded') {
        return reply.status(400).send({ error: 'Only recorded segments can be trimmed' });
      }
      
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      
      // Get current duration
      const probe = await audioService.probeAudio(audio.path, audio.base);
      const currentDurationSec = probe.durationSec;
      
      // Calculate new start and end
      const newStartSec = startSec ?? 0;
      const newEndSec = endSec ?? currentDurationSec;
      
      if (newStartSec < 0 || newEndSec <= newStartSec || newEndSec > currentDurationSec) {
        return reply.status(400).send({ error: 'Invalid trim range' });
      }

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const tempPath = join(tmpdir(), `${nanoid()}.wav`);
      const outputExt = '.wav';
      const finalPath = join(dir, basename(audio.path, extname(audio.path)) + outputExt);

      try {
        await audioService.trimAudioToWav(audio.path, audio.base, newStartSec, newEndSec, tempPath);

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error('Trimmed audio file was not created or is empty');
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn({ err, finalPath }, 'Waveform generation failed after trim');
        }

        // Update transcript if it exists (adjust timings)
        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, 'utf-8');
          const entries = parseSrt(srtText);

          const adjustedEntries = entries
            .map((entry) => {
              const entryStartSec = parseSrtTime(entry.start);
              const entryEndSec = parseSrtTime(entry.end);
              if (entryEndSec <= newStartSec || entryStartSec >= newEndSec) return null;
              const adjustedStart = Math.max(0, entryStartSec - newStartSec);
              const adjustedEnd = Math.min(newEndSec - newStartSec, entryEndSec - newStartSec);
              return {
                ...entry,
                start: formatSrtTime(adjustedStart),
                end: formatSrtTime(adjustedEnd),
              };
            })
            .filter((e): e is SrtEntry => e !== null);

          const newTxtPath = transcriptPath(finalPath);
          const updatedSrt = adjustedEntries
            .map((entry, i) => `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`)
            .join('\n');
          writeFileSync(newTxtPath, updatedSrt, 'utf-8');
        }

        const newDurationSec = newEndSec - newStartSec;
        db.prepare('UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?').run(
          finalPath,
          newDurationSec,
          segmentId,
          episodeId
        );

        if (audio.path !== finalPath) unlinkSync(audio.path);
        const txtPathToRemove = transcriptPath(audio.path);
        if (existsSync(txtPathToRemove) && txtPathToRemove !== transcriptPath(finalPath)) {
          unlinkSync(txtPathToRemove);
        }

        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: 'Failed to trim audio' });
      }
    }
  );

  app.post(
    '/api/episodes/:episodeId/segments/:segmentId/remove-silence',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'ffmpeg', windowMs: 1000 })] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const body = request.body as { threshold_seconds?: number; silence_threshold?: number } | undefined;
      if (body?.threshold_seconds !== undefined) {
        if (typeof body.threshold_seconds !== 'number' || !Number.isFinite(body.threshold_seconds) || body.threshold_seconds <= 0) {
          return reply.status(400).send({ error: 'threshold_seconds must be a positive float' });
        }
      }
      const thresholdSeconds = typeof body?.threshold_seconds === 'number' ? body.threshold_seconds : 2.0;
      if (body?.silence_threshold !== undefined) {
        if (typeof body.silence_threshold !== 'number' || !Number.isFinite(body.silence_threshold)) {
          return reply.status(400).send({ error: 'silence_threshold must be a float' });
        }
      }
      const silenceThresholdDb = typeof body?.silence_threshold === 'number' ? body.silence_threshold : -60;
      
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      
      // Only recorded segments can have silence removed
      if (segment.type !== 'recorded') {
        return reply.status(400).send({ error: 'Only recorded segments can have silence removed' });
      }
      
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const tempPath = join(tmpdir(), `${nanoid()}.wav`);
      const finalPath = join(dir, basename(audio.path, extname(audio.path)) + '.wav');

      try {
        await audioService.removeSilenceFromWav(audio.path, audio.base, thresholdSeconds, silenceThresholdDb, tempPath);

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error('Audio file with silence removed was not created or is empty');
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn({ err, finalPath }, 'Waveform generation failed after remove-silence');
        }

        const probe = await audioService.probeAudio(finalPath, audio.base);
        const newDurationSec = probe.durationSec;

        // Update transcript if it exists (adjust timings based on removed silence)
        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, 'utf-8');
          const entries = parseSrt(srtText);
          
          // Detect silence periods to calculate timing adjustments
          const { stderr } = await exec(FFMPEG, [
            '-i', audio.path,
            '-af', `silencedetect=noise=${silenceThresholdDb}dB:d=${thresholdSeconds}`,
            '-f', 'null',
            '-',
          ], { maxBuffer: 10 * 1024 * 1024 });
          
          const silencePeriods: Array<{ start: number; end: number }> = [];
          const lines = stderr.split('\n');
          let currentStart: number | null = null;
          
          for (const line of lines) {
            const startMatch = line.match(/silence_start:\s*([\d.]+)/);
            const endMatch = line.match(/silence_end:\s*([\d.]+)/);
            
            if (startMatch) {
              currentStart = parseFloat(startMatch[1]);
            }
            if (endMatch && currentStart !== null) {
              const end = parseFloat(endMatch[1]);
              const duration = end - currentStart;
              if (duration >= thresholdSeconds) {
                silencePeriods.push({ start: currentStart, end });
              }
              currentStart = null;
            }
          }
          
          // Adjust transcript timings: subtract cumulative silence duration before each entry
          const adjustedEntries = entries
            .map((entry) => {
              const entryStartSec = parseSrtTime(entry.start);
              const entryEndSec = parseSrtTime(entry.end);
              
              // Calculate how much silence was removed before this entry
              let removedBefore = 0;
              for (const silence of silencePeriods) {
                if (silence.end <= entryStartSec) {
                  removedBefore += silence.end - silence.start;
                } else if (silence.start < entryStartSec && silence.end > entryStartSec) {
                  // Entry starts during silence, adjust start to silence start
                  removedBefore += entryStartSec - silence.start;
                }
              }
              
              // Calculate how much silence was removed before the end
              let removedBeforeEnd = 0;
              for (const silence of silencePeriods) {
                if (silence.end <= entryEndSec) {
                  removedBeforeEnd += silence.end - silence.start;
                } else if (silence.start < entryEndSec && silence.end > entryEndSec) {
                  removedBeforeEnd += entryEndSec - silence.start;
                }
              }
              
              // Adjust timings
              const adjustedStart = Math.max(0, entryStartSec - removedBefore);
              const adjustedEnd = Math.max(adjustedStart, entryEndSec - removedBeforeEnd);
              
              return {
                ...entry,
                start: formatSrtTime(adjustedStart),
                end: formatSrtTime(adjustedEnd),
              };
            })
            .filter((e) => {
              // Remove entries that are now invalid or were entirely within removed silence
              const startSec = parseSrtTime(e.start);
              const endSec = parseSrtTime(e.end);
              return endSec > startSec && startSec >= 0;
            });
          
          const newTxtPath = transcriptPath(finalPath);
          const updatedSrt = adjustedEntries
            .map((entry, i) => `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`)
            .join('\n');
          writeFileSync(newTxtPath, updatedSrt, 'utf-8');
        }

        db.prepare('UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?').run(
          finalPath,
          newDurationSec,
          segmentId,
          episodeId
        );

        if (audio.path !== finalPath) unlinkSync(audio.path);
        const txtPathToRemove = transcriptPath(audio.path);
        if (existsSync(txtPathToRemove) && txtPathToRemove !== transcriptPath(finalPath)) {
          unlinkSync(txtPathToRemove);
        }

        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: 'Failed to remove silence' });
      }
    }
  );

  app.post(
    '/api/episodes/:episodeId/segments/:segmentId/noise-suppression',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'ffmpeg', windowMs: 1000 })] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const body = request.body as { nf?: number } | undefined;
      const nf = typeof body?.nf === 'number' && Number.isFinite(body.nf) ? body.nf : -25;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });

      if (segment.type !== 'recorded') {
        return reply.status(400).send({ error: 'Only recorded segments can have noise suppression applied' });
      }

      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const ext = extname(audio.path) || '.wav';
      const tempPath = join(tmpdir(), `${nanoid()}${ext}`);
      const finalPath = join(dir, basename(audio.path));

      try {
        await audioService.applyNoiseSuppressionToWav(audio.path, audio.base, nf, tempPath);

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error('Noise-suppressed audio file was not created or is empty');
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn({ err, finalPath }, 'Waveform generation failed after noise-suppression');
        }

        const probe = await audioService.probeAudio(finalPath, audio.base);
        const newDurationSec = probe.durationSec;

        const oldTxtPath = transcriptPath(audio.path);
        const newTxtPath = transcriptPath(finalPath);
        if (existsSync(oldTxtPath)) {
          assertPathUnder(oldTxtPath, audio.base);
          copyFileSync(oldTxtPath, newTxtPath);
        }

        db.prepare('UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?').run(
          finalPath,
          newDurationSec,
          segmentId,
          episodeId
        );

        if (audio.path !== finalPath) unlinkSync(audio.path);
        if (existsSync(oldTxtPath) && oldTxtPath !== newTxtPath) unlinkSync(oldTxtPath);

        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: 'Failed to apply noise suppression' });
      }
    }
  );

  app.patch(
    '/api/episodes/:episodeId/segments/:segmentId/transcript',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const body = request.body as { text?: string } | undefined;
      const transcriptText = typeof body?.text === 'string' ? body.text : undefined;
      
      if (!transcriptText) {
        return reply.status(400).send({ error: 'Transcript text is required' });
      }
      
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      const txtPath = transcriptPath(audio.path);
      assertPathUnder(dirname(txtPath), audio.base);
      writeFileSync(txtPath, transcriptText, 'utf-8');
      return reply.send({ text: transcriptText });
    }
  );

  app.delete(
    '/api/episodes/:episodeId/segments/:segmentId/transcript',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'ffmpeg', windowMs: 1000 })] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const query = request.query as { entryIndex?: string } | undefined;
      const entryIndex = query?.entryIndex ? parseInt(query.entryIndex, 10) : undefined;
      
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const segment = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment) return reply.status(404).send({ error: 'Segment not found' });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path)) return reply.status(404).send({ error: 'Segment audio not found' });
      const txtPath = transcriptPath(audio.path);
      if (!existsSync(txtPath)) return reply.status(404).send({ error: 'Transcript not found' });
      assertPathUnder(txtPath, audio.base);
      
      // If entryIndex is provided, delete that specific entry from audio and transcript
      if (typeof entryIndex === 'number') {
        const srtText = readFileSync(txtPath, 'utf-8');
        const entries = parseSrt(srtText);
        
        if (entryIndex < 0 || entryIndex >= entries.length) {
          return reply.status(404).send({ error: 'Transcript entry not found' });
        }
        
        const entryToRemove = entries[entryIndex]; // entryIndex is 0-based array index
        
        const startSec = parseSrtTime(entryToRemove.start);
        const endSec = parseSrtTime(entryToRemove.end);
        const removedDurationSec = endSec - startSec;
        
        // Remove segment from audio and export to WAV
        const { nanoid } = await import('nanoid');
        const isReusable = segment.type === 'reusable';
        let workingSourcePath = audio.path;
        let workingBase = audio.base;
        let tempSourcePath: string | null = null;
        if (isReusable) {
          const ext = audio.path.toLowerCase().endsWith('.webm')
            ? 'webm'
            : audio.path.toLowerCase().endsWith('.wav')
              ? 'wav'
              : audio.path.toLowerCase().endsWith('.ogg')
                ? 'ogg'
                : 'mp3';
          tempSourcePath = segmentPath(access.podcastId, episodeId, nanoid(), ext);
          copyFileSync(audio.path, tempSourcePath);
          workingSourcePath = tempSourcePath;
          workingBase = uploadsDir(access.podcastId, episodeId);
        }
        const newAudioPath = isReusable
          ? segmentPath(access.podcastId, episodeId, nanoid(), 'wav')
          : join(dirname(audio.path), `${nanoid()}.wav`);
        
        try {
          await audioService.removeSegmentAndExportToWav(
            workingSourcePath,
            workingBase,
            startSec,
            endSec,
            newAudioPath
          );
          if (tempSourcePath && existsSync(tempSourcePath)) {
            unlinkSync(tempSourcePath);
          }
          
          // Update transcript
          const updatedSrt = removeSrtEntryAndAdjustTimings(entries, entryIndex, removedDurationSec);
          const newTxtPath = transcriptPath(newAudioPath);
          
          // Write updated transcript to new location
          writeFileSync(newTxtPath, updatedSrt, 'utf-8');
          
          // Replace old audio file with new one and clean up old transcript
          if (!isReusable && audio.path !== newAudioPath) {
            unlinkSync(audio.path);
            // Delete old transcript if it exists and has a different name
            if (txtPath !== newTxtPath && existsSync(txtPath)) {
              unlinkSync(txtPath);
            }
          }
          let newDurationSec = removedDurationSec;
          try {
            const probe = await audioService.probeAudio(newAudioPath, uploadsDir(access.podcastId, episodeId));
            newDurationSec = probe.durationSec;
          } catch {
            // fallback: subtract removed duration if probe fails
            newDurationSec = Math.max(0, (segment.duration_sec as number | undefined ?? 0) - removedDurationSec);
          }
          if (isReusable) {
            db.prepare(
              `UPDATE episode_segments
               SET audio_path = ?, reusable_asset_id = NULL, type = 'recorded', duration_sec = ?
               WHERE id = ? AND episode_id = ?`
            ).run(newAudioPath, newDurationSec, segmentId, episodeId);
          } else {
            db.prepare('UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?').run(
              newAudioPath,
              newDurationSec,
              segmentId,
              episodeId
            );
          }
          
          return reply.send({ text: updatedSrt });
        } catch (err) {
          // Clean up new file if it exists
          try {
            if (existsSync(newAudioPath)) unlinkSync(newAudioPath);
          } catch {
            // ignore
          }
          request.log.error(err);
          return reply.status(500).send({ error: 'Failed to remove segment from audio' });
        }
      } else {
        // Delete entire transcript (original behavior)
        assertPathUnder(txtPath, audio.base);
        unlinkSync(txtPath);
        return reply.status(204).send();
      }
    }
  );

  app.delete(
    '/api/episodes/:episodeId/segments/:segmentId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as { episodeId: string; segmentId: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const row = db
        .prepare('SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?')
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: 'Segment not found' });
      const path = row.audio_path as string | null;
      const { unlinkSync } = await import('fs');
      let bytesFreed = 0;
      if (path && existsSync(path)) {
        const base = uploadsDir(access.podcastId, episodeId);
        assertPathUnder(path, base);
        try {
          bytesFreed = statSync(path).size;
        } catch {
          bytesFreed = 0;
        }
        unlinkSync(path);
        const txtPath = transcriptPath(path);
        if (existsSync(txtPath)) {
          try {
            assertPathUnder(txtPath, base);
            unlinkSync(txtPath);
          } catch {
            // ignore if transcript path escapes base
          }
        }
      }
      db.prepare('DELETE FROM episode_segments WHERE id = ? AND episode_id = ?').run(segmentId, episodeId);

      // Track disk usage (recorded segments only). Ignore transcript bytes per request.
      if (bytesFreed > 0) {
        db.prepare(
          `UPDATE users
           SET disk_bytes_used =
             CASE
               WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
               ELSE COALESCE(disk_bytes_used, 0) - ?
             END
           WHERE id = ?`
        ).run(bytesFreed, bytesFreed, request.userId);
      }

      return reply.status(204).send();
    }
  );

  app.post(
    '/api/episodes/:id/render',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'ffmpeg', windowMs: 1000 })] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const { podcastId } = access;
      const segments = db
        .prepare('SELECT * FROM episode_segments WHERE episode_id = ? ORDER BY position ASC, created_at ASC')
        .all(episodeId) as Record<string, unknown>[];
      if (segments.length === 0) {
        return reply.status(400).send({ error: 'Add at least one section before rendering.' });
      }
      const DATA_DIR = getDataDir();
      const paths: string[] = [];
      for (const s of segments) {
        if (s.type === 'recorded' && s.audio_path && existsSync(s.audio_path as string)) {
          assertPathUnder(s.audio_path as string, DATA_DIR);
          paths.push(s.audio_path as string);
        } else if (s.type === 'reusable' && s.reusable_asset_id) {
          const asset = db.prepare('SELECT audio_path FROM reusable_assets WHERE id = ?').get(s.reusable_asset_id) as { audio_path: string } | undefined;
          if (asset?.audio_path && existsSync(asset.audio_path)) {
            assertPathUnder(asset.audio_path, DATA_DIR);
            paths.push(asset.audio_path);
          }
        }
      }
      if (paths.length === 0) return reply.status(400).send({ error: 'No valid segment audio found.' });
      const copyrightLines: string[] = [];
      for (const s of segments) {
        if (s.type === 'reusable' && s.reusable_asset_id) {
          const asset = db
            .prepare('SELECT name, copyright FROM reusable_assets WHERE id = ?')
            .get(s.reusable_asset_id) as { name: string; copyright: string | null } | undefined;
          const copyright = asset?.copyright != null ? String(asset.copyright).trim() : '';
          if (copyright) {
            const name = (s.name != null && String(s.name).trim() !== '') ? String(s.name).trim() : (asset?.name ?? '');
            copyrightLines.push(`${name || 'Segment'} by ${copyright}`);
          }
        }
      }
      const descriptionCopyrightSnapshot = copyrightLines.length > 0 ? copyrightLines.join('\n') : null;
      const settings = readSettings();
      const outPath = audioService.getFinalOutputPath(podcastId, episodeId, settings.final_format);
      try {
        await audioService.concatToFinal(paths, outPath, {
          format: settings.final_format,
          bitrateKbps: settings.final_bitrate_kbps,
          channels: settings.final_channels,
        });
        const meta = await audioService.getAudioMetaAfterProcess(podcastId, episodeId, settings.final_format);
        db.prepare(
          `UPDATE episodes SET
            audio_final_path = ?,
            audio_source_path = ?,
            audio_mime = ?,
            audio_bytes = ?,
            audio_duration_sec = ?,
            description_copyright_snapshot = ?,
            updated_at = datetime('now')
           WHERE id = ?`
        ).run(outPath, outPath, meta.mime, meta.sizeBytes, meta.durationSec, descriptionCopyrightSnapshot, episodeId);
        try {
          writeRssFile(podcastId, null);
        } catch (err) {
          request.log.warn({ err, podcastId }, 'Failed to regenerate RSS feed after episode render');
        }
        try {
          await audioService.generateWaveformFile(outPath, processedDir(podcastId, episodeId));
        } catch (err) {
          request.log.warn({ err, episodeId }, 'Waveform generation failed after render');
        }
        const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown>;
        return row;
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Render failed' });
      }
    }
  );
}
