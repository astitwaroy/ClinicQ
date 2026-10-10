import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { hashPassword, requireOwner, requireStaff } from '../lib/auth.js';
import { conflict, forbidden, isUniqueViolation } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { clinicAnalytics } from '../services/analytics.js';
import { addSamplePatients, noteStaffAction, resetDemoToday } from '../services/demo.js';
import {
  advance,
  callToken,
  getClinicById,
  issueToken,
  requeue,
  staffSnapshot,
  updateClinic,
} from '../services/queue.js';
import { broadcast } from '../services/realtime.js';

/** Everything the doctor's desk and clinic owner can do. All routes are scoped to the signed-in user's clinic. */
export const staffRouter = Router();
staffRouter.use(requireStaff);

const cid = (req: Express.Request & { user?: { clinicId: string } }) => req.user!.clinicId;

function changed(clinicId: string) {
  noteStaffAction(clinicId);
  broadcast(clinicId);
}

staffRouter.get(
  '/queue',
  ah(async (req, res) => {
    res.json(await staffSnapshot(cid(req)));
  }),
);

const Advance = z.object({ mode: z.enum(['next', 'no_show', 'finish']) });
staffRouter.post(
  '/queue/advance',
  ah(async (req, res) => {
    const { mode } = parse(Advance, req.body);
    const r = await advance(cid(req), mode);
    changed(cid(req));
    res.json({ finished: r.finished?.number ?? null, called: r.called?.number ?? null });
  }),
);

const IdParam = z.object({ id: z.uuid() });
staffRouter.post(
  '/queue/:id/call',
  ah(async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const t = await callToken(cid(req), id);
    changed(cid(req));
    res.json({ called: t.number });
  }),
);

staffRouter.post(
  '/queue/:id/requeue',
  ah(async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const t = await requeue(cid(req), id);
    changed(cid(req));
    res.json({ requeued: t.number });
  }),
);

const WalkIn = z.object({
  patientName: z.string().trim().min(2, 'Please enter the patient name.').max(60),
  phone: z.string().trim().max(16).default(''),
  reason: z.string().trim().max(120).optional(),
});
staffRouter.post(
  '/queue/walkin',
  ah(async (req, res) => {
    const b = parse(WalkIn, req.body);
    const t = await issueToken(cid(req), { ...b, source: 'walkin' });
    changed(cid(req));
    res.status(201).json({ number: t.number, code: t.public_code });
  }),
);

const Settings = z
  .object({
    name: z.string().trim().min(2).max(80),
    doctorName: z.string().trim().max(80),
    address: z.string().trim().max(160),
    phone: z.string().trim().max(20),
    defaultConsultSecs: z.number().int().min(60).max(3600),
    dailyLimit: z.number().int().min(1).max(500),
    bookingOpen: z.boolean(),
    paused: z.boolean(),
    pauseMessage: z.string().trim().max(140),
  })
  .partial();
staffRouter.patch(
  '/clinic',
  ah(async (req, res) => {
    const s = parse(Settings, req.body);
    const clinic = await getClinicById(cid(req));
    // The public demo keeps its name and details; queue controls still work.
    if (clinic.is_demo) {
      if ([s.name, s.doctorName, s.address, s.phone].some((v) => v !== undefined)) {
        throw forbidden('Clinic details are locked in the demo. Booking, pause and limits still work.');
      }
      // Free text would be shown on the public demo screens, so the demo uses a fixed message.
      if (s.pauseMessage !== undefined) s.pauseMessage = 'Back in 15 minutes.';
    }
    await updateClinic(cid(req), s);
    changed(cid(req));
    res.json({ ok: true });
  }),
);

staffRouter.get(
  '/analytics',
  ah(async (req, res) => {
    const days = Math.min(60, Math.max(7, Number(req.query.days) || 14));
    res.json(await clinicAnalytics(cid(req), days));
  }),
);

// ----------------------------------------------------------------- team

staffRouter.get(
  '/team',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, created_at AS "createdAt" FROM users WHERE clinic_id = $1 ORDER BY created_at`,
      [cid(req)],
    );
    res.json(rows);
  }),
);

const NewStaff = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.email().max(120),
  password: z.string().min(8, 'use at least 8 characters').max(100),
});
staffRouter.post(
  '/team',
  requireOwner,
  ah(async (req, res) => {
    const b = parse(NewStaff, req.body);
    const clinic = await getClinicById(cid(req));
    if (clinic.is_demo) throw forbidden('Adding staff is turned off in the demo.');
    try {
      await pool.query(
        `INSERT INTO users (clinic_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'staff')`,
        [cid(req), b.name, b.email, await hashPassword(b.password)],
      );
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_key')) throw conflict('An account with this email already exists.');
      throw err;
    }
    res.status(201).json({ ok: true });
  }),
);

staffRouter.delete(
  '/team/:id',
  requireOwner,
  ah(async (req, res) => {
    const { id } = parse(IdParam, req.params);
    if (id === req.user!.id) throw forbidden('You cannot remove yourself.');
    await pool.query(`DELETE FROM users WHERE id = $1 AND clinic_id = $2 AND role = 'staff'`, [id, cid(req)]);
    res.json({ ok: true });
  }),
);

// ----------------------------------------------------------------- demo only

async function demoOnly(clinicId: string) {
  const clinic = await getClinicById(clinicId);
  if (!clinic.is_demo) throw forbidden('Only available in the demo clinic.');
}

staffRouter.post(
  '/demo/sample-patients',
  ah(async (req, res) => {
    await demoOnly(cid(req));
    await addSamplePatients(cid(req), 4);
    changed(cid(req));
    res.json({ ok: true });
  }),
);

staffRouter.post(
  '/demo/reset',
  ah(async (req, res) => {
    await demoOnly(cid(req));
    await resetDemoToday(cid(req));
    changed(cid(req));
    res.json({ ok: true });
  }),
);
