import pg from 'pg';
import { config } from '../config.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates shifted to local time.
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC (queue_pos) as a JS number.
pg.types.setTypeParser(1700, (v) => Number(v));
// COUNT(*) and other int8 results as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

const needsSsl = /sslmode=require|neon\.tech|render\.com/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl.replace(/[?&]sslmode=require/, ''),
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
