import { useState } from "react";
import { request } from "./api";
import {
  ActionMessages,
  Badge,
  Empty,
  ErrorMessage,
  Field,
  Form,
  Loading,
  Metric,
  Modal,
  Submit,
} from "./components";
import { localTime, number } from "./domain";
import { useAction, useApp, useResource } from "./state";
import type { Analytics, Audit, Policy, Table, User } from "./types";

const policyLabels: Record<keyof Policy, [string, string]> = {
  arrivalLeadMinutes: [
    "Arrival lead · minutes",
    "Open arrival when the forecast reaches this threshold.",
  ],
  arrivalGraceMinutes: [
    "Arrival grace · minutes",
    "Extra time to reach the venue after the arrival invitation.",
  ],
  callGraceMinutes: [
    "Table call grace · minutes",
    "How long an assigned table waits for its party.",
  ],
  maxSnoozes: ["Maximum snoozes", "Per reservation."],
  snoozeMinutes: [
    "Snooze duration · minutes",
    "Maximum time until the reservation re-enters the queue.",
  ],
  snoozeSpots: [
    "Snooze predecessor limit",
    "Maximum parties allowed to advance during a snooze.",
  ],
  priorityBurstLimit: [
    "Priority burst limit",
    "Maximum consecutive priority parties while ordinary guests wait.",
  ],
  agingMinutes: [
    "Aging interval · minutes",
    "Waiting-time fairness increment.",
  ],
  starvationMinutes: [
    "Starvation threshold · minutes",
    "Long-waiting compatible parties receive a protected turn.",
  ],
  sampleSize: [
    "Recent dining samples",
    "Maximum historical completions used per cohort.",
  ],
  sampleHorizonMinutes: [
    "Sample window · minutes",
    "Only dining completions inside this window are included.",
  ],
  minimumSamples: [
    "Minimum sample count",
    "Below this count, use the configured fallback.",
  ],
  defaultDiningMinutes: [
    "Fallback dining time · minutes",
    "Used when matching history is insufficient.",
  ],
  maxActiveParties: [
    "Active party limit",
    "Maximum reservations in an operating session.",
  ],
  capacityWastePenalty: [
    "Empty-seat penalty",
    "Discourages assigning small parties to unnecessarily large tables.",
  ],
};
const policyBounds: Record<keyof Policy, [number, number]> = {
  arrivalLeadMinutes: [1, 120],
  arrivalGraceMinutes: [1, 30],
  callGraceMinutes: [1, 10],
  maxSnoozes: [0, 2],
  snoozeMinutes: [1, 10],
  snoozeSpots: [1, 10],
  priorityBurstLimit: [1, 2],
  agingMinutes: [1, 30],
  starvationMinutes: [5, 120],
  sampleSize: [5, 100],
  sampleHorizonMinutes: [15, 1440],
  minimumSamples: [1, 100],
  defaultDiningMinutes: [5, 180],
  maxActiveParties: [1, 500],
  capacityWastePenalty: [0, 30],
};
function Reports() {
  const report = useResource<Analytics>("/admin/analytics");
  if (report.loading) return <Loading />;
  const data = report.data;
  return (
    <>
      <ErrorMessage>{report.error}</ErrorMessage>
      {data && (
        <>
          <div className="metrics-row reports-metrics">
            <Metric
              label="Average wait"
              value={number(data.averageWaitMinutes, " min")}
            />
            <Metric
              label="Average dining"
              value={number(data.averageDiningMinutes, " min")}
            />
            <Metric label="Completed parties" value={data.completedParties} />
            <Metric
              label="Table utilization"
              value={number(data.utilizationPercent, "%")}
            />
            <Metric
              label="Throughput"
              value={number(data.throughputPerHour, " / hr")}
            />
            <Metric
              label="Cancellations / no-shows"
              value={`${data.cancellations} / ${data.noShows}`}
            />
          </div>
          <div className="manager-grid">
            <section className="panel">
              <p className="eyebrow">THE RHYTHM OF SERVICE</p>
              <h2>Queue activity</h2>
              <p className="small muted">
                Joined and completed parties by hour. Bars use the same scale.
              </p>
              {data.queueTrends.length ? (
                <div className="trend-chart">
                  {data.queueTrends.map((point, index) => {
                    const max = Math.max(
                      1,
                      ...data.queueTrends.flatMap((p) => [
                        p.joined,
                        p.completed,
                      ]),
                    );
                    return (
                      <div className="trend-column" key={index}>
                        <div className="trend-bars">
                          <span
                            className="trend-joined"
                            style={{ height: `${(point.joined / max) * 100}%` }}
                            title={`${point.joined} joined`}
                          />
                          <span
                            className="trend-completed"
                            style={{
                              height: `${(point.completed / max) * 100}%`,
                            }}
                            title={`${point.completed} completed`}
                          />
                        </div>
                        <strong>
                          {point.joined} / {point.completed}
                        </strong>
                        <small>
                          {point.hour.includes("T")
                            ? localTime(point.hour)
                            : point.hour}
                        </small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty title="Service is just beginning" />
              )}
              <p className="chart-legend">
                <span>● Joined</span>
                <span>● Completed</span>
              </p>
            </section>
            <section className="panel">
              <p className="eyebrow">CAPACITY IN USE</p>
              <h2>By table</h2>
              {data.tableUtilization.map((table) => (
                <div className="utilization-row" key={table.tableNumber}>
                  <span>Table {table.tableNumber}</span>
                  <meter
                    min="0"
                    max="100"
                    value={table.utilizationPercent || 0}
                    aria-label={`Table ${table.tableNumber} utilization`}
                  />
                  <strong>{number(table.utilizationPercent, "%")}</strong>
                </div>
              ))}
            </section>
          </div>
          <p className="small muted">
            As of {localTime(data.asOf)} · {data.sampleCount} completed visit
            samples. Wait includes snooze time. Utilization measures occupied
            time against enabled, available service intervals; no denominator is
            shown as —.
          </p>
        </>
      )}
    </>
  );
}
function AuditLog() {
  const audit = useResource<Audit[]>("/admin/audit");
  const [search, setSearch] = useState("");
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Operational history</h2>
        <input
          type="search"
          aria-label="Search audit history"
          placeholder="Search actions, actors, reasons…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ErrorMessage>{audit.error}</ErrorMessage>
      {audit.loading ? (
        <Loading />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Reason / details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data
                ?.filter((row) =>
                  `${row.action} ${row.actor} ${row.reason}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.occurredAt).toLocaleString()}</td>
                    <td>
                      <strong>{row.action.replaceAll("_", " ")}</strong>
                      {row.entryId && (
                        <small className="mono">{row.entryId}</small>
                      )}
                    </td>
                    <td>{row.actor}</td>
                    <td>
                      {row.reason || "—"}
                      {row.details != null && (
                        <details>
                          <summary>Event details</summary>
                          <pre>
                            {typeof row.details === "string"
                              ? row.details
                              : JSON.stringify(row.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Configuration() {
  const { restaurant } = useApp();
  const action = useAction();
  const [table, setTable] = useState<Table | "new" | null>(null);
  if (!restaurant) return <Loading />;
  return (
    <>
      <ActionMessages action={action} />
      <div className="manager-grid">
        <section className="panel">
          <p className="eyebrow">RESTAURANT DETAILS</p>
          <h2>A place of your own</h2>
          <Form
            onSubmit={(data) =>
              action.run(
                () =>
                  request("/admin/restaurant", "PUT", {
                    name: data.get("name"),
                    location: data.get("location"),
                    timezone: data.get("timezone"),
                    description: data.get("description"),
                    reason: data.get("reason"),
                  }),
                "Restaurant details saved.",
              )
            }
          >
            <Field label="Restaurant name">
              <input
                name="name"
                defaultValue={restaurant.name}
                maxLength={120}
                required
              />
            </Field>
            <Field label="Location">
              <input
                name="location"
                defaultValue={restaurant.location}
                maxLength={200}
                required
              />
            </Field>
            <Field
              label="Time zone"
              hint="IANA name, for example Asia/Kolkata."
            >
              <input
                name="timezone"
                defaultValue={restaurant.timezone}
                required
              />
            </Field>
            <Field label="Guest welcome message">
              <textarea
                name="description"
                rows={3}
                defaultValue={restaurant.description}
                maxLength={1000}
              />
            </Field>
            <Field label="Reason for change">
              <input name="reason" required maxLength={500} />
            </Field>
            <Submit pending={action.pending} disabled={action.disabled}>
              Save restaurant
            </Submit>
          </Form>
        </section>
        <section className="panel">
          <p className="eyebrow">SERVICE CONTROL</p>
          <h2>Operating session</h2>
          <div className="row between">
            <Badge status={restaurant.sessionStatus || "CLOSED"} />
            <span>
              {restaurant.open ? "Accepting reservations" : "Joins paused"}
            </span>
          </div>
          <p>
            Open a new service, close the queue, or reconcile an interruption.
            Closing cancels unseated parties; finish active dining first.
          </p>
          <Form
            onSubmit={(data) =>
              action.run(
                () =>
                  request(`/admin/session/${data.get("action")}`, "POST", {
                    reason: data.get("reason"),
                    graceSeconds: Number(data.get("graceSeconds") || 300),
                    ...(data.get("opensAt")
                      ? {
                          opensAt: new Date(
                            String(data.get("opensAt")),
                          ).toISOString(),
                        }
                      : {}),
                    ...(data.get("closesAt")
                      ? {
                          closesAt: new Date(
                            String(data.get("closesAt")),
                          ).toISOString(),
                        }
                      : {}),
                  }),
                "Operating session updated.",
              )
            }
          >
            <Field label="Session action">
              <select
                name="action"
                defaultValue={
                  restaurant.recoveryRequired
                    ? "recover"
                    : restaurant.open
                      ? "close"
                      : "open"
                }
              >
                <option value="open">Open service</option>
                <option value="close">Close service</option>
                <option value="recover">Reconcile and recover service</option>
              </select>
            </Field>
            <div className="form-columns">
              <Field label="Opens at (optional)">
                <input type="datetime-local" name="opensAt" />
              </Field>
              <Field label="Closes at (optional)">
                <input type="datetime-local" name="closesAt" />
              </Field>
            </div>
            <Field label="Recovery grace · seconds">
              <input
                type="number"
                name="graceSeconds"
                defaultValue={300}
                min={60}
                max={1800}
              />
            </Field>
            <Field label="Session reason">
              <textarea name="reason" rows={2} maxLength={500} required />
            </Field>
            <Submit pending={action.pending} disabled={action.disabled}>
              Apply session action
            </Submit>
          </Form>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">THE SEATING PLAN</p>
            <h2>Dining areas & tables</h2>
          </div>
          <button className="button primary" onClick={() => setTable("new")}>
            Add table
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Area</th>
                <th>Capacity</th>
                <th>Access</th>
                <th>State</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {restaurant.tables.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.number}</strong>
                  </td>
                  <td>{t.areaName}</td>
                  <td>{t.capacity} guests</td>
                  <td>{t.accessible ? "Accessible" : "Standard"}</td>
                  <td>
                    <Badge status={t.enabled ? t.status : "DISABLED"} />
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setTable(t)}
                      aria-label={`Edit table ${t.number}`}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Form
          className="inline-form"
          onSubmit={(data) =>
            action.run(
              () => request("/admin/areas", "POST", { name: data.get("name") }),
              "Dining area added.",
            )
          }
        >
          <Field label="New dining area">
            <input
              name="name"
              placeholder="e.g. Garden terrace"
              required
              maxLength={100}
            />
          </Field>
          <Submit pending={action.pending} disabled={action.disabled}>
            Add area
          </Submit>
        </Form>
      </section>
      {table && (
        <Modal
          title={table === "new" ? "Add a table" : `Edit table ${table.number}`}
          onClose={() => setTable(null)}
        >
          <Form
            onSubmit={(data) =>
              action.run(async () => {
                await request(
                  table === "new"
                    ? "/admin/tables"
                    : `/admin/tables/${table.id}`,
                  table === "new" ? "POST" : "PUT",
                  {
                    number: data.get("number"),
                    areaId: data.get("areaId"),
                    capacity: Number(data.get("capacity")),
                    accessible: data.get("accessible") === "on",
                    enabled: data.get("enabled") === "on",
                    ...(table === "new"
                      ? {}
                      : {
                          expectedVersion:
                            restaurant.tables.find((t) => t.id === table.id)
                              ?.version ?? table.version,
                          reason: data.get("reason"),
                        }),
                  },
                );
                setTable(null);
              }, "Table saved.")
            }
          >
            <Field label="Table number">
              <input
                name="number"
                required
                maxLength={20}
                defaultValue={table === "new" ? "" : table.number}
              />
            </Field>
            <Field label="Dining area">
              <select
                name="areaId"
                required
                defaultValue={
                  table === "new" ? restaurant.areas[0]?.id : table.areaId
                }
              >
                {restaurant.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seats">
              <input
                type="number"
                name="capacity"
                required
                min={1}
                max={20}
                defaultValue={table === "new" ? 2 : table.capacity}
              />
            </Field>
            <label className="check-field">
              <input
                type="checkbox"
                name="accessible"
                defaultChecked={table !== "new" && table.accessible}
              />{" "}
              Accessible table
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={table === "new" || table.enabled}
              />{" "}
              Enabled for service
            </label>
            {table !== "new" && (
              <Field label="Reason for table change">
                <textarea name="reason" required maxLength={500} />
              </Field>
            )}
            <ActionMessages action={action} />
            <Submit pending={action.pending} disabled={action.disabled}>
              Save table
            </Submit>
          </Form>
        </Modal>
      )}
    </>
  );
}
function Policies() {
  const { restaurant } = useApp();
  const action = useAction();
  if (!restaurant) return <Loading />;
  return (
    <section className="panel">
      <p className="eyebrow">FAIR WAITING, SENSIBLE TABLES</p>
      <h2>Queue & estimate policies</h2>
      <p>
        These values govern arrival windows, priority fairness, snoozing, table
        efficiency and historical estimates. Server validation protects
        incompatible combinations.
      </p>
      <Form
        onSubmit={(data) =>
          action.run(
            () =>
              request("/admin/policy", "PUT", {
                ...Object.fromEntries(
                  Object.keys(policyLabels).map((key) => [
                    key,
                    Number(data.get(key)),
                  ]),
                ),
                reason: data.get("reason"),
              }),
            "Queue policy saved.",
          )
        }
      >
        <div className="policy-grid">
          {(
            Object.entries(policyLabels) as [keyof Policy, [string, string]][]
          ).map(([key, [label, hint]]) => (
            <Field label={label} hint={hint} key={key}>
              <input
                type="number"
                name={key}
                defaultValue={restaurant.policy[key]}
                min={policyBounds[key][0]}
                max={policyBounds[key][1]}
                required
                step="1"
              />
            </Field>
          ))}
        </div>
        <Field label="Reason for policy change">
          <textarea name="reason" required maxLength={500} rows={2} />
        </Field>
        <ActionMessages action={action} />
        <Submit pending={action.pending} disabled={action.disabled}>
          Save queue policy
        </Submit>
      </Form>
    </section>
  );
}
function Team() {
  const staff = useResource<User[]>("/admin/staff");
  const action = useAction();
  return (
    <div className="manager-grid">
      <section className="panel">
        <h2>The service team</h2>
        <ErrorMessage>{staff.error}</ErrorMessage>
        {staff.data?.map((user) => (
          <div className="team-member" key={user.id}>
            <div>
              <strong>{user.displayName}</strong>
              <span>{user.email}</span>
            </div>
            <Badge status={user.role} />
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Provision an account</h2>
        <p>
          Display accounts can access only the calling board, QR and live
          updates.
        </p>
        <Form
          onSubmit={(data) =>
            action.run(
              () =>
                request("/admin/staff", "POST", {
                  email: data.get("email"),
                  password: data.get("password"),
                  displayName: data.get("displayName"),
                  role: data.get("role"),
                }),
              "Staff account created.",
            )
          }
        >
          <Field label="Name">
            <input name="displayName" required maxLength={100} />
          </Field>
          <Field label="Staff email">
            <input name="email" type="email" required maxLength={254} />
          </Field>
          <Field label="Initial password">
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={72}
              required
              autoComplete="new-password"
            />
          </Field>
          <Field label="Role">
            <select name="role">
              <option value="HOST">Host / operator</option>
              <option value="MANAGER">Manager / admin</option>
              <option value="DISPLAY">Venue display</option>
            </select>
          </Field>
          <ActionMessages action={action} />
          <Submit pending={action.pending} disabled={action.disabled}>
            Create staff account
          </Submit>
        </Form>
      </section>
    </div>
  );
}
function Simulator() {
  const { restaurant } = useApp();
  const action = useAction();
  const [reset, setReset] = useState(false);
  const [count, setCount] = useState(5);
  const [tableId, setTableId] = useState("");
  const simulate = (name: string) =>
    action.run(async () => {
      const result = await request<{ message: string }>(
        `/demo/${name === "multiple" ? "add" : name}`,
        "POST",
        { count: name === "add" ? 1 : count, ...(tableId ? { tableId } : {}) },
      );
      return result;
    }, "Simulation applied. Open the floor console or display to see the changes.");
  if (!restaurant?.demoMode)
    return (
      <Empty title="Simulation is unavailable">
        The current environment is not running the demo profile.
      </Empty>
    );
  return (
    <section className="panel simulation">
      <p className="eyebrow">DEVELOPMENT ENVIRONMENT ONLY</p>
      <h2>Put the evening in motion.</h2>
      <p>
        Create realistic queue pressure, free capacity, or restart the
        demonstration. Changes use real persisted service state.
      </p>
      <div className="form-columns">
        <Field label="Number of parties">
          <input
            type="number"
            value={count}
            min={1}
            max={60}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Field label="Target table">
          <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Choose automatically</option>
            {restaurant.tables.map((table) => (
              <option value={table.id} key={table.id}>
                {table.number} · {table.capacity} seats · {table.status}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="simulation-actions">
        {[
          [
            "add",
            "Add random customer",
            "Create a new party with a realistic size.",
          ],
          [
            "multiple",
            "Add multiple customers",
            "Create the selected number of random parties.",
          ],
          [
            "rush",
            "Simulate rush hour",
            "Add a burst of arrivals to exercise allocation.",
          ],
          [
            "occupy",
            "Occupy tables",
            "Create dining visits and reduce free capacity.",
          ],
          ["free", "Free tables", "Release simulated table activity."],
          [
            "complete",
            "Complete dining visit",
            "Record duration and refresh projections.",
          ],
          ["no-show", "Create no-show", "Demonstrate absent-party cleanup."],
          [
            "activity",
            "Generate queue activity",
            "Advance a realistic mixture of service events.",
          ],
        ].map(([name, label, description]) => (
          <button
            className="simulation-action"
            key={name}
            disabled={action.disabled}
            onClick={() => simulate(name)}
          >
            <strong>{label} ↗</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <ActionMessages action={action} />
      <div className="reset-zone">
        <div>
          <h3>Start a fresh demonstration</h3>
          <p>
            Clears demo operational history and restores the seeded restaurant
            and dining samples.
          </p>
        </div>
        <button className="button danger-button" onClick={() => setReset(true)}>
          Reset / reseed demo
        </button>
      </div>
      {reset && (
        <Modal
          title="Reset the demo restaurant?"
          onClose={() => setReset(false)}
        >
          <p>
            All demo reservations, visits, notifications and operational history
            will be replaced with the seed dataset. This action is restricted to
            the demo environment.
          </p>
          <ActionMessages action={action} />
          <button
            className="button danger-button"
            disabled={action.disabled}
            onClick={() =>
              action.run(async () => {
                await request("/demo/reset", "POST", {});
                setReset(false);
              }, "Demo reset complete.")
            }
          >
            Reset demo now
          </button>
        </Modal>
      )}
    </section>
  );
}
export function Manager() {
  const { restaurant } = useApp();
  const [tab, setTab] = useState("analytics");
  return (
    <main className="page manager-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">BEHIND A GOOD SERVICE</p>
          <h1>A restaurant that runs with care.</h1>
          <p>Understand the evening. Tune the next one.</p>
        </div>
        <a className="button secondary" href="/host">
          Open floor console ↗
        </a>
      </div>
      <div className="tabs manager-tabs" aria-label="Manager sections">
        {[
          ["analytics", "Service analytics"],
          ["configuration", "Restaurant & tables"],
          ["policies", "Queue policies"],
          ["team", "Team access"],
          ["audit", "Audit history"],
          ...(restaurant?.demoMode ? [["demo", "Demo studio"]] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "analytics" ? (
        <Reports />
      ) : tab === "configuration" ? (
        <Configuration />
      ) : tab === "policies" ? (
        <Policies />
      ) : tab === "team" ? (
        <Team />
      ) : tab === "audit" ? (
        <AuditLog />
      ) : (
        <Simulator />
      )}
    </main>
  );
}
