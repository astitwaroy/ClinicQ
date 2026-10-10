import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pool } from './db/pool.js';
import { ah, errorHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { staffRouter } from './routes/staff.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: real client IPs for rate limiting
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.get(
    '/api/health',
    ah(async (_req, res) => {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    }),
  );
  app.use('/api', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such API route.' } });
  });

  // Serve the built React app, with client-side routing fallback.
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
