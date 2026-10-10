import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { attachRealtime, closeRealtime } from '../src/services/realtime.js';
import { app, book, newClinic, resetDb } from './helpers.js';

let server: http.Server;
let url: string;

beforeAll(async () => {
  await resetDb();
  server = http.createServer(app);
  attachRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeRealtime();
  await new Promise((r) => server.close(r));
  await pool.end();
});

function nextEvent<T>(s: Socket, event: string, match: (x: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 5000);
    const handler = (x: T) => {
      if (!match(x)) return;
      clearTimeout(timer);
      s.off(event, handler);
      resolve(x);
    };
    s.on(event, handler);
  });
}

describe('live updates', () => {
  it('pushes the new queue to watchers when a token is booked and called', async () => {
    const { agent, slug } = await newClinic();
    const s = connect(url, { transports: ['websocket'] });
    const first = nextEvent<{ waiting: number[] }>(s, 'queue');
    s.emit('watch', { slug });
    expect((await first).waiting).toEqual([]);

    const afterBooking = nextEvent<{ waiting: number[] }>(s, 'queue', (q) => q.waiting.length === 1);
    await book(slug);
    expect((await afterBooking).waiting).toEqual([1]);

    const afterCall = nextEvent<{ serving: { number: number } | null }>(s, 'queue', (q) => q.serving !== null);
    await agent.post('/api/staff/queue/advance').send({ mode: 'next' });
    expect((await afterCall).serving?.number).toBe(1);
    s.close();
  });

  it('only sends staff details to signed-in staff', async () => {
    const { agent } = await newClinic();
    const anon = connect(url, { transports: ['websocket'] });
    const denied = await new Promise((r) => anon.emit('watchStaff', {}, r));
    expect(denied).toEqual({ ok: false });
    anon.close();

    const login = await agent.get('/api/auth/me');
    expect(login.status).toBe(200);
    const cookie = (agent as unknown as { jar: { getCookies: (o: object) => { toValueString(): string }[] } }).jar
      .getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false })
      .map((c) => c.toValueString())
      .join('; ');
    const staff = connect(url, { transports: ['websocket'], extraHeaders: { cookie } });
    const snap = nextEvent<{ tokens: unknown[] }>(staff, 'staffQueue');
    const ok = await new Promise((r) => staff.emit('watchStaff', {}, r));
    expect(ok).toEqual({ ok: true });
    expect(Array.isArray((await snap).tokens)).toBe(true);
    staff.close();
  });
});
