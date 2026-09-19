import type { Entry, EntryStatus } from "./types";

export const terminalStates: EntryStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "NO_SHOW",
];
export const isActive = (entry: Entry) =>
  !terminalStates.includes(entry.status);
export const canSnooze = (entry: Entry) =>
  ["WAITING", "ARRIVAL_WINDOW", "CHECKED_IN"].includes(entry.status) &&
  entry.snoozesRemaining > 0;
export const canCancel = (entry: Entry) =>
  ["WAITING", "ARRIVAL_WINDOW", "CHECKED_IN", "SNOOZED", "CALLED"].includes(
    entry.status,
  );
export const labels: Record<EntryStatus, string> = {
  WAITING: "Waiting remotely",
  ARRIVAL_WINDOW: "Time to head over",
  CHECKED_IN: "Arrived · finding your table",
  SNOOZED: "Taking a little extra time",
  CALLED: "Your table is ready",
  SEATED: "Welcome to your table",
  DINING: "Enjoy your meal",
  COMPLETED: "Thanks for dining with us",
  CANCELLED: "Reservation cancelled",
  EXPIRED: "Arrival window expired",
  NO_SHOW: "Missed table call",
};
export function minutes(seconds: number | null | undefined) {
  return seconds == null
    ? "Pending"
    : seconds < 60
      ? "< 1 min"
      : `${Math.ceil(seconds / 60)} min`;
}
export function elapsed(since: string, now = Date.now()) {
  return minutes(Math.max(0, (now - Date.parse(since)) / 1000));
}
export function remaining(deadline: string | null, now = Date.now()) {
  if (!deadline) return "—";
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function challengeFrom(input: string): string {
  const trimmed = input.trim();
  if (!trimmed)
    throw new Error("Scan the venue QR or paste its check-in link.");
  try {
    const url = new URL(trimmed);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/check-in"
    )
      throw new Error("Invalid venue check-in link.");
    const challenge = url.searchParams.get("challenge");
    if (!challenge || challenge.length > 128)
      throw new Error("This link does not contain a valid arrival challenge.");
    return challenge;
  } catch (error) {
    if (trimmed.includes("://")) throw error;
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(trimmed))
      throw new Error("Paste the complete venue check-in link or challenge.");
    return trimmed;
  }
}
export function roleHome(role: string) {
  return role === "HOST"
    ? "/host"
    : role === "MANAGER"
      ? "/manager"
      : role === "DISPLAY"
        ? "/display"
        : "/";
}
export function localTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export function number(value: number | null | undefined, suffix = "") {
  return value == null ? "—" : `${Number(value.toFixed(1))}${suffix}`;
}
