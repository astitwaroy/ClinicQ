import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorNote, Field, Input, Label, LiveDot, Pill, cx } from '../../components/ui';
import { api, ApiError, type StaffSnapshot, type StaffToken } from '../../lib/api';
import { clock, etaSecs, minutes, timeOfDay } from '../../lib/eta';
import { useNow, useStaffQueue } from '../../lib/live';
import { useConsole } from './ConsoleLayout';

export function QueuePage() {
  const { me, refreshMe } = useConsole();
  const { snap, connected, setSnap } = useStaffQueue(me.clinic.slug);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const reload = useCallback(() => api<StaffSnapshot>('/staff/queue').then(setSnap), [setSnap]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const act = useCallback(
    async (key: string, path: string, body: unknown = {}) => {
      setBusy(key);
      setError(null);
      try {
        await api(path, { method: 'POST', body });
        await reload();
      } catch (e) {
        setError((e as ApiError).message);
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  // Keyboard shortcuts for the reception desk: N = next patient, M = mark no-show.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') void act('next', '/staff/queue/advance', { mode: 'next' });
      if ((e.key === 'm' || e.key === 'M') && snap?.serving) void act('no_show', '/staff/queue/advance', { mode: 'no_show' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, snap?.serving]);

  if (!snap) return <p className="text-muted">Loading the queue…</p>;

  const tokens = snap.tokens;
  const serving = tokens.find((t) => t.status === 'serving') ?? null;
  const waiting = tokens.filter((t) => t.status === 'waiting');
  const finished = tokens
    .filter((t) => t.status === 'done' || t.status === 'no_show' || t.status === 'cancelled')
    .sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt));
  const elapsed = serving?.calledAt ? (now - Date.parse(serving.calledAt)) / 1000 : null;
  const noShows = tokens.filter((t) => t.status === 'no_show').length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="grid content-start gap-6">
        {/* With the doctor */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <Label>With the doctor</Label>
            <LiveDot on={connected} />
          </div>
          <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className={cx('slip min-w-40 rounded-2xl px-7 py-4 text-center', !serving && 'opacity-50')}>
              <p className="text-xs font-bold uppercase tracking-[0.18em]">Token</p>
              <p className="num text-7xl">{serving?.number ?? '–'}</p>
            </div>
            {serving ? (
              <div className="grid gap-1">
                <p className="text-2xl font-bold">{serving.patientName}</p>
                <p className="text-muted">{serving.reason || 'No reason given'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <SourcePill t={serving} />
                  {serving.phone ? <span className="font-mono">{serving.phone}</span> : null}
                  <span className={cx('font-mono font-semibold', elapsed && elapsed > snap.consultSecs * 1.5 ? 'text-warn' : 'text-muted')}>
                    in for {clock(elapsed ?? 0)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-muted">
                {waiting.length ? 'Nobody is with the doctor. Call the first patient when ready.' : 'Nobody is waiting right now.'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line bg-sunken/50 px-5 py-4">
            <Button size="lg" onClick={() => act('next', '/staff/queue/advance', { mode: 'next' })} busy={busy === 'next'}
              disabled={!waiting.length && !serving}>
              {waiting[0] ? `Call next: #${waiting[0].number}` : serving ? 'Finish visit' : 'Call next'}
              <kbd className="rounded bg-black/15 px-1.5 text-xs">N</kbd>
            </Button>
            <Button variant="secondary" size="lg" disabled={!serving} busy={busy === 'no_show'}
              onClick={() => act('no_show', '/staff/queue/advance', { mode: 'no_show' })}>
              Not here (no-show) <kbd className="rounded bg-sunken px-1.5 text-xs">M</kbd>
            </Button>
            <Button variant="ghost" size="lg" disabled={!serving} busy={busy === 'finish'}
              onClick={() => act('finish', '/staff/queue/advance', { mode: 'finish' })}>
              Finish without calling next
            </Button>
          </div>
        </Card>
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {/* Waiting list */}
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <Label>Waiting · {waiting.length}</Label>
            <span className="text-xs text-muted">About {Math.round(snap.consultSecs / 60)} min per patient today</span>
          </div>
          {waiting.length ? (
            <ul className="divide-y divide-line">
              {waiting.map((t, i) => {
                const eta = etaSecs({ ahead: i, consultSecs: snap.consultSecs, servingElapsedSecs: elapsed });
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="num w-14 text-3xl">{t.number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{t.patientName}</p>
                      <p className="truncate text-sm text-muted">{t.reason || '—'}</p>
                    </div>
                    <SourcePill t={t} />
                    <div className="w-32 text-right text-sm">
                      <p>waited {minutes((now - Date.parse(t.createdAt)) / 1000)} min</p>
                      <p className="text-muted">call ~{timeOfDay(new Date(now + eta * 1000))}</p>
                    </div>
                    <Button size="sm" variant="secondary" busy={busy === t.id} onClick={() => act(t.id, `/staff/queue/${t.id}/call`)}>
                      Call now
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-muted">The waiting list is empty.</p>
          )}
        </Card>

        {/* Done today */}
        <Card>
          <div className="border-b border-line px-5 py-3">
            <Label>Earlier today · {finished.length}</Label>
          </div>
          {finished.length ? (
            <ul className="divide-y divide-line">
              {finished.slice(0, 30).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="num w-12 text-xl text-muted">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate">{t.patientName}</span>
                  {t.status === 'done' ? (
                    <Pill t="ok">Seen {t.calledAt && t.completedAt ? `· ${minutes((Date.parse(t.completedAt) - Date.parse(t.calledAt)) / 1000)} min` : ''}</Pill>
                  ) : t.status === 'no_show' ? (
                    <>
                      <Pill t="bad">No-show</Pill>
                      <Button size="sm" variant="secondary" busy={busy === t.id} onClick={() => act(t.id, `/staff/queue/${t.id}/requeue`)}>
                        Arrived: put back next
                      </Button>
                    </>
                  ) : (
                    <Pill>Cancelled</Pill>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-muted">No finished visits yet today.</p>
          )}
        </Card>
      </div>

      <aside className="grid content-start gap-6">
        <WalkInForm onAdded={reload} />
        <QueueControls snap={snap} onChange={async () => { await reload(); await refreshMe(); }} />
        <Card className="grid grid-cols-2 gap-4 p-5">
          <Mini label="Tokens today" value={`${snap.issuedToday} / ${snap.clinic.dailyLimit}`} />
          <Mini label="Seen" value={String(snap.servedToday)} />
          <Mini label="No-shows" value={String(noShows)} />
          <Mini label="Avg visit" value={`${Math.round(snap.consultSecs / 60)} min`} />
        </Card>
        {me.clinic.isDemo ? <DemoTools onDone={reload} /> : null}
      </aside>
    </div>
  );
}

function SourcePill({ t }: { t: StaffToken }) {
  return t.source === 'online' ? <Pill t="brand">Online</Pill> : <Pill>Walk-in</Pill>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function WalkInForm({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ number: number }>('/staff/queue/walkin', { body: { patientName: name, phone, reason } });
      setAdded(r.number);
      setName('');
      setPhone('');
      setReason('');
      await onAdded();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-3">
        <h2 className="font-bold">Add a walk-in patient</h2>
        <Field label="Name" htmlFor="wname">
          <Input id="wname" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Mobile (optional)" htmlFor="wphone">
          <Input id="wphone" type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Reason (optional)" htmlFor="wreason">
          <Input id="wreason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {added ? <p className="text-sm font-semibold text-ok">Added as token #{added}. Write it on their slip.</p> : null}
        <Button type="submit" busy={busy}>Give token</Button>
      </form>
    </Card>
  );
}

function QueueControls({ snap, onChange }: { snap: StaffSnapshot; onChange: () => Promise<unknown> }) {
  const [msg, setMsg] = useState(snap.clinic.pauseMessage || 'Back in 15 minutes.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api('/staff/clinic', { method: 'PATCH', body });
      await onChange();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="grid gap-4 p-5">
      <h2 className="font-bold">Queue controls</h2>
      <Toggle
        label="Online booking"
        sub={snap.clinic.bookingOpen ? 'Patients can take tokens from their phones.' : 'Closed. Walk-ins still work.'}
        on={snap.clinic.bookingOpen}
        disabled={busy}
        onToggle={() => patch({ bookingOpen: !snap.clinic.bookingOpen })}
      />
      <div className="grid gap-2">
        <Toggle
          label="Doctor on a break"
          sub={snap.clinic.paused ? 'Patients see the message below.' : 'Shows a notice on every screen.'}
          on={snap.clinic.paused}
          disabled={busy}
          onToggle={() => patch({ paused: !snap.clinic.paused, pauseMessage: msg })}
        />
        <Input aria-label="Break message" value={msg} maxLength={140} onChange={(e) => setMsg(e.target.value)}
          onBlur={() => snap.clinic.paused && msg !== snap.clinic.pauseMessage && patch({ pauseMessage: msg })} />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Card>
  );
}

function Toggle({ label, sub, on, onToggle, disabled }: { label: string; sub: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-brand' : 'bg-line')}
      >
        <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]', on ? 'left-6' : 'left-1')} />
      </button>
    </div>
  );
}

function DemoTools({ onDone }: { onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, path: string) => {
    setBusy(k);
    await api(path, { method: 'POST' }).catch(() => {});
    await onDone();
    setBusy(null);
  };
  return (
    <Card className="grid gap-3 border-dashed p-5">
      <h2 className="font-bold">Demo tools</h2>
      <p className="text-sm text-muted">
        Open the patient page and the TV screen in other tabs, then call patients here. When nobody uses the desk for 5
        minutes, an autopilot keeps the demo queue moving.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" busy={busy === 'add'} onClick={() => run('add', '/staff/demo/sample-patients')}>
          Add 4 sample patients
        </Button>
        <Button size="sm" variant="secondary" busy={busy === 'reset'} onClick={() => run('reset', '/staff/demo/reset')}>
          Reset today's demo
        </Button>
      </div>
    </Card>
  );
}
