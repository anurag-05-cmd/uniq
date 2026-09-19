import { useState } from "react";
import { clearSession, request } from "./api";
import {
  ActionMessages,
  ErrorMessage,
  Field,
  Form,
  Loading,
  Submit,
} from "./components";
import { roleHome } from "./domain";
import { Provider, useAction, useApp } from "./state";
import type { User } from "./types";
import { Customer } from "./Customer";
import { Host } from "./Host";
import { Manager } from "./Manager";
import { Display } from "./Display";

function Login() {
  const [register, setRegister] = useState(false);
  const { setUser, restaurant } = useApp();
  const action = useAction();
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">GOOD FOOD. LESS WAITING.</p>
        <h1>
          Your evening
          <br />
          starts here.
        </h1>
        <p>
          Find your place in line, then make the time your own. We’ll keep you
          close to your table.
        </p>
        <div className="cedar-art" aria-hidden="true">
          <span>✦</span>
          <i />
          <i />
          <i />
        </div>
        <small>{restaurant?.location || "The Cedar Table"}</small>
      </section>
      <section className="auth-form">
        <p className="eyebrow">WELCOME TO THE CEDAR TABLE</p>
        <h2>{register ? "Make yourself at home." : "Welcome back."}</h2>
        <p>
          {register
            ? "Create an account to join the waitlist."
            : "Sign in to find your table or manage service."}
        </p>
        <Form
          onSubmit={(data) =>
            action.run(async () => {
              const email = String(data.get("email"));
              const password = String(data.get("password"));
              if (register)
                await request<User>("/auth/register", "POST", {
                  email,
                  password,
                  displayName: data.get("displayName"),
                });
              const user = await request<User>(
                "/auth/login",
                "POST",
                new URLSearchParams({ username: email, password }),
              );
              clearSession();
              setUser(user);
              const challenge =
                new URLSearchParams(window.location.search).get("challenge") ||
                sessionStorage.getItem("arrivalChallenge");
              window.location.assign(
                challenge && user.role === "CUSTOMER"
                  ? `/check-in?challenge=${encodeURIComponent(challenge)}`
                  : roleHome(user.role),
              );
            })
          }
        >
          {register && (
            <Field label="Your name">
              <input
                name="displayName"
                autoComplete="name"
                required
                maxLength={100}
              />
            </Field>
          )}
          <Field label="Email address">
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
            />
          </Field>
          <Field
            label="Password"
            hint={
              register
                ? "Use at least 12 characters (at most 72 UTF-8 bytes)."
                : undefined
            }
          >
            <input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 12 : undefined}
              maxLength={72}
            />
          </Field>
          <ActionMessages action={action} />
          <Submit pending={action.pending} disabled={action.disabled}>
            {register ? "Create account & continue" : "Sign in"}
          </Submit>
        </Form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            action.setError("");
          }}
        >
          {register
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {restaurant?.demoMode && (
          <details className="demo-login">
            <summary>Demo accounts</summary>
            <p>
              Password: <code>CedarDemo!2026</code>
            </p>
            {["customer", "host", "manager", "display"].map((role) => (
              <p key={role}>
                <strong>{role}</strong> <code>{role}@cedar.local</code>
              </p>
            ))}
          </details>
        )}
        <p className="muted small">
          Need help accessing your account? Ask the restaurant host for
          assistance.
        </p>
      </section>
    </main>
  );
}
function Shell() {
  const { user, restaurant, loading, error, live, online, lastSynced, now } =
    useApp();
  const path = window.location.pathname;
  const challenge = new URLSearchParams(window.location.search).get(
    "challenge",
  );
  if (challenge && path === "/check-in")
    sessionStorage.setItem("arrivalChallenge", challenge);
  if (loading) return <Loading />;
  const staff = user?.role === "HOST" || user?.role === "MANAGER";
  const authorized =
    path === "/host"
      ? staff
      : path === "/manager"
        ? user?.role === "MANAGER"
        : path === "/display"
          ? staff || user?.role === "DISPLAY"
          : true;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href={user ? roleHome(user.role) : "/"}>
          <img src="/cedar.svg" alt="" />
          <span>
            {restaurant?.name || "The Cedar Table"}
            <small>YOUR TABLE, IN GOOD TIME</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {staff && (
            <a className={path === "/host" ? "active" : ""} href="/host">
              Floor & waitlist
            </a>
          )}
          {user?.role === "MANAGER" && (
            <a className={path === "/manager" ? "active" : ""} href="/manager">
              Restaurant
            </a>
          )}
          {(staff || user?.role === "DISPLAY") && (
            <a className={path === "/display" ? "active" : ""} href="/display">
              Display
            </a>
          )}
          {user && (
            <button
              className="text-button signout"
              onClick={async () => {
                try {
                  await request("/auth/logout", "POST");
                  clearSession();
                  window.location.assign("/login");
                } catch {
                  window.location.reload();
                }
              }}
            >
              Sign out<span className="small">{user.displayName}</span>
            </button>
          )}
        </nav>
      </header>
      <div
        className={`connection-strip ${!online || (user && !live) ? "degraded" : ""}`}
      >
        <span className={`signal ${live ? "live" : ""}`} />
        <span role="status">
          {!online
            ? "You are offline. Displayed information may be stale; reconnect to take action."
            : user
              ? live
                ? "Live with the restaurant"
                : "Reconnecting live updates · refreshing every 15 seconds"
              : restaurant?.open
                ? "We’re welcoming guests"
                : "The waitlist is currently closed"}
        </span>
        {lastSynced > 0 && (
          <span className="connection-time">
            Last synced {Math.max(0, Math.floor((now - lastSynced) / 1000))}s
            ago
          </span>
        )}
      </div>
      <div className="global-notices">
        <ErrorMessage>{error}</ErrorMessage>
        {restaurant?.recoveryRequired && (
          <p className="notice warning">
            Service is being reconciled after an interruption. New queue
            operations may be paused while a manager checks the floor.
          </p>
        )}
      </div>
      <div id="main">
        {!user ? (
          <Login />
        ) : !authorized ? (
          <main className="page">
            <h1>This area is for restaurant staff.</h1>
            <p>Your account cannot access this screen.</p>
            <a className="button primary" href={roleHome(user.role)}>
              Return to your home
            </a>
          </main>
        ) : path === "/display" || user.role === "DISPLAY" ? (
          <Display />
        ) : path === "/manager" ? (
          <Manager />
        ) : path === "/host" || (user.role === "HOST" && path === "/") ? (
          <Host />
        ) : user.role === "MANAGER" && path === "/" ? (
          <Manager />
        ) : (
          <Customer />
        )}
      </div>
      {path !== "/display" && (
        <footer>
          <span>THE CEDAR TABLE</span>
          <span>Good company is always worth a little time.</span>
        </footer>
      )}
    </>
  );
}
export function App() {
  return (
    <Provider>
      <Shell />
    </Provider>
  );
}
