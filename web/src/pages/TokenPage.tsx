import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TokenSlip } from '../components/TokenSlip';
import { Button, Card, CenterMessage, ErrorNote, Label, LiveDot, Logo } from '../components/ui';
import { api, ApiError, type TokenView } from '../lib/api';
import { etaSecs, formatEta, timeOfDay } from '../lib/eta';
import { chime, useClinicQueue, useNow } from '../lib/live';

export function TokenPage() {
  const { code = '' } = useParams();
  const [view, setView] = useState<TokenView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slug = view?.queue.clinic.slug;
  const { snap, connected } = useClinicQueue(slug, view?.queue);
  const now = useNow(1000);
  const [alerts, setAlerts] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api<TokenView>(`/tokens/${code}`)
      .then(setView)
      .catch((e: ApiError) => setError(e.message));
  }, [code]);
  useEffect(load, [load]);

  const queue = snap ?? view?.queue;
  const token = view?.token;
  const number = token?.number;

  // Our own status changes (called, seen, missed) are inferred from the live queue, then confirmed with the server.
  const inLine = queue && number !== undefined ? queue.waiting.includes(number) : false;
  const beingSeen = queue?.serving?.number === number;
  const lastReload = useRef(0);
  useEffect(() => {
    if (!token || !queue || token.serviceDate !== queue.date) return;
    const live = beingSeen ? 'serving' : inLine ? 'waiting' : 'other';
    const known = token.status === 'serving' ? 'serving' : token.status === 'waiting' ? 'waiting' : 'other';
    if (live !== known && Date.now() - lastReload.current > 1500) {
      lastReload.current = Date.now();
      load();
    }
  }, [queue, token, beingSeen, inLine, load]);

  // Alerts: chime + vibrate when 2 ahead and when called.
  const ahead = queue && number !== undefined ? queue.waiting.indexOf(number) : -1;
  const lastAlert = useRef<string>('');
  useEffect(() => {
    if (!alerts) return;
    const key = beingSeen ? 'called' : ahead >= 0 && ahead <= 2 ? `ahead-${ahead}` : '';
    if (!key || key === lastAlert.current) return;
    lastAlert.current = key;
    chime();
    navigator.vibrate?.(beingSeen ? [300, 150, 300, 150, 300] : [200]);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(beingSeen ? `Token ${number}: it's your turn` : `Token ${number}: ${ahead === 0 ? 'you are next' : `${ahead} ahead of you`}`);
    }
  }, [alerts, beingSeen, ahead, number]);

  if (error) {
    return (
      <CenterMessage title="Token not found">
        <p className="text-muted">{error}</p>
        <Link to="/" className="font-semibold text-brand">ClinicQ home</Link>
      </CenterMessage>
    );
  }
  if (!view || !queue || !token) return <CenterMessage title="Loading your token…" />;

  const status = beingSeen ? 'serving' : inLine ? 'waiting' : token.status;
  const isToday = token.serviceDate === queue.date;
  const elapsed = queue.serving ? (now - Date.parse(queue.serving.calledAt)) / 1000 : null;
  const eta = ahead >= 0 ? etaSecs({ ahead, consultSecs: queue.consultSecs, servingElapsedSecs: elapsed }) : 0;
  const total = queue.waiting.length;

  async function enableAlerts() {
    setAlerts(true);
    chime(); // also unlocks audio on iOS, which needs a tap first
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
  }

  async function cancel() {
    setCancelError(null);
    try {
      await api(`/tokens/${code}/cancel`, { method: 'POST' });
      load();
      setConfirmCancel(false);
    } catch (e) {
      setCancelError((e as ApiError).message);
    }
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `Token ${token!.number}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user dismissed */
    }
  }

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <Logo />
        <LiveDot on={connected} />
      </header>
      <main className="mx-auto grid max-w-md gap-4 px-4 pb-16">
        <TokenSlip
          number={token.number}
          clinic={queue.clinic.name}
          footer={`${token.patientName} · booked ${timeOfDay(token.createdAt)}`}
          className={status === 'serving' ? 'pop' : undefined}
        />

        {!isToday ? (
          <Card className="p-5">
            <p className="font-semibold">This token was for {new Date(token.serviceDate).toDateString()}.</p>
            <Link to={`/c/${queue.clinic.slug}`} className="font-semibold text-brand">Get a token for today →</Link>
          </Card>
        ) : status === 'serving' ? (
          <section role="status" className="pulse-ring rounded-2xl bg-brand p-6 text-brand-ink">
            <p className="display-face text-3xl font-extrabold">It's your turn</p>
            <p className="mt-1 text-lg">Please go in{queue.clinic.doctorName ? ` to ${queue.clinic.doctorName}` : ''} now.</p>
          </section>
        ) : status === 'waiting' ? (
          <Card className="grid gap-4 p-5">
            {queue.clinic.paused ? (
              <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm font-semibold text-warn">
                Doctor on a short break. {queue.clinic.pauseMessage}
              </p>
            ) : null}
            <div className="flex items-end justify-between gap-4">
              <div>
                <Label>{ahead === 0 ? 'You are next' : 'People ahead of you'}</Label>
                <p className="num mt-2 text-6xl">{ahead === 0 ? '0' : ahead}</p>
              </div>
              <div className="text-right">
                <Label>Estimated wait</Label>
                <p className="mt-2 text-xl font-bold">{formatEta(eta)}</p>
                <p className="text-sm text-muted">around {timeOfDay(new Date(now + eta * 1000))}</p>
              </div>
            </div>
            <Progress ahead={ahead} total={total} />
            <p className="text-sm text-muted">
              Now seeing <b className="text-ink">#{queue.serving?.number ?? '–'}</b>. Estimates use today's average
              visit of about {Math.round(queue.consultSecs / 60)} min and update after every patient.
            </p>
            {ahead >= 3 ? (
              <p className="text-sm">Plan to be at the clinic by the time there are 3 people ahead of you.</p>
            ) : (
              <p className="text-sm font-semibold">Please be at the clinic now.</p>
            )}
          </Card>
        ) : (
          <Card className="p-5">
            {status === 'done' ? (
              <>
                <p className="text-lg font-semibold">Visit complete. Get well soon.</p>
                {token.completedAt ? <p className="text-muted">Seen at {timeOfDay(token.calledAt ?? token.completedAt)}.</p> : null}
              </>
            ) : status === 'no_show' ? (
              <>
                <p className="text-lg font-semibold">Your number was called, but you weren't there.</p>
                <p className="text-muted">Tell the reception desk you have arrived. They can put you back in line right away.</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">This token was cancelled.</p>
                <Link to={`/c/${queue.clinic.slug}`} className="font-semibold text-brand">Get a new token →</Link>
              </>
            )}
          </Card>
        )}

        {isToday && status === 'waiting' ? (
          <div className="grid gap-2">
            {alerts ? (
              <p className="rounded-xl bg-sunken px-4 py-3 text-sm">
                Alerts are on. Keep this page open: your phone will chime when you're 2 away and when you're called.
              </p>
            ) : (
              <Button onClick={enableAlerts} size="lg">Alert me when it's almost my turn</Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={share}>{copied ? 'Link copied' : 'Share this page'}</Button>
              {confirmCancel ? (
                <Button variant="danger" onClick={cancel}>Yes, cancel token</Button>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>Cancel token</Button>
              )}
            </div>
            {confirmCancel ? (
              <p className="text-sm text-muted">
                Cancelling gives up your place. <button className="underline" onClick={() => setConfirmCancel(false)}>Keep my token</button>
              </p>
            ) : null}
            {cancelError ? <ErrorNote>{cancelError}</ErrorNote> : null}
          </div>
        ) : null}
        <p className="text-center text-xs text-muted">Save this page: the link is your token.</p>
      </main>
    </div>
  );
}

function Progress({ ahead, total }: { ahead: number; total: number }) {
  const pct = total <= 1 ? 100 : Math.round(100 * (1 - ahead / Math.max(1, total)));
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(6, pct)}%` }} />
    </div>
  );
}
