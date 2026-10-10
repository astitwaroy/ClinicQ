import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { readCookie, SESSION_COOKIE, userFromToken } from '../lib/auth.js';
import { getClinicBySlug, publicSnapshot, staffSnapshot } from './queue.js';

/**
 * Live updates over Socket.IO.
 *   public:<clinicId>  – patients' phones and the waiting-room screen (token numbers only)
 *   staff:<clinicId>   – the doctor's desk (full patient details); requires the session cookie
 */
let io: Server | null = null;
const pending = new Map<string, NodeJS.Timeout>();

export function attachRealtime(server: HttpServer): Server {
  io = new Server(server, { serveClient: false, cors: { origin: false } });

  io.on('connection', (socket) => {
    socket.on('watch', async (msg: { slug?: unknown }, ack?: (r: unknown) => void) => {
      try {
        if (typeof msg?.slug !== 'string') throw new Error('slug required');
        const clinic = await getClinicBySlug(msg.slug);
        for (const room of socket.rooms) if (room.startsWith('public:')) socket.leave(room);
        socket.join(`public:${clinic.id}`);
        socket.emit('queue', await publicSnapshot(clinic.id));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('watchStaff', async (_msg: unknown, ack?: (r: unknown) => void) => {
      try {
        for (const room of socket.rooms) if (room.startsWith('staff:')) socket.leave(room);
        const user = await userFromToken(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
        if (!user) return ack?.({ ok: false });
        socket.join(`staff:${user.clinicId}`);
        socket.emit('staffQueue', await staffSnapshot(user.clinicId));
        ack?.({ ok: true });
      } catch (err) {
        console.error('watchStaff failed', err);
        ack?.({ ok: false });
      }
    });
  });
  return io;
}

/** Push fresh snapshots to everyone watching a clinic. Bursts within 40 ms are coalesced. */
export function broadcast(clinicId: string): void {
  if (!io) return;
  if (pending.has(clinicId)) return;
  pending.set(
    clinicId,
    setTimeout(async () => {
      pending.delete(clinicId);
      if (!io) return;
      try {
        io.to(`public:${clinicId}`).emit('queue', await publicSnapshot(clinicId));
        const staffRoom = io.sockets.adapter.rooms.get(`staff:${clinicId}`);
        if (staffRoom?.size) io.to(`staff:${clinicId}`).emit('staffQueue', await staffSnapshot(clinicId));
      } catch (err) {
        console.error('broadcast failed', err);
      }
    }, 40),
  );
}

export function closeRealtime(): Promise<void> {
  return new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
