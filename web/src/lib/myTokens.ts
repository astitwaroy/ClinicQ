/** Tokens booked from this device, so a patient who closes the tab can find theirs again. */
interface Saved {
  code: string;
  slug: string;
  number: number;
  date: string;
}
const KEY = 'clinicq.myTokens';

export function savedTokens(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Saved[];
  } catch {
    return [];
  }
}

export function saveToken(t: Saved) {
  try {
    const rest = savedTokens().filter((x) => x.code !== t.code).slice(0, 19);
    localStorage.setItem(KEY, JSON.stringify([t, ...rest]));
  } catch {
    /* storage unavailable */
  }
}

export function todaysTokenFor(slug: string, date: string): Saved | undefined {
  return savedTokens().find((t) => t.slug === slug && t.date === date);
}
