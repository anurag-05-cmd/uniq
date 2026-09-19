# Operational visibility

The application writes ECS JSON logs. Completed HTTP requests carry a UUID `traceId`, method, matched route template, status and elapsed milliseconds. The same trace ID is returned in `X-Request-Id` and application problem responses. Request bodies, query strings, cookies, credentials, QR challenges and customer names are excluded. Unmapped requests are logged as `unmapped`, without copying their raw path. SQL bind values and database row-error details are suppressed.

`GET /actuator/health` exposes minimal readiness information publicly. All other Actuator paths require an authenticated **MANAGER** session. `GET /actuator/metrics` lists metrics; `GET /actuator/metrics/{name}` reads one. Metrics access uses the same secure session and role checks as the application. There is no public metrics or debug endpoint.

| Metric | Meaning |
| --- | --- |
| `http.server.requests` | Spring's request counts, latency and outcomes by bounded route template |
| `cedar.queue.active` | Number of nonterminal parties |
| `cedar.queue.deadline.lag` | Maximum overdue arrival, call or snooze deadline, in seconds |
| `cedar.queue.projection.age` | Oldest active ETA projection age, in seconds |
| `cedar.outbox.pending` | Durable events awaiting notification processing |
| `cedar.outbox.oldest.age` | Age of the oldest pending durable event, in seconds |
| `cedar.worker.last.success.age` | Seconds since a successful queue worker run; unavailable before its first run |
| `cedar.worker.duration` | Queue worker execution timer, tagged `outcome=success` or `failure` |
| `cedar.worker.failures` | Queue worker failure counter |
| `cedar.venue.lock.wait` | Timer covering venue lock acquisition and authoritative refresh, tagged by outcome; includes query overhead |
| `cedar.metrics.refresh.failures` | Failed diagnostic snapshot refresh counter |

Aggregate queue diagnostics refresh every 10 seconds with one read-only SQL statement. Reading a metric serves an in-memory snapshot and does not execute SQL. Custom metrics have no account, reservation, table or challenge tags. Framework JVM and connection-pool diagnostics are also available to managers.

Useful investigation thresholds are deadline lag above 30 seconds, projection age above 30 seconds, oldest outbox age above 60 seconds, or repeated worker failures. These are suggested operator thresholds; the application does not claim an external alerting service is configured. Recovery mode intentionally suspends expiry, so an overdue-deadline gauge can rise until a manager reconciles the restaurant. Review that state before treating the gauge as a scheduler failure.

Native integration tests verify that anonymous users receive 401, customer/host/display users receive 403 and managers receive 200 on metrics. They also compare diagnostics with real persisted overdue deadlines and pending events. A separate logging test verifies that private payloads and customer identifiers do not enter the structured request record.
