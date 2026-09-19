# The Cedar Table — Smart Restaurant Queue

A native, full-stack restaurant waitlist, arrival-verification, dining and table-allocation application. Customers join remotely and receive calculated estimates. Hosts check in, call and seat compatible parties. Managers configure service and inspect analytics. A separate display shows anonymous calls and a rotating arrival QR.

## Quick start on Windows

Open PowerShell in this repository root. Install **Java 25**, **Bun 1.4.2 or newer compatible stable**, and **PostgreSQL 18.6**. Set `JAVA_HOME` to your Java 25 installation and add its `bin` directory to `PATH`. Verify:

```powershell
java -version
bun --version
```

Create the private local configuration:

```powershell
Copy-Item .env.example .env
.\scripts\setup-dev.ps1
.\scripts\start-dev.ps1
```

If PostgreSQL is installed outside `PATH`, pass its binary directory:

```powershell
.\scripts\setup-dev.ps1 -PgBin 'C:\Program Files\PostgreSQL\18\bin'
```

Alternatively, the setup helper can download official native PostgreSQL binaries into this repository's ignored `.tools` directory:

```powershell
.\scripts\setup-dev.ps1 -DownloadPostgres
```

Setup creates a dedicated PostgreSQL cluster in `.local/pgdata`, listening **only on localhost:5433**, creates the `cedar` and `cedar_test` databases, generates local SCRAM credentials, installs frontend dependencies with Bun, and builds the backend. It does not modify a preexisting PostgreSQL service. It can be run again safely. Schema creation and changes belong to Flyway and run when the application starts.

Open **http://localhost:5173**. Startup writes readable logs to `.logs/backend.log`, `.logs/backend-error.log`, `.logs/frontend.log` and `.logs/frontend-error.log`; it does not open extra terminal windows.

```powershell
.\scripts\stop-dev.ps1             # stop frontend/backend
.\scripts\stop-dev.ps1 -Database   # also stop the workspace database
```

The workspace-local Bun runtime, if present under `.tools/bun/bun-windows-x64`, takes precedence in helper scripts. A standard Bun installation works too. The Maven Wrapper downloads its pinned Maven release on first use; no global Maven installation is needed.

## Demo accounts

Only the `demo` and `dev` profiles seed demonstration accounts and enable simulation. All demonstration passwords are **`CedarDemo!2026`**.

| Persona | Email | Route |
| --- | --- | --- |
| Customer | `customer@cedar.local` | `/` |
| Host | `host@cedar.local` | `/host` |
| Manager | `manager@cedar.local` | `/manager` |
| Display | `display@cedar.local` | `/display` |

Use different browsers, browser profiles, or private sessions for simultaneous personas; authentication cookies are shared between tabs of one browser profile. New customer accounts can register from the login screen. Display access has its own restricted role and exposes only tokens, table numbers, area names and the active QR.

The seed restaurant is **The Cedar Table**, with multiple dining areas and 2-, 4-, 6- and 8-seat tables. Historical dining visits provide real samples for ETA calculation immediately. Managers have a development-only simulation panel for individual arrivals, bursts/rush hour, table occupation/freeing, dining completion, no-shows, activity and a fresh reseed.

## Routes and day-to-day workflow

| Route | Purpose |
| --- | --- |
| `/` | Customer restaurant status, join form, live token/ETA, snooze, cancel, notifications and feedback |
| `/login` | Customer registration and all-role login |
| `/check-in?challenge=...` | Ownership-checked arrival confirmation from the venue QR |
| `/host` | Live queue, optimizer suggestions, check-in, priority, assignment, seating, dining and tables |
| `/manager` | Restaurant, tables/areas, policy, sessions, staff, analytics, audit and demo simulation |
| `/display` | Fullscreen anonymous calls and rotating arrival QR |

Commands and queries use `/api/v1`. The checked-in [OpenAPI 3.1 contract](contracts/openapi.json) describes the actual routes, DTOs, security and responses; regenerate it with `bun scripts/generate-openapi.mjs`. Live refresh signals use authenticated SSE at `/api/v1/events`; clients fetch their authorized data after each event and reconnect. No customer details are broadcast in SSE payloads.

Customer flow: log in → join with party size and seating preference → keep the token and ETA → wait for an arrival window → scan the venue QR or ask a host for assisted check-in → get called to a compatible table → be seated → dine → complete → optionally leave feedback.

Hosts use **Call next** to select the next compatible party/table pair. They can confirm or change an assignment with an audit reason. Seating opens the dining visit, and completion closes the visit and releases the table. Managers can open/close service and recover an interrupted operating session.

## Allocation, fairness and ETA

The queue is venue-wide. Table assignment is deferred until call time. Capacity and accessibility are hard constraints; dining-area preferences are soft preferences. The independent allocation engine scores compatible pairs using fairness age, verified priority, preferred area and unused capacity. A party cannot be seated at an undersized table. Starvation safeguards and a priority burst limit keep large and ordinary parties progressing. Manual overrides require a recorded reason and still obey physical table constraints.

An original join timestamp is immutable. Snoozing preserves that history, has a bounded count and release deadline, and resets effective fairness age when the party returns to the queue, following the blueprint. Backend transitions enforce the lifecycle:

`WAITING → ARRIVAL_WINDOW → CHECKED_IN → CALLED → SEATED → DINING → COMPLETED`

`SNOOZED`, `CANCELLED`, `EXPIRED` and `NO_SHOW` cover permitted alternate and terminal paths. Table states are `AVAILABLE`, `ASSIGNED`, `OCCUPIED` and `UNAVAILABLE`, with a separate enabled flag.

ETA is a projection, not a reservation or promised seating time. It uses a rolling window of recent completed dining visits by party-size category, configured fallbacks when samples are insufficient, compatible tables, current visits/assignments and simulated dispatch of the queue ahead. The UI exposes estimate freshness, sample/confidence context and arrival assumptions. Queue/table events and scheduled refreshes recalculate projections.

In-app notifications are written through a durable PostgreSQL outbox. Processing and message creation share one transaction, retries resume automatically, and obsolete arrival/call messages are suppressed. Email and SMS delivery remain external adapter work requiring provider credentials and customer consent; the local product does not claim to deliver them.

Arrival windows, call deadlines, snooze releases, visits, queue history and operational state are persisted. Background processing resumes overdue work after restart. The arrival challenge is short-lived and validated against venue/session, expiry, authenticated ownership, lifecycle and arrival window. Successful replays are idempotent. Staff-assisted check-in records who performed it.

## Architecture and persistence

```text
React + TypeScript + Vite (Bun)
          │ REST commands/queries + SSE refresh
Spring MVC / Security / validation / DTOs
          │ transactional domain services
State machine · Allocation engine · ETA engine · Scheduled operations
          │ JPA / Hibernate / Flyway
Native PostgreSQL: accounts, sessions, queue, tables, visits,
notifications, challenge, idempotency, assignment history and audit
```

The backend separates web DTOs/controllers from allocation and ETA logic. PostgreSQL is authoritative. Venue/session locks serialize conflicting queue operations; entity versions reject stale changes; database constraints prevent duplicate active entries and conflicting table occupancy. Mutation requests carry idempotency keys. PostgreSQL-backed sessions, secure password hashing, role checks and CSRF protection enforce server-side security.

| Directory | Contents |
| --- | --- |
| `backend/` | Java application, Maven Wrapper, Flyway migrations and JUnit tests |
| `frontend/` | Responsive customer, host, manager and display UI; Bun lockfile and tests |
| `scripts/` | Native Windows setup, start/stop, build, tests, reset and backup helpers |
| `tests/` | HTTP workflow/concurrency verification against the real backend |
| `contracts/` | OpenAPI 3.1 endpoint, input/output and security contract |
| `docs/` | Shared API agreement, version evidence and implementation notes |
| `.tools/`, `.local/`, `.logs/` | Ignored local runtimes, PostgreSQL data and execution logs |

## Exact stack and compatibility

Versions were checked against official release information and package registries on **2026-09-19**. Stable releases are pinned; preview releases are excluded. Spring Boot's BOM manages the Spring ecosystem, Hibernate, Flyway and test platform together, avoiding incompatible independent upgrades.

| Component | Selected version |
| --- | --- |
| Java | 25; verified with Eclipse Adoptium 25.0.3 |
| Spring Boot | 4.1.1 |
| Spring Framework | 7.0.9 |
| Spring Security | 7.1.1 |
| Spring Data BOM | 2026.0.1 |
| Hibernate ORM | 7.4.5.Final |
| Flyway | 12.4.0 |
| PostgreSQL | 18.6 native server |
| PostgreSQL JDBC | 42.7.13 |
| JUnit Jupiter | 6.0.3 |
| Maven / Maven Wrapper | 3.9.16 / 3.3.4 |
| React / React DOM | 19.3.0 |
| TypeScript | 7.0.2 |
| Vite / React plugin | 8.3.0 / 6.1.1 |
| Bun | 1.4.2 |
| Playwright | 1.63.0 |

See [version evidence](docs/versions.md) and the checked-in `backend/pom.xml`, `frontend/package.json` and `frontend/bun.lock` for dependency detail.

## Prerequisites and environment

Java: install a Java 25 JDK from [Eclipse Adoptium](https://adoptium.net/temurin/releases/?version=25), then set `JAVA_HOME` and `PATH`. A JRE alone cannot compile the backend. Bun: follow the [official Windows installation guide](https://bun.sh/docs/installation). PostgreSQL: use the [official Windows download page](https://www.postgresql.org/download/windows/) or the setup helper's EDB binary download. Internet access is needed for the initial Maven/Bun dependency downloads.

`.env.example` contains no real secrets. The setup helper replaces `change-me` with a generated local credential in ignored `.env`. Keep `.env`, `.local/admin-password`, backups and PostgreSQL data private.

| Variable | Purpose / local default |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `demo` for the supplied demonstration |
| `DATABASE_URL` | `jdbc:postgresql://localhost:5433/cedar` |
| `DATABASE_USERNAME`, `DATABASE_PASSWORD` | Non-superuser application database credentials |
| `TEST_DATABASE_URL` | `jdbc:postgresql://localhost:5433/cedar_test` |
| `TEST_DATABASE_USERNAME`, `TEST_DATABASE_PASSWORD` | Dedicated test database credentials |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | Native PostgreSQL helper connection settings |
| `PG_BIN` | Optional PostgreSQL `bin` path |
| `SERVER_ADDRESS`, `SERVER_PORT` | Backend `127.0.0.1:8080` |
| `SESSION_COOKIE_SECURE` | `false` for local HTTP demonstration; `true` for HTTPS deployment |
| `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` | First manager provisioning outside demo mode |

To use an existing locally installed PostgreSQL server, set the database host/port and URLs in `.env`, then run `setup-dev.ps1 -UseExistingServer -PgBin '...'`. The script requests the administrator password if `PGADMIN_PASSWORD` is not set, creates missing `cedar`/`cedar_test` databases and an application role, and does not replace existing roles/databases. If a role already exists, configure `.env` with that role's correct password.

Operational privacy retention defaults to 90 days. The scheduled retention job processes up to 200 old terminal reservations per daily run, replaces their customer link with a disabled historical identity, removes free text from associated feedback/history/audit/arrival records and preserves dining statistics. Active accounts remain available for future visits. Retention runs at 03:17 UTC by default; override `APP_RETENTION_DAYS` (minimum 30) and `APP_RETENTION_CRON` for your policy. A system audit records each anonymization batch. The age threshold controls eligibility; a backlog can extend actual retention beyond 90 days, so operators must monitor the batch audit and choose a suitable reviewed schedule for their service volume. Expired idempotency records and unused QR challenges are separately cleaned after 24 hours.

## Operational diagnostics

`/actuator/health` exposes only minimal readiness. `/actuator/metrics` and individual metric endpoints require an authenticated **MANAGER** session. The frontend proxy deliberately forwards only `/api`; inspect diagnostics from a trusted backend connection with the same authenticated session.

Spring's `http.server.requests` and Hikari metrics cover requests and the connection pool. Aggregate `cedar.*` metrics report active parties, overdue deadline lag, oldest projection age, outbox backlog/age, worker success age/failures/duration and venue-lock wait time. Database aggregates refresh every 10 seconds; metric reads use the cached snapshot. Investigate deadline lag above 30 seconds, outbox age above 60 seconds, persistent worker failures or missing worker successes during service. Recovery mode can intentionally suspend deadlines.

ECS JSON logs include request correlation, method, route template, status and duration. They omit request bodies, query strings, headers, QR challenges and customer identities. Error responses include a trace ID for locating the matching request. Restrict log/metric access in deployment and configure an external monitor and backup schedule for the restaurant's operating hours. See [operational metric semantics](docs/observability.md).
## Native development commands

The launch scripts load `.env`. For manual terminals, dot-source the helper first:

```powershell
. .\scripts\common.ps1
Import-CedarEnvironment
cd backend
.\mvnw.cmd spring-boot:run
```

In a second terminal at the repository root:

```powershell
cd frontend
bun install
bun run dev
```

Build both deliverables:

```powershell
.\scripts\build.ps1
```

Or build separately:

```powershell
cd backend
.\mvnw.cmd package
cd ..\frontend
bun run build
```

The backend artifact is `backend/target/cedar-queue-1.0.0.jar`; frontend static assets are in `frontend/dist`. For a non-demo deployment, provide external database/bootstrap credentials, disable `demo`/`dev`, use HTTPS and secure cookies, and serve the frontend and `/api` from one origin via a trusted reverse proxy. Keep PostgreSQL on a private interface. The development Vite server is intended for development/demonstration.

## Tests

Start the local database through setup if it is not already running. The test helpers refuse to run destructive demo workflow tests unless the URL ends in `/cedar_test`.

```powershell
.\scripts\test.ps1       # JUnit + native PostgreSQL integration suite + frontend tests/build
.\scripts\test-api.ps1   # build/start isolated demo backend :8081, HTTP workflow/concurrency tests, stop it
```

A bounded native load smoke can run against the isolated test backend and writes measured timings to `.artifacts/load-smoke.json`:

```powershell
.\scripts\test-api.ps1 -LoadSmoke
```

It exercises 100 queued parties, 100 SSE connections on one authenticated session and concurrent host-board reads. These local smoke measurements do not establish sustained production capacity or 100 independent authenticated sessions.

Fast unit checks without integration:

```powershell
.\scripts\test.ps1 -SkipIntegration
```

Individual frontend commands:

```powershell
cd frontend
bun run test
bun run build
bun run test:e2e
```

The HTTP tests run against a separate real PostgreSQL database and exercise ownership/authorization, joins, state transitions, QR checks, table assignment and lifecycle operations. Unit tests exercise allocation and ETA independently. PostgreSQL tests retain its actual locking, unique-index and transaction semantics. `test-api.ps1` cleans up only the test backend process it started; the development server/database remain separate.

For browser tests, ensure the native app is running first. If Playwright reports a missing browser, install its browser using Bun:

```powershell
cd frontend
bunx playwright install chromium
bun run test:e2e
```

For the full customer → QR → host → dining → completion browser journey, start a fresh demo and run from the repository root:

```powershell
.\scripts\reset-demo.ps1
bun tests/browser-smoke.ts
```

This creates a demo customer and queue activity; screenshots are saved under `.artifacts/browser`.

Test coverage, measured load results and verification limits are recorded in [the verification report](docs/verification.md); failure logs are retained under `.logs` and Maven reports under `backend/target`.

The checked-in [native Windows CI workflow](.github/workflows/native-windows.yml) runs on pull requests and main/master changes using Java 25, pinned Bun, a fresh local PostgreSQL cluster, frozen frontend dependencies, contract regeneration checks, JUnit/integration/API/browser verification and a backup restore drill. It uses read-only repository permission and no external secrets. Action releases are pinned to verified commit SHAs. The workflow is provided as source; its GitHub-hosted execution must be verified after pushing this repository.

## Reset, backup and recovery

Reset demonstration activity through the manager simulation panel or:

```powershell
.\scripts\reset-demo.ps1
```

This is an authenticated, demo-only operation. It resets demonstration operational data and rebuilds the seed scenario. It is unavailable outside `demo`/`dev`; the script does not drop a database. No script deletes a PostgreSQL cluster.

```powershell
.\scripts\backup-db.ps1
```

Backups are timestamped PostgreSQL custom-format dumps in ignored `.backups`. With application writers stopped, run `.\scripts\verify-backup.ps1` to restore into a fresh, uniquely named workspace database, compare core row counts and occupancy invariants, and remove only that temporary database. The original database is not modified. Restore only into a deliberately chosen empty database using PostgreSQL's `pg_restore`; never overwrite an operational database casually. Flyway applies migrations on restart. After an interrupted service, use the manager operating-session recovery action and inspect the audit trail.

## Phone / LAN and QR demonstration

Connect laptop and phone to the same trusted Wi-Fi network. Stop an existing local-only launcher session before restarting in LAN mode:

```powershell
.\scripts\stop-dev.ps1
.\scripts\start-dev.ps1 -Lan
```

The launcher prints candidate laptop IPv4 URLs such as `http://192.168.1.20:5173`. Allow **TCP 5173 on Private networks only** in Windows Defender Firewall. Keep TCP 5433 and 8080 local; the frontend proxies `/api` and SSE to the backend. Do not disable Windows Firewall. Guest Wi-Fi client isolation may block phone-to-laptop traffic; use a network that allows local device communication.

Open the display on the laptop **using the same LAN URL**, then log in as the display account. The QR uses the display's current browser origin, so a display opened at `localhost` produces a localhost link that a phone cannot reach. On the phone, log in as a customer, join the queue and wait until the arrival window opens. Use the phone's native camera to scan the laptop's rotating QR. Login redirects retain the arrival challenge; if the QR expired during login, scan the current QR again.

Browser camera access generally requires HTTPS, except localhost. For an HTTP LAN demonstration, the phone's native camera scanner opens the check-in link, or paste a decoded QR URL into the app. The in-app camera scanner works on a secure origin; staff-assisted check-in is also available. None of these fallbacks exposes the live challenge through the customer API or bypasses server validation.

## Suggested 5–10 minute demonstration

1. Open manager, host and display in separate browser profiles; open the customer on a phone using the laptop LAN URL.
2. Show table sizes/areas and the manager's rolling dining statistics. Trigger a small rush and occupy selected tables.
3. Join as a customer with a party size and preference. Show the token, useful position, ETA source and live refresh.
4. Scan the rotating display QR when the arrival window opens. The host sees the checked-in party without refreshing.
5. Use Call next. Explain the compatible-table choice and unused-capacity trade-off; seat the party and begin dining.
6. Complete a dining visit. Watch the table become available and the queue/ETA update in other browsers.
7. Demonstrate a bounded snooze, a justified staff priority/manual action and an audit record. Use the simulator for a no-show or another rush.
8. Inspect analytics and session/policy configuration, then reset the demo so the next demonstration starts cleanly.

## Troubleshooting

- **Java version mismatch:** `java -version` and `JAVA_HOME` must both point to Java 25. Restart PowerShell after changing environment variables.
- **Execution policy blocks scripts:** use a trusted PowerShell session with `powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1`; do not change a machine-wide policy merely for the demo.
- **Port in use:** stop this app with `stop-dev.ps1`. Do not terminate unrelated processes. Change the configured ports consistently if needed; Vite's backend proxy expects the configured backend target.
- **Database connection refused:** confirm the workspace cluster is running; rerun `setup-dev.ps1 -SkipInstall`. Inspect `.logs/postgresql.log`.
- **Database authentication fails:** ensure `.env` agrees with the application's existing role. The setup helper intentionally does not silently change existing role passwords.
- **Backend startup fails:** inspect both backend logs; Flyway errors often identify a database-version or schema mismatch. Use the dedicated fresh test database for tests.
- **Logged out after switching roles:** use separate browser profiles. Login intentionally replaces the current session persona.
- **Login works but mutations fail:** retain cookies and CSRF tokens; use the frontend rather than manually posting without CSRF. A stale row version requires refreshing the board.
- **SSE reconnects:** temporary reconnects are safe; data refetches after reconnect. A reverse proxy must stream SSE without response buffering.
- **QR rejected:** verify customer ownership, arrival window, current display challenge and phone/laptop clocks. Expired codes must be rescanned; hosts can assist with an audited check-in.
- **Phone cannot connect:** verify the displayed LAN IP, Windows Private firewall rule, matching Wi-Fi and client-isolation settings. A localhost QR is only valid on the laptop.
- **Camera permission unavailable:** use HTTPS, the phone's native QR scanner, pasted decoded URL, or assisted check-in.
- **ETA changes:** projections respond to completions, arrivals, fairness, table status and queue changes. Low sample counts use the configured fallback and remain explicitly estimates.
- **First startup is slow:** initial Maven/Bun downloads require network access. Later runs reuse normal caches; inspect logs before restarting.
