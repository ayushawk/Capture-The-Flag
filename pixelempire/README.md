# PixelEmpire

A persistent public map of one million logical pixels, divided into 10,000 plots.
Users claim a 10×10 plot for $1, name their empire, and hold that square publicly —
on the map, on a shareable empire page, and on the leaderboard.

Built to the PixelEmpire Master Build Prompt (V1). Section references below (§12,
§16, …) point at that document.

> PixelEmpire is a novelty map, not a financial product. Plots are not investments
> or securities, no return is offered or implied, and there is no crypto, NFT,
> marketplace, resale, or gambling mechanic anywhere in the system.

---

## Quick start

```bash
cd pixelempire
npm install
cp .env.example .env          # then fill in AUTH_SECRET and your Razorpay keys
npm run db:migrate            # prisma migrate deploy
npm run db:seed               # 10,000 plots, founding pricing rule, settings
npm run dev
```

Requires PostgreSQL 14+ and Node 20+.

In development, `EMAIL_PROVIDER=console` prints the magic-link sign-in URL to the
server log and also returns it from `POST /api/auth/request` as `devLink`, so you
can sign in without configuring email. It is never returned under any other
provider.

### The lock sweeper

Reservations expire after ten minutes and need a sweeper to release them (§18).
Run whichever fits the host:

```bash
npm run worker:locks            # one pass, then exit — for cron or a Kubernetes Job
npm run worker:locks -- --loop  # long-lived process, sweeps every 60s
```

or schedule `POST /api/cron/expire-locks` with `Authorization: Bearer $CRON_SECRET`.
`vercel.json` already declares that as a once-a-minute cron.

The sweeper is a safety net, not the mechanism: the claim path releases a lapsed
reservation inline, so a plot is claimable the moment it should be even if the
sweeper is down.

### Tests

```bash
createdb pixelempire_test
npm test
```

`tests/global-setup.ts` migrates and seeds the test database, so the suite runs
against the same schema, constraints and triggers as production.

---

## How ownership works

This is the part worth reading carefully. Everything else is a map.

### One writer

`finalizePurchase(purchaseId, paymentId)` is the **only** operation in the system
that creates ownership (§16). The browser callback and the Razorpay webhook both
end there; neither has its own copy of the logic. It runs in one transaction
holding the purchase, payment and plot rows `FOR UPDATE`, in that order.

```
POST /api/payments/verify ─┐
                           ├─► finalizePurchase() ─► ownership
POST /api/webhooks/razorpay┘
```

Two rules are absolute:

- Ownership is never granted because a payment says `paid`. It requires the
  finalization transaction to succeed.
- An existing owner is never overwritten. A paid transaction that cannot become
  ownership becomes a row in `payment_exceptions` for refund, not a lost plot.

### The claim path (§12)

`POST /api/purchases` accepts **only** `{ "plotId": "…" }`. The user, price,
currency, pricing rule and lock duration are all decided server-side; a client
that sends `amountMinor` or `userId` is simply ignored. The transaction:

1. `SELECT plot FOR UPDATE`
2. verify status is `available`, and there is no live lock
3. resolve the active pricing rule for the plot's tier
4. create the purchase (`pending`, amount copied from the rule, expires in 10 min)
5. create the plot lock
6. set the plot to `locked`

Only after that commits is the Razorpay order created — an external HTTP call
cannot be part of a database transaction. If order creation fails, a compensating
transaction cancels the purchase, releases the lock and returns the plot to
`available` (§13), so a plot is never stranded.

### Payments after the window closes (§17)

A payment that lands after the reservation lapsed is **not** rejected on that
basis. Finalization inspects the plot's actual current state:

| Plot state when the late payment arrives | Outcome |
| --- | --- |
| still unowned (`available` or `locked`) | ownership is granted |
| owned by someone else | never overwritten → refund exception |
| disabled or unreleased | not sellable → refund exception |

Current ownership is the final safety invariant.

### Idempotency

Duplicate webhooks, a callback racing a webhook, and simultaneous retries all
converge, at three layers:

1. `webhook_events` is unique on `(provider, provider_event_id)` — a redelivery of
   a finished event returns early.
2. `payments` is unique on `(provider, provider_payment_id)` — one attempt can
   never fork into two rows.
3. `finalizePurchase()` holds the purchase row and returns the existing result
   when the purchase is already `completed`.

---

## Invariants, enforced by the database

Application code can have bugs; these cannot be violated even so. All are created
in the initial migration and exercised by the test suite.

| Invariant | Mechanism |
| --- | --- |
| `owned` ⇒ owner user, owner empire and `owned_at` all set; otherwise all NULL | `plots_ownership_invariant` CHECK |
| A plot has at most one **active** lock | partial unique index on `plot_locks(plot_id) WHERE released_at IS NULL` |
| A plot has at most one **open** ownership-history row | partial unique index on `ownership_history(plot_id) WHERE ended_at IS NULL` |
| A plot has at most one live reservation | partial unique index on `purchases(plot_id) WHERE status = 'pending'` |
| Ownership history is append-only | `ownership_history_append_only_trg` — blocks DELETE and any UPDATE except a write-once `ended_at` |
| One provider payment maps to one payment row | partial unique index on `payments(provider, provider_payment_id)` |
| One primary empire per user | `empires.owner_user_id` UNIQUE |
| Purchase completion and `completed_at` agree | `purchases_completed_check` CHECK |
| Statuses stay in their vocabulary | CHECK constraints on `plots`, `purchases`, `payments`, `ownership_history` |

### Lock ordering

Three code paths touch the same rows, so they agree on an order:

- `finalizePurchase` — purchase → payment → plot → plot_locks
- `expireDueLocks` — purchase → plot → plot_locks
- `createPurchase` — must start from the plot, so when it needs a purchase row it
  takes it with `FOR UPDATE SKIP LOCKED` and backs off if another transaction
  holds it, rather than completing a deadlock cycle.

`tests/concurrency.test.ts` asserts that none of these combinations deadlocks.

---

## Map rendering

`src/components/MapCanvas.tsx` is a single `<canvas>` with one interaction layer —
no DOM node per plot, and no WebGL (§25, §27).

- Viewport, hover cell, pointer bookkeeping and the plot cache live in refs. React
  does not re-render while you pan.
- One `requestAnimationFrame` loop draws only when a dirty flag is set.
- All 10,000 plot statuses are cached in a `Uint8Array`, with a parallel
  `Int16Array` of empire indices, so hover and hit-testing never touch the network.
- `GET /api/map` is viewport-aware and takes a plot buffer, so panning has data
  ready before it is needed. Unreleased plots are omitted from the response — they
  are 90% of the world, and the client treats any cell missing from the returned
  bounds as unreleased.
- Cells are bucketed by colour before drawing, so `fillStyle` is set a handful of
  times per frame rather than once per plot.
- Detail tiers by zoom: territory fills at low zoom, plot boundaries at medium,
  labels only near the selection at high.
- Mobile: drag, pinch zoom, tap, and a bottom sheet for plot details. The canvas
  sets `touch-action: none` and owns its gestures.

---

## API

**Public** — `GET /api/map?minX=&minY=&maxX=&maxY=`, `/api/plots/:id`,
`/api/plots?x=&y=`, `/api/empires/:slug`, `/api/leaderboard?limit=`,
`/api/activity?limit=`, `/api/stats`

**Authenticated** — `POST /api/purchases`, `GET /api/purchases/:id`,
`POST /api/payments/verify`, `GET /api/me`, `PATCH /api/me/empire`,
`POST /api/auth/request`, `GET /api/auth/callback`, `POST /api/auth/logout`

**Server-to-server** — `POST /api/webhooks/razorpay` (signature-authenticated, no
session), `POST /api/cron/expire-locks` (bearer secret)

**Admin** — `/api/admin/stats`, `/users`, `/plots`, `/plots/:id` (disable/enable),
`/purchases`, `/payments`, `/exceptions`, `/exceptions/:id`, `/pricing-rules`,
`/pricing-rules/:id`. Every one calls `requireAdmin()` server-side; the hidden UI
is not the control.

---

## Security

- Server-side authentication (magic link, single-use, 15-minute tokens) and
  authorization on every mutating route.
- Sessions are random 256-bit tokens stored only as SHA-256 in the database, in
  HttpOnly SameSite=Lax cookies.
- CSRF: `Origin` is checked against `Host` on cookie-authenticated mutations. The
  webhook is exempt and is authenticated by its signature over the raw body.
- Razorpay checkout and webhook signatures are verified with constant-time
  comparison; the browser callback additionally re-fetches the payment from the
  provider before anything is finalized.
- Rate limiting on the purchase, verify, login and empire-update endpoints.
- URL fields accept `http(s)` only, so `javascript:` and `data:` cannot reach an
  `href`. Text fields are stored as plain text and escaped by React.
- Slugs are generated safely and reserved names are blocked.
- Logs carry only safe correlation ids (`purchaseId`, `paymentId`, `plotId`,
  `providerOrderId`); a redaction pass strips anything resembling a credential or
  signature. No card data, CVV or bank details are ever stored or logged.

---

## Deliberate deviations from the spec

Each of these is a judgement call, not an oversight.

1. **`plot_locks.plot_id` is a partial unique index, not a plain `UNIQUE`.** §11
   says both `plot_id UNIQUE` and "only one active lock per plot". Taken
   literally, a plain `UNIQUE` would mean a plot could never be locked a second
   time — which breaks the expire-and-reclaim cycle §18 and §38 require. The
   partial unique index on `WHERE released_at IS NULL` enforces the stated
   invariant while keeping released locks as an audit trail.

2. **Four tables were added.** `payment_exceptions` (§16 and §24 require routing
   paid-but-unusable transactions somewhere and inspecting payment failures),
   `webhook_events` (§15 requires persisting provider events idempotently), and
   `login_tokens` / `sessions` for the magic-link auth §5 asks for.

3. **`users.is_admin` was added.** §24 requires server-side admin authorization
   and the users table has no way to express it otherwise.

4. **A user's empire is created at first sign-in.** §16 assigns "the user's
   primary empire" during finalization, so one must always exist by then. The
   empire is named from the email local part and customised later, which also
   matches the §29 flow (claim, then customise).

5. **Five concurrent unpaid reservations per account.** Founding inventory is only
   1,000 plots, so an unbounded reservation loop could take the map off sale. This
   implements §36's rate limiting at the inventory level and does not restrict
   buying plots one after another.

6. **Empire pages live at `/e/[slug]`.** Keeps user-chosen slugs from ever
   colliding with an application route.

7. **`GET /api/plots?x=&y=`** was added because map selection yields grid
   coordinates, and §22 only specifies lookup by id.

8. **Rate limiting is in-process.** V1 ships as a single deployable service (§40),
   so this is sufficient and free. Scaling horizontally would require moving it
   behind a shared store; this is called out in `src/lib/rate-limit.ts`.

9. **Currency comes from the pricing rule (`USD`, per §19).** Razorpay accounts
   often need to be enabled for international payments before non-INR currencies
   will settle; the rule is a database row, so switching currency is a data change,
   not a code change.

---

## Not built (§39)

Battles, attacks, conquest, defence, power scores, empire levels, premium land,
auctions, marketplace, resale, rental, NFTs, cryptocurrency, betting, gambling,
cash prizes, user-to-user transfers, recommendation systems, AI-generated content,
moderation systems, WebGL, microservices, Kubernetes.

The extension points named in §48 — `plots`, `empires`, `purchases`, `payments`,
`plot_locks`, `ownership_history`, `pricing_rules`, `activity_events` — are all in
place, and `ownership_history.acquisition_type` already accepts `conquest`, so a
future mechanic can add ownership transfers without touching the payment system.
V2 mechanics are gated behind feature flags (`BATTLES_ENABLED`, `EXPANSION_ENABLED`,
`POWER_SCORE_ENABLED`, `EMPIRE_LEVELS_ENABLED`, `PREMIUM_LAND_ENABLED`,
`SPONSORED_LAND_ENABLED`), all `false`, and nothing gated by them renders.

---

## Layout

```
prisma/
  schema.prisma          models + relations
  migrations/            schema, CHECK constraints, partial unique indexes, append-only trigger
  seed.ts                idempotent: 10,000 plots, pricing rule, settings
src/
  lib/                   constants, coords (pure), validation, crypto, http, rate-limit, palette
  server/
    auth/                magic link, sessions, guards
    payments/            gateway interface + Razorpay client
    services/            purchases, finalize, verify-payment, webhook, expire-locks,
                         row-locks, pricing, empires, admin, read
  app/                   routes: pages + API
  components/            MapCanvas, ClaimPanel, MapExperience, editors, share
scripts/expire-locks.ts  the §18 worker
tests/                   87 tests, including the §38 race conditions
```
