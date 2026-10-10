import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { ah, parse } from '../lib/http.js';
import {
  cancelByCode,
  getClinicBySlug,
  getTokenByCode,
  issueToken,
  publicSnapshot,
} from '../services/queue.js';
import { broadcast } from '../services/realtime.js';

export const publicRouter = Router();

const bookingLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many bookings from this device. Please wait a few minutes.' } },
});

const BookingBody = z.object({
  patientName: z.string().trim().min(2, 'Please enter the patient name.').max(60),
  phone: z.string().trim().min(10, 'Enter a valid 10-digit mobile number.').max(16),
  reason: z.string().trim().max(120).optional(),
});

/** Clinic page: details + live queue summary. */
publicRouter.get(
  '/clinics/:slug',
  ah(async (req, res) => {
    const clinic = await getClinicBySlug(String(req.params.slug));
    res.json(await publicSnapshot(clinic.id));
  }),
);

/** Patient books a token online. */
publicRouter.post(
  '/clinics/:slug/tokens',
  bookingLimiter,
  ah(async (req, res) => {
    const body = parse(BookingBody, req.body);
    const clinic = await getClinicBySlug(String(req.params.slug));
    const token = await issueToken(clinic.id, { ...body, source: 'online' });
    broadcast(clinic.id);
    res.status(201).json({ code: token.public_code, number: token.number });
  }),
);

/** Token tracking page: the patient's own token + the clinic's live queue. */
publicRouter.get(
  '/tokens/:code',
  ah(async (req, res) => {
    const t = await getTokenByCode(String(req.params.code));
    res.json({
      token: {
        code: t.public_code,
        number: t.number,
        status: t.status,
        // First name only: the link may be shared with family.
        patientName: t.patient_name.split(' ')[0],
        serviceDate: t.service_date,
        createdAt: t.created_at.toISOString(),
        calledAt: t.called_at?.toISOString() ?? null,
        completedAt: t.completed_at?.toISOString() ?? null,
      },
      queue: await publicSnapshot(t.clinic_id),
    });
  }),
);

publicRouter.post(
  '/tokens/:code/cancel',
  ah(async (req, res) => {
    const t = await cancelByCode(String(req.params.code));
    broadcast(t.clinic_id);
    res.json({ ok: true });
  }),
);
