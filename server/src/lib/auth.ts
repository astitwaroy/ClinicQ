import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { forbidden, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'cq_session';
const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  clinicId: string;
  role: 'owner' | 'staff';
  name: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function setSessionCookie(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolve a session token to a live user (the account may have been removed since login). */
export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  let sub: string;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string };
    if (!payload.sub) return null;
    sub = payload.sub;
  } catch {
    return null;
  }
  const { rows } = await pool.query<SessionUser>(
    `SELECT id, clinic_id AS "clinicId", role, name, email FROM users WHERE id = $1`,
    [sub],
  );
  return rows[0] ?? null;
}

/** Express middleware: requires a signed-in clinic user. */
export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await userFromToken(req.cookies?.[SESSION_COOKIE]);
    if (!user) return next(unauthorized());
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'owner') return next(forbidden('Only the clinic owner can do this.'));
  next();
}

/** Parse a raw Cookie header (used by the websocket handshake). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
