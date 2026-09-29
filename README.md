# EVE Healthcare – Diagnostic Booking Service

A small backend for booking diagnostic tests at diagnostic centres, with a simulated payment
service and an idempotent payment webhook.

**Stack:** Node.js · Express 5 · TypeScript · PostgreSQL · Prisma · Zod · JWT · Jest + Supertest

> Status: authentication, diagnostic centres/tests, bookings and simulated payments are implemented.
> The payment webhook is implemented in a subsequent step.

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

### Bookings

All booking routes require a token. Every user — including admins — only ever sees and cancels
**their own** bookings.

| Method | Path                   | Description                                      |
| ------ | ---------------------- | ------------------------------------------------ |
| POST   | `/bookings`            | Book `{ centreId, testId, appointmentDateTime }` |
| GET    | `/bookings`            | The caller's bookings, newest first              |
| GET    | `/bookings/:id`        | One of the caller's bookings                     |
| PATCH  | `/bookings/:id/cancel` | Cancel one of the caller's bookings              |

```bash
curl -X POST http://localhost:3000/bookings   -H "Authorization: Bearer <token>" -H "Content-Type: application/json"   -d '{"centreId":"<centreId>","testId":"<testId>","appointmentDateTime":"2030-01-15T10:00:00+05:30"}'
# 201 { "data": { "id": "…", "status": "PENDING", "amountPaise": 35000,
#                 "appointmentDateTime": "2030-01-15T04:30:00.000Z",
#                 "centre": { "id": "…", "name": "HealthFirst Diagnostics", "location": "…" },
#                 "test": { "id": "…", "name": "Complete Blood Count (CBC)" }, … } }
```

The amount is **always** the centre's current price for that test; the request body is strict,
so sending `amount`, `amountPaise` or `status` is rejected with 400.

**Booking status rules** (defined once in `src/utils/bookingStatus.ts`):

```
PENDING ──payment succeeds──► CONFIRMED ──user cancels──► CANCELLED   (no refund; out of scope)
   │  └──payment fails──────► FAILED       (terminal)
   └──────user cancels──────► CANCELLED    (terminal)
```

| Situation                                                           | Status | `error.code`                |
| ------------------------------------------------------------------- | ------ | --------------------------- |
| Malformed id, bad/past/timezone-less time, unknown field (`amount`) | 400    | `VALIDATION_ERROR`          |
| No token                                                            | 401    | `UNAUTHORIZED`              |
| Booking doesn't exist **or belongs to another user**                | 404    | `NOT_FOUND`                 |
| Centre or test in the body doesn't exist                            | 404    | `NOT_FOUND`                 |
| Centre exists and test exists, but the centre doesn't offer it      | 422    | `TEST_NOT_OFFERED`          |
| Same user, centre, test and time already booked (active)            | 409    | `DUPLICATE_BOOKING`         |
| Cancelling a CANCELLED or FAILED booking                            | 409    | `INVALID_STATUS_TRANSITION` |
| Cancelling after the appointment time                               | 409    | `APPOINTMENT_PASSED`        |

Another user's booking returns **404, not 403**, so the API never reveals that a booking ID exists.
This is enforced in the query itself (`WHERE id = ? AND user_id = ?`), not by fetching and comparing.

Booking responses include the booking's `payment` (`id`, `status`, `providerPaymentId`,
`amountPaise`) once it has been paid, or `null`.

### Payments (simulated)

There is **no real payment gateway**. A mock provider settles the payment immediately.

| Method | Path        | Auth | Description                                                            |
| ------ | ----------- | ---- | ---------------------------------------------------------------------- |
| POST   | `/payments` | User | Pay for one of your PENDING bookings `{ bookingId, simulateOutcome? }` |

```bash
curl -X POST http://localhost:3000/payments   -H "Authorization: Bearer <token>" -H "Content-Type: application/json"   -d '{"bookingId":"<bookingId>","simulateOutcome":"SUCCESS"}'
# 201 { "data": { "id": "…", "bookingId": "…", "amountPaise": 35000, "status": "SUCCESS",
#                 "providerPaymentId": "mock_pay_…", "booking": { "id": "…", "status": "CONFIRMED" } } }
```

- `simulateOutcome` (`"SUCCESS"` | `"FAILED"`, default `"SUCCESS"`) makes the mock deterministic
  for testing. Letting the client pick the outcome is acceptable **only because this is a mock**; with a
  real gateway the outcome comes from the provider.
- The amount is always the booking's `amountPaise`. Sending `amount` is rejected with 400.
- **A failed payment is still a successful request**: `201` with `"status": "FAILED"`, and the
  booking becomes `FAILED`. 4xx codes are reserved for requests that could not be processed.
- Flow: SUCCESS → booking `CONFIRMED`; FAILED → booking `FAILED` (terminal: the user creates a new
  booking to try again).
- **Relationship with the webhook:** `POST /payments` settles synchronously. The webhook
  (`POST /payments/webhook/`) is the provider's asynchronous notification of the same outcome; both
  settle through one shared function, so a webhook for an already-settled payment changes nothing.

| Situation                                               | Status | `error.code`             |
| ------------------------------------------------------- | ------ | ------------------------ |
| Missing/malformed `bookingId`, unknown field (`amount`) | 400    | `VALIDATION_ERROR`       |
| No token                                                | 401    | `UNAUTHORIZED`           |
| Booking doesn't exist or belongs to another user        | 404    | `NOT_FOUND`              |
| Booking already paid (CONFIRMED)                        | 409    | `PAYMENT_ALREADY_EXISTS` |
| Booking is FAILED or CANCELLED                          | 409    | `BOOKING_NOT_PAYABLE`    |
| Appointment time has passed                             | 409    | `APPOINTMENT_PASSED`     |

## Database design

```
diagnostic_centres ──< centre_test_offerings >── diagnostic_tests
                              │
users ──────────────────< bookings ──< payments ──< webhook_events
```

| Table                   | Notes                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `users`                 | Name, unique lowercase email, bcrypt password hash, role (`USER`/`ADMIN`)                       |
| `diagnostic_centres`    | Name + free-text location; unique `(name, location)`                                            |
| `diagnostic_tests`      | Catalogue of test types (unique name, optional description)                                     |
| `centre_test_offerings` | Which centre offers which test, at what `price_paise`; unique `(centre_id, test_id)`            |
| `bookings`              | User, centre, test, `appointment_date_time`, `amount_paise` snapshot, status enum               |
| `payments`              | One per booking (unique `booking_id`); amount, `SUCCESS`/`FAILED`, unique `provider_payment_id` |
| `webhook_events`        | Every processed provider event; unique `event_id`                                               |

Key decisions:

- **Price belongs to the offering, not the test.** The same test can cost different amounts at
  different centres (the seed data shows CBC at ₹350, ₹399 and ₹420).
- **Money is stored as integers in paise** (`price_paise`, `amount_paise`) to avoid
  floating-point rounding. Zod rejects non-integer or non-positive prices, and hand-written
  `CHECK (> 0)` constraints in the migration SQL enforce the same rule in the database (Prisma's
  schema language cannot express CHECK constraints).
- **Booking amount is a snapshot** of the centre's price at booking time, so later price changes
  do not alter existing bookings.
- **Bookings store `centre_id` + `test_id` with a composite foreign key** to the offering's unique
  `(centre_id, test_id)`. The database itself guarantees that a booking is only ever for a test the
  centre actually offers.
- **Duplicate active bookings are blocked** by a partial unique index on
  `(user_id, centre_id, test_id, appointment_date_time) WHERE status IN ('PENDING','CONFIRMED')`.
  A cancelled or failed slot can be booked again.
- **Cancellation is atomic**: a single conditional `UPDATE … WHERE id AND user_id AND status IN
(PENDING, CONFIRMED) AND appointment in the future`, so it cannot race with a payment update.
- **No payment columns on `bookings`.** The payment row points to the booking.
- **All foreign keys are `ON DELETE RESTRICT`**: a centre, test or offering that bookings refer to
  can never be deleted out from under them.
- **One payment per booking** (unique `payments.booking_id`). Because FAILED bookings are terminal,
  a booking is never paid twice, and the database itself blocks double payment.
- **Payment is one transaction with a row lock.** `POST /payments` locks the booking
  (`SELECT … FOR UPDATE`), checks it is PENDING, creates the payment and updates the booking before
  committing. A concurrent second payment (or a cancel) waits for the lock and then sees the new
  status, so exactly one wins.
- **Webhook idempotency** – `webhook_events.event_id` is unique. The event row is inserted in the
  same transaction as the payment/booking update, so a replayed event either hits the unique
  constraint or finds the payment already in a terminal state, and becomes a no-op.

## Assumptions

- Timestamps are stored as `timestamptz`. `appointmentDateTime` must be ISO 8601 **with a
  timezone** (`Z` or `+05:30`) and in the future; responses are in UTC.
- There is no slot/capacity management: any future time is bookable.
- Admins have no special access to bookings; they see only their own.
- A booking cannot be cancelled after its appointment time. Cancelling a CONFIRMED booking does not
  trigger a refund (refunds are out of scope).
- If a payment succeeds for a booking that is already CANCELLED, the payment is recorded but the
  booking stays CANCELLED, and the event is logged.
- All amounts are in Indian rupees (paise); there is no currency column.
- Payment retries on the same booking are not supported: after a failed payment the booking is
  FAILED and the user books again.

## What I would improve with more time

- An `Idempotency-Key` header on `POST /payments`, so a client retrying after a network timeout gets
  the original payment back instead of a 409.
- A real gateway integration would create a PENDING payment first and call the provider **outside**
  the database transaction (never hold a row lock during a network call), then settle on the webhook.
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
