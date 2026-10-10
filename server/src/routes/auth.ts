import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { tx } from '../db/pool.js';
import {
  clearSessionCookie,
  hashPassword,
  requireStaff,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth.js';
import { AppError, conflict, isUniqueViolation, unauthorized } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { pool } from '../db/pool.js';
import { getClinicById } from '../services/queue.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } },
});

const RESERVED_SLUGS = new Set(['app', 'api', 'admin', 'login', 'signup', 'display', 'c', 't', 'static', 'assets']);

const SignupBody = z.object({
  clinicName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$/, 'use 3–40 lowercase letters, numbers or dashes'),
  doctorName: z.string().trim().max(80).default(''),
  ownerName: z.string().trim().min(2).max(60),
  email: z.email().max(120),
  password: z.string().min(8, 'use at least 8 characters').max(100),
});

const LoginBody = z.object({ email: z.string().trim().min(3), password: z.string().min(1) });

authRouter.post(
  '/signup',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(SignupBody, req.body);
    if (RESERVED_SLUGS.has(b.slug)) throw conflict('That link name is reserved. Try another.', 'SLUG_TAKEN');
    const hash = await hashPassword(b.password);
    try {
      const userId = await tx(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO clinics (slug, name, doctor_name) VALUES ($1, $2, $3) RETURNING id`,
          [b.slug, b.clinicName, b.doctorName],
        );
        const { rows: u } = await c.query<{ id: string }>(
          `INSERT INTO users (clinic_id, name, email, password_hash, role)
           VALUES ($1, $2, $3, $4, 'owner') RETURNING id`,
          [rows[0]!.id, b.ownerName, b.email, hash],
        );
        return u[0]!.id;
      });
      setSessionCookie(res, userId);
      res.status(201).json({ ok: true });
    } catch (err) {
      if (isUniqueViolation(err, 'clinics_slug_key')) throw conflict('That clinic link is already taken.', 'SLUG_TAKEN');
      if (isUniqueViolation(err, 'users_email_key')) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
      throw err;
    }
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(LoginBody, req.body);
    const { rows } = await pool.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE lower(email) = lower($1)',
      [b.email],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(b.password, user.password_hash))) {
      throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect.');
    }
    setSessionCookie(res, user.id);
    res.json({ ok: true });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireStaff,
  ah(async (req, res) => {
    if (!req.user) throw unauthorized();
    const clinic = await getClinicById(req.user.clinicId);
    res.json({
      user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role },
      clinic: {
        id: clinic.id,
        slug: clinic.slug,
        name: clinic.name,
        doctorName: clinic.doctor_name,
        address: clinic.address,
        phone: clinic.phone,
        defaultConsultSecs: clinic.default_consult_secs,
        dailyLimit: clinic.daily_limit,
        bookingOpen: clinic.booking_open,
        paused: clinic.paused,
        pauseMessage: clinic.pause_message,
        isDemo: clinic.is_demo,
      },
    });
  }),
);
