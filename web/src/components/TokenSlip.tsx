import type { ReactNode } from 'react';
import { cx } from './ui';

/** The paper token a patient would normally get at the counter, as a ticket stub. */
export function TokenSlip({
  number,
  clinic,
  footer,
  size = 'lg',
  className,
}: {
  number: number;
  clinic: string;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cx('slip rounded-2xl px-8 pt-5 pb-4 text-center', className)}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-75">{clinic}</p>
      <p className="mt-1 text-sm font-semibold opacity-80">Token</p>
      <p className={cx('num', size === 'lg' ? 'text-[7.5rem]' : 'text-7xl')} aria-label={`Token number ${number}`}>
        {number}
      </p>
      {footer ? <div className="slip-perf mt-3 pt-3 text-sm font-semibold">{footer}</div> : null}
    </div>
  );
}
