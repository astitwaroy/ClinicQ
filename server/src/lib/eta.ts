/**
 * Wait-time estimation. Pure functions so they are easy to test and reuse on the client.
 *
 * Consultation length is estimated with an exponentially weighted moving average (EWMA)
 * of today's completed consultations, starting from the clinic's configured default.
 * Recent patients count more, so the estimate adapts when the doctor speeds up or slows down,
 * and a single unusually long visit only nudges it.
 */

export const MIN_CONSULT_SECS = 60;
export const MAX_CONSULT_SECS = 3600;
export const EWMA_ALPHA = 0.3;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** EWMA over consultation durations (seconds, oldest first). */
export function estimateConsultSecs(durationsSecs: number[], defaultSecs: number, alpha = EWMA_ALPHA): number {
  let est = clamp(defaultSecs, MIN_CONSULT_SECS, MAX_CONSULT_SECS);
  for (const d of durationsSecs) {
    if (!Number.isFinite(d) || d <= 0) continue;
    est = alpha * clamp(d, MIN_CONSULT_SECS, MAX_CONSULT_SECS) + (1 - alpha) * est;
  }
  return Math.round(est);
}

/**
 * Seconds until a patient with `ahead` people in front of them is called.
 * The patient currently with the doctor is assumed to need the remainder of an average
 * consultation, never less than a minute if they have already run over.
 */
export function etaSecs(opts: {
  ahead: number;
  consultSecs: number;
  servingElapsedSecs: number | null;
}): number {
  const { ahead, consultSecs, servingElapsedSecs } = opts;
  const current =
    servingElapsedSecs === null ? 0 : Math.max(MIN_CONSULT_SECS, consultSecs - servingElapsedSecs);
  return Math.round(current + Math.max(0, ahead) * consultSecs);
}

/** Human-friendly rounding: "about 5 min", "about 1 h 20 min". */
export function formatEta(secs: number): string {
  if (secs < 90) return 'about a minute';
  const mins = Math.round(secs / 300) * 5 || Math.round(secs / 60);
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}
