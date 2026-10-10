import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, ErrorNote, Label, cx } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface Analytics {
  days: { date: string; issued: number; served: number; noShows: number; cancelled: number; avgWaitMin: number | null; avgConsultMin: number | null }[];
  hourly: { hour: number; avgArrivals: number }[];
  totals: { issued: number; served: number; noShowRate: number | null; avgWaitMin: number | null; avgConsultMin: number | null; onlineShare: number | null };
}

/** Chart colours come from the theme tokens so charts follow light/dark mode. */
function useThemeColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (k: string) => s.getPropertyValue(k).trim();
    return { brand: v('--brand'), bad: v('--bad'), muted: v('--muted'), line: v('--line'), ink: v('--ink'), card: v('--card'), slip: v('--slip'), warn: v('--warn') };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setC(read());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return c;
}

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

export function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = useThemeColors();

  useEffect(() => {
    api<Analytics>(`/staff/analytics?days=${days}`).then(setData).catch((e: ApiError) => setError(e.message));
  }, [days]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <p className="text-muted">Loading analytics…</p>;

  const t = data.totals;
  const daily = data.days.map((d) => ({ ...d, label: dayLabel(d.date) }));
  const firstOpen = data.hourly.findIndex((h) => h.avgArrivals > 0);
  const lastOpen = data.hourly.length - 1 - [...data.hourly].reverse().findIndex((h) => h.avgArrivals > 0);
  const hours = firstOpen < 0 ? [] : data.hourly.slice(Math.max(0, firstOpen - 1), lastOpen + 2).map((h) => ({ ...h, label: hourLabel(h.hour) }));
  const peak = hours.reduce((m, h) => (h.avgArrivals > m.avgArrivals ? h : m), { hour: -1, avgArrivals: 0, label: '' });
  const axis = { stroke: c.muted, fontSize: 12, tickLine: false, axisLine: { stroke: c.line } };
  const tooltip = { contentStyle: { background: c.card, border: `1px solid ${c.line}`, borderRadius: 12, color: c.ink }, cursor: { fill: c.line, opacity: 0.4 } };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-face text-2xl font-extrabold">Last {days} days</h1>
          <p className="text-muted">Times are the clinic's local time. Today is included.</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={cx('px-3 py-1.5 text-sm font-semibold', d === days ? 'bg-ink text-paper' : 'bg-card hover:bg-sunken')}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Kpi label="Patients seen" value={String(t.served)} sub={`${t.issued} tokens issued`} />
        <Kpi label="Average wait" value={t.avgWaitMin === null ? '–' : `${Math.round(t.avgWaitMin)} min`} sub="booking to being called" />
        <Kpi label="Average visit" value={t.avgConsultMin === null ? '–' : `${t.avgConsultMin} min`} sub="with the doctor" />
        <Kpi label="No-show rate" value={t.noShowRate === null ? '–' : `${t.noShowRate}%`} sub="of patients called" tone={t.noShowRate !== null && t.noShowRate > 10 ? 'warn' : undefined} />
        <Kpi label="Booked online" value={t.onlineShare === null ? '–' : `${Math.round(t.onlineShare)}%`} sub="the rest were walk-ins" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Patients per day" note="Sundays closed in the demo">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.line} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12, color: c.muted }} />
              <Bar dataKey="served" name="Seen" stackId="a" fill={c.brand} />
              <Bar dataKey="noShows" name="No-show" stackId="a" fill={c.bad} />
              <Bar dataKey="cancelled" name="Cancelled" stackId="a" fill={c.muted} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average wait and visit length" note="minutes">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.line} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12, color: c.muted }} />
              <Line type="monotone" dataKey="avgWaitMin" name="Wait" stroke={c.brand} strokeWidth={2.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="avgConsultMin" name="Visit" stroke={c.warn} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Busiest hours"
          note={peak.hour >= 0 ? `Most tokens are booked around ${hourLabel(peak.hour)}. Average per open day.` : 'No bookings yet.'}
          wide
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hours} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.line} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tooltip} formatter={(v) => [v, 'tokens booked']} />
              <Bar dataKey="avgArrivals" name="Tokens booked" fill={c.brand} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'warn' }) {
  return (
    <Card className="p-4">
      <Label>{label}</Label>
      <p className={cx('mt-1 text-3xl font-extrabold tabular-nums', tone === 'warn' && 'text-warn')}>{value}</p>
      <p className="text-sm text-muted">{sub}</p>
    </Card>
  );
}

function ChartCard({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <Card className={cx('min-w-0 p-5', wide && 'xl:col-span-2')}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </div>
      {children}
    </Card>
  );
}
