# EVE Healthcare – Diagnostic Booking Service

A small backend for booking diagnostic tests at diagnostic centres, with a simulated payment
service and an idempotent payment webhook.

**Stack:** Node.js · Express 5 · TypeScript · PostgreSQL · Prisma · Zod · JWT · Jest + Supertest

> Status: foundation and authentication are implemented. Centres, bookings, payments and the
> webhook are implemented in subsequent steps.

## Running locally

Prerequisites: Node.js 20+ and a running PostgreSQL instance.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / secrets
cp .env.test.example .env.test  # separate database for tests

npm run db:deploy               # apply migrations to the dev database
npm run db:seed                 # create the admin user from ADMIN_* in .env
npm run dev                     # http://localhost:3000/health
```

### Tests

```bash
npm run db:test:deploy          # apply migrations to the test database
npm test
```

### Other scripts

| Script               | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `npm run build`      | Compile TypeScript to `dist/`               |
| `npm start`          | Run the compiled server                     |
| `npm run lint`       | ESLint                                      |
| `npm run typecheck`  | Type-check source and tests                 |
| `npm run db:migrate` | Create a new migration after schema edits   |
| `npm run db:seed`    | Create/reset the admin account (idempotent) |

## Architecture

```
Route → Middleware (auth, validate) → Controller → Service → Repository → PostgreSQL
                                                                  ↓ (any thrown error)
                                                           errorHandler → JSON error
```

| Folder          | Responsibility                                                             |
| --------------- | -------------------------------------------------------------------------- |
| `config/`       | Environment validation (fails fast on bad config) and the Prisma client    |
| `routes/`       | URL → handler mapping; attaches auth and validation middleware per route   |
| `middleware/`   | Cross-cutting concerns: JWT auth, Zod validation, error handling           |
| `validators/`   | Zod schemas for request bodies, params and queries                         |
| `controllers/`  | HTTP only: read the validated request, call a service, shape the response  |
| `services/`     | Business rules: booking state transitions, payment processing, idempotency |
| `repositories/` | Prisma queries; the only layer that talks to the database                  |
| `types/`        | Shared types (e.g. `req.user` augmentation)                                |
| `utils/`        | Small helpers such as `AppError`                                           |

### Response format

Successful responses wrap the payload in `data`:

```json
{ "data": { "id": "…", "name": "Asha Rao" } }
```

Every error response has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": {} } }
```

Services throw `AppError` (400/401/403/404/409) for expected failures. The central `errorHandler`
also maps Zod errors, malformed JSON and Prisma unique-constraint / not-found errors. Anything else
returns a generic 500 without leaking internals.

## API endpoints

### Authentication

| Method | Path           | Auth | Description                    |
| ------ | -------------- | ---- | ------------------------------ |
| POST   | `/auth/signup` | –    | Register a user                |
| POST   | `/auth/login`  | –    | Exchange credentials for a JWT |

Protected endpoints require `Authorization: Bearer <accessToken>`.

**Roles.** Every user is `USER` or `ADMIN`. Signup always creates a `USER` (a `role` field in
the request body is ignored); the only admin is created by `npm run db:seed`. Admin-only routes use
`authenticate` (who are you? → 401) followed by `requireAdmin` (are you allowed? → 403).

```bash
curl -X POST http://localhost:3000/auth/signup   -H "Content-Type: application/json"   -d '{"name":"Asha Rao","email":"asha@example.com","password":"password123"}'
# 201 { "data": { "id": "…", "name": "Asha Rao", "email": "asha@example.com", "createdAt": "…" } }

curl -X POST http://localhost:3000/auth/login   -H "Content-Type: application/json"   -d '{"email":"asha@example.com","password":"password123"}'
# 200 { "data": { "accessToken": "eyJ…", "tokenType": "Bearer", "expiresIn": "1h", "user": { … } } }
```

| Situation                                | Status | `error.code`               |
| ---------------------------------------- | ------ | -------------------------- |
| Invalid body (bad email, short password) | 400    | `VALIDATION_ERROR`         |
| Email already registered                 | 409    | `EMAIL_ALREADY_REGISTERED` |
| Wrong email or password                  | 401    | `INVALID_CREDENTIALS`      |
| Missing / malformed Authorization header | 401    | `UNAUTHORIZED`             |
| Invalid or tampered token                | 401    | `INVALID_TOKEN`            |
| Expired token                            | 401    | `TOKEN_EXPIRED`            |
| Normal user calls an admin-only route    | 403    | `FORBIDDEN`                |

## Database design

```
users ──< bookings >── centre_tests >── diagnostic_centres
              │              │
              │              └──────── diagnostic_tests
              └──< payments ──< webhook_events
```

| Table                | Notes                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `users`              | Name, unique lowercase email, bcrypt password hash, role (`USER`/`ADMIN`)    |
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
- Emails are case-insensitive: they are trimmed and lowercased before being stored or looked up.
- Passwords must be 8–72 characters (bcrypt ignores bytes beyond 72).
- Login returns the same error for an unknown email and a wrong password, so the API does not
  reveal which emails are registered.
- A JWT is trusted until it expires (default 1 hour); there are no refresh tokens or revocation.
  The role is stored in the token, so a role change takes effect at the user's next login.
- There is a single seeded admin; there is no API to promote users.
