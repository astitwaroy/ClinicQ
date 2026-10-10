// Same rules as server/src/lib/eta.ts (kept in sync by hand; both are tiny).

export const MIN_CONSULT_SECS = 60;

export function etaSecs(opts: { ahead: number; consultSecs: number; servingElapsedSecs: number | null }): number {
  const { ahead, consultSecs, servingElapsedSecs } = opts;
  const current =
    servingElapsedSecs === null ? 0 : Math.max(MIN_CONSULT_SECS, consultSecs - servingElapsedSecs);
  return Math.round(current + Math.max(0, ahead) * consultSecs);
}

export function formatEta(secs: number): string {
  if (secs < 90) return 'about a minute';
  const mins = Math.round(secs / 300) * 5 || Math.round(secs / 60);
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}

export const minutes = (secs: number) => Math.max(1, Math.round(secs / 60));

/** "4:07" style elapsed timer. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function timeOfDay(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
