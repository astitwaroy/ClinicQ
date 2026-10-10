import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://dev:dev@localhost:5432/clinicq'),
  JWT_SECRET: z.string().min(16).optional(),
  // Seeds and maintains the public "Sunrise Family Clinic" demo.
  DEMO_MODE: bool.default(true),
  // Run SQL migrations automatically on boot (handy on free hosting with no shell access).
  AUTO_MIGRATE: bool.default(true),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
  process.exit(1);
}
const env = parsed.data;

if (env.NODE_ENV === 'production' && !env.JWT_SECRET) {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
  demoMode: env.DEMO_MODE,
  autoMigrate: env.AUTO_MIGRATE,
} as const;
