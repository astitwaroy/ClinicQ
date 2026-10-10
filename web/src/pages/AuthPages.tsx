import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorNote, Field, Input, Logo } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { resetSocket } from '../lib/live';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="mx-auto max-w-md px-4 py-5">
        <Logo />
      </header>
      <main className="mx-auto grid max-w-md gap-4 px-4 pb-16">
        <h1 className="display-face text-3xl font-extrabold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const demo = params.get('demo') === '1';
  const [email, setEmail] = useState(demo ? 'demo@clinicq.app' : '');
  const [password, setPassword] = useState(demo ? 'demo1234' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { body: { email, password } });
      resetSocket();
      navigate('/app');
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Shell title="Doctor's desk login">
      {demo ? (
        <p className="rounded-xl bg-sunken px-4 py-3 text-sm">
          The demo login is filled in for you. You'll run the queue for <b>Sunrise Family Clinic</b>; it resets every day.
        </p>
      ) : null}
      <Card className="p-5">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" size="lg" busy={busy}>Sign in</Button>
        </form>
      </Card>
      <p className="text-sm text-muted">
        New clinic? <Link to="/signup" className="font-semibold text-brand">Set it up in a minute</Link>
        {!demo ? <> · <Link to="/login?demo=1" className="font-semibold text-brand">Use the demo</Link></> : null}
      </p>
    </Shell>
  );
}

const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function SignupPage() {
  const [f, setF] = useState({ clinicName: '', slug: '', doctorName: '', ownerName: '', email: '', password: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => {
      const next = { ...p, [k]: e.target.value };
      if (k === 'clinicName' && !slugTouched) next.slug = toSlug(e.target.value);
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/signup', { body: f });
      resetSocket();
      navigate('/app/settings?welcome=1');
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Shell title="Set up your clinic">
      <Card className="p-5">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Clinic name" htmlFor="clinicName">
            <Input id="clinicName" required minLength={2} maxLength={80} value={f.clinicName} onChange={set('clinicName')} />
          </Field>
          <Field label="Booking link" htmlFor="slug" hint={`Patients will book at ${window.location.host}/c/${f.slug || 'your-clinic'}`}>
            <Input id="slug" required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={f.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setF((p) => ({ ...p, slug: toSlug(e.target.value) }));
              }} />
          </Field>
          <Field label="Doctor's name (shown to patients)" htmlFor="doctorName">
            <Input id="doctorName" maxLength={80} placeholder="Dr. …" value={f.doctorName} onChange={set('doctorName')} />
          </Field>
          <Field label="Your name" htmlFor="ownerName">
            <Input id="ownerName" required minLength={2} value={f.ownerName} onChange={set('ownerName')} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} />
          </Field>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" size="lg" busy={busy}>Create clinic</Button>
        </form>
      </Card>
      <p className="text-sm text-muted">
        Already set up? <Link to="/login" className="font-semibold text-brand">Sign in</Link>
      </p>
    </Shell>
  );
}
