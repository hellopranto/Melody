import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('2h'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  ADMIN_BOOTSTRAP_TOKEN: z.string().min(24, 'ADMIN_BOOTSTRAP_TOKEN must be at least 24 characters'),
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET_NAME: z.string().optional().default(''),
  R2_ENDPOINT: z.string().optional().default(''),
  R2_REGION: z.string().default('auto'),
  R2_PUBLIC_BASE_URL: z.string().optional().default(''),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(52428800),
  SIGNED_URL_SECONDS: z.coerce.number().int().min(60).max(900).default(300)
});

export const config = schema.parse(process.env);
export const corsOrigins = config.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

export function isR2Configured(): boolean {
  return Boolean(config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET_NAME &&
    (config.R2_ENDPOINT || config.R2_ACCOUNT_ID));
}
