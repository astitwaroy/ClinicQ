import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { anonymizeOldTokens, autopilotTick, ensureDemoClinic, ensureDemoToday } from './services/demo.js';
import { attachRealtime, broadcast, closeRealtime } from './services/realtime.js';

async function main() {
  if (config.autoMigrate) await migrate();

  const app = createApp();
  const server = http.createServer(app);
  attachRealtime(server);

  const timers: NodeJS.Timeout[] = [];
  if (config.demoMode) {
    const demoId = await ensureDemoClinic();
    await ensureDemoToday(demoId);
    // Refill the demo after midnight and keep the queue moving for visitors.
    timers.push(setInterval(() => ensureDemoToday(demoId).then(() => broadcast(demoId)).catch(console.error), 10 * 60_000));
    timers.push(setInterval(() => autopilotTick(demoId, () => broadcast(demoId)).catch(console.error), 30_000));
  }
  timers.push(setInterval(() => anonymizeOldTokens().catch(console.error), 60 * 60_000));
  anonymizeOldTokens().catch(console.error);

  server.listen(config.port, () => console.log(`ClinicQ listening on http://localhost:${config.port}`));

  const shutdown = () => {
    timers.forEach(clearInterval);
    server.close();
    closeRealtime()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (reason) => console.error('unhandled rejection:', reason));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
