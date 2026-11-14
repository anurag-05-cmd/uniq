# UNIQ+ — Smart Queue Optimizer

UNIQ+ helps restaurants manage the wait from joining a queue to seating a party. Customers can join remotely and track an estimated wait, while hosts see a live queue and recommendations for compatible tables. Managers control service settings and review activity. **The Cedar Table is the example restaurant seeded for the demo; UNIQ+ is the product.**

## What it does

- **Customer:** register or sign in, join with a party size and seating preference, see a queue token and ETA, check in during an arrival window, snooze or cancel, and leave feedback.
- **Host:** monitor the live waitlist, confirm arrivals, call a compatible party, assign a table, seat guests, and complete dining visits.
- **Manager:** configure restaurant areas, tables and queue policies, manage staff, inspect analytics and audit history, and run demo scenarios.
- **Display:** show anonymous calls and a rotating QR code for arrival check-in.

UNIQ+ chooses a table when a party is called. Capacity and accessibility are hard constraints; area preference, fairness age, priority and unused seats influence the recommendation. ETAs use recent dining durations, compatible table availability and the queue ahead. They are projections, not guaranteed seating times.

## Run the demo on Windows

You need a **Java 25 JDK**, **Bun 1.4.2 or newer compatible stable release**, and **PostgreSQL 18**. The setup script can download native PostgreSQL binaries if they are not installed. Run these commands in PowerShell from the repository root:

```powershell
Copy-Item .env.example .env
.\scripts\setup.ps1 -DownloadPostgres
.\scripts\dev.ps1
```

Open **http://localhost:5173**. The backend listens on localhost port 8080, and the workspace PostgreSQL cluster uses localhost port 5433. Setup creates the `cedar` and `cedar_test` databases and generates a local database password in the ignored `.env` file. Flyway applies schema migrations when the backend starts.

If PostgreSQL is already installed, use `.\scripts\setup.ps1 -PgBin 'C:\Program Files\PostgreSQL\18\bin'`. For a separately managed server, see the `-UseExistingServer` option in [setup.ps1](scripts/setup.ps1). Stop the app with `.\scripts\stop-dev.ps1`, adding `-Database` to stop the workspace database too. Logs are written to `.logs/`.

### Demo accounts

The `demo` profile seeds these accounts. Their demonstration password is `CedarDemo!2026`.

| Role | Email | Page |
| --- | --- | --- |
| Customer | `customer@cedar.local` | `/` |
| Host | `host@cedar.local` | `/host` |
| Manager | `manager@cedar.local` | `/manager` |
| Display | `display@cedar.local` | `/display` |

Use separate browser profiles for simultaneous roles because tabs in one profile share authentication cookies.

## Try the queue flow

1. Sign in as a customer and join the queue with a party size and seating preference.
2. Watch the token and ETA update as the queue and tables change.
3. During the arrival window, scan the QR on `/display` or ask a host to check in the party.
4. As a host, use **Call next**, review the recommended compatible table, and seat the party.
5. Complete the dining visit. The table becomes available and queue estimates refresh.
6. As a manager, inspect the policy, analytics and audit views. The demo simulator can create a rush, occupancy changes and no-shows.

The customer lifecycle is `WAITING → ARRIVAL_WINDOW → CHECKED_IN → CALLED → SEATED → DINING → COMPLETED`, with alternate states for snoozes, cancellations, expiry and no-shows. Server-side transitions, idempotency keys and database constraints protect concurrent operations.

## Architecture

```text
React + TypeScript + Vite (Bun)
        │ REST API and authenticated SSE refresh
Java 25 + Spring Boot + Spring Security
        │ allocation, ETA and lifecycle services
PostgreSQL + Flyway
```

| Path | Purpose |
| --- | --- |
| [frontend/](frontend/) | Customer, host, manager and display interfaces |
| [backend/](backend/) | Spring application, Gradle build, migrations and tests |
| [contracts/openapi.json](contracts/openapi.json) | Checked-in OpenAPI 3.1 API contract |
| [scripts/](scripts/) | Native Windows setup, development, build and test helpers |
| [docs/](docs/) | Technical notes and verification detail |

The API is under `/api/v1`. Authenticated server-sent events signal clients to refresh their authorized data. PostgreSQL stores queue entries, sessions, tables, visits, notifications and audit history. Arrival QR challenges are short-lived and checked against the signed-in customer and operating session.

## Build and verify

```powershell
.\scripts\build.ps1
.\scripts\test.ps1
```

`test.ps1` runs Gradle unit and PostgreSQL integration checks, frontend unit tests and a production frontend build. For the faster unit checks, use `.\scripts\test.ps1 -SkipIntegration`. The integration suite requires the dedicated `cedar_test` database.

For browser tests, start the demo first, then run:

```powershell
cd frontend
bunx playwright install chromium
bun run test:e2e
```

The [Windows verification workflow](.github/workflows/native-windows.yml) runs these checks on GitHub. See [verification notes](docs/verification.md) for test scope and limitations.

## Configuration and deployment

Copy [.env.example](.env.example) to `.env` and run setup to generate local credentials. Keep `.env`, `.local/`, `.logs/` and backups private. The `demo` and `dev` profiles enable seeded accounts and simulation. For a deployment, use a separate PostgreSQL server, non-demo profile, HTTPS, secure cookies and an external reverse proxy. The Vite development server is for local use.

For a phone demonstration on the same trusted network, run `.\scripts\dev.ps1 -Lan` and use the laptop IP shown by the launcher. Open the display using that LAN address so its QR contains a reachable URL. Keep database and backend ports local.

## Troubleshooting

- **Java or Bun check fails:** confirm `java -version`, `bun --version`, `JAVA_HOME` and `PATH`; reopen PowerShell after changing them.
- **Database connection fails:** rerun `.\scripts\setup.ps1 -SkipInstall` and inspect `.logs/postgresql.log`.
- **Startup fails:** inspect `.logs/backend-error.log`, `.logs/backend.log` and the frontend logs.
- **Browser tests cannot sign in:** confirm `.\scripts\dev.ps1` reports the app ready and that `http://127.0.0.1:8080/api/v1/restaurant` responds.
- **Phone cannot open the QR link:** open both the app and display through the LAN URL, and check the private-network firewall rule for port 5173.
