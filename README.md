# ClinicQ: live token queue for small clinics

In most small clinics, patients get a paper token and then sit in a crowded waiting room for an hour, because
nobody can tell them when their turn will come. ClinicQ lets patients **take a token from their phone and watch
their place in line live**, so they can wait at home or nearby. The reception desk calls the next patient with one
tap, and a TV in the waiting room shows who is being seen.

**Live demo:** https://clinicq-84sn.onrender.com (free hosting: the first visit after a quiet spell takes up to a minute to wake up) · demo desk login `demo@clinicq.app` / `demo1234`

| Patient's phone | Called! | Waiting-room TV |
|---|---|---|
| <img src="docs/screenshots/patient-token.webp" width="260" alt="Token page showing 5 people ahead and about 45 minutes wait"> | <img src="docs/screenshots/patient-called.webp" width="260" alt="Token page saying it's your turn"> | <img src="docs/screenshots/tv-display.webp" width="420" alt="TV screen with the number being seen, next numbers and a QR code to book"> |

<img src="docs/screenshots/doctors-desk.webp" alt="Doctor's desk: current patient, call next, no-show, waiting list, walk-in form, queue controls">

## What it does

**For patients**
- Book a token in under a minute from a link or by scanning the QR poster on the clinic door. No app or account needed.
- A tracking page shows the token number, people ahead, estimated wait and the time you'll likely be called.
  It updates live, and can chime and vibrate when you are 2 away and when you're called.
- Cancel the token if plans change. Missed your turn? Reception can put you back in line right after the current patient.

**For the clinic**
- **Doctor's desk:** call next (`N`), mark no-show (`M`), call someone out of turn, finish without calling, add walk-ins,
  pause for a break with a message shown on every screen, close online booking, and cap tokens per day.
- **Waiting-room screen:** the number being seen, the next six, average visit length, and a QR code to book.
  It announces each new number aloud.
- **Analytics:** patients per day, no-show rate, average wait and visit length, share of online bookings, and busiest hours.
- **Settings:** clinic details, staff logins (owner only), shareable links and a printable QR poster.

## Architecture

```mermaid
flowchart LR
  P[Patient phone<br/>React] -- REST: book / cancel --> API
  D[Doctor's desk<br/>React] -- REST: next / no-show / walk-in --> API
  API[Express API<br/>Node.js + TypeScript] -- SQL in transactions --> DB[(PostgreSQL)]
  API -- broadcast --> WS[Socket.IO]
  WS -- "public room: numbers only" --> P
  WS -- "public room" --> TV[Waiting-room TV]
  WS -- "staff room: full details<br/>(cookie-authenticated)" --> D
```

- **One deployable service.** Express serves the API, the WebSocket and the built React app. Postgres is the only other piece.
- **Server is the source of truth.** Every change goes through the REST API and then gets broadcast. Clients
  never trust their own state, and a reconnecting client simply re-subscribes and gets a fresh snapshot.

### Correctness: no duplicate or skipped token numbers

The interesting part of a queue is concurrency: twenty people booking at 9:00 sharp, or reception double-clicking "next".

- Every queue change runs in a transaction that first takes a row lock on the clinic (`SELECT … FOR UPDATE`),
  so changes to one clinic's queue happen one at a time. Different clinics never block each other.
- Token numbers come from a per-clinic, per-day counter (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) inside that
  transaction, so they are gap-free and never repeat.
- The database enforces the rules as well as the app, using partial unique indexes:
  - `UNIQUE (clinic_id, service_date, number)`: a number is never handed out twice.
  - `… (clinic_id, service_date) WHERE status = 'serving'`: only one patient is with the doctor at a time.
  - `… (clinic_id, service_date, phone) WHERE status IN ('waiting','serving')`: one active token per phone per day.
- Tests fire 25 bookings and 4 "next" clicks concurrently and check the results ([`server/tests/queue.test.ts`](server/tests/queue.test.ts)).

### Wait estimates that adapt

Visit length is an **exponentially weighted moving average** (α = 0.3) of today's finished visits, starting from the
clinic's typical visit time. Each visit is clamped to between 1 and 60 minutes.
A patient's estimate = remaining time of the current visit (at least 1 minute) + people ahead × average.
Recent visits count most, so the estimate follows a doctor who speeds up or slows down, and one long visit only nudges it
([`server/src/lib/eta.ts`](server/src/lib/eta.ts)).

### Privacy

- Public endpoints and the public WebSocket room carry **token numbers only**. A test checks that names and phone numbers never appear.
- The tracking link is an unguessable 8-character code. It shows only the patient's first name, because links get shared with family.
- Names, phone numbers and reasons are erased from tokens older than 7 days. Analytics only need timestamps.
- Sessions use an httpOnly, SameSite cookie. Passwords are hashed with bcrypt. Booking and login are rate-limited.
  Staff routes are scoped to the signed-in user's clinic.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 4, Recharts, Socket.IO client |
| Backend | Node.js 22, Express, TypeScript, Socket.IO, Zod validation, node-postgres |
| Database | PostgreSQL 16 (plain SQL migrations, no ORM) |
| Auth | bcrypt, JWT in an httpOnly cookie |
| Tests | Vitest + Supertest against a real Postgres, Socket.IO client for live updates |
| CI / hosting | GitHub Actions; Render (web service) + Neon (Postgres) |

## Run it locally

You need Node 20+ and PostgreSQL.

```bash
createdb clinicq                        # or use any Postgres URL
npm install
export DATABASE_URL=postgres://localhost:5432/clinicq   # default: postgres://dev:dev@localhost:5432/clinicq
npm run seed                            # creates the demo clinic with two weeks of history
npm run dev                             # API on :3000, web app on :5173
```

Open http://localhost:5173 and sign in with `demo@clinicq.app` / `demo1234`.

```bash
npm test          # 28 API, concurrency, privacy and live-update tests (uses clinicq_test, or TEST_DATABASE_URL)
npm run build     # production build: web → web/dist, server → server/dist
npm start         # serves everything on :3000
```

## Deploy for free (Render + Neon)

1. **Database:** create a free project at [neon.tech](https://neon.tech) (pick the Singapore region if you're in India)
   and copy the connection string.
2. **App:** on [render.com](https://render.com), choose **New → Blueprint** and select this repo. Render reads `render.yaml`.
   Paste the Neon string as `DATABASE_URL`; `JWT_SECRET` is generated for you.
3. On first start the server runs the migrations and creates the demo clinic. Open the URL Render gives you.

The free Render plan sleeps after 15 minutes without traffic, so the first visit after a while takes about a minute to wake up.

## API

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/clinics/:slug` | public | Clinic info and live queue (numbers only) |
| POST | `/api/clinics/:slug/tokens` | public | Book a token `{patientName, phone, reason?}` |
| GET | `/api/tokens/:code` | link holder | Token status and queue |
| POST | `/api/tokens/:code/cancel` | link holder | Cancel a waiting token |
| POST | `/api/auth/signup` · `/login` · `/logout` | — | Clinic owner sign-up and sessions |
| GET | `/api/staff/queue` | staff | Today's full queue |
| POST | `/api/staff/queue/advance` | staff | `{mode: next \| no_show \| finish}` |
| POST | `/api/staff/queue/:id/call` · `/:id/requeue` | staff | Call out of turn, re-queue a no-show |
| POST | `/api/staff/queue/walkin` | staff | Add a walk-in |
| PATCH | `/api/staff/clinic` | staff | Booking on/off, pause, limits, details |
| GET | `/api/staff/analytics?days=14` | staff | Daily and hourly stats |
| GET/POST/DELETE | `/api/staff/team` | owner | Staff logins |

WebSocket events: emit `watch {slug}` → receive `queue`; emit `watchStaff` (with the session cookie) → receive `staffQueue`.

## Project layout

```
server/
  migrations/001_init.sql      schema and queue invariants
  src/services/queue.ts        booking, calling, re-queue, snapshots (all transactional)
  src/services/realtime.ts     Socket.IO rooms and broadcast
  src/services/analytics.ts    reporting queries
  src/services/demo.ts         demo clinic, history generator, autopilot, data retention
  src/lib/eta.ts               wait-time estimation
  tests/                       Vitest suites
web/src/pages/                 patient, token, TV, desk, analytics, settings
```

## Ideas for next steps

- SMS or WhatsApp alerts for patients without smartphones, via an SMS provider.
- Several doctors per clinic, each with their own queue and screen.
- Booking for a later day, with time slots.
- Interface in Hindi and other regional languages.
