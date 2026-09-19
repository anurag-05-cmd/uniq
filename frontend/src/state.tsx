import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ApiError, clearSession, request } from "./api";
import type { Restaurant, User } from "./types";

interface State {
  user: User | null;
  restaurant: Restaurant | null;
  loading: boolean;
  error: string;
  refresh: () => void;
  revision: number;
  setUser: (user: User | null) => void;
  live: boolean;
  online: boolean;
  now: number;
  lastSynced: number;
}
const Context = createContext<State>(null!);
export const useApp = () => useContext(Context);
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const [lastSynced, setLastSynced] = useState(0);
  const offset = useRef(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    Promise.all([
      request<User>("/me").catch((error) => {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }),
      request<Restaurant>("/restaurant"),
    ])
      .then(([account, venue]) => {
        setUser(account);
        setRestaurant(venue);
        offset.current = Date.parse(venue.serverTime) - Date.now();
        setLastSynced(Date.now());
      })
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
    const expired = () => {
      clearSession();
      setUser(null);
      setError("Your session has ended. Sign in again to continue.");
    };
    const connected = () => {
      setOnline(true);
      refresh();
    };
    const disconnected = () => {
      setOnline(false);
      setLive(false);
    };
    window.addEventListener("session-expired", expired);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, [refresh]);
  useEffect(() => {
    if (loading) return;
    request<Restaurant>("/restaurant")
      .then((venue) => {
        setRestaurant(venue);
        setError("");
        setLastSynced(Date.now());
        offset.current = Date.parse(venue.serverTime) - Date.now();
      })
      .catch((error) => setError(error.message));
  }, [revision, loading]);
  useEffect(() => {
    if (!user || !online) return;
    const source = new EventSource("/api/v1/events");
    source.onopen = () => {
      setLive(true);
      refresh();
    };
    source.addEventListener("refresh", refresh);
    source.onerror = () => setLive(false);
    return () => {
      source.close();
      setLive(false);
    };
  }, [user?.id, online, refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, live ? 30000 : 15000);
    return () => clearInterval(timer);
  }, [live, refresh]);
  return (
    <Context.Provider
      value={{
        user,
        restaurant,
        loading,
        error,
        refresh,
        revision,
        setUser,
        live,
        online,
        now,
        lastSynced,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useResource<T>(path: string | null) {
  const { revision } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    request<T>(path)
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, loading };
}
export function useAction() {
  const { refresh, online } = useApp();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function run<T>(
    action: () => Promise<T>,
    message?: string,
  ): Promise<T | undefined> {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const result = await action();
      setSuccess(message || "Saved.");
      refresh();
      return result;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
      refresh();
      return undefined;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return {
    run,
    pending,
    error,
    success,
    setError,
    disabled: pending || !online,
  };
}
