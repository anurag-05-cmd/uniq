# Implementation verification — 19 September 2026

The complete supplied HTML blueprint was read before implementation. The application lives directly in this workspace. Restaurant constraints and the user's required Java 25, Bun and native PostgreSQL stack replace the blueprint's older platform and counter model.

## Functional coverage

| Requirement | Implementation and verification |
| --- | --- |
| Accounts and roles | Hashed passwords, database-backed sessions, CSRF, CUSTOMER/HOST/MANAGER/DISPLAY authorization; HTTP role, ownership, CSRF and private-metrics checks |
| Remote waitlist | Server-validated party/preference input, unique active entry, immutable join identity, calculated ETA, persisted deadlines; parallel duplicate-join tests |
| Legal lifecycle | Explicit state machine, terminal-state enforcement, audited transitions, transaction locks and row versions; lifecycle and PostgreSQL races |
| Restaurant allocation | Hard capacity/accessibility constraints; age, verified priority, seating preference and waste scoring; ordinary-party burst bound and oldest-overdue protection; 10,000-dispatch deterministic priority-flood test |
| Dining flow | Call/assignment confirmation or justified change, seat, start dining, complete and release table; real API and browser journeys with concurrent call/seat/completion checks |
| ETA | Recent completed visit windows, party-size and table compatibility, mean/residual fallbacks, queue simulation reusing dispatch policy, persisted projection context; exact 90/270/450-second regression and fallback/window tests |
| Arrival and QR | Rotating short-lived challenge, ownership, expiry/window/state checks, replay idempotency, assisted check-in; native expiry/check-in race and browser workflow |
| Snooze and absence | Persisted bounded predecessor barriers and deadlines, quota, ghost/call expiration; native limit/release/recovery tests |
| Notifications and live views | Transactional durable in-app outbox, stale-message suppression, duplicate protection, SSE revision signals with reconnect/poll fallback; browser updates without reload and 100-stream smoke |
| Host console | Waiting/arrived/called parties, table states, suggestions, priority, assignment, visits and reasoned actions; browser and API verification |
| Manager | Restaurant/area/table/staff/policy/session configuration, actual service-window analytics, utilization and audit; valid/invalid configuration and close/reopen tests |
| Public display | Dedicated restricted display role, readable anonymous calls, live QR, fullscreen control; authorization and customer-information exclusion checks |
| Demo | The Cedar Table, 3 areas, 8 tables of 2/4/6/8 seats, 24 historical visits; all simulator commands verified against persisted state |
| Recovery and privacy | Restart reconciliation, persisted grace, daily audited batch anonymization, account preservation; native recovery/retention tests and successful backup/restore drill |
| Operations | Native Windows setup/start/stop/reset, generated local credentials, reproducible locks/wrapper, Flyway V1/V2, structured request correlation logs and private aggregate metrics |
| Engineering contract | OpenAPI 3.1 contract with 46 paths, 47 operations and resolved schema references; native Windows CI source with pinned action commits |

Restaurant assignment is deferred until a host calls a checked-in party. The optimizer and ETA simulation repeatedly evaluate all compatible tables in the venue-wide queue; this replaces premature persistent counter binding and cross-counter movement. Original join age is retained. Snooze deliberately resets effective fairness age on release, as the blueprint specifies. Priority is approved by authorized staff rather than claimed by customers.

## Executed locally

- Backend compilation and executable packaging passed. **24 unit tests and 11 native PostgreSQL integration tests passed**, with zero failures, errors or skips; individual cases are recorded in Surefire/Failsafe reports.
- Frontend production build passed with the pinned Bun lockfile. **15 unit tests, 54 assertions passed**, including safe retry after a truncated successful response.
- **4 Playwright screen/role/keyboard tests passed** against the real application.
- The complete Chromium journey passed at **390×844** and **1440×1000**: registration, remote join, calculated ETA, QR check-in, live host/customer/display update, call, seat, dining, completion, feedback and manager analytics. No uncaught page errors or mobile horizontal overflow were observed. Screenshots were visually inspected.
- **11 HTTP tests passed, with 170 assertions**, exercising real PostgreSQL transactions, concurrency, security, private metrics, manager settings, sessions and every simulator action. It uses only the dedicated `cedar_test` database.
- Native launcher start/stop/restart and authenticated demo reset passed. Application shutdown released its ports and preserved the separate PostgreSQL process. Both migrations were applied successfully.
- A native custom-format backup restored into an isolated database, matching core row counts and occupancy invariants. The temporary restore database was removed by the drill; the source database was unchanged.

## Local load smoke

`./scripts/test-api.ps1 -LoadSmoke` runs against the dedicated test database. On this Windows machine (Intel Core i5-13500H, 16 logical processors, approximately 16 GB RAM), the measured sample had:

| Measurement | Result |
| --- | --- |
| Active queued parties | 100 |
| Open SSE streams | 100 |
| Concurrent host-board readers | 10 |
| Measured board reads | 200 |
| Read latency, p95 | 73 ms |
| Call mutation latency, p95 | 112 ms (3 calls; small smoke sample) |
| Observed post-commit live signal | 1,971 ms |

The streams share one authenticated manager session. This is a bounded local correctness/responsiveness smoke, not a production sizing or sustained multi-user benchmark. The script records results and target comparisons in `.artifacts/load-smoke.json`; it rejects transport or missing-live-update failures.

## Evidence and limits

Run commands and prerequisites are in [README](../README.md). Generated local evidence is intentionally ignored by Git: `backend/target/surefire-reports`, `backend/target/failsafe-reports`, `frontend/playwright-report`, `.artifacts/browser`, `.artifacts/load-smoke.json` and `.logs`.

The physical phone camera, a real LAN firewall rule, hosted TLS, external provider delivery, long-running availability/RPO targets and a restaurant pilot have not been exercised from this session. The documented phone workflow supports a native QR scanner on HTTP LAN, plus secure-origin browser scanning and assisted check-in. In-app delivery is implemented; SMS/email are external adapters explicitly deferred by the blueprint. The checked-in GitHub workflow has been statically validated but has not run on a GitHub-hosted runner here.

Retention eligibility defaults to 90 days and processes up to 200 terminal records per daily batch. The audit must be monitored for a backlog; this is not a strict 90-day deletion guarantee. Operational account credentials remain available for returning users. External encrypted backup scheduling and off-host storage are deployment responsibilities; the supplied native backup/restore procedure was tested locally.
