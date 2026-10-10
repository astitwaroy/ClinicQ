import { pool, tx } from '../db/pool.js';
import { hashPassword } from '../lib/auth.js';
import { advance, clinicToday, issueToken, newPublicCode, publicSnapshot } from './queue.js';

/**
 * The public demo: "Sunrise Family Clinic" with two weeks of history, a live queue for today,
 * and an autopilot that keeps the queue moving when nobody is using the doctor's desk.
 * All names are made up. Seeded tokens have no phone numbers.
 */

export const DEMO_SLUG = 'sunrise';
export const DEMO_EMAIL = 'demo@clinicq.app';
export const DEMO_PASSWORD = 'demo1234';
const IST_OFFSET_MIN = 330;

const FIRST = ['Aarav', 'Ananya', 'Rohan', 'Priya', 'Kabir', 'Meera', 'Arjun', 'Diya', 'Vikram', 'Sneha', 'Rahul',
  'Isha', 'Aditya', 'Kavya', 'Siddharth', 'Neha', 'Farhan', 'Pooja', 'Manoj', 'Lakshmi', 'Imran', 'Ritu', 'Suresh',
  'Fatima', 'Harpreet', 'Joseph', 'Nandini', 'Gaurav', 'Sana', 'Deepak', 'Anjali', 'Tenzin', 'Bhavna', 'Kiran'];
const LAST = ['S.', 'K.', 'R.', 'M.', 'P.', 'D.', 'B.', 'N.', 'G.', 'T.', 'A.', 'V.'];
const REASONS = ['Fever and cough', 'Follow-up visit', 'BP check', 'Diabetes review', 'Child vaccination',
  'Skin rash', 'Back pain', 'Prescription renewal', 'Stomach ache', 'Headache', 'Sore throat', '', '', ''];

/** Small seeded PRNG so the demo history is the same on every fresh database. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const randName = (r: Rng) => `${pick(r, FIRST)} ${pick(r, LAST)}`;
/** Log-normal consultation length centred near 6.5 minutes. */
const consultSecs = (r: Rng) => Math.round(Math.exp(Math.log(390) + 0.35 * gauss(r)));
function gauss(r: Rng) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/** A Date for a wall-clock time in India on a YYYY-MM-DD day. */
function istDate(day: string, minutesFromMidnight: number): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + (minutesFromMidnight - IST_OFFSET_MIN) * 60_000);
}
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function ensureDemoClinic(): Promise<string> {
  const existing = await pool.query<{ id: string }>('SELECT id FROM clinics WHERE slug = $1', [DEMO_SLUG]);
  if (existing.rows[0]) return existing.rows[0].id;
  const hash = await hashPassword(DEMO_PASSWORD);
  const id = await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO clinics (slug, name, doctor_name, address, phone, default_consult_secs, daily_limit, is_demo)
       VALUES ($1, 'Sunrise Family Clinic', 'Dr. Meera Iyer', '14 Lake View Road, near City Bus Stand', '', 420, 150, true)
       RETURNING id`,
      [DEMO_SLUG],
    );
    const clinicId = rows[0]!.id;
    await c.query(
      `INSERT INTO users (clinic_id, name, email, password_hash, role) VALUES ($1, 'Demo Reception', $2, $3, 'owner')`,
      [clinicId, DEMO_EMAIL, hash],
    );
    return clinicId;
  });
  await seedHistory(id);
  return id;
}

/** 14 days of realistic history (closed on Sundays) so the analytics page has something to show. */
export async function seedHistory(clinicId: string, days = 14): Promise<void> {
  const today = await clinicToday(clinicId);
  const r = mulberry32(2026);
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (let back = days; back >= 1; back--) {
    const day = addDays(today, -back);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue; // Sunday: closed
    const sessions = [
      { start: 9 * 60 + 30, end: 13 * 60, n: 18 + Math.floor(r() * 10) },
      { start: 17 * 60, end: 20 * 60 + 30, n: 12 + Math.floor(r() * 9) },
    ];
    const arrivals: number[] = [];
    for (const s of sessions) {
      for (let i = 0; i < s.n; i++) arrivals.push(s.start - 45 + r() * (s.end - s.start));
    }
    arrivals.sort((a, b) => a - b);
    let doctorFree = 0;
    arrivals.forEach((arrive, idx) => {
      const session = arrive < 15 * 60 ? sessions[0]! : sessions[1]!;
      const roll = r();
      const status = roll < 0.03 ? 'cancelled' : roll < 0.09 ? 'no_show' : 'done';
      const callAt = Math.max(arrive + 2, session.start, doctorFree);
      const dur = status === 'no_show' ? 120 : consultSecs(r);
      if (status !== 'cancelled') doctorFree = callAt + dur / 60;
      const created = istDate(day, arrive);
      const called = status === 'cancelled' ? null : istDate(day, callAt);
      const completed = status === 'cancelled' ? null : istDate(day, callAt + dur / 60);
      const cancelled = status === 'cancelled' ? istDate(day, arrive + 10) : null;
      const row = [clinicId, day, idx + 1, newPublicCode(10), randName(r), pick(r, REASONS),
        r() < 0.62 ? 'online' : 'walkin', status, created, called, completed, cancelled];
      const base = values.length;
      values.push(...row);
      tuples.push(`(${row.map((_, i) => `$${base + i + 1}`).join(',')})`);
    });
  }
  // Insert in chunks to stay under the parameter limit.
  const per = 12;
  for (let i = 0; i < tuples.length; i += 400) {
    const slice = tuples.slice(i, i + 400);
    const vals = values.slice(i * per, (i + slice.length) * per);
    const renumbered = slice.map((_, k) => `(${Array.from({ length: per }, (_, j) => `$${k * per + j + 1}`).join(',')})`);
    await pool.query(
      `INSERT INTO tokens (clinic_id, service_date, number, queue_pos, public_code, patient_name, phone, reason,
                           source, status, created_at, called_at, completed_at, cancelled_at)
       SELECT v.c::uuid, v.d::date, v.n::int, v.n::numeric, v.code, v.name, '', v.reason, v.src, v.st,
              v.cr::timestamptz, v.ca::timestamptz, v.co::timestamptz, v.cx::timestamptz
         FROM (VALUES ${renumbered.join(',')}) AS v(c, d, n, code, name, reason, src, st, cr, ca, co, cx)`,
      vals,
    );
  }
}

/** Make sure today's demo queue is not empty: a few patients seen, one with the doctor, several waiting. */
export async function ensureDemoToday(clinicId: string): Promise<void> {
  const today = await clinicToday(clinicId);
  const { rows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM tokens WHERE clinic_id = $1 AND service_date = $2',
    [clinicId, today],
  );
  if ((rows[0]?.n ?? 0) > 0) return;
  const r = mulberry32(Date.now() % 100000);
  const now = Date.now();
  const plan: { status: 'done' | 'serving' | 'waiting' | 'no_show' }[] = [
    { status: 'done' }, { status: 'done' }, { status: 'no_show' }, { status: 'done' }, { status: 'done' },
    { status: 'serving' }, { status: 'waiting' }, { status: 'waiting' }, { status: 'waiting' },
    { status: 'waiting' }, { status: 'waiting' }, { status: 'waiting' },
  ];
  let t = now - 48 * 60_000; // first patient called 48 minutes ago
  await tx(async (c) => {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i]!;
      const created = new Date(now - (70 - i * 5) * 60_000);
      let called: Date | null = null;
      let completed: Date | null = null;
      if (p.status === 'done' || p.status === 'no_show') {
        const dur = p.status === 'no_show' ? 90 : consultSecs(r);
        called = new Date(t);
        completed = new Date(t + dur * 1000);
        t += dur * 1000;
      } else if (p.status === 'serving') {
        called = new Date(now - 3 * 60_000);
      }
      await c.query(
        `INSERT INTO tokens (clinic_id, service_date, number, queue_pos, public_code, patient_name, phone, reason,
                             source, status, created_at, called_at, completed_at)
         VALUES ($1, $2, $3::int, $3::int, $4, $5, '', $6, $7, $8, $9, $10, $11)`,
        [clinicId, today, i + 1, newPublicCode(), randName(r), pick(r, REASONS),
          r() < 0.6 ? 'online' : 'walkin', p.status, created, called, completed],
      );
    }
    await c.query(
      `INSERT INTO daily_counters (clinic_id, service_date, last_number) VALUES ($1, $2, $3)
       ON CONFLICT (clinic_id, service_date) DO UPDATE SET last_number = EXCLUDED.last_number`,
      [clinicId, today, plan.length],
    );
  });
}

export async function resetDemoToday(clinicId: string): Promise<void> {
  const today = await clinicToday(clinicId);
  await tx(async (c) => {
    await c.query('DELETE FROM tokens WHERE clinic_id = $1 AND service_date = $2', [clinicId, today]);
    await c.query('DELETE FROM daily_counters WHERE clinic_id = $1 AND service_date = $2', [clinicId, today]);
    await c.query(
      `UPDATE clinics SET booking_open = true, paused = false, pause_message = '', daily_limit = 150,
              default_consult_secs = 420 WHERE id = $1`,
      [clinicId],
    );
  });
  await ensureDemoToday(clinicId);
}

/** Add a few made-up walk-in patients (demo console button). */
export async function addSamplePatients(clinicId: string, n = 4): Promise<void> {
  const r = mulberry32(Date.now() % 1_000_000);
  for (let i = 0; i < n; i++) {
    await issueToken(clinicId, { patientName: randName(r), phone: '', reason: pick(r, REASONS), source: 'walkin' });
  }
}

// ------------------------------------------------------------- autopilot

const lastStaffAction = new Map<string, number>();
export function noteStaffAction(clinicId: string) {
  lastStaffAction.set(clinicId, Date.now());
}

/**
 * Keeps the public demo alive for visitors: calls the next patient when a consultation has run
 * its course and adds a new patient now and then. Stands down for 5 minutes after any real
 * action at the doctor's desk, so a visitor driving the console is never overridden.
 */
export async function autopilotTick(clinicId: string, onChange: () => void): Promise<void> {
  const idle = Date.now() - (lastStaffAction.get(clinicId) ?? 0);
  if (idle < 5 * 60_000) return;
  let changed = false;
  try {
    await tick(clinicId, idle, () => (changed = true));
  } finally {
    if (changed) onChange();
  }
}

async function tick(clinicId: string, idleMs: number, changed: () => void): Promise<void> {
  let snap = await publicSnapshot(clinicId);
  // A visitor may have paused the demo or closed booking; put it back after 10 quiet minutes.
  if ((snap.clinic.paused || !snap.clinic.bookingOpen) && idleMs > 10 * 60_000) {
    await pool.query(
      `UPDATE clinics SET paused = false, booking_open = true, pause_message = '', daily_limit = 150 WHERE id = $1`,
      [clinicId],
    );
    changed();
    snap = await publicSnapshot(clinicId);
  }
  if (snap.clinic.paused) return;
  const r = Math.random;
  const consult = snap.consultSecs;
  if (snap.serving) {
    const elapsed = (Date.now() - Date.parse(snap.serving.calledAt)) / 1000;
    if (elapsed > consult * (0.75 + r() * 0.5)) {
      await advance(clinicId, r() < 0.05 ? 'no_show' : 'next');
      changed();
    }
  } else if (snap.waiting.length) {
    await advance(clinicId, 'next');
    changed();
  }
  if (snap.waiting.length < 5 && snap.issuedToday < snap.clinic.dailyLimit - 5 && r() < 0.5) {
    await issueToken(clinicId, {
      patientName: randName(r),
      phone: '',
      reason: pick(r, REASONS),
      source: 'walkin', // walk-ins are accepted even if a visitor closed online booking
    });
    changed();
  }
}

/** Privacy: strip phone numbers and names from tokens older than a week. */
export async function anonymizeOldTokens(): Promise<number> {
  const res = await pool.query(
    `UPDATE tokens SET phone = '', patient_name = 'Patient', reason = ''
      WHERE service_date < current_date - 7 AND (phone <> '' OR patient_name <> 'Patient')`,
  );
  return res.rowCount ?? 0;
}
