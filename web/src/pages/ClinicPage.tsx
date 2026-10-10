import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, CenterMessage, ErrorNote, Field, Input, Label, LiveDot, Logo } from '../components/ui';
import { api, ApiError, type PublicSnapshot } from '../lib/api';
import { etaSecs, formatEta } from '../lib/eta';
import { useClinicQueue, useNow } from '../lib/live';
import { saveToken, todaysTokenFor } from '../lib/myTokens';

export function ClinicPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [loadError, setLoadError] = useState<string | null>(null);
  const { snap, connected, setSnap } = useClinicQueue(slug);
  const now = useNow(5000);

  useEffect(() => {
    api<PublicSnapshot>(`/clinics/${slug}`)
      .then(setSnap)
      .catch((e: ApiError) => setLoadError(e.message));
  }, [slug, setSnap]);

  if (loadError) {
    return (
      <CenterMessage title="Clinic not found">
        <p className="text-muted">{loadError}</p>
        <Link to="/" className="font-semibold text-brand">
          Go to ClinicQ home
        </Link>
      </CenterMessage>
    );
  }
  if (!snap) return <CenterMessage title="Loading…" />;

  const c = snap.clinic;
  const mine = todaysTokenFor(slug, snap.date);
  const elapsed = snap.serving ? (now - Date.parse(snap.serving.calledAt)) / 1000 : null;
  const newEta = etaSecs({ ahead: snap.waiting.length, consultSecs: snap.consultSecs, servingElapsedSecs: elapsed });
  const full = snap.issuedToday >= c.dailyLimit;

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 py-4">
        <Logo />
        <LiveDot on={connected} />
      </header>
      <main className="mx-auto grid max-w-xl gap-4 px-4 pb-16">
        <div className="grid gap-1 pt-2">
          <h1 className="display-face text-3xl font-extrabold tracking-tight">{c.name}</h1>
          <p className="text-muted">
            {[c.doctorName, c.address].filter(Boolean).join(' · ')}
          </p>
        </div>

        {c.paused ? (
          <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">
            <p className="font-semibold">The doctor is on a short break.</p>
            {c.pauseMessage ? <p className="text-sm">{c.pauseMessage}</p> : null}
          </div>
        ) : null}

        <Card className="grid grid-cols-3 divide-x divide-line">
          <Stat label="Now seeing" value={snap.serving ? `#${snap.serving.number}` : '–'} big />
          <Stat label="Waiting" value={String(snap.waiting.length)} />
          <Stat label="Your wait" value={formatEta(newEta).replace('about ', '~')} />
        </Card>

        {mine ? (
          <Card className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold">You already have token {mine.number} today</p>
              <p className="text-sm text-muted">Booked from this phone.</p>
            </div>
            <Link to={`/t/${mine.code}`} className="shrink-0 font-semibold text-brand hover:underline">
              Track it →
            </Link>
          </Card>
        ) : null}

        {!c.bookingOpen ? (
          <Card className="p-5">
            <p className="font-semibold">Online booking is closed right now.</p>
            <p className="text-muted">Please visit the clinic reception{c.phone ? ` or call ${c.phone}` : ''}.</p>
          </Card>
        ) : full ? (
          <Card className="p-5">
            <p className="font-semibold">All of today's tokens are taken.</p>
            <p className="text-muted">The clinic sees up to {c.dailyLimit} patients a day. Please try tomorrow.</p>
          </Card>
        ) : (
          <BookingForm
            slug={slug}
            isDemo={c.isDemo}
            onBooked={(code, number) => {
              saveToken({ code, number, slug, date: snap.date });
              navigate(`/t/${code}`);
            }}
          />
        )}

        <p className="text-center text-sm text-muted">
          Waiting-room screen: <Link to={`/display/${slug}`} className="underline">/display/{slug}</Link>
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="grid gap-1 p-4">
      <Label>{label}</Label>
      <p className={big ? 'num text-4xl' : 'text-2xl font-bold'}>{value}</p>
    </div>
  );
}

function BookingForm({
  slug,
  isDemo,
  onBooked,
}: {
  slug: string;
  isDemo: boolean;
  onBooked: (code: string, number: number) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ code: string; number: number }>(`/clinics/${slug}/tokens`, {
        body: { patientName: name, phone, reason: reason || undefined },
      });
      onBooked(r.code, r.number);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-4">
        <h2 className="text-lg font-bold">Get a token</h2>
        <Field label="Patient name" htmlFor="name">
          <Input id="name" autoComplete="name" required minLength={2} maxLength={60} value={name}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Mobile number"
          htmlFor="phone"
          hint={isDemo ? 'Demo clinic: use any made-up 10-digit number starting with 6–9. Numbers are not stored.' : 'One token per number per day.'}
        >
          <Input id="phone" type="tel" inputMode="numeric" autoComplete="tel" required placeholder="98765 43210"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Reason for visit (optional)" htmlFor="reason">
          <Input id="reason" maxLength={120} placeholder="e.g. fever, follow-up" value={reason}
            onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button type="submit" size="lg" busy={busy}>
          Get my token
        </Button>
      </form>
    </Card>
  );
}
