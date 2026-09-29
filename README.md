# EVE Healthcare – Diagnostic Booking Service

A small backend for booking diagnostic tests at diagnostic centres, with a simulated payment
service and an idempotent payment webhook.

**Stack:** Node.js · Express 5 · TypeScript · PostgreSQL · Prisma · Zod · JWT · Jest + Supertest

> Status: authentication and diagnostic centres/tests are implemented. Bookings, payments and the
> webhook are implemented in subsequent steps.

## Running locally

Prerequisites: Node.js 20+ and a running PostgreSQL instance.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / secrets
cp .env.test.example .env.test  # separate database for tests

npm run db:deploy               # apply migrations to the dev database
npm run db:seed                 # admin user (from ADMIN_* in .env) + demo centres/tests/prices
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

### Diagnostic centres & tests

Reads are public. Every write requires an admin token (`authenticate` → 401, `requireAdmin` → 403).

| Method | Path                               | Auth  | Description                                         |
| ------ | ---------------------------------- | ----- | --------------------------------------------------- |
| POST   | `/centres`                         | Admin | Create a centre `{ name, location }`                |
| GET    | `/centres`                         | –     | List centres                                        |
| GET    | `/centres/:centreId`               | –     | Get one centre                                      |
| POST   | `/tests`                           | Admin | Create a test `{ name, description? }`              |
| GET    | `/tests`                           | –     | List the test catalogue                             |
| POST   | `/centres/:centreId/tests`         | Admin | Offer a test at a centre `{ testId, pricePaise }`   |
| GET    | `/centres/:centreId/tests`         | –     | Tests offered at a centre, with that centre's price |
| PATCH  | `/centres/:centreId/tests/:testId` | Admin | Change the price `{ pricePaise }`                   |

Prices are **integers in paise**: `49900` = ₹499.00.

```bash
# Admin: offer a test at a centre
curl -X POST http://localhost:3000/centres/<centreId>/tests   -H "Authorization: Bearer <adminToken>" -H "Content-Type: application/json"   -d '{"testId":"<testId>","pricePaise":35000}'

# Public: what does this centre offer, and at what price?
curl http://localhost:3000/centres/<centreId>/tests
# 200 { "data": [ { "id": "…", "centreId": "…", "pricePaise": 35000,
#                   "test": { "id": "…", "name": "Complete Blood Count (CBC)", "description": "…" } } ] }
```

| Situation                                     | Status | `error.code`       |
| --------------------------------------------- | ------ | ------------------ |
| Invalid UUID in the path, bad body, price ≤ 0 | 400    | `VALIDATION_ERROR` |
| No token on a write                           | 401    | `UNAUTHORIZED`     |
| Normal user attempts a write                  | 403    | `FORBIDDEN`        |
| Centre, test or offering not found            | 404    | `NOT_FOUND`        |
| Duplicate test name, centre, or offering      | 409    | `CONFLICT`         |

There are deliberately **no DELETE endpoints** — see Assumptions.

## Database design

```
diagnostic_centres ──< centre_test_offerings >── diagnostic_tests
                              │
users ──────────────────< bookings ──< payments ──< webhook_events
```

| Table                   | Notes                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `users`                 | Name, unique lowercase email, bcrypt password hash, role (`USER`/`ADMIN`)            |
| `diagnostic_centres`    | Name + free-text location; unique `(name, location)`                                 |
| `diagnostic_tests`      | Catalogue of test types (unique name, optional description)                          |
| `centre_test_offerings` | Which centre offers which test, at what `price_paise`; unique `(centre_id, test_id)` |
| `bookings`              | User, offering (→ centre + test), appointment time, `amount_paise` snapshot, status  |
| `payments`              | Payment attempts for a booking; unique `provider_reference`                          |
| `webhook_events`        | Every processed provider event; unique `event_id`                                    |

Key decisions:

- **Price belongs to the offering, not the test.** The same test can cost different amounts at
  different centres (the seed data shows CBC at ₹350, ₹399 and ₹420).
- **Money is stored as integers in paise** (`price_paise`, `amount_paise`) to avoid
  floating-point rounding. Zod rejects non-integer or non-positive prices, and hand-written
  `CHECK (> 0)` constraints in the migration SQL enforce the same rule in the database (Prisma's
  schema language cannot express CHECK constraints).
- **Booking amount is a snapshot** of the centre's price at booking time, so later price changes
  do not alter existing bookings.
- **Bookings reference the offering** (`offering_id`), so a booking can only be for a test the
  centre actually offers.
- **All foreign keys are `ON DELETE RESTRICT`**: a centre, test or offering that bookings refer to
  can never be deleted out from under them.
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
- A centre's location is a single free-text string (no structured address or geolocation).
- Centre uniqueness is `(name, location)`: the same chain may have several branches. Name
  uniqueness for tests and centres is case-sensitive.
- Prices are between 1 paise and ₹1,00,000 (`10000000` paise).
- **No DELETE endpoints.** Once bookings reference an offering, deleting its centre or test would
  either fail or erase booking history. Removing items from sale would be done with an "active" flag,
  which is out of scope.
- Changing a price (PATCH) only affects future bookings; existing bookings keep their snapshot.
