import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { config, isR2Configured } from '../config';
import { createUploadUrl, getObjectInfo, createDownloadUrl } from '../services/r2';
import crypto from 'node:crypto';

const router = Router();
const allowedAudio = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg', 'audio/webm']);
const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  contentType: z.string().refine(v => allowedAudio.has(v), 'Unsupported audio MIME type'),
  sizeBytes: z.number().int().positive().max(config.MAX_UPLOAD_BYTES)
});
const metadataSchema = z.object({
  uploadId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(180),
  artistName: z.string().trim().min(1).max(180),
  albumName: z.string().trim().max(180).optional().nullable(),
  genre: z.string().trim().max(80).optional().nullable(),
  coverKey: z.string().trim().max(500).optional().nullable(),
  durationSeconds: z.number().int().nonnegative().optional().nullable()
});

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, artist_name AS artist, album_name AS album, genre, cover_key, duration_seconds, created_at FROM songs WHERE status = 'published' ORDER BY created_at DESC LIMIT 100"
    );
    return res.json({ songs: result.rows });
  } catch (err) {
    console.error('Songs list error:', err);
    return res.status(500).json({ error: 'Could not load songs' });
  }
});

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ songs: [] });
  try {
    const result = await pool.query(
      "SELECT id, title, artist_name AS artist, album_name AS album, genre, cover_key, duration_seconds FROM songs WHERE status = 'published' AND (title ILIKE $1 OR artist_name ILIKE $1 OR COALESCE(album_name,'') ILIKE $1) ORDER BY title LIMIT 50",
      [`%${q.replace(/[%_\\]/g, '\\$&')}%`]
    );
    return res.json({ songs: result.rows });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Search unavailable' });
  }
});

router.get('/admin', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, artist_name, album_name, genre, audio_key, cover_key, mime_type, file_size_bytes, duration_seconds, status, created_at, updated_at FROM songs ORDER BY created_at DESC LIMIT 500"
    );
    const counts = await pool.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='published')::int AS published, COUNT(*) FILTER (WHERE status='draft')::int AS drafts FROM songs"
    );
    return res.json({ songs: result.rows, stats: counts.rows[0] });
  } catch (err) {
    console.error('Admin songs error:', err);
    return res.status(500).json({ error: 'Could not load admin songs' });
  }
});

router.post('/admin/uploads/presign', requireAuth, requireAdmin, async (req, res) => {
  if (!isR2Configured()) return res.status(503).json({ error: 'Audio storage is not configured on the server' });
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const safeName = parsed.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const key = `audio/${crypto.randomUUID()}-${safeName}`;
    const upload = await pool.query(
      "INSERT INTO upload_jobs (admin_id, object_key, original_filename, mime_type, expected_size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [req.authUser!.id, key, parsed.data.filename, parsed.data.contentType, parsed.data.sizeBytes]
    );
    const uploadUrl = await createUploadUrl(key, parsed.data.contentType);
    return res.status(201).json({
      uploadId: upload.rows[0].id,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': parsed.data.contentType },
      objectKey: key,
      expiresInSeconds: config.SIGNED_URL_SECONDS,
      maxBytes: config.MAX_UPLOAD_BYTES
    });
  } catch (err) {
    console.error('Presign error:', err);
    return res.status(500).json({ error: 'Could not authorize upload' });
  }
});

router.post('/admin/uploads/:uploadId/complete', requireAuth, requireAdmin, async (req, res) => {
  if (!isR2Configured()) return res.status(503).json({ error: 'Audio storage is not configured' });
  const id = Number(req.params.uploadId);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid upload id' });
  const parsed = metadataSchema.omit({ uploadId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const jobResult = await pool.query(
      "SELECT * FROM upload_jobs WHERE id=$1 AND admin_id=$2 AND status='pending' LIMIT 1",
      [id, req.authUser!.id]
    );
    const job = jobResult.rows[0];
    if (!job) return res.status(404).json({ error: 'Pending upload not found' });
    const head = await getObjectInfo(job.object_key);
    if (!head.ContentLength || Number(head.ContentLength) !== Number(job.expected_size_bytes)) {
      return res.status(400).json({ error: 'Uploaded object size does not match expected size' });
    }
    if (head.ContentType && head.ContentType !== job.mime_type) {
      return res.status(400).json({ error: 'Uploaded content type does not match' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const song = await client.query(
        "INSERT INTO songs (title, artist_name, album_name, genre, audio_key, cover_key, mime_type, file_size_bytes, duration_seconds, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) RETURNING id, title, status",
        [parsed.data.title, parsed.data.artistName, parsed.data.albumName || null, parsed.data.genre || null,
          job.object_key, parsed.data.coverKey || null, job.mime_type, job.expected_size_bytes,
          parsed.data.durationSeconds ?? null, req.authUser!.id]
      );
      await client.query("UPDATE upload_jobs SET status='completed', updated_at=NOW() WHERE id=$1", [id]);
      await client.query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1,'song_uploaded','song',$2)",
        [req.authUser!.id, String(song.rows[0].id)]
      );
      await client.query('COMMIT');
      return res.status(201).json({ song: song.rows[0], message: 'Upload verified and saved as draft. Publish after reviewing metadata and playback.' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Upload completion error:', err);
    return res.status(500).json({ error: 'Could not verify and save upload' });
  }
});

router.patch('/admin/:id/publish', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid song id' });
  try {
    const result = await pool.query(
      "UPDATE songs SET status='published', updated_at=NOW() WHERE id=$1 AND status IN ('draft','unpublished') RETURNING id,title,status",
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Draft song not found' });
    await pool.query(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1,'song_published','song',$2)",
      [req.authUser!.id, String(id)]
    );
    return res.json({ song: result.rows[0] });
  } catch (err) {
    console.error('Publish error:', err);
    return res.status(500).json({ error: 'Could not publish song' });
  }
});

router.patch('/admin/:id/unpublish', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid song id' });
  try {
    const result = await pool.query(
      "UPDATE songs SET status='unpublished', updated_at=NOW() WHERE id=$1 AND status='published' RETURNING id,title,status",
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Published song not found' });
    return res.json({ song: result.rows[0] });
  } catch (err) {
    console.error('Unpublish error:', err);
    return res.status(500).json({ error: 'Could not unpublish song' });
  }
});

router.get('/:id/stream', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid song id' });
  try {
    const result = await pool.query(
      "SELECT audio_key FROM songs WHERE id=$1 AND status='published' LIMIT 1", [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Song not found' });
    if (!isR2Configured()) return res.status(503).json({ error: 'Audio storage is not configured' });
    const url = await createDownloadUrl(result.rows[0].audio_key);
    return res.redirect(302, url);
  } catch (err) {
    console.error('Stream URL error:', err);
    return res.status(500).json({ error: 'Could not create stream URL' });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid song id' });
  try {
    const result = await pool.query(
      "SELECT id, title, artist_name AS artist, album_name AS album, genre, cover_key, duration_seconds, status FROM songs WHERE id=$1 AND status='published' LIMIT 1",
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Song not found' });
    return res.json({ song: result.rows[0] });
  } catch (err) {
    console.error('Song detail error:', err);
    return res.status(500).json({ error: 'Could not load song' });
  }
});

export default router;
