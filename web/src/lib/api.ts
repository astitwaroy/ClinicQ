export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON fetch against our own API. Throws ApiError with the server's friendly message. */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

// ------------------------------------------------------------ shared types (mirror the server)

export type TokenStatus = 'waiting' | 'serving' | 'done' | 'no_show' | 'cancelled';

export interface PublicSnapshot {
  clinic: {
    name: string;
    slug: string;
    doctorName: string;
    address: string;
    phone: string;
    bookingOpen: boolean;
    paused: boolean;
    pauseMessage: string;
    dailyLimit: number;
    isDemo: boolean;
  };
  date: string;
  serverTime: string;
  serving: { number: number; calledAt: string } | null;
  waiting: number[];
  issuedToday: number;
  servedToday: number;
  consultSecs: number;
}

export interface StaffToken {
  id: string;
  number: number;
  patientName: string;
  phone: string;
  reason: string;
  source: 'online' | 'walkin';
  status: TokenStatus;
  createdAt: string;
  calledAt: string | null;
  completedAt: string | null;
}

export interface StaffSnapshot extends PublicSnapshot {
  tokens: StaffToken[];
}

export interface Me {
  user: { id: string; name: string; email: string; role: 'owner' | 'staff' };
  clinic: {
    id: string;
    slug: string;
    name: string;
    doctorName: string;
    address: string;
    phone: string;
    defaultConsultSecs: number;
    dailyLimit: number;
    bookingOpen: boolean;
    paused: boolean;
    pauseMessage: string;
    isDemo: boolean;
  };
}

export interface TokenView {
  token: {
    code: string;
    number: number;
    status: TokenStatus;
    patientName: string;
    serviceDate: string;
    createdAt: string;
    calledAt: string | null;
    completedAt: string | null;
  };
  queue: PublicSnapshot;
}
