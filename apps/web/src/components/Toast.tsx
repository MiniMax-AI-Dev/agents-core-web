/* eslint-disable react-refresh/only-export-components */
import { AlertTriangle, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { StatusIcon } from "./StatusIcon";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  detail?: string;
  action?: ReactNode;
  persist?: boolean;
  /** The same key updates and revives the existing toast. */
  key?: string;
}

export interface ToastItem extends ToastOptions {
  id: number;
  message: ReactNode;
  durationMs: number;
  leaving: boolean;
  /** Changes on every keyed update, even when the message text is identical. */
  revision: number;
}

export type ShowToast = (message: ReactNode, options?: ToastOptions) => void;

interface ToastContextValue {
  show: ShowToast;
  dismiss: (key: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const NO_PROVIDER: ToastContextValue = { show: () => undefined, dismiss: () => undefined };

const DEFAULT_MS = 4_000;
const ERROR_MS = 7_000;
const MAX_VISIBLE = 3;
const EXIT_FALLBACK_MS = 250;

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NO_PROVIDER;
}

/** @internal Exported for the focused queue regression tests. */
export function enqueueToast(
  list: ToastItem[],
  id: number,
  message: ReactNode,
  options: ToastOptions = {},
): ToastItem[] {
  const tone = options.tone ?? "success";
  const fields = {
    message,
    tone,
    detail: options.detail,
    action: options.action,
    persist: options.persist,
    key: options.key,
    durationMs: tone === "error" ? ERROR_MS : DEFAULT_MS,
    leaving: false,
  };
  const sameKey = options.key ? list.find((toast) => toast.key === options.key) : undefined;

  if (sameKey) {
    return list.map((toast) => (
      toast.id === sameKey.id
        ? { ...toast, ...fields, revision: toast.revision + 1 }
        : toast
    ));
  }

  // Parsar lets the oldest transient toast finish its exit rather than
  // removing it abruptly. Persistent prompts are never selected for eviction.
  const live = list.filter((toast) => !toast.leaving && !toast.persist);
  const excess = live.slice(0, Math.max(0, live.length - (MAX_VISIBLE - 1)));
  const next = list.map((toast) => (
    excess.some((candidate) => candidate.id === toast.id)
      ? { ...toast, leaving: true }
      : toast
  ));

  return [...next, { id, ...fields, revision: 1 }];
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const drop = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const startLeaving = useCallback((id: number) => {
    setToasts((list) => list.map((toast) => (
      toast.id === id ? { ...toast, leaving: true } : toast
    )));
  }, []);

  const show = useCallback<ShowToast>((message, options = {}) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => enqueueToast(list, id, message, options));
  }, []);

  const dismiss = useCallback((key: string) => {
    setToasts((list) => list.map((toast) => (
      toast.key === key ? { ...toast, leaving: true } : toast
    )));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [dismiss, show]);
  const assertive = toasts.filter((toast) => toast.tone === "error");
  const polite = toasts.filter((toast) => toast.tone !== "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
          <div className="toast-position">
            <div aria-live="assertive" className="toast-region toast-region-assertive">
              {assertive.map((toast) => (
                <ToastStrip
                  key={toast.id}
                  toast={toast}
                  onLeave={startLeaving}
                  onDrop={drop}
                />
              ))}
            </div>
            <div aria-live="polite" className="toast-region">
              {polite.map((toast) => (
                <ToastStrip
                  key={toast.id}
                  toast={toast}
                  onLeave={startLeaving}
                  onDrop={drop}
                />
              ))}
            </div>
          </div>,
          document.body,
        )
        : null}
    </ToastContext.Provider>
  );
}

function ToastStrip({
  toast,
  onLeave,
  onDrop,
}: {
  toast: ToastItem;
  onLeave: (id: number) => void;
  onDrop: (id: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(0);

  // A keyed toast may be shown again with exactly the same text. Revision is
  // therefore the signal that this reader-visible countdown must restart.
  useEffect(() => {
    remaining.current = toast.durationMs;
  }, [toast.durationMs, toast.revision]);

  useEffect(() => {
    if (toast.persist || toast.leaving || focused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onLeave(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [focused, onLeave, toast.durationMs, toast.id, toast.leaving, toast.persist, toast.revision]);

  useEffect(() => {
    if (!toast.leaving) return;
    const timer = window.setTimeout(() => onDrop(toast.id), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [onDrop, toast.id, toast.leaving]);

  const tone = toast.tone ?? "success";

  return (
    <div
      className={`toast ${toast.persist && !toast.action ? "toast-persist" : ""} ${toast.leaving ? "leaving" : ""}`}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onAnimationEnd={(event) => {
        if (toast.leaving && event.target === event.currentTarget) onDrop(toast.id);
      }}
    >
      <div className="toast-row">
        <div className={`toast-notice toast-${tone}`}>
          {tone === "success" ? (
            <StatusIcon status="completed" />
          ) : tone === "error" ? (
            <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : tone === "warning" ? (
            <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Info size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          <span>{toast.message}</span>
        </div>
        {toast.action}
        {!toast.persist ? (
          <button
            className="icon-button ghost toast-close"
            type="button"
            aria-label="Close notification"
            onClick={() => onLeave(toast.id)}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {toast.detail ? <pre className="toast-detail">{toast.detail}</pre> : null}
    </div>
  );
}
