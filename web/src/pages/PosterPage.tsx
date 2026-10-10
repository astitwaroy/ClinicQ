import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, CenterMessage } from '../components/ui';
import { api, type PublicSnapshot } from '../lib/api';
import { useQrSvg } from '../lib/qr';

/** A printable A4 poster with the booking QR code, for the clinic door and reception. */
export function PosterPage() {
  const { slug = '' } = useParams();
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const url = `${window.location.origin}/c/${slug}`;
  const qr = useQrSvg(url);
  useEffect(() => {
    api<PublicSnapshot>(`/clinics/${slug}`).then(setSnap).catch(() => {});
  }, [slug]);
  if (!snap) return <CenterMessage title="Loading…" />;

  return (
    <div className="min-h-full bg-white text-[#0f1f1b] [color-scheme:light]">
      <div className="no-print flex justify-center gap-2 p-4">
        <Button onClick={() => window.print()}>Print poster</Button>
      </div>
      <div className="mx-auto grid max-w-[180mm] justify-items-center gap-6 px-6 py-10 text-center">
        <p className="text-lg font-bold uppercase tracking-[0.2em]">{snap.clinic.name}</p>
        <h1 className="display-face text-5xl font-extrabold leading-tight">Don't wait in line.<br />Take a token on your phone.</h1>
        {qr ? <div className="h-[90mm] w-[90mm] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
        <ol className="grid gap-1 text-xl">
          <li>1. Scan the code with your phone camera.</li>
          <li>2. Enter your name and mobile number.</li>
          <li>3. Watch your place in line. Come in when it's almost your turn.</li>
        </ol>
        <p className="font-mono text-lg">{url.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  );
}
