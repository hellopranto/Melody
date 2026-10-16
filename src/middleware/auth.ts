import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { AuthUser } from '../types';

declare global {
  namespace Express {
    interface Request { authUser?: AuthUser }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub || !payload.email || !payload.role || !payload.status || !payload.name) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.authUser = {
      id: Number(payload.sub),
      email: String(payload.email),
      role: payload.role as 'user' | 'admin',
      status: payload.status as 'active' | 'disabled',
      display_name: String(payload.name)
    };
    if (req.authUser.status !== 'active') {
      return res.status(403).json({ error: 'Account disabled' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser || req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}
