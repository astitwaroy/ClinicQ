import pg from 'pg';

/** Fresh schema for every test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://dev:dev@localhost:5432/clinicq_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  process.env.DATABASE_URL = url;
  const { migrate } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/pool.js');
  await migrate(() => {});
  await pool.end();
}
