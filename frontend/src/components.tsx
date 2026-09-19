import { cloneElement, isValidElement, useEffect, useId, useRef } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";
import { labels, remaining } from "./domain";
import type { EntryStatus } from "./types";
import { useApp } from "./state";

export function Badge({ status }: { status: EntryStatus | string }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      {labels[status as EntryStatus] || status.replaceAll("_", " ")}
    </span>
  );
}
export function ErrorMessage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (children) ref.current?.focus();
  }, [children]);
  return children ? (
    <div className="notice error" role="alert" tabIndex={-1} ref={ref}>
      {children}
    </div>
  ) : null;
}
export function ActionMessages({
  action,
}: {
  action: { error: string; success: string };
}) {
  return (
    <>
      <ErrorMessage>{action.error}</ErrorMessage>
      {action.success && (
        <p className="notice success" role="status">
          {action.success}
        </p>
      )}
    </>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="leaf">✦</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-dot" /> Bringing your table up to date…
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const labelId = id + "-label";
  const hintId = id + "-hint";
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-labelledby": labelId,
        ...(hint ? { "aria-describedby": hintId } : {}),
      })
    : children;
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}

export function Submit({
  pending,
  children,
  disabled,
}: {
  pending: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="button primary"
      type="submit"
      disabled={pending || disabled}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
export function Countdown({
  deadline,
  label,
}: {
  deadline: string | null;
  label: string;
}) {
  const { now } = useApp();
  return deadline ? (
    <div className="countdown" aria-live="off">
      <span>{label}</span>
      <strong>{remaining(deadline, now)}</strong>
    </div>
  ) : null;
}
export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="modal" onCancel={onClose}>
      <div className="row between">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  children,
  onSubmit,
  className,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => void;
  className?: string;
}) {
  return (
    <form
      className={className || "form-stack"}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
    </form>
  );
}
