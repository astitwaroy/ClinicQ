import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { pool, tx, type Db } from '../db/pool.js';
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { estimateConsultSecs } from '../lib/eta.js';

export type TokenStatus = 'waiting' | 'serving' | 'done' | 'no_show' | 'cancelled';
export type TokenSource = 'online' | 'walkin';

export interface Clinic {
  id: string;
  slug: string;
  name: string;
  doctor_name: string;
  address: string;
  phone: string;
  timezone: string;
  default_consult_secs: number;
  daily_limit: number;
  booking_open: boolean;
  paused: boolean;
  pause_message: string;
  is_demo: boolean;
}

export interface TokenRow {
  id: string;
  clinic_id: string;
  service_date: string;
  number: number;
  queue_pos: number;
  public_code: string;
  patient_name: string;
  phone: string;
  reason: string;
  source: TokenSource;
  status: TokenStatus;
  created_at: Date;
  called_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
}

const CLINIC_COLS = `id, slug, name, doctor_name, address, phone, timezone, default_consult_secs,
  daily_limit, booking_open, paused, pause_message, is_demo`;

// ---------------------------------------------------------------- clinics

export async function getClinicBySlug(slug: string, db: Db = pool): Promise<Clinic> {
  const { rows } = await db.query<Clinic>(`SELECT ${CLINIC_COLS} FROM clinics WHERE slug = $1`, [slug]);
  if (!rows[0]) throw notFound('We could not find that clinic. Check the link and try again.');
  return rows[0];
}

export async function getClinicById(id: string, db: Db = pool): Promise<Clinic> {
  const { rows } = await db.query<Clinic>(`SELECT ${CLINIC_COLS} FROM clinics WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Clinic not found.');
  return rows[0];
}

/** Lock the clinic row so queue changes for one clinic happen one at a time. */
async function lockClinic(c: pg.PoolClient, clinicId: string): Promise<Clinic & { today: string }> {
  const { rows } = await c.query<Clinic & { today: string }>(
    `SELECT ${CLINIC_COLS}, (now() AT TIME ZONE timezone)::date AS today
       FROM clinics WHERE id = $1 FOR UPDATE`,
    [clinicId],
  );
  if (!rows[0]) throw notFound('Clinic not found.');
  return rows[0];
}

export async function clinicToday(clinicId: string, db: Db = pool): Promise<string> {
  const { rows } = await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE timezone)::date AS today FROM clinics WHERE id = $1`,
    [clinicId],
  );
  if (!rows[0]) throw notFound('Clinic not found.');
  return rows[0].today;
}

// ---------------------------------------------------------------- tokens

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
export function newPublicCode(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Indian mobile numbers: keep the last 10 digits, must start with 6-9. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) throw badRequest('Enter a valid 10-digit mobile number.', 'INVALID_PHONE');
  return ten;
}

export interface IssueInput {
  patientName: string;
  phone: string;
  reason?: string;
  source: TokenSource;
}

/**
 * Hand out the next token number for today.
 * The clinic row lock serialises concurrent bookings, so numbers are gap-free and never repeat,
 * and the daily limit check cannot be raced past.
 */
export async function issueToken(clinicId: string, input: IssueInput): Promise<TokenRow> {
  const phone = input.phone.trim() === '' && input.source === 'walkin' ? '' : normalizePhone(input.phone);
  const patientName = input.patientName.trim();
  if (patientName.length < 2) throw badRequest('Please enter the patient name.', 'INVALID_NAME');

  try {
    return await tx(async (c) => {
      const clinic = await lockClinic(c, clinicId);
      if (input.source === 'online' && !clinic.booking_open) {
        throw new AppError(409, 'BOOKING_CLOSED', 'Online booking is closed for today. Please contact the clinic.');
      }
      const { rows: cnt } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tokens WHERE clinic_id = $1 AND service_date = $2 AND status <> 'cancelled'`,
        [clinicId, clinic.today],
      );
      if ((cnt[0]?.n ?? 0) >= clinic.daily_limit) {
        throw new AppError(409, 'DAY_FULL', "Today's tokens are all taken. Please try again tomorrow.");
      }
      const { rows: num } = await c.query<{ last_number: number }>(
        `INSERT INTO daily_counters (clinic_id, service_date, last_number) VALUES ($1, $2, 1)
         ON CONFLICT (clinic_id, service_date) DO UPDATE SET last_number = daily_counters.last_number + 1
         RETURNING last_number`,
        [clinicId, clinic.today],
      );
      const number = num[0]!.last_number;
      const { rows } = await c.query<TokenRow>(
        `INSERT INTO tokens (clinic_id, service_date, number, queue_pos, public_code,
                             patient_name, phone, reason, source)
         VALUES ($1, $2, $3::int, $3::int, $4, $5, $6, $7, $8) RETURNING *`,
        // The public demo never keeps phone numbers: anyone can sign in to its desk.
        [clinicId, clinic.today, number, newPublicCode(), patientName, clinic.is_demo ? '' : phone,
          (input.reason ?? '').trim(), input.source],
      );
      return rows[0]!;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'tokens_one_active_per_phone')) {
      throw conflict(
        'This mobile number already has a token in today’s queue. Ask the reception desk if you lost your link.',
        'ALREADY_BOOKED',
      );
    }
    throw err;
  }
}

export type AdvanceMode = 'next' | 'no_show' | 'finish';

/**
 * Doctor's-desk actions.
 *  next    – mark the current patient done and call the next one in line
 *  no_show – mark the current patient as a no-show and call the next one
 *  finish  – mark the current patient done without calling anyone (break / end of day)
 */
export async function advance(
  clinicId: string,
  mode: AdvanceMode,
): Promise<{ finished: TokenRow | null; called: TokenRow | null }> {
  return tx(async (c) => {
    const clinic = await lockClinic(c, clinicId);
    const endStatus: TokenStatus = mode === 'no_show' ? 'no_show' : 'done';
    const { rows: fin } = await c.query<TokenRow>(
      `UPDATE tokens SET status = $3, completed_at = now()
        WHERE clinic_id = $1 AND service_date = $2 AND status = 'serving' RETURNING *`,
      [clinicId, clinic.today, endStatus],
    );
    let called: TokenRow | null = null;
    if (mode !== 'finish') {
      const { rows } = await c.query<TokenRow>(
        `UPDATE tokens SET status = 'serving', called_at = now()
          WHERE id = (SELECT id FROM tokens
                       WHERE clinic_id = $1 AND service_date = $2 AND status = 'waiting'
                       ORDER BY queue_pos, number LIMIT 1)
          RETURNING *`,
        [clinicId, clinic.today],
      );
      called = rows[0] ?? null;
    }
    return { finished: fin[0] ?? null, called };
  });
}

/** Call a specific waiting token now (e.g. an emergency), finishing the current patient first. */
export async function callToken(clinicId: string, tokenId: string): Promise<TokenRow> {
  return tx(async (c) => {
    const clinic = await lockClinic(c, clinicId);
    await c.query(
      `UPDATE tokens SET status = 'done', completed_at = now()
        WHERE clinic_id = $1 AND service_date = $2 AND status = 'serving'`,
      [clinicId, clinic.today],
    );
    const { rows } = await c.query<TokenRow>(
      `UPDATE tokens SET status = 'serving', called_at = now()
        WHERE id = $1 AND clinic_id = $2 AND service_date = $3 AND status = 'waiting' RETURNING *`,
      [tokenId, clinicId, clinic.today],
    );
    if (!rows[0]) throw notFound('That token is not waiting in today’s queue.');
    return rows[0];
  });
}

/** Put a no-show back in line, right after the patient currently being seen. */
export async function requeue(clinicId: string, tokenId: string): Promise<TokenRow> {
  try {
    return await requeueTx(clinicId, tokenId);
  } catch (err) {
    if (isUniqueViolation(err, 'tokens_one_active_per_phone')) {
      throw conflict('This patient already has another token waiting today.', 'ALREADY_BOOKED');
    }
    throw err;
  }
}

async function requeueTx(clinicId: string, tokenId: string): Promise<TokenRow> {
  return tx(async (c) => {
    const clinic = await lockClinic(c, clinicId);
    const { rows: head } = await c.query<{ pos: number | null }>(
      `SELECT min(queue_pos) AS pos FROM tokens
        WHERE clinic_id = $1 AND service_date = $2 AND status = 'waiting'`,
      [clinicId, clinic.today],
    );
    const { rows } = await c.query<TokenRow>(
      `UPDATE tokens SET status = 'waiting', called_at = NULL, completed_at = NULL,
              queue_pos = COALESCE($4::numeric - 0.5, number::numeric)
        WHERE id = $1 AND clinic_id = $2 AND service_date = $3 AND status = 'no_show' RETURNING *`,
      [tokenId, clinicId, clinic.today, head[0]?.pos ?? null],
    );
    if (!rows[0]) throw notFound('Only today’s no-shows can be put back in the queue.');
    return rows[0];
  });
}

/** Patient cancels their own waiting token from the tracking page. */
export async function cancelByCode(code: string): Promise<TokenRow> {
  const { rows } = await pool.query<TokenRow>(
    `UPDATE tokens SET status = 'cancelled', cancelled_at = now()
      WHERE public_code = $1 AND status = 'waiting' RETURNING *`,
    [code],
  );
  if (!rows[0]) {
    const existing = await pool.query('SELECT 1 FROM tokens WHERE public_code = $1', [code]);
    if (!existing.rowCount) throw notFound('We could not find that token.');
    throw conflict('This token can no longer be cancelled.', 'NOT_CANCELLABLE');
  }
  return rows[0];
}

export async function getTokenByCode(code: string): Promise<TokenRow & { slug: string }> {
  const { rows } = await pool.query<TokenRow & { slug: string }>(
    `SELECT t.*, c.slug FROM tokens t JOIN clinics c ON c.id = t.clinic_id WHERE t.public_code = $1`,
    [code],
  );
  if (!rows[0]) throw notFound('We could not find that token. Check the link and try again.');
  return rows[0];
}

// ---------------------------------------------------------------- snapshots

export interface PublicSnapshot {
  clinic: {
    name: string;
    slug: string;
    doctorName: string;
    address: string;
    phone: string;
    bookingOpen: boolean;
    paused: boolean;
    pauseMessage: string;
    dailyLimit: number;
    isDemo: boolean;
  };
  date: string;
  serverTime: string;
  serving: { number: number; calledAt: string } | null;
  /** Token numbers still waiting, in calling order. Numbers only: no names or phones. */
  waiting: number[];
  issuedToday: number;
  servedToday: number;
  consultSecs: number;
}

export interface StaffToken {
  id: string;
  number: number;
  patientName: string;
  phone: string;
  reason: string;
  source: TokenSource;
  status: TokenStatus;
  createdAt: string;
  calledAt: string | null;
  completedAt: string | null;
}

export interface StaffSnapshot extends PublicSnapshot {
  tokens: StaffToken[];
}

async function todaysTokens(clinicId: string, today: string): Promise<TokenRow[]> {
  const { rows } = await pool.query<TokenRow>(
    `SELECT * FROM tokens WHERE clinic_id = $1 AND service_date = $2 ORDER BY queue_pos, number`,
    [clinicId, today],
  );
  return rows;
}

function buildPublic(clinic: Clinic, today: string, rows: TokenRow[]): PublicSnapshot {
  const serving = rows.find((t) => t.status === 'serving') ?? null;
  const durations = rows
    .filter((t) => t.status === 'done' && t.called_at && t.completed_at)
    .sort((a, b) => a.completed_at!.getTime() - b.completed_at!.getTime())
    .map((t) => (t.completed_at!.getTime() - t.called_at!.getTime()) / 1000);
  return {
    clinic: {
      name: clinic.name,
      slug: clinic.slug,
      doctorName: clinic.doctor_name,
      address: clinic.address,
      phone: clinic.phone,
      bookingOpen: clinic.booking_open,
      paused: clinic.paused,
      pauseMessage: clinic.pause_message,
      dailyLimit: clinic.daily_limit,
      isDemo: clinic.is_demo,
    },
    date: today,
    serverTime: new Date().toISOString(),
    serving: serving ? { number: serving.number, calledAt: serving.called_at!.toISOString() } : null,
    waiting: rows.filter((t) => t.status === 'waiting').map((t) => t.number),
    issuedToday: rows.length,
    servedToday: rows.filter((t) => t.status === 'done').length,
    consultSecs: estimateConsultSecs(durations, clinic.default_consult_secs),
  };
}

export async function publicSnapshot(clinicId: string): Promise<PublicSnapshot> {
  const clinic = await getClinicById(clinicId);
  const today = await clinicToday(clinicId);
  return buildPublic(clinic, today, await todaysTokens(clinicId, today));
}

export async function staffSnapshot(clinicId: string): Promise<StaffSnapshot> {
  const clinic = await getClinicById(clinicId);
  const today = await clinicToday(clinicId);
  const rows = await todaysTokens(clinicId, today);
  return {
    ...buildPublic(clinic, today, rows),
    tokens: rows.map((t) => ({
      id: t.id,
      number: t.number,
      patientName: t.patient_name,
      phone: t.phone,
      reason: t.reason,
      source: t.source,
      status: t.status,
      createdAt: t.created_at.toISOString(),
      calledAt: t.called_at?.toISOString() ?? null,
      completedAt: t.completed_at?.toISOString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------- settings

export interface ClinicSettings {
  name?: string;
  doctorName?: string;
  address?: string;
  phone?: string;
  defaultConsultSecs?: number;
  dailyLimit?: number;
  bookingOpen?: boolean;
  paused?: boolean;
  pauseMessage?: string;
}

export async function updateClinic(clinicId: string, s: ClinicSettings): Promise<Clinic> {
  const map: Record<keyof ClinicSettings, string> = {
    name: 'name',
    doctorName: 'doctor_name',
    address: 'address',
    phone: 'phone',
    defaultConsultSecs: 'default_consult_secs',
    dailyLimit: 'daily_limit',
    bookingOpen: 'booking_open',
    paused: 'paused',
    pauseMessage: 'pause_message',
  };
  const sets: string[] = [];
  const vals: unknown[] = [clinicId];
  for (const [k, col] of Object.entries(map)) {
    const v = s[k as keyof ClinicSettings];
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return getClinicById(clinicId);
  const { rows } = await pool.query<Clinic>(
    `UPDATE clinics SET ${sets.join(', ')} WHERE id = $1 RETURNING ${CLINIC_COLS}`,
    vals,
  );
  return rows[0]!;
}
