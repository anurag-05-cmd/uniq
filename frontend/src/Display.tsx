import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Empty, ErrorMessage, Loading } from "./components";
import { remaining } from "./domain";
import { useApp, useResource } from "./state";
import type { DisplayBoard } from "./types";

export function Display() {
  const { now, online, live, refresh } = useApp();
  const board = useResource<DisplayBoard>("/display/board");
  const [image, setImage] = useState("");
  const [qrError, setQrError] = useState("");
  const url = board.data?.challenge
    ? `${window.location.origin}/check-in?challenge=${encodeURIComponent(board.data.challenge)}`
    : "";
  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const valid = board.data && Date.parse(board.data.expiresAt) > now && online;
  useEffect(() => {
    let active = true;
    if (!url) return;
    QRCode.toDataURL(url, {
      width: 520,
      margin: 3,
      errorCorrectionLevel: "M",
      color: { dark: "#142e25", light: "#ffffff" },
    })
      .then((value) => {
        if (active) {
          setImage(value);
          setQrError("");
        }
      })
      .catch(() => {
        if (active)
          setQrError(
            "The arrival QR could not be generated. Ask your host to check you in.",
          );
      });
    return () => {
      active = false;
    };
  }, [url]);
  if (board.loading) return <Loading />;
  return (
    <main className="display-page">
      <div className="display-top">
        <div>
          <p className="eyebrow">COME IN. SETTLE IN.</p>
          <h1>{board.data?.restaurantName || "The Cedar Table"}</h1>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen().catch(() => {});
          }}
        >
          Fullscreen ↗
        </button>
      </div>
      <ErrorMessage>{board.error || qrError}</ErrorMessage>
      <div className="display-grid">
        <section className="display-calls">
          <p className="eyebrow">YOUR EVENING IS READY</p>
          <h2>Now welcoming</h2>
          <div aria-live="polite">
            {board.data?.called.length ? (
              board.data.called.map((call) => (
                <div className="call-line" key={call.token}>
                  <strong>{call.token}</strong>
                  <div>
                    <span>Table {call.tableNumber}</span>
                    <small>{call.areaName}</small>
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Good things are on the way.">
                Your token will appear here when your table is ready.
              </Empty>
            )}
          </div>
          <p className="display-bottom-note">
            See your token? Please meet your host.
          </p>
        </section>
        <section className="display-arrival">
          <p className="eyebrow">JUST ARRIVED?</p>
          <h2>Make yourself known.</h2>
          <div className="qr-frame">
            {image && valid ? (
              <img
                src={image}
                alt="Rotating restaurant arrival check-in QR code"
              />
            ) : (
              <div className="qr-unavailable">
                <strong>
                  {online ? "Refreshing arrival code…" : "Arrival code offline"}
                </strong>
                <p>Please ask your host for assisted check-in.</p>
              </div>
            )}
          </div>
          <p className="qr-caption">
            Open your phone camera, scan, and sign in.
            <br />
            Already waiting? Confirm your arrival.
          </p>
          <div className="qr-timer">
            {valid
              ? `This code refreshes in ${remaining(board.data!.expiresAt, now)}`
              : "Please wait for a fresh venue code."}
          </div>
          <p className="small muted">
            Check-in is available during your arrival window. Your host is here
            to help.
          </p>
        </section>
      </div>
      {!live && (
        <p className="notice warning">
          Live updates are reconnecting. The board refreshes automatically; your
          host can confirm your table.
        </p>
      )}
    </main>
  );
}
