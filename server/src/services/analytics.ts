import { pool } from '../db/pool.js';
import { clinicToday } from './queue.js';

export interface DayStats {
  date: string;
  issued: number;
  served: number;
  noShows: number;
  cancelled: number;
  /** Average minutes from booking to being called. */
  avgWaitMin: number | null;
  /** Average minutes with the doctor. */
  avgConsultMin: number | null;
}

export interface Analytics {
  days: DayStats[];
  /** Average tokens booked per hour of day (clinic local time), over open days in the range. */
  hourly: { hour: number; avgArrivals: number }[];
  totals: {
    issued: number;
    served: number;
    noShowRate: number | null;
    avgWaitMin: number | null;
    avgConsultMin: number | null;
    onlineShare: number | null;
  };
}

const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export async function clinicAnalytics(clinicId: string, numDays = 14): Promise<Analytics> {
  const today = await clinicToday(clinicId);
  const { rows } = await pool.query<{
    date: string;
    issued: number;
    served: number;
    no_shows: number;
    cancelled: number;
    avg_wait: number | null;
    avg_consult: number | null;
  }>(
    `WITH days AS (
       SELECT generate_series($2::date - ($3::int - 1), $2::date, interval '1 day')::date AS date
     )
     SELECT d.date,
            count(t.id)::int                                             AS issued,
            count(*) FILTER (WHERE t.status = 'done')::int                AS served,
            count(*) FILTER (WHERE t.status = 'no_show')::int             AS no_shows,
            count(*) FILTER (WHERE t.status = 'cancelled')::int           AS cancelled,
            avg(extract(epoch FROM t.called_at - t.created_at) / 60)
              FILTER (WHERE t.called_at IS NOT NULL)::float8              AS avg_wait,
            avg(extract(epoch FROM t.completed_at - t.called_at) / 60)
              FILTER (WHERE t.status = 'done')::float8                    AS avg_consult
       FROM days d
       LEFT JOIN tokens t ON t.clinic_id = $1 AND t.service_date = d.date
      GROUP BY d.date ORDER BY d.date`,
    [clinicId, today, numDays],
  );

  const { rows: hours } = await pool.query<{ hour: number; n: number; open_days: number }>(
    `WITH t AS (
       SELECT t.service_date, extract(hour FROM t.created_at AT TIME ZONE c.timezone)::int AS hour
         FROM tokens t JOIN clinics c ON c.id = t.clinic_id
        WHERE t.clinic_id = $1 AND t.service_date > $2::date - $3::int
     )
     SELECT h.hour, count(t.hour)::int AS n,
            (SELECT count(DISTINCT service_date) FROM t)::int AS open_days
       FROM generate_series(0, 23) AS h(hour) LEFT JOIN t ON t.hour = h.hour
      GROUP BY h.hour ORDER BY h.hour`,
    [clinicId, today, numDays],
  );

  const { rows: tot } = await pool.query<{
    issued: number;
    served: number;
    no_shows: number;
    called: number;
    online: number;
    avg_wait: number | null;
    avg_consult: number | null;
  }>(
    `SELECT count(*)::int AS issued,
            count(*) FILTER (WHERE status = 'done')::int AS served,
            count(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
            count(*) FILTER (WHERE status IN ('done', 'no_show'))::int AS called,
            count(*) FILTER (WHERE source = 'online')::int AS online,
            avg(extract(epoch FROM called_at - created_at) / 60) FILTER (WHERE called_at IS NOT NULL)::float8 AS avg_wait,
            avg(extract(epoch FROM completed_at - called_at) / 60) FILTER (WHERE status = 'done')::float8 AS avg_consult
       FROM tokens WHERE clinic_id = $1 AND service_date > $2::date - $3::int`,
    [clinicId, today, numDays],
  );
  const t = tot[0]!;
  const openDays = hours[0]?.open_days ?? 0;

  return {
    days: rows.map((r) => ({
      date: r.date,
      issued: r.issued,
      served: r.served,
      noShows: r.no_shows,
      cancelled: r.cancelled,
      avgWaitMin: round1(r.avg_wait),
      avgConsultMin: round1(r.avg_consult),
    })),
    hourly: hours.map((h) => ({ hour: h.hour, avgArrivals: openDays ? round1(h.n / openDays)! : 0 })),
    totals: {
      issued: t.issued,
      served: t.served,
      noShowRate: t.called ? round1((100 * t.no_shows) / t.called) : null,
      avgWaitMin: round1(t.avg_wait),
      avgConsultMin: round1(t.avg_consult),
      onlineShare: t.issued ? round1((100 * t.online) / t.issued) : null,
    },
  };
}
