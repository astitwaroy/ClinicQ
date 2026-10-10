import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { app, book, newClinic, phone, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('booking tokens', () => {
  it('hands out sequential numbers and a tracking code', async () => {
    const { slug } = await newClinic();
    const a = await book(slug);
    const b = await book(slug);
    expect(a.status).toBe(201);
    expect([a.body.number, b.body.number]).toEqual([1, 2]);
    expect(a.body.code).toMatch(/^[a-z2-9]{8}$/);

    const track = await request(app).get(`/api/tokens/${b.body.code}`);
    expect(track.body.token).toMatchObject({ number: 2, status: 'waiting', patientName: 'Asha' });
    expect(track.body.queue.waiting).toEqual([1, 2]);
  });

  it('never repeats or skips a number under concurrent bookings', async () => {
    const { slug } = await newClinic();
    const results = await Promise.all(Array.from({ length: 25 }, () => book(slug)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('allows one active token per phone number per day', async () => {
    const { slug } = await newClinic();
    const ph = phone();
    expect((await book(slug, 'Ravi P.', ph)).status).toBe(201);
    const dup = await book(slug, 'Ravi P.', `+91 ${ph}`);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_BOOKED');
  });

  it('rejects invalid phone numbers and names', async () => {
    const { slug } = await newClinic();
    expect((await book(slug, 'Ravi', '12345')).body.error.code).toBe('VALIDATION');
    expect((await book(slug, 'Ravi', '5123456789')).body.error.code).toBe('INVALID_PHONE');
    expect((await book(slug, 'R', phone())).status).toBe(400);
  });

  it('respects the daily limit and the booking switch', async () => {
    const { agent, slug } = await newClinic();
    await agent.patch('/api/staff/clinic').send({ dailyLimit: 2 }).expect(200);
    await book(slug);
    await book(slug);
    const full = await book(slug);
    expect(full.body.error.code).toBe('DAY_FULL');

    const other = await newClinic();
    await other.agent.patch('/api/staff/clinic').send({ bookingOpen: false }).expect(200);
    expect((await book(other.slug)).body.error.code).toBe('BOOKING_CLOSED');
    // Walk-ins at the desk still work when online booking is closed.
    await other.agent.post('/api/staff/queue/walkin').send({ patientName: 'Walk In' }).expect(201);
  });

  it('lets a patient cancel a waiting token, once', async () => {
    const { slug } = await newClinic();
    const { body } = await book(slug);
    await request(app).post(`/api/tokens/${body.code}/cancel`).expect(200);
    const again = await request(app).post(`/api/tokens/${body.code}/cancel`);
    expect(again.body.error.code).toBe('NOT_CANCELLABLE');
    const snap = await request(app).get(`/api/clinics/${slug}`);
    expect(snap.body.waiting).toEqual([]);
  });
});

describe("doctor's desk", () => {
  it('calls patients in order and records outcomes', async () => {
    const { agent, slug } = await newClinic();
    for (let i = 0; i < 3; i++) await book(slug);

    let r = await agent.post('/api/staff/queue/advance').send({ mode: 'next' });
    expect(r.body).toEqual({ finished: null, called: 1 });
    r = await agent.post('/api/staff/queue/advance').send({ mode: 'no_show' });
    expect(r.body).toEqual({ finished: 1, called: 2 });
    r = await agent.post('/api/staff/queue/advance').send({ mode: 'finish' });
    expect(r.body).toEqual({ finished: 2, called: null });

    const q = await agent.get('/api/staff/queue');
    const status = Object.fromEntries(q.body.tokens.map((t: { number: number; status: string }) => [t.number, t.status]));
    expect(status).toEqual({ 1: 'no_show', 2: 'done', 3: 'waiting' });
    expect(q.body.serving).toBeNull();
  });

  it('puts a re-queued no-show next in line', async () => {
    const { agent, slug } = await newClinic();
    for (let i = 0; i < 4; i++) await book(slug);
    await agent.post('/api/staff/queue/advance').send({ mode: 'next' }); // 1 serving
    await agent.post('/api/staff/queue/advance').send({ mode: 'no_show' }); // 1 no-show, 2 serving
    const q = await agent.get('/api/staff/queue');
    const one = q.body.tokens.find((t: { number: number }) => t.number === 1);
    await agent.post(`/api/staff/queue/${one.id}/requeue`).expect(200);
    const snap = await request(app).get(`/api/clinics/${slug}`);
    expect(snap.body.serving.number).toBe(2);
    expect(snap.body.waiting).toEqual([1, 3, 4]);
  });

  it('can call a specific patient out of turn', async () => {
    const { agent, slug } = await newClinic();
    for (let i = 0; i < 3; i++) await book(slug);
    const q = await agent.get('/api/staff/queue');
    const three = q.body.tokens.find((t: { number: number }) => t.number === 3);
    await agent.post(`/api/staff/queue/${three.id}/call`).expect(200);
    const snap = await request(app).get(`/api/clinics/${slug}`);
    expect(snap.body.serving.number).toBe(3);
    expect(snap.body.waiting).toEqual([1, 2]);
  });

  it('keeps exactly one patient with the doctor under concurrent clicks', async () => {
    const { agent, slug } = await newClinic();
    for (let i = 0; i < 6; i++) await book(slug);
    await Promise.all(Array.from({ length: 4 }, () => agent.post('/api/staff/queue/advance').send({ mode: 'next' })));
    const q = await agent.get('/api/staff/queue');
    const serving = q.body.tokens.filter((t: { status: string }) => t.status === 'serving');
    const done = q.body.tokens.filter((t: { status: string }) => t.status === 'done');
    expect(serving).toHaveLength(1);
    expect(done).toHaveLength(3);
    expect(serving[0].number).toBe(4);
  });
});

describe('privacy and access control', () => {
  it('never exposes patient names or phones on public endpoints', async () => {
    const { slug } = await newClinic();
    await book(slug, 'Secret Name', '9876543210');
    const snap = await request(app).get(`/api/clinics/${slug}`);
    const text = JSON.stringify(snap.body);
    expect(text).not.toContain('Secret');
    expect(text).not.toContain('9876543210');
  });

  it('requires sign-in for the desk and scopes staff to their own clinic', async () => {
    await request(app).get('/api/staff/queue').expect(401);
    const a = await newClinic();
    const b = await newClinic();
    await book(b.slug);
    const bQueue = await b.agent.get('/api/staff/queue');
    const tokenOfB = bQueue.body.tokens[0].id;
    // Clinic A's owner cannot call clinic B's patient.
    const r = await a.agent.post(`/api/staff/queue/${tokenOfB}/call`);
    expect(r.status).toBe(404);
    const aQueue = await a.agent.get('/api/staff/queue');
    expect(aQueue.body.tokens).toEqual([]);
  });

  it('only lets owners add staff, and staff can run the desk', async () => {
    const { agent, slug } = await newClinic();
    await agent.post('/api/staff/team').send({ name: 'Nurse Joy', email: `joy-${slug}@example.com`, password: 'password123' }).expect(201);
    const staff = request.agent(app);
    await staff.post('/api/auth/login').send({ email: `joy-${slug}@example.com`, password: 'password123' }).expect(200);
    await staff.post('/api/staff/team').send({ name: 'X Y', email: `x-${slug}@example.com`, password: 'password123' }).expect(403);
    await book(slug);
    const r = await staff.post('/api/staff/queue/advance').send({ mode: 'next' });
    expect(r.body.called).toBe(1);
  });

  it('rejects bad logins and duplicate clinic links', async () => {
    const { slug } = await newClinic();
    const bad = await request(app).post('/api/auth/login').send({ email: `${slug}@example.com`, password: 'nope' });
    expect(bad.status).toBe(401);
    const dup = await request(app).post('/api/auth/signup').send({
      clinicName: 'Another', slug, ownerName: 'Someone', email: 'other@example.com', password: 'password123',
    });
    expect(dup.body.error.code).toBe('SLUG_TAKEN');
  });
});

describe('fixes from review', () => {
  it('frees a slot when a token is cancelled', async () => {
    const { agent, slug } = await newClinic();
    await agent.patch('/api/staff/clinic').send({ dailyLimit: 1 }).expect(200);
    const first = await book(slug);
    await request(app).post(`/api/tokens/${first.body.code}/cancel`).expect(200);
    expect((await book(slug)).status).toBe(201);
  });

  it('returns 409, not 500, when re-queueing a no-show who already rebooked', async () => {
    const { agent, slug } = await newClinic();
    const ph = phone();
    await book(slug, 'Ravi P.', ph);
    await agent.post('/api/staff/queue/advance').send({ mode: 'next' });
    await agent.post('/api/staff/queue/advance').send({ mode: 'no_show' });
    expect((await book(slug, 'Ravi P.', ph)).status).toBe(201); // rebooked with the same phone
    const q = await agent.get('/api/staff/queue');
    const missed = q.body.tokens.find((t: { status: string }) => t.status === 'no_show');
    const r = await agent.post(`/api/staff/queue/${missed.id}/requeue`);
    expect(r.status).toBe(409);
  });

  it('never stores phone numbers in the public demo, and keeps its details locked', async () => {
    const { agent, slug } = await newClinic();
    await pool.query('UPDATE clinics SET is_demo = true WHERE slug = $1', [slug]);
    await book(slug, 'Recruiter R.', '9876501234');
    const q = await agent.get('/api/staff/queue');
    expect(q.body.tokens[0].phone).toBe('');
    expect((await agent.patch('/api/staff/clinic').send({ doctorName: '' })).status).toBe(403);
    await agent.patch('/api/staff/clinic').send({ paused: true, pauseMessage: 'anything at all' }).expect(200);
    const snap = await request(app).get(`/api/clinics/${slug}`);
    expect(snap.body.clinic.pauseMessage).toBe('Back in 15 minutes.');
  });

  it('health check reports errors instead of crashing', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
  });
});
