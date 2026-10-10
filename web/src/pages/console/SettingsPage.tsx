import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorNote, Field, Input, Label, Pill } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useQrSvg } from '../../lib/qr';
import { useConsole } from './ConsoleLayout';

export function SettingsPage() {
  const { me, refreshMe } = useConsole();
  const [params] = useSearchParams();
  const c = me.clinic;
  const bookingUrl = `${window.location.origin}/c/${c.slug}`;
  const qr = useQrSvg(bookingUrl);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-6">
        {params.get('welcome') ? (
          <section className="rounded-2xl border border-brand bg-card p-5">
            <h1 className="display-face text-2xl font-extrabold">Your clinic is ready</h1>
            <p className="mt-1 text-muted">
              Share the booking link with patients, print the QR poster for the door, and open the TV screen on the
              waiting-room television. Then go to <Link to="/app" className="font-semibold text-brand">Queue</Link>.
            </p>
          </section>
        ) : null}
        <DetailsForm onSaved={refreshMe} />
        {me.user.role === 'owner' ? <Team /> : null}
      </div>
      <aside className="grid content-start gap-6">
        <Card className="grid gap-4 p-5">
          <h2 className="font-bold">Share with patients</h2>
          {qr ? <div className="mx-auto h-44 w-44 rounded-xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
          <CopyRow label="Booking link" value={bookingUrl} />
          <CopyRow label="TV screen" value={`${window.location.origin}/display/${c.slug}`} />
          <a href={`/c/${c.slug}/poster`} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
            Print the QR poster ↗
          </a>
        </Card>
      </aside>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" />
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked: the field is selectable */
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function DetailsForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const { me } = useConsole();
  const c = me.clinic;
  const [f, setF] = useState({
    name: c.name,
    doctorName: c.doctorName,
    address: c.address,
    phone: c.phone,
    dailyLimit: String(c.dailyLimit),
    consultMin: String(Math.round(c.defaultConsultSecs / 60)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: Record<string, unknown> = {
      dailyLimit: Number(f.dailyLimit),
      defaultConsultSecs: Math.round(Number(f.consultMin) * 60),
    };
    if (!c.isDemo) Object.assign(body, { name: f.name, doctorName: f.doctorName, address: f.address, phone: f.phone });
    try {
      await api('/staff/clinic', { method: 'PATCH', body });
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Clinic details</h2>
          {c.isDemo ? <Pill t="warn">Details locked in demo</Pill> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clinic name" htmlFor="cname">
            <Input id="cname" disabled={c.isDemo} required value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Doctor's name" htmlFor="dname">
            <Input id="dname" disabled={c.isDemo} value={f.doctorName} onChange={set('doctorName')} />
          </Field>
          <Field label="Address" htmlFor="addr">
            <Input id="addr" disabled={c.isDemo} value={f.address} onChange={set('address')} />
          </Field>
          <Field label="Clinic phone" htmlFor="cphone">
            <Input id="cphone" disabled={c.isDemo} value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Tokens per day" htmlFor="limit" hint="Online booking stops at this number.">
            <Input id="limit" type="number" min={1} max={500} required value={f.dailyLimit} onChange={set('dailyLimit')} />
          </Field>
          <Field label="Typical visit (minutes)" htmlFor="consult" hint="Starting point for wait estimates each day.">
            <Input id="consult" type="number" min={1} max={60} required value={f.consultMin} onChange={set('consultMin')} />
          </Field>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex items-center gap-3">
          <Button type="submit" busy={busy}>Save</Button>
          {saved ? <span className="text-sm font-semibold text-ok">Saved</span> : null}
        </div>
      </form>
    </Card>
  );
}

interface Member { id: string; name: string; email: string; role: 'owner' | 'staff' }

function Team() {
  const { me } = useConsole();
  const [team, setTeam] = useState<Member[]>([]);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Member[]>('/staff/team').then(setTeam).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/staff/team', { body: f });
      setF({ name: '', email: '', password: '' });
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-bold">Reception staff</h2>
      <ul className="mt-3 divide-y divide-line">
        {team.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-semibold">{m.name}</p>
              <p className="truncate text-sm text-muted">{m.email}</p>
            </div>
            {m.role === 'owner' ? (
              <Pill t="brand">Owner</Pill>
            ) : (
              <Button size="sm" variant="danger" onClick={() => api(`/staff/team/${m.id}`, { method: 'DELETE' }).then(load)}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
        <Input aria-label="Name" placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input aria-label="Email" placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input aria-label="Temporary password" placeholder="Temporary password" type="password" required minLength={8}
          value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {error ? <div className="sm:col-span-3"><ErrorNote>{error}</ErrorNote></div> : null}
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" busy={busy} disabled={me.clinic.isDemo}>
            Add staff login
          </Button>
          {me.clinic.isDemo ? <span className="ml-3 text-sm text-muted">Turned off in the demo.</span> : null}
        </div>
      </form>
    </Card>
  );
}
