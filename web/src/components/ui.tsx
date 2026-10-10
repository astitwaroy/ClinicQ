import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-strong border-transparent',
  secondary: 'bg-card text-ink border-line hover:border-muted',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-sunken',
  danger: 'bg-card text-bad border-line hover:border-bad',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2.5 text-[15px]',
        size === 'lg' && 'px-5 py-3.5 text-base',
        btn[variant],
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-bad">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted/70',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
        props.className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-2xl border border-line bg-card', className)}>{children}</section>;
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{children}</p>;
}

type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'muted';
const tone: Record<Tone, string> = {
  brand: 'text-brand border-brand/40 bg-brand/10',
  ok: 'text-ok border-ok/40 bg-ok/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  bad: 'text-bad border-bad/40 bg-bad/10',
  muted: 'text-muted border-line bg-sunken',
};
export function Pill({ t = 'muted', children }: { t?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', tone[t])}>
      {children}
    </span>
  );
}

export function LiveDot({ on }: { on: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={on ? 'Live' : 'Reconnecting'}>
      <span className={cx('h-2 w-2 rounded-full', on ? 'bg-ok' : 'bg-warn')} />
      {on ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 font-bold text-ink">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect x="2" y="7" width="28" height="18" rx="4" fill="var(--brand)" />
        <circle cx="2" cy="16" r="3.2" fill="var(--paper)" />
        <circle cx="30" cy="16" r="3.2" fill="var(--paper)" />
        <path d="M11 12v8M16 11v10M21 13v6" stroke="var(--slip)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="display-face text-xl tracking-tight">ClinicQ</span>
    </Link>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
      {children}
    </div>
  );
}

export function CenterMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-24 text-center">
      <h1 className="display-face text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
