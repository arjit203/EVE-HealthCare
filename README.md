# EVE Healthcare – Diagnostic Booking Service

A small backend for booking diagnostic tests at diagnostic centres, with a simulated payment
service and an idempotent payment webhook.

**Stack:** Node.js · Express 5 · TypeScript · PostgreSQL · Prisma · Zod · JWT · Jest + Supertest

> Status: project foundation and database schema are in place. Business modules (auth, centres,
> bookings, payments, webhook) are implemented in subsequent steps.

## Running locally

Prerequisites: Node.js 20+ and a running PostgreSQL instance.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / secrets
cp .env.test.example .env.test  # separate database for tests

npm run db:deploy               # apply migrations to the dev database
npm run dev                     # http://localhost:3000/health
```

### Tests

```bash
npm run db:test:deploy          # apply migrations to the test database
npm test
```

### Other scripts

| Script               | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `npm run build`      | Compile TypeScript to `dist/`             |
| `npm start`          | Run the compiled server                   |
| `npm run lint`       | ESLint                                    |
| `npm run typecheck`  | Type-check source and tests               |
| `npm run db:migrate` | Create a new migration after schema edits |

## Architecture

```
Route → Middleware (auth, validate) → Controller → Service → Repository → PostgreSQL
                                                                  ↓ (any thrown error)
                                                           errorHandler → JSON error
```

| Folder          | Responsibility                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| `config/`       | Environment validation (fails fast on bad config) and the Prisma client       |
| `routes/`       | URL → handler mapping; attaches auth and validation middleware per route      |
| `middleware/`   | Cross-cutting concerns: JWT auth, role checks, Zod validation, error handling |
| `validators/`   | Zod schemas for request bodies, params and queries                            |
| `controllers/`  | HTTP only: read the validated request, call a service, shape the response     |
| `services/`     | Business rules: booking state transitions, payment processing, idempotency    |
| `repositories/` | Prisma queries; the only layer that talks to the database                     |
| `types/`        | Shared types (e.g. `req.user` augmentation)                                   |
| `utils/`        | Small helpers such as `AppError`                                              |

### Error format

Every error response has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": {} } }
```

Services throw `AppError` (400/401/403/404/409) for expected failures. The central `errorHandler`
also maps Zod errors, malformed JSON and Prisma unique-constraint / not-found errors. Anything else
returns a generic 500 without leaking internals.

## Database design

```
users ──< bookings >── centre_tests >── diagnostic_centres
              │              │
              │              └──────── diagnostic_tests
              └──< payments ──< webhook_events
```

| Table                | Notes                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `users`              | Unique email, bcrypt password hash, role `PATIENT` or `ADMIN`                |
| `diagnostic_centres` | Name + location (unique together)                                            |
| `diagnostic_tests`   | Catalogue of test types, independent of centres                              |
| `centre_tests`       | Which centre offers which test, and at what price. PK `(centre_id, test_id)` |
| `bookings`           | User, centre, test, appointment time, amount snapshot, status                |
| `payments`           | Payment attempts for a booking; unique `provider_reference`                  |
| `webhook_events`     | Every processed provider event; unique `event_id`                            |

Key decisions:

- **Money is stored as integers in minor units** (`price_minor`, `amount_minor`, paise) to avoid
  floating-point rounding. `CHECK (> 0)` constraints guard against zero/negative amounts.
- **Booking amount is a snapshot** of the centre's price at booking time, so later price changes
  do not alter existing bookings.
- **Composite foreign key** `bookings(centre_id, test_id) → centre_tests` makes it impossible to
  book a test at a centre that does not offer it.
- **One booking, many payment attempts** – a failed payment can be retried. A partial unique index
  (`payments_one_success_per_booking`) guarantees at most one `SUCCESS` payment per booking, even
  under concurrent requests.
- **Webhook idempotency** – `webhook_events.event_id` is unique. The event row is inserted in the
  same transaction as the payment/booking update, so a replayed event either hits the unique
  constraint or finds the payment already in a terminal state, and becomes a no-op.

## Assumptions

- Timestamps are stored as `timestamptz`; clients send ISO-8601 datetimes.
- Managing centres and tests is restricted to `ADMIN` users; any authenticated user can book.
