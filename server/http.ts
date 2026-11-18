import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // express.json() parse errors
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}

/**
 * CSRF guard for state-changing requests: browsers always send Origin on
 * cross-site POSTs, so reject any that don't come from the app itself.
 * Session cookies are also SameSite=Lax.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin && !config.appOrigins.includes(origin)) {
    return next(new HttpError(403, 'BAD_ORIGIN', 'Request origin not allowed.'));
  }
  if (!req.is('application/json')) {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected a JSON request body.'));
  }
  next();
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function str(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new HttpError(400, 'VALIDATION', `"${field}" is required.`);
  }
  return value.trim();
}
