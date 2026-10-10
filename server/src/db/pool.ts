import pg from 'pg';
import { config } from '../config.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates shifted to local time.
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC (queue_pos) as a JS number.
pg.types.setTypeParser(1700, (v) => Number(v));
// COUNT(*) and other int8 results as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

const needsSsl = /sslmode=require|neon\.tech|render\.com/.test(config.databaseUrl);

/**
 * TLS is configured below, so drop libpq-style TLS options from the URL. Neon's strings end in
 * `?sslmode=require&channel_binding=require`; node-postgres would otherwise apply its own (stricter)
 * reading of sslmode.
 */
export function cleanDatabaseUrl(raw: string): string {
  const q = raw.indexOf('?');
  if (q === -1) return raw;
  const params = new URLSearchParams(raw.slice(q + 1));
  for (const k of ['sslmode', 'channel_binding', 'sslrootcert']) params.delete(k);
  const rest = params.toString();
  return raw.slice(0, q) + (rest ? `?${rest}` : '');
}

export const pool = new pg.Pool({
  connectionString: cleanDatabaseUrl(config.databaseUrl),
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// Serverless Postgres (Neon) drops idle connections; log it instead of crashing the process.
pool.on('error', (err) => console.error('idle database client error:', err.message));

export type Db = pg.Pool | pg.PoolClient;

/** Run `fn` inside a transaction. Rolls back on any thrown error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
