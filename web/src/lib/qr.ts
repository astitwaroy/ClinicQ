import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** SVG markup for a QR code of `text` (generated locally, no external service). */
export function useQrSvg(text: string | null, dark = '#0f1f1b', light = '#ffffff'): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [text, dark, light]);
  return svg;
}
