import { migrate } from './migrate.js';
import { pool } from './pool.js';
import { DEMO_EMAIL, DEMO_PASSWORD, ensureDemoClinic, ensureDemoToday } from '../services/demo.js';

/** `npm run seed` – create the demo clinic with history and today's queue. */
await migrate();
const id = await ensureDemoClinic();
await ensureDemoToday(id);
console.log(`Demo clinic ready: /c/sunrise  (login ${DEMO_EMAIL} / ${DEMO_PASSWORD})`);
await pool.end();
