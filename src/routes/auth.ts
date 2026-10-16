import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200)
});

router.post('/admin/bootstrap', async (req, res) => {
  const token = req.header('x-bootstrap-token');
  if (!token || token !== config.ADMIN_BOOTSTRAP_TOKEN) {
    return res.status(403).json({ error: 'Invalid bootstrap token' });
  }
  const schema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(12).max(200),
    displayName: z.string().trim().min(1).max(80)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An admin already exists; bootstrap is disabled' });
    }
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const created = await client.query(
      "INSERT INTO users (email, password_hash, display_name, role) VALUES (lower($1), $2, $3, 'admin') RETURNING id, email, display_name, role",
      [parsed.data.email, hash, parsed.data.displayName]
    );
    await client.query(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1, 'admin_bootstrap', 'user', $1)",
      [created.rows[0].id]
    );
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Initial admin created. Remove or rotate ADMIN_BOOTSTRAP_TOKEN now.', user: created.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin bootstrap error:', err);
    return res.status(500).json({ error: 'Could not create initial admin' });
  } finally {
    client.release();
  }
});

router.post('/admin/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password format' });
  try {
    const result = await pool.query(
      "SELECT id, email, display_name, password_hash, role, status FROM users WHERE email = lower($1) AND role = 'admin' LIMIT 1",
      [parsed.data.email]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active' || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { email: user.email, role: user.role, status: user.status, name: user.display_name },
      config.JWT_SECRET,
      { subject: String(user.id), expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );
    await pool.query(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1, 'admin_login', 'user', $1)",
      [user.id]
    );
    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Login service unavailable' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});

export default router;
