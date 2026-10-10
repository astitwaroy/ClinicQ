import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CenterMessage } from '../components/ui';
import { api, ApiError, type PublicSnapshot } from '../lib/api';
import { useQrSvg } from '../lib/qr';
import { chime, useClinicQueue, useNow } from '../lib/live';

/**
 * Waiting-room TV screen. Deliberately one fixed dark look (it runs full-screen on a TV),
 * independent of the viewer's light/dark setting.
 */
export function DisplayPage() {
  const { slug = '' } = useParams();
  const { snap, connected, setSnap } = useClinicQueue(slug);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const now = useNow(1000);
  const bookUrl = `${window.location.origin}/c/${slug}`;
  const qr = useQrSvg(bookUrl, '#0b1311', '#ffffff');

  useEffect(() => {
    api<PublicSnapshot>(`/clinics/${slug}`).then(setSnap).catch((e: ApiError) => setError(e.message));
  }, [slug, setSnap]);

  // Announce each newly called token.
  const lastServing = useRef<number | null | undefined>(undefined);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const n = snap?.serving?.number ?? null;
    if (lastServing.current === undefined) {
      lastServing.current = n;
      return;
    }
    if (n !== null && n !== lastServing.current) {
      setFlash((f) => f + 1);
      if (sound) {
        chime();
        try {
          const u = new SpeechSynthesisUtterance(
            `Token number ${n}. Please go in${snap?.clinic.doctorName ? ` to ${snap.clinic.doctorName}` : ''}.`,
          );
          u.lang = 'en-IN';
          u.rate = 0.9;
          setTimeout(() => window.speechSynthesis?.speak(u), 900);
        } catch {
          /* speech not available */
        }
      }
    }
    lastServing.current = n;
  }, [snap?.serving?.number, sound, snap?.clinic.doctorName]);

  if (error) return <CenterMessage title="Clinic not found"><p className="text-muted">{error}</p></CenterMessage>;
  if (!snap) return <div className="min-h-full bg-[#0b1311]" />;

  const next = snap.waiting.slice(0, 6);
  const avgMin = Math.round(snap.consultSecs / 60);

  return (
    <div className="flex min-h-full flex-col bg-[#0b1311] text-[#e8f1ec] [color-scheme:dark]">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4 lg:px-10">
        <div>
          <p className="display-face text-2xl font-extrabold lg:text-3xl">{snap.clinic.name}</p>
          <p className="text-[#9fb3ab]">{snap.clinic.doctorName}</p>
        </div>
        <div className="text-right">
          <p className="num text-3xl lg:text-4xl">
            {new Date(now).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="text-sm text-[#9fb3ab]">{connected ? 'Live' : 'Reconnecting…'}</p>
        </div>
      </header>

      {snap.clinic.paused ? (
        <div className="bg-[#f4c95d] px-6 py-3 text-center text-xl font-bold text-[#2b1f00] lg:text-2xl">
          The doctor is on a short break. {snap.clinic.pauseMessage}
        </div>
      ) : null}

      <main className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-10 lg:p-10">
        <section className="flex flex-col items-center justify-center rounded-3xl bg-[#ffe08a] p-8 text-center text-[#3d2c00]">
          <p className="text-xl font-bold uppercase tracking-[0.2em] lg:text-2xl">Now seeing</p>
          <p key={flash} className="num pop text-[38vw] leading-none sm:text-[28vw] lg:text-[18vw]">
            {snap.serving?.number ?? '–'}
          </p>
          <p className="text-lg font-semibold lg:text-xl">
            {snap.serving ? 'Please go in when your number is shown.' : 'The next number will appear here.'}
          </p>
        </section>

        <section className="flex flex-col gap-6">
          <div className="rounded-3xl border border-white/10 p-6">
            <p className="text-lg font-bold uppercase tracking-[0.2em] text-[#9fb3ab]">Next</p>
            {next.length ? (
              <ol className="mt-4 grid grid-cols-3 gap-3">
                {next.map((n, i) => (
                  <li
                    key={n}
                    className={`num rounded-2xl py-4 text-center text-5xl lg:text-6xl ${i === 0 ? 'bg-[#2fae88] text-[#04140f]' : 'bg-white/8'}`}
                  >
                    {n}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-xl text-[#9fb3ab]">Nobody waiting.</p>
            )}
            {snap.waiting.length > next.length ? (
              <p className="mt-3 text-[#9fb3ab]">+ {snap.waiting.length - next.length} more waiting</p>
            ) : null}
            <p className="mt-4 text-lg">About {avgMin} min per patient today.</p>
          </div>

          <div className="flex items-center gap-5 rounded-3xl border border-white/10 p-6">
            {qr ? (
              <div className="h-32 w-32 shrink-0 overflow-hidden rounded-xl bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            ) : null}
            <div className="min-w-0">
              <p className="text-xl font-bold">Skip the wait</p>
              <p className="text-[#9fb3ab]">Scan to take a token on your phone and see your turn live.</p>
              <p className="mt-1 truncate font-mono text-sm text-[#9fb3ab]">{bookUrl.replace(/^https?:\/\//, '')}</p>
            </div>
          </div>
        </section>
      </main>

      {!sound ? (
        <div className="no-print fixed right-4 bottom-4 left-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={() => {
              setSound(true);
              chime();
            }}
            className="rounded-xl bg-white px-4 py-2.5 font-semibold text-[#0b1311]"
          >
            Turn on sound & announcements
          </button>
          <button
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="rounded-xl border border-white/30 px-4 py-2.5 font-semibold"
          >
            Full screen
          </button>
          <Link to="/" className="rounded-xl border border-white/30 px-4 py-2.5 font-semibold">Home</Link>
        </div>
      ) : null}
    </div>
  );
}
