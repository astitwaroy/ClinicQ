import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { PublicSnapshot, StaffSnapshot } from './api';

let socket: Socket | null = null;
function getSocket(): Socket {
  if (!socket) socket = io({ transports: ['websocket', 'polling'] });
  return socket;
}

/**
 * The server reads the session cookie when the socket connects, so after signing in or out
 * we open a fresh connection. Pages subscribe again via their `connect` handlers.
 */
export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}

/**
 * Live public queue for a clinic. Re-subscribes after reconnects (e.g. phone screen woke up),
 * and reports whether the live connection is currently up.
 */
export function useClinicQueue(slug: string | undefined, initial?: PublicSnapshot | null) {
  const [snap, setSnap] = useState<PublicSnapshot | null>(initial ?? null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!slug) return;
    const s = getSocket();
    const onQueue = (q: PublicSnapshot) => {
      if (q.clinic.slug === slug) setSnap(q);
    };
    const subscribe = () => {
      setConnected(true);
      s.emit('watch', { slug });
    };
    const onDown = () => setConnected(false);
    s.on('queue', onQueue);
    s.on('connect', subscribe);
    s.on('disconnect', onDown);
    if (s.connected) subscribe();
    return () => {
      s.off('queue', onQueue);
      s.off('connect', subscribe);
      s.off('disconnect', onDown);
    };
  }, [slug]);
  return { snap, connected, setSnap };
}

export function useStaffQueue(slug: string | undefined) {
  const [snap, setSnap] = useState<StaffSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!slug) return;
    const s = getSocket();
    // Only accept updates for the clinic this user belongs to.
    const onQueue = (q: StaffSnapshot) => {
      if (q.clinic.slug === slug) setSnap(q);
    };
    const subscribe = () => {
      s.emit('watchStaff', {}, (r: { ok?: boolean } | undefined) => setConnected(!!r?.ok));
    };
    const onDown = () => setConnected(false);
    s.on('staffQueue', onQueue);
    s.on('connect', subscribe);
    s.on('disconnect', onDown);
    if (s.connected) subscribe();
    return () => {
      s.off('staffQueue', onQueue);
      s.off('connect', subscribe);
      s.off('disconnect', onDown);
    };
  }, [slug]);
  return { snap, connected, setSnap };
}

/** Re-render every `ms` so timers and estimates tick between server updates. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Server clock offset so countdowns are right even if the phone's clock is off. */
export function useServerOffset(serverTime: string | undefined): number {
  const offset = useRef(0);
  if (serverTime) offset.current = Date.parse(serverTime) - Date.now();
  return offset.current;
}

/** Short two-tone chime via Web Audio (no audio files needed). */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = ctx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio not available */
  }
}
