import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, corsOrigins } from './config';
import { pool } from './db/pool';
import authRoutes from './routes/auth';
import songRoutes from './routes/songs';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Bootstrap-Token']
}));
app.use(express.json({ limit: '1mb' }));

const generalLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
app.use(generalLimiter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'melody-backend', database: 'connected' });
  } catch {
    return res.status(503).json({ ok: false, service: 'melody-backend', database: 'unavailable' });
  }
});

app.get('/', (_req, res) => res.json({ name: 'Melody API', version: '1.0.0', docs: '/api' }));
app.get('/api', (_req, res) => res.json({
  endpoints: {
    health: 'GET /health',
    adminBootstrap: 'POST /api/auth/admin/bootstrap (one-time)',
    adminLogin: 'POST /api/auth/admin/login',
    currentUser: 'GET /api/auth/me',
    songs: 'GET /api/songs',
    search: 'GET /api/songs/search?q=term',
    song: 'GET /api/songs/:id',
    stream: 'GET /api/songs/:id/stream',
    adminSongs: 'GET /api/songs/admin',
    createUploadUrl: 'POST /api/songs/admin/uploads/presign',
    completeUpload: 'POST /api/songs/admin/uploads/:uploadId/complete',
    publish: 'PATCH /api/songs/admin/:id/publish',
    unpublish: 'PATCH /api/songs/admin/:id/unpublish'
  }
}));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/songs', songRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof Error && err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed by CORS' });
  }
  console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown error');
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.PORT, () => {
  console.log(`Melody API listening on port ${config.PORT}`);
});
