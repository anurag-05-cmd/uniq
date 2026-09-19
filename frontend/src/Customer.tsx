import { useEffect, useRef, useState } from "react";
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
import {
  canCancel,
  canSnooze,
  challengeFrom,
  elapsed,
  isActive,
  localTime,
  minutes,
} from "./domain";
import { useAction, useApp, useResource } from "./state";
import type { Entry, Notification } from "./types";

function Scanner({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(true);
  const controls = useRef<{ stop: () => void } | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [payload, setPayload] = useState(
    sessionStorage.getItem("arrivalChallenge") || "",
  );
  const action = useAction();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controls.current?.stop();
    };
  }, []);
  async function startCamera() {
    setCameraError("");
    setCamera(true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices)
        throw new Error(
          "Camera scanning requires HTTPS or localhost. Use your phone camera to open the venue QR link, paste the link below, or ask your host for check-in.",
        );
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      controls.current = await new BrowserQRCodeReader().decodeFromVideoDevice(
        undefined,
        video.current!,
        (result, _error, scannerControls) => {
          if (result) {
            setPayload(result.getText());
            scannerControls.stop();
            setCamera(false);
          }
        },
      );
      if (!mounted.current) controls.current.stop();
    } catch (error) {
      setCamera(false);
      setCameraError(
        error instanceof Error
          ? error.message
          : "Camera unavailable. Please use the check-in link.",
      );
    }
  }
  return (
    <Modal title="Let us know you’re here" onClose={onClose}>
      <p>
        Scan the rotating QR on the restaurant’s arrival display. Your host can
        also check you in after confirming your arrival.
      </p>
      <div className={camera ? "camera-frame" : "camera-frame hidden-camera"}>
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label="Arrival QR camera preview"
        />
      </div>
      <button
        className="button secondary"
        disabled={camera}
        onClick={startCamera}
      >
        {camera ? "Point your camera at the venue QR" : "Open QR camera"}
      </button>
      <ErrorMessage>{cameraError}</ErrorMessage>
      <Form
        onSubmit={() =>
          action.run(async () => {
            await request(`/entries/${entry.id}/check-in`, "POST", {
              challenge: challengeFrom(payload),
              expectedVersion: entry.version,
            });
            sessionStorage.removeItem("arrivalChallenge");
            window.history.replaceState({}, "", "/");
            onClose();
          }, "You’re checked in. We’ll let you know when your table is ready.")
        }
      >
        <Field
          label="Venue check-in link or challenge"
          hint="The QR changes often. If the link expired, scan the current display."
        >
          <textarea
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            rows={2}
            required
            autoComplete="off"
          />
        </Field>
        <ActionMessages action={action} />
        <Submit pending={action.pending} disabled={action.disabled}>
          Confirm my arrival
        </Submit>
      </Form>
    </Modal>
  );
}
function Feedback({ entry }: { entry: Entry }) {
  const action = useAction();
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <p className="notice success">
        Thank you. Your feedback helps us make the next visit better.
      </p>
    );
  return (
    <details className="feedback">
      <summary>How was your visit? Leave feedback</summary>
      <Form
        onSubmit={(data) =>
          action.run(async () => {
            await request(`/entries/${entry.id}/feedback`, "POST", {
              rating: Number(data.get("rating")),
              comment: data.get("comment"),
            });
            setSent(true);
          })
        }
      >
        <Field label="Your experience">
          <select name="rating" defaultValue="5">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} / 5{" "}
                {n === 5 ? "— Wonderful" : n === 1 ? "— Needs improvement" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Anything we should know?">
          <textarea name="comment" maxLength={1000} rows={3} />
        </Field>
        <ActionMessages action={action} />
        <Submit pending={action.pending} disabled={action.disabled}>
          Send feedback
        </Submit>
      </Form>
    </details>
  );
}
export function Customer() {
  const { restaurant, user, now, online } = useApp();
  const entries = useResource<Entry[]>("/me/entries");
  const notifications = useResource<Notification[]>("/me/notifications");
  const action = useAction();
  const [scan, setScan] = useState(false);
  const [snoozeConfirm, setSnoozeConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const active = entries.data?.find(isActive);
  const history = entries.data?.filter((entry) => !isActive(entry)) || [];
  useEffect(() => {
    if (
      active &&
      active.status === "ARRIVAL_WINDOW" &&
      sessionStorage.getItem("arrivalChallenge")
    )
      setScan(true);
  }, [active?.id, active?.status]);
  const maxPartySize = Math.max(
    1,
    ...(restaurant?.tables
      .filter((table) => table.enabled)
      .map((table) => table.capacity) || [8]),
  );
  return (
    <main className="page customer-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">A PLACE FOR GOOD COMPANY</p>
          <h1>
            {active
              ? `We’re saving you a place, ${user?.displayName.split(" ")[0]}.`
              : "Your table, in good time."}
          </h1>
          <p>
            {restaurant?.description ||
              "Seasonal plates, familiar faces, and a table worth sharing."}
          </p>
        </div>
        <span className="venue-location">↗ {restaurant?.location}</span>
      </div>
      <ErrorMessage>{entries.error}</ErrorMessage>
      <ActionMessages action={action} />
      {entries.loading ? (
        <Loading />
      ) : (
        <div className="customer-grid">
          <section>
            {!active ? (
              <section className="panel join-panel">
                <div className="row between">
                  <p className="eyebrow">JOIN THE EVENING</p>
                  <Badge status={restaurant?.open ? "OPEN" : "CLOSED"} />
                </div>
                <h2>A table for…</h2>
                <Form
                  onSubmit={(data) =>
                    action.run(
                      () =>
                        request<Entry>("/entries", "POST", {
                          partySize,
                          preference: data.get("preference"),
                          accessible: data.get("accessible") === "on",
                        }),
                      "You’re on the waitlist. Your estimate will update as tables turn.",
                    )
                  }
                >
                  <div className="party-picker">
                    <button
                      type="button"
                      aria-label="Remove one guest"
                      disabled={partySize <= 1}
                      onClick={() => setPartySize((n) => n - 1)}
                    >
                      −
                    </button>
                    <div>
                      <strong>{partySize}</strong>
                      <span>{partySize === 1 ? "guest" : "guests"}</span>
                    </div>
                    <button
                      type="button"
                      aria-label="Add one guest"
                      disabled={partySize >= maxPartySize}
                      onClick={() => setPartySize((n) => n + 1)}
                    >
                      +
                    </button>
                  </div>
                  <Field
                    label="Where would you like to sit?"
                    hint="We’ll do our best. A preference may affect your wait."
                  >
                    <select name="preference" defaultValue="ANY">
                      <option value="ANY">
                        Anywhere lovely · first available
                      </option>
                      {restaurant?.areas.map((area) => (
                        <option key={area.id} value={area.name}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="check-field">
                    <input type="checkbox" name="accessible" /> We need an
                    accessible table
                  </label>
                  <Submit
                    pending={action.pending}
                    disabled={!restaurant?.open || action.disabled}
                  >
                    Join the waitlist
                  </Submit>
                  <p className="small muted">
                    {restaurant?.open
                      ? `${restaurant.waitingCount} parties currently waiting. One active reservation per account.`
                      : "The waitlist is closed. Please check with the restaurant for opening times."}
                  </p>
                </Form>
              </section>
            ) : (
              <section
                className={`panel reservation ${active.status === "CALLED" ? "called" : ""}`}
              >
                <div className="row between">
                  <p className="eyebrow">YOUR RESERVATION</p>
                  <span role="status">
                    <Badge status={active.status} />
                  </span>
                </div>
                <div className="token-line">
                  <h2>{active.token}</h2>
                  <span>
                    {active.partySize} guests ·{" "}
                    {active.preference === "ANY"
                      ? "First available"
                      : active.preference}
                    {active.accessible ? " · Accessible" : ""}
                  </span>
                </div>
                {active.status === "CALLED" ? (
                  <div className="ready-banner">
                    <span>YOUR TABLE IS READY</span>
                    <h3>Table {active.tableNumber}</h3>
                    <p>{active.areaName} · Please meet your host now.</p>
                    <Countdown
                      deadline={active.callDeadline}
                      label="Your table is held for"
                    />
                  </div>
                ) : ["SEATED", "DINING"].includes(active.status) ? (
                  <div className="ready-banner">
                    <span>MAKE YOURSELF AT HOME</span>
                    <h3>Table {active.tableNumber}</h3>
                    <p>{active.areaName} · Enjoy your time together.</p>
                  </div>
                ) : (
                  <>
                    <div className="eta-block">
                      <span>Estimated wait</span>
                      <strong>{minutes(active.etaSeconds)}</strong>
                      <p>
                        {active.estimatedStartAt
                          ? `Around ${localTime(active.estimatedStartAt)}`
                          : "Checking suitable table availability"}
                        {active.assumesArrival
                          ? " · assumes timely arrival"
                          : ""}
                      </p>
                    </div>
                    <div className="reservation-facts">
                      <Metric
                        label="Queue position"
                        value={active.position ? `≈ ${active.position}` : "—"}
                        note="Projected service order"
                      />
                      <Metric
                        label="Waiting since"
                        value={localTime(active.joinedAt)}
                        note={`${elapsed(active.joinedAt, now)} so far`}
                      />
                    </div>
                    {active.status === "WAITING" && (
                      <p className="notice">
                        You’re waiting remotely. We’ll invite you to check in
                        when your arrival window opens. Keep this page nearby.
                      </p>
                    )}
                    {active.status === "ARRIVAL_WINDOW" && (
                      <div className="arrival-note">
                        <h3>It’s time to head over.</h3>
                        <p>
                          At the restaurant, scan the rotating arrival QR or ask
                          your host to check you in.
                        </p>
                        <Countdown
                          deadline={active.arrivalDeadline}
                          label="Check in within"
                        />
                        <button
                          className="button primary full"
                          disabled={!online}
                          onClick={() => setScan(true)}
                        >
                          I’m here · scan venue QR
                        </button>
                      </div>
                    )}
                    {active.status === "CHECKED_IN" && (
                      <p className="notice success">
                        You’re checked in. Stay nearby; we’re matching your
                        party with a suitable table.
                      </p>
                    )}
                    {active.status === "SNOOZED" && (
                      <div className="notice">
                        <strong>A little extra time is yours.</strong>
                        <p>
                          Your token stays the same. The queue may move ahead
                          while you’re snoozing.
                        </p>
                        <Countdown
                          deadline={active.snoozeReleaseAt}
                          label="Snooze releases within"
                        />
                      </div>
                    )}
                    <p className="estimate-note">
                      Estimates can change with table availability, party size
                      and verified priority. {active.sampleCount || 0} recent
                      dining samples ·{" "}
                      {active.estimateSource
                        ?.replaceAll("_", " ")
                        .toLowerCase() || "Calculating"}
                      . Updated{" "}
                      {active.computedAt
                        ? `${elapsed(active.computedAt, now)} ago`
                        : "soon"}
                      .
                    </p>
                  </>
                )}
                <div className="button-row">
                  {canSnooze(active) && (
                    <button
                      className="button secondary"
                      disabled={action.disabled}
                      onClick={() => setSnoozeConfirm(true)}
                    >
                      Need more time? Snooze ({active.snoozesRemaining})
                    </button>
                  )}
                  {canCancel(active) && (
                    <button
                      className="text-button danger"
                      disabled={action.disabled}
                      onClick={() => setCancelConfirm(true)}
                    >
                      Cancel reservation
                    </button>
                  )}
                </div>
              </section>
            )}
            <section className="how-it-works">
              <h3>A relaxed way to wait</h3>
              <ol>
                <li>
                  <strong>Join from wherever you are.</strong>
                  <span>
                    We estimate your wait using recent dining times and suitable
                    tables.
                  </span>
                </li>
                <li>
                  <strong>Come by when your window opens.</strong>
                  <span>Scan the venue QR to confirm you’ve arrived.</span>
                </li>
                <li>
                  <strong>We’ll bring you to your table.</strong>
                  <span>
                    Keep an eye on your token. Your host will take it from here.
                  </span>
                </li>
              </ol>
            </section>
          </section>
          <aside>
            <section className="panel inbox">
              <div className="row between">
                <h2>From your host</h2>
                <span className="count-pill">
                  {notifications.data?.filter((n) => !n.readAt).length || 0}
                </span>
              </div>
              <ErrorMessage>{notifications.error}</ErrorMessage>
              {notifications.data?.length ? (
                <ul className="notifications">
                  {notifications.data.slice(0, 12).map((note) => (
                    <li
                      key={note.id}
                      className={note.readAt ? "read" : "unread"}
                    >
                      <div className="row between">
                        <strong>{note.title}</strong>
                        <small>{localTime(note.createdAt)}</small>
                      </div>
                      <p>{note.body}</p>
                      {!note.readAt && (
                        <button
                          className="text-button"
                          disabled={action.disabled}
                          onClick={() =>
                            action.run(
                              () =>
                                request(
                                  `/me/notifications/${note.id}/read`,
                                  "POST",
                                ),
                              "Message marked read.",
                            )
                          }
                        >
                          Mark read
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="We’ll keep you in the loop">
                  Arrival reminders and table updates appear here.
                </Empty>
              )}
            </section>
            {history.length > 0 && (
              <section className="panel history">
                <h2>Past visits</h2>
                {history.slice(0, 8).map((entry) => (
                  <article key={entry.id}>
                    <div className="row between">
                      <strong>{entry.token}</strong>
                      <span className="small">
                        {new Date(entry.joinedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <Badge status={entry.status} />
                    <p className="small muted">
                      {entry.partySize} guests
                      {entry.terminalReason
                        ? ` · ${entry.terminalReason.replaceAll("_", " ").toLowerCase()}`
                        : ""}
                    </p>
                    {entry.status === "COMPLETED" && <Feedback entry={entry} />}
                  </article>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}
      {scan && active && (
        <Scanner entry={active} onClose={() => setScan(false)} />
      )}
      {snoozeConfirm && active && (
        <Modal
          title="Take a little more time?"
          onClose={() => setSnoozeConfirm(false)}
        >
          <p>
            Your token and original join time stay the same. Up to{" "}
            {restaurant?.policy.snoozeSpots} waiting parties may move ahead. You
            return within {restaurant?.policy.snoozeMinutes} minutes and your
            waiting-time priority restarts when the snooze ends.
          </p>
          <p>You have {active.snoozesRemaining} snoozes remaining.</p>
          <ActionMessages action={action} />
          <button
            className="button primary"
            disabled={action.disabled}
            onClick={() =>
              action.run(async () => {
                await request(`/entries/${active.id}/snooze`, "POST", {
                  expectedVersion: active.version,
                });
                setSnoozeConfirm(false);
              }, "Snoozed. Your reservation is saved.")
            }
          >
            Confirm snooze
          </button>
        </Modal>
      )}
      {cancelConfirm && active && (
        <Modal
          title="Release your place?"
          onClose={() => setCancelConfirm(false)}
        >
          <p>
            This ends reservation {active.token}. You can join again while the
            waitlist is open.
          </p>
          <ActionMessages action={action} />
          <button
            className="button danger-button"
            disabled={action.disabled}
            onClick={() =>
              action.run(async () => {
                await request(`/entries/${active.id}/cancel`, "POST", {
                  expectedVersion: active.version,
                  reason: "Customer cancelled",
                });
                setCancelConfirm(false);
              }, "Your reservation has been cancelled.")
            }
          >
            Cancel my reservation
          </button>
        </Modal>
      )}
    </main>
  );
}
