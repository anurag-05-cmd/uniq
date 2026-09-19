import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError, clearSession, request } from "../../src/api";
const originalFetch = globalThis.fetch;
const captured: RequestInit[] = [];
beforeEach(() => {
  clearSession();
  captured.length = 0;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function responder(replies: ("network" | "truncated" | number)[]) {
  let calls = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(url).endsWith("/auth/csrf"))
      return new Response(
        JSON.stringify({ token: "csrf-test", headerName: "X-CSRF-TOKEN" }),
      );
    captured.push(init || {});
    const status = replies[calls++];
    if (status === "network") throw new TypeError("Network disconnected");
    if (status === "truncated") {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          controller.error(new TypeError("Response body interrupted"));
        },
      });
      return new Response(stream, { status: 200 });
    }

    return new Response(
      status === 204
        ? null
        : JSON.stringify(
            status === 200
              ? { ok: true }
              : { detail: "State changed.", code: "VERSION_CONFLICT" },
          ),
      { status: status || 200 },
    );
  }) as typeof fetch;
}
describe("commands preserve a retry-safe intent", () => {
  test("uses same CSRF and idempotency key after ambiguous transport failure", async () => {
    responder(["network", 200]);
    await expect(
      request("/entries", "POST", { partySize: 2 }),
    ).rejects.toBeInstanceOf(ApiError);
    await request("/entries", "POST", { partySize: 2 });
    const a = captured[0].headers as Record<string, string>;
    const b = captured[1].headers as Record<string, string>;
    expect(a["Idempotency-Key"]).toBe(b["Idempotency-Key"]);
    expect(a["X-CSRF-TOKEN"]).toBe("csrf-test");
    expect(captured[0].credentials).toBe("same-origin");
  });
  test("retains the command key when a successful response body is interrupted", async () => {
    responder(["truncated", 200, 200]);
    await expect(
      request("/entries/id/snooze", "POST", { expectedVersion: 4 }),
    ).rejects.toBeInstanceOf(ApiError);
    await request("/entries/id/snooze", "POST", { expectedVersion: 4 });
    await request("/entries/id/snooze", "POST", { expectedVersion: 4 });
    const first = (captured[0].headers as Record<string, string>)[
      "Idempotency-Key"
    ];
    const retry = (captured[1].headers as Record<string, string>)[
      "Idempotency-Key"
    ];
    const next = (captured[2].headers as Record<string, string>)[
      "Idempotency-Key"
    ];
    expect(retry).toBe(first);
    expect(next).not.toBe(retry);
  });

  test("a new command following a committed success receives a new key", async () => {
    responder([200, 200]);
    await request("/demo/add", "POST", { count: 1 });
    await request("/demo/add", "POST", { count: 1 });
    expect(
      (captured[0].headers as Record<string, string>)["Idempotency-Key"],
    ).not.toBe(
      (captured[1].headers as Record<string, string>)["Idempotency-Key"],
    );
  });
  test("known version conflicts display the server error", async () => {
    responder([409]);
    try {
      await request("/entries/id/cancel", "POST", { expectedVersion: 1 });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as Error).message).toBe("State changed.");
    }
  });
  test("form login remains URL encoded and no-content commands are supported", async () => {
    responder([200, 204]);
    await request(
      "/auth/login",
      "POST",
      new URLSearchParams({ username: "a+b@example.com", password: "secret" }),
    );
    expect(captured[0].body).toBe(
      "username=a%2Bb%40example.com&password=secret",
    );
    expect(
      (captured[0].headers as Record<string, string>)["Content-Type"],
    ).toBe("application/x-www-form-urlencoded");
    expect(await request("/auth/logout", "POST")).toBeUndefined();
  });
});
