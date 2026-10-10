import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

export const app = createApp();

export async function resetDb() {
  await pool.query('TRUNCATE tokens, daily_counters, users, clinics RESTART IDENTITY CASCADE');
}

let n = 0;
/** Sign up a new clinic and return a cookie-carrying agent for its owner. */
export async function newClinic(overrides: Record<string, unknown> = {}) {
  n += 1;
  const slug = `clinic-${n}-${Math.random().toString(36).slice(2, 7)}`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').send({
    clinicName: `Test Clinic ${n}`,
    slug,
    doctorName: 'Dr. Test',
    ownerName: 'Owner Person',
    email: `${slug}@example.com`,
    password: 'password123',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, slug };
}

let phoneSeq = 0;
export const phone = () => `98${String(10_000_000 + ++phoneSeq).slice(-8)}`;

export async function book(slug: string, name = 'Asha K.', ph = phone()) {
  return request(app).post(`/api/clinics/${slug}/tokens`).send({ patientName: name, phone: ph });
}
