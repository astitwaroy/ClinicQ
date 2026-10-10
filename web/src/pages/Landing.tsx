import { Link } from 'react-router-dom';
import { Card, Label, LiveDot, Logo } from '../components/ui';
import { formatEta } from '../lib/eta';
import { useClinicQueue } from '../lib/live';

const REPO_URL = 'https://github.com/astitwaroy/clinicq';

export function Landing() {
  const { snap, connected } = useClinicQueue('sunrise');

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-3">
          <Link to="/login" className="rounded-lg px-3 py-2 hover:bg-sunken">
            Clinic login
          </Link>
          <Link to="/signup" className="rounded-lg bg-ink px-3 py-2 text-paper hover:opacity-90">
            Set up your clinic
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-10 py-10 md:grid-cols-[1.1fr_0.9fr] md:py-16">
          <div className="grid gap-6">
            <h1 className="display-face text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
              Wait at home, not in a crowded clinic.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Patients take a token from their phone and see live how many people are ahead of them. The
              reception desk calls the next patient with one tap, and the waiting-room screen updates
              everywhere at once.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/c/sunrise"
                className="rounded-xl bg-brand px-5 py-3.5 font-semibold text-brand-ink hover:bg-brand-strong"
              >
                Try it: take a token
              </Link>
              <a href="#demo" className="rounded-xl border border-line bg-card px-5 py-3.5 font-semibold hover:border-muted">
                See all three screens
              </a>
            </div>
            <p className="text-sm text-muted">No app to install. Works on any phone with a browser.</p>
          </div>

          {/* Live status of the demo clinic */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <p className="font-semibold">{snap?.clinic.name ?? 'Sunrise Family Clinic'}</p>
                <p className="text-sm text-muted">Demo clinic · {snap?.clinic.doctorName ?? 'Dr. Meera Iyer'}</p>
              </div>
              <LiveDot on={connected} />
            </div>
            <div className="grid grid-cols-2 divide-x divide-line">
              <div className="p-5">
                <Label>Now seeing</Label>
                <p className="num mt-2 text-7xl">{snap?.serving?.number ?? '–'}</p>
              </div>
              <div className="grid content-start gap-3 p-5">
                <div>
                  <Label>Waiting</Label>
                  <p className="mt-1 text-2xl font-bold">{snap ? snap.waiting.length : '–'}</p>
                </div>
                <div>
                  <Label>Wait for a new token</Label>
                  <p className="mt-1 text-lg font-semibold">
                    {snap ? formatEta((snap.waiting.length + (snap.serving ? 0.5 : 0)) * snap.consultSecs) : '–'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-line px-5 py-3">
              <span className="mr-1 text-sm text-muted">Next:</span>
              {(snap?.waiting ?? []).slice(0, 8).map((n) => (
                <span key={n} className="rounded-md bg-sunken px-2 py-0.5 text-sm font-bold tabular-nums">
                  {n}
                </span>
              ))}
              {snap && snap.waiting.length === 0 ? <span className="text-sm text-muted">nobody waiting</span> : null}
            </div>
          </Card>
        </section>

        <section id="demo" className="grid gap-5 py-10">
          <div className="grid gap-2">
            <h2 className="display-face text-3xl font-bold">Three screens, one live queue</h2>
            <p className="max-w-2xl text-muted">
              Open them side by side. Book a token on your phone, call it from the doctor's desk, and watch the
              waiting-room screen announce it.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <DemoCard
              to="/c/sunrise"
              title="Patient's phone"
              body="Take a token, then follow your place in line and the estimated wait. Get a chime when you're next."
              cta="Take a token"
            />
            <DemoCard
              to="/display/sunrise"
              title="Waiting-room screen"
              body="For a TV in the clinic: the number being seen, who's next, and a QR code to book."
              cta="Open the screen"
            />
            <DemoCard
              to="/login?demo=1"
              title="Doctor's desk"
              body="Call the next patient, mark no-shows, add walk-ins, pause for a break, and see analytics."
              cta="Open the desk"
              note="Demo login: demo@clinicq.app · demo1234"
            />
          </div>
        </section>

        <section className="grid gap-6 border-t border-line py-12 md:grid-cols-3">
          <Feature title="Fair and in order">
            Token numbers come from the database under a lock, so two people can never get the same number, even when
            many book in the same second.
          </Feature>
          <Feature title="Estimates that learn">
            The wait estimate tracks how long the doctor is actually taking today and adjusts after every patient.
          </Feature>
          <Feature title="Private by design">
            Public screens show token numbers only. Names and phone numbers stay at the desk and are erased after a
            week.
          </Feature>
          <Feature title="Walk-ins welcome">
            Reception adds walk-in patients to the same line, and can put a missed patient back right after the
            current one.
          </Feature>
          <Feature title="Works on a bad network">
            Live updates reconnect on their own, and the page shows when it's offline.
          </Feature>
          <Feature title="Know your busy hours">
            See daily patient counts, average waits, no-show rate and the busiest hours of the day.
          </Feature>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <span>ClinicQ · React, Node.js, PostgreSQL and Socket.IO</span>
          <a href={REPO_URL} className="underline-offset-2 hover:underline">
            Source code
          </a>
        </div>
      </footer>
    </div>
  );
}

function DemoCard({ to, title, body, cta, note }: { to: string; title: string; body: string; cta: string; note?: string }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="flex-1 text-muted">{body}</p>
      {note ? <p className="rounded-lg bg-sunken px-3 py-2 font-mono text-xs">{note}</p> : null}
      <Link to={to} className="font-semibold text-brand hover:underline">
        {cta} →
      </Link>
    </Card>
  );
}

function Feature({ title, children }: { title: string; children: string }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="font-bold">{title}</h3>
      <p className="text-muted">{children}</p>
    </div>
  );
}
