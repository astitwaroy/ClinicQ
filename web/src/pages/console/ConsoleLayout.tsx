import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { CenterMessage, Logo, cx } from '../../components/ui';
import { api, ApiError, type Me } from '../../lib/api';
import { resetSocket } from '../../lib/live';

interface ConsoleCtx {
  me: Me;
  refreshMe: () => Promise<void>;
}
export const useConsole = () => useOutletContext<ConsoleCtx>();

export function ConsoleLayout() {
  const [me, setMe] = useState<Me | null>(null);
  const navigate = useNavigate();

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch (e) {
      if ((e as ApiError).status === 401) navigate('/login', { replace: true });
    }
  }, [navigate]);
  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  if (!me) return <CenterMessage title="Opening the desk…" />;

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    resetSocket();
    navigate('/login');
  }

  const tab = ({ isActive }: { isActive: boolean }) =>
    cx('rounded-lg px-3 py-1.5 text-sm font-semibold', isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-sunken hover:text-ink');

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Logo to="/app" />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate font-semibold">{me.clinic.name}</p>
              <p className="truncate text-xs text-muted">
                {me.user.name} · {me.user.role === 'owner' ? 'Owner' : 'Staff'}
                {me.clinic.isDemo ? ' · demo' : ''}
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/app" end className={tab}>Queue</NavLink>
            <NavLink to="/app/analytics" className={tab}>Analytics</NavLink>
            <NavLink to="/app/settings" className={tab}>Settings</NavLink>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <a href={`/display/${me.clinic.slug}`} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1.5 font-semibold hover:bg-sunken">
              TV screen ↗
            </a>
            <a href={`/c/${me.clinic.slug}`} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1.5 font-semibold hover:bg-sunken">
              Patient page ↗
            </a>
            <button onClick={logout} className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-sunken hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet context={{ me, refreshMe } satisfies ConsoleCtx} />
      </main>
    </div>
  );
}
