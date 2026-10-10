/** An error that is safe to show to the client. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new AppError(404, 'NOT_FOUND', what);
export const badRequest = (msg: string, code = 'BAD_REQUEST') => new AppError(400, code, msg);
export const conflict = (msg: string, code = 'CONFLICT') => new AppError(409, code, msg);
export const forbidden = (msg = 'You do not have access to this.') => new AppError(403, 'FORBIDDEN', msg);
export const unauthorized = (msg = 'Please sign in.') => new AppError(401, 'UNAUTHORIZED', msg);

/** Postgres unique-violation on a specific index/constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
