import { describe, expect, test } from "bun:test";
import {
  canCancel,
  canSnooze,
  challengeFrom,
  elapsed,
  isActive,
  minutes,
  remaining,
  roleHome,
  terminalStates,
} from "../../src/domain";
import type { Entry, EntryStatus } from "../../src/types";

const entry = (status: EntryStatus, snoozesRemaining = 2) =>
  ({ status, snoozesRemaining }) as Entry;
describe("customer lifecycle controls", () => {
  test("all terminal states suppress queue mutations", () => {
    for (const state of terminalStates) {
      expect(isActive(entry(state))).toBe(false);
      expect(canCancel(entry(state))).toBe(false);
      expect(canSnooze(entry(state))).toBe(false);
    }
  });
  test("seated and dining parties cannot cancel or snooze", () => {
    for (const state of ["SEATED", "DINING"] as EntryStatus[]) {
      expect(canCancel(entry(state))).toBe(false);
      expect(canSnooze(entry(state))).toBe(false);
    }
  });
  test("snooze requires an eligible lifecycle and remaining allowance", () => {
    expect(canSnooze(entry("CHECKED_IN"))).toBe(true);
    expect(canSnooze(entry("CHECKED_IN", 0))).toBe(false);
    expect(canSnooze(entry("CALLED"))).toBe(false);
    expect(canSnooze(entry("SNOOZED"))).toBe(false);
  });
  test("called party may cancel before seating", () =>
    expect(canCancel(entry("CALLED"))).toBe(true));
});
describe("arrival QR interpretation", () => {
  const challenge = "abcdefghijklmnopqrstuv1234567890-_";
  test("accepts a venue link and decodes exactly its challenge", () =>
    expect(
      challengeFrom("https://cedar.example/check-in?challenge=" + challenge),
    ).toBe(challenge));
  test("supports phone LAN links and a pasted decoded challenge", () => {
    expect(
      challengeFrom("http://192.168.1.4:5173/check-in?challenge=" + challenge),
    ).toBe(challenge);
    expect(challengeFrom(" " + challenge + " ")).toBe(challenge);
  });
  test("rejects unrelated routes, unsafe schemes, absent and oversized challenges", () => {
    for (const value of [
      "javascript:alert(1)",
      "https://example.com/login?challenge=" + challenge,
      "https://example.com/check-in",
      "not a qr",
      "https://example.com/check-in?challenge=" + "a".repeat(257),
    ])
      expect(() => challengeFrom(value)).toThrow();
  });
});
describe("honest estimate presentation", () => {
  test("unknown estimates are pending, not zero", () => {
    expect(minutes(null)).toBe("Pending");
    expect(minutes(undefined)).toBe("Pending");
  });
  test("durations round up and deadlines never go negative", () => {
    expect(minutes(61)).toBe("2 min");
    expect(minutes(0)).toBe("< 1 min");
    const now = Date.parse("2026-09-19T12:00:00Z");
    expect(remaining("2026-09-19T12:01:01Z", now)).toBe("1:01");
    expect(remaining("2026-09-19T11:59:00Z", now)).toBe("0:00");
    expect(elapsed("2026-09-19T12:00:00Z", now)).toBe("< 1 min");
  });
  test("roles reach only their intended landing screen", () => {
    expect(roleHome("CUSTOMER")).toBe("/");
    expect(roleHome("HOST")).toBe("/host");
    expect(roleHome("MANAGER")).toBe("/manager");
    expect(roleHome("DISPLAY")).toBe("/display");
  });
});
