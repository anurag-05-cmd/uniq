import { useEffect, useState } from "react";
import { request } from "./api";
import {
  ActionMessages,
  Badge,
  Countdown,
  Empty,
  ErrorMessage,
  Field,
  Form,
  Loading,
  Metric,
  Modal,
  Submit,
} from "./components";
import { elapsed, isActive, localTime, minutes } from "./domain";
import { useAction, useApp, useResource } from "./state";
import type { Entry, HostBoard, Table } from "./types";

type Operation =
  { entry: Entry; action: string } | { table: Table; action: "availability" };
const actionNames: Record<string, string> = {
  assist: "Verify arrival",
  priority: "Review priority",
  assign: "Assign or change table",
  seat: "Seat party",
  dining: "Start dining",
  complete: "Complete dining visit",
  "no-show": "Mark as no-show",
  availability: "Update table availability",
};
export function Host() {
  const { restaurant, now } = useApp();
  const board = useResource<HostBoard>("/host/board");
  const action = useAction();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  useEffect(() => {
    if (!board.data) return;
    setOperation((current) => {
      if (!current) return null;
      if ("table" in current) {
        const latest = board.data!.tables.find(
          (table) => table.id === current.table.id,
        );
        return latest ? { ...current, table: latest } : null;
      }
      const latest = board.data!.entries.find(
        (entry) => entry.id === current.entry.id,
      );
      return latest ? { ...current, entry: latest } : null;
    });
  }, [board.data]);
  const active = board.data?.entries.filter(isActive) || [];
  const filtered = active.filter(
    (entry) =>
      (filter === "all" ||
        (filter === "waiting" &&
          ["WAITING", "ARRIVAL_WINDOW", "SNOOZED"].includes(entry.status)) ||
        (filter === "arrived" && entry.status === "CHECKED_IN") ||
        (filter === "called" && entry.status === "CALLED") ||
        (filter === "dining" && ["SEATED", "DINING"].includes(entry.status))) &&
      `${entry.token} ${entry.customerName || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const tables = board.data?.tables || [];
  function open(entry: Entry, name: string) {
    action.setError("");
    setOperation({ entry, action: name });
  }
  return (
    <main className="page host-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">THE FLOOR, AT A GLANCE</p>
          <h1>Make room for a good evening.</h1>
          <p>Live parties, suitable tables, and one clear next move.</p>
        </div>
        <button
          className="button primary"
          disabled={
            action.disabled ||
            !restaurant?.open ||
            !active.some((e) => e.status === "CHECKED_IN")
          }
          onClick={() =>
            action.run(async () => {
              const result = await request<Entry | undefined>(
                "/host/call-next",
                "POST",
                {},
              );
              if (!result)
                throw new Error(
                  "No checked-in party can be assigned to an available compatible table right now.",
                );
            }, "The best compatible party has been called.")
          }
        >
          Call next suitable party ↗
        </button>
      </div>
      <ErrorMessage>{board.error}</ErrorMessage>
      <ActionMessages action={action} />
      <div className="metrics-row">
        <Metric
          label="Waiting remotely"
          value={
            active.filter((e) =>
              ["WAITING", "ARRIVAL_WINDOW", "SNOOZED"].includes(e.status),
            ).length
          }
        />
        <Metric
          label="Arrived & eligible"
          value={active.filter((e) => e.status === "CHECKED_IN").length}
        />
        <Metric
          label="Called to table"
          value={active.filter((e) => e.status === "CALLED").length}
        />
        <Metric
          label="Available tables"
          value={
            tables.filter((t) => t.status === "AVAILABLE" && t.enabled).length
          }
          note={`${tables.filter((t) => t.enabled).length} enabled tables`}
        />
      </div>
      {board.loading ? (
        <Loading />
      ) : (
        <div className="host-grid">
          <section className="panel queue-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LIVE SERVICE</p>
                <h2>
                  The waitlist{" "}
                  <span className="count-pill">{active.length}</span>
                </h2>
              </div>
              <input
                className="search"
                type="search"
                aria-label="Search token or guest"
                placeholder="Find token or guest…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="tabs" aria-label="Filter waitlist">
              {[
                ["all", "All parties"],
                ["waiting", "Remote"],
                ["arrived", "Arrived"],
                ["called", "Called"],
                ["dining", "Dining"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? "selected" : ""}
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                >
                  {label}
                </button>
              ))}
            </div>
            {filtered.length ? (
              <div className="party-list">
                {filtered.map((entry) => {
                  const suggestion = board.data?.suggestions?.find(
                    (item) => item.entryId === entry.id,
                  );
                  const suggestedTable = tables.find(
                    (table) => table.id === suggestion?.tableId,
                  );
                  return (
                    <article className="party-row" key={entry.id}>
                      <div className="party-identity">
                        <strong className="party-token">{entry.token}</strong>
                        <span>
                          {entry.customerName || "Guest"} · {entry.partySize}{" "}
                          guests
                        </span>
                        <Badge status={entry.status} />
                      </div>
                      <div className="party-details">
                        <span>
                          <strong>{elapsed(entry.joinedAt, now)}</strong>{" "}
                          waiting · ETA{" "}
                          <strong>{minutes(entry.etaSeconds)}</strong>
                        </span>
                        <span>
                          {entry.preference === "ANY"
                            ? "Any dining area"
                            : entry.preference}
                          {entry.accessible ? " · Accessible" : ""}
                          {entry.priority ? " · VERIFIED PRIORITY" : ""}
                        </span>
                        <span>
                          {entry.tableNumber
                            ? `Table ${entry.tableNumber} · ${entry.areaName}`
                            : suggestedTable
                              ? `Suggested: ${suggestedTable.number} · ${suggestedTable.capacity} seats`
                              : "Awaiting a compatible table"}
                        </span>
                        {entry.status === "CALLED" && (
                          <Countdown
                            deadline={entry.callDeadline}
                            label="Call expires"
                          />
                        )}
                        {entry.status === "ARRIVAL_WINDOW" && (
                          <Countdown
                            deadline={entry.arrivalDeadline}
                            label="Arrival due"
                          />
                        )}
                      </div>
                      <div className="party-actions">
                        {["WAITING", "ARRIVAL_WINDOW"].includes(
                          entry.status,
                        ) && (
                          <button
                            className="button small-button"
                            disabled={action.disabled}
                            onClick={() => open(entry, "assist")}
                          >
                            Check in
                          </button>
                        )}
                        {["WAITING", "ARRIVAL_WINDOW", "CHECKED_IN"].includes(
                          entry.status,
                        ) && (
                          <button
                            className="text-button"
                            onClick={() => open(entry, "priority")}
                          >
                            {entry.priority
                              ? "Review priority"
                              : "Approve priority"}
                          </button>
                        )}
                        {["CHECKED_IN", "CALLED"].includes(entry.status) && (
                          <button
                            className="button small-button"
                            onClick={() => open(entry, "assign")}
                          >
                            {entry.status === "CALLED"
                              ? "Change table"
                              : "Assign table"}
                          </button>
                        )}
                        {entry.status === "CALLED" && (
                          <button
                            className="button primary small-button"
                            disabled={action.disabled}
                            onClick={() => open(entry, "seat")}
                          >
                            Seat party
                          </button>
                        )}
                        {entry.status === "SEATED" && (
                          <button
                            className="button primary small-button"
                            onClick={() => open(entry, "dining")}
                          >
                            Start dining
                          </button>
                        )}
                        {["SEATED", "DINING"].includes(entry.status) && (
                          <button
                            className="button small-button"
                            onClick={() => open(entry, "complete")}
                          >
                            Complete visit
                          </button>
                        )}
                        {["ARRIVAL_WINDOW", "CALLED"].includes(
                          entry.status,
                        ) && (
                          <button
                            className="text-button danger"
                            onClick={() => open(entry, "no-show")}
                          >
                            No-show
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty title="A little breathing room">
                No parties match this view.
              </Empty>
            )}
            <div className="panel-footnote">
              Recommendations balance waiting age, party size, accessibility,
              table efficiency and verified priority. Manual assignments require
              a recorded reason.
            </div>
          </section>
          <aside className="floor-sidebar">
            <section className="panel floor-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">TABLE AVAILABILITY</p>
                  <h2>The floor</h2>
                </div>
              </div>
              {restaurant?.areas.map((area) => (
                <div className="area-group" key={area.id}>
                  <h3>{area.name}</h3>
                  <div className="table-grid">
                    {tables
                      .filter((table) => table.areaId === area.id)
                      .map((table) => {
                        const party = active.find(
                          (entry) => entry.tableId === table.id,
                        );
                        return (
                          <button
                            key={table.id}
                            className={`table-card table-${table.status.toLowerCase()} ${!table.enabled ? "table-disabled" : ""}`}
                            onClick={() => {
                              action.setError("");
                              setOperation({ table, action: "availability" });
                            }}
                            aria-label={`Table ${table.number}, ${table.capacity} seats, ${table.enabled ? table.status : "disabled"}`}
                          >
                            <strong>{table.number}</strong>
                            <span>
                              {table.capacity} seats{" "}
                              {table.accessible ? "♿" : ""}
                            </span>
                            <small>
                              {!table.enabled
                                ? "Disabled"
                                : table.status.toLowerCase()}
                            </small>
                            {party && <b>{party.token}</b>}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
              <p className="small muted">
                Select a table to manage availability. Occupied and assigned
                tables must finish or release their active party first.
              </p>
            </section>
            <section className="panel">
              <h2>Dining now</h2>
              {board.data?.visits.filter((visit) => !visit.completedAt)
                .length ? (
                board.data.visits
                  .filter((visit) => !visit.completedAt)
                  .map((visit) => (
                    <div className="visit-row" key={visit.id}>
                      <div>
                        <strong>{visit.token}</strong>
                        <span>
                          Table {visit.tableNumber} · {visit.partySize} guests
                        </span>
                      </div>
                      <strong>{elapsed(visit.startedAt, now)}</strong>
                    </div>
                  ))
              ) : (
                <p className="muted">No active dining visits.</p>
              )}
            </section>
          </aside>
        </div>
      )}
      {operation && (
        <Modal
          title={actionNames[operation.action]}
          onClose={() => setOperation(null)}
        >
          <Form
            onSubmit={(data) =>
              action.run(async () => {
                if ("table" in operation)
                  await request(
                    `/host/tables/${operation.table.id}/availability`,
                    "POST",
                    {
                      status: data.get("status"),
                      enabled: data.get("enabled") === "on",
                      reason: data.get("reason"),
                      expectedVersion: operation.table.version,
                    },
                  );
                else
                  await request(
                    `/host/entries/${operation.entry.id}/${operation.action}`,
                    "POST",
                    {
                      expectedVersion: operation.entry.version,
                      reason: data.get("reason") || undefined,
                      ...(operation.action === "assign"
                        ? { tableId: data.get("tableId") }
                        : {}),
                      ...(operation.action === "priority"
                        ? { priority: data.get("priority") === "true" }
                        : {}),
                    },
                  );
                setOperation(null);
              }, "Service updated.")
            }
          >
            {"entry" in operation ? (
              <>
                <div className="notice">
                  <strong>{operation.entry.token}</strong> ·{" "}
                  {operation.entry.partySize} guests ·{" "}
                  <Badge status={operation.entry.status} />
                </div>
                {operation.action === "assign" && (
                  <Field label="Suitable table">
                    <select name="tableId" required defaultValue="">
                      <option value="" disabled>
                        Choose a compatible available table
                      </option>
                      {tables
                        .filter(
                          (table) =>
                            table.enabled &&
                            (table.status === "AVAILABLE" ||
                              table.id === operation.entry.tableId) &&
                            table.capacity >= operation.entry.partySize &&
                            (!operation.entry.accessible || table.accessible),
                        )
                        .map((table) => (
                          <option key={table.id} value={table.id}>
                            {table.number} · {table.capacity} seats ·{" "}
                            {table.areaName}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {operation.action === "priority" && (
                  <>
                    <p>
                      Approve only after verifying a legitimate accessibility or
                      service need. Ordinary parties remain protected by the
                      priority burst limit.
                    </p>
                    <Field label="Priority decision">
                      <select
                        name="priority"
                        defaultValue={String(!operation.entry.priority)}
                      >
                        <option value="true">Approve verified priority</option>
                        <option value="false">
                          Return to ordinary priority
                        </option>
                      </select>
                    </Field>
                  </>
                )}
                {operation.action === "assist" && (
                  <p>
                    Confirm the entire party is physically present. This is
                    recorded as staff-assisted check-in.
                  </p>
                )}
                {operation.action === "no-show" && (
                  <p>
                    The server permits a no-show only after the relevant
                    persisted deadline. Current deadline:{" "}
                    {localTime(
                      operation.entry.callDeadline ||
                        operation.entry.arrivalDeadline,
                    )}
                    .
                  </p>
                )}
                {operation.action === "complete" && (
                  <p>
                    Confirm this party has finished dining and the table is
                    ready for its next guests.
                  </p>
                )}
              </>
            ) : (
              <>
                <p>
                  Table {operation.table.number} · {operation.table.capacity}{" "}
                  seats · {operation.table.areaName}
                </p>
                <Field label="Availability">
                  <select
                    name="status"
                    defaultValue={
                      operation.table.status === "AVAILABLE"
                        ? "AVAILABLE"
                        : "UNAVAILABLE"
                    }
                  >
                    <option value="AVAILABLE">Available</option>
                    <option value="UNAVAILABLE">Unavailable</option>
                  </select>
                </Field>
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={operation.table.enabled}
                  />{" "}
                  Table enabled
                </label>
              </>
            )}
            <Field
              label="Reason / service note"
              hint="Recorded in the operational audit."
            >
              <textarea
                name="reason"
                rows={2}
                maxLength={500}
                required={[
                  "assist",
                  "priority",
                  "assign",
                  "no-show",
                  "availability",
                ].includes(operation.action)}
                placeholder="Explain the service action…"
              />
            </Field>
            <ActionMessages action={action} />
            <Submit pending={action.pending} disabled={action.disabled}>
              Confirm{" "}
              {operation.action === "availability"
                ? "availability"
                : operation.action.replace("-", " ")}
            </Submit>
          </Form>
        </Modal>
      )}
    </main>
  );
}
