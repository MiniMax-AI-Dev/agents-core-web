import { Activity, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AgentTurn,
  SessionItem,
  TokenUsage,
  TurnStatus,
} from "@agents-core-web/agents-client";

import { StatusIcon, type StatusKind } from "../../../components/StatusIcon";

export type TurnTimelineLoadState = "idle" | "loading" | "ready" | "failed";

interface TurnTimelineProps {
  turns: AgentTurn[];
  items: SessionItem[];
  sessionUsage: TokenUsage | null;
  loadState: TurnTimelineLoadState;
  error?: string | null;
  nowSeconds?: number;
}

const usageMetrics = [
  ["Input", ["input_tokens"]],
  ["Output", ["output_tokens"]],
  ["Total", ["total_tokens"]],
  ["Cached", ["input_tokens_details", "cached_tokens"]],
  ["Reasoning", ["output_tokens_details", "reasoning_tokens"]],
] as const;

function metric(value: unknown, path: readonly string[]): number | null {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isSafeInteger(current) && current >= 0 ? current : null;
}

function UsageGrid({
  label,
  usage,
  accessibleLabel = label,
  landmark = false,
}: {
  label: string;
  usage: unknown;
  accessibleLabel?: string;
  landmark?: boolean;
}) {
  const content = (
    <>
      <strong>{label}</strong>
      <dl>
        {usageMetrics.map(([name, path]) => {
          const value = metric(usage, path);
          return <div key={name}><dt>{name}</dt><dd>{value === null ? "Unknown" : value.toLocaleString("en-US")}</dd></div>;
        })}
      </dl>
    </>
  );
  return landmark
    ? <section className="turn-usage" aria-label={accessibleLabel}>{content}</section>
    : <div className="turn-usage" role="group" aria-label={accessibleLabel}>{content}</div>;
}

function statusLabel(status: TurnStatus): string {
  return status.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function statusKind(status: TurnStatus): StatusKind {
  if (status === "in_progress" || status === "waiting") return "running";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  return "queued";
}

function seconds(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function formatTurnTimestamp(value: unknown): string {
  const timestamp = seconds(value);
  if (timestamp === null) return "Unknown";
  const date = new Date(timestamp * 1_000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function formatTurnElapsed(startedAt: unknown, endedAt: unknown): string {
  const start = seconds(startedAt);
  const end = seconds(endedAt);
  if (start === null || end === null || end < start) return "Unknown";
  const elapsed = end - start;
  const hours = Math.floor(elapsed / 3_600);
  const minutes = Math.floor(elapsed % 3_600 / 60);
  const remainder = elapsed % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

function errorProjection(value: unknown): { code: string; message: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") return null;
  return { code: candidate.code || "unknown_error", message: candidate.message || "Unknown" };
}

function TurnCard({ turn, itemCount, now }: { turn: AgentTurn; itemCount: number; now: number }) {
  const active = turn.status === "in_progress" || turn.status === "waiting";
  const elapsed = active
    ? formatTurnElapsed(turn.started_at, now)
    : formatTurnElapsed(turn.started_at, turn.completed_at);
  const error = errorProjection(turn.error);
  const headingId = `turn-${turn.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-heading`;

  return (
    <article className={`turn-card turn-card-${turn.status}`} data-turn-id={turn.id} data-turn-status={turn.status} aria-labelledby={headingId}>
      <header className="turn-card-heading">
        <StatusIcon status={statusKind(turn.status)} title={`Turn status: ${statusLabel(turn.status)}`} />
        <div>
          <strong id={headingId}>{statusLabel(turn.status)} Turn</strong>
          <code title={turn.id}>{turn.id}</code>
        </div>
        <span className="turn-item-count">{itemCount} linked {itemCount === 1 ? "Item" : "Items"}</span>
      </header>

      <dl className="turn-timing">
        <div><dt>Started</dt><dd>{formatTurnTimestamp(turn.started_at)}</dd></div>
        <div><dt>Completed</dt><dd>{formatTurnTimestamp(turn.completed_at)}</dd></div>
        <div>
          <dt>{active ? "Running elapsed" : "Wall clock"}</dt>
          <dd aria-label={active ? `Running elapsed ${elapsed}` : `Wall clock ${elapsed}`}>
            {active && elapsed !== "Unknown" ? `Running · ${elapsed}` : elapsed}
          </dd>
        </div>
      </dl>

      {error ? (
        <div className="turn-error">
          <strong>Turn error</strong>
          <code>{error.code}</code>
          <p>{error.message}</p>
          <small>Durable conversation Items remain available in the Conversation tab.</small>
        </div>
      ) : null}

      <UsageGrid label="Turn usage" accessibleLabel={`Usage for Turn ${turn.id}`} usage={turn.usage} />
    </article>
  );
}

export function TurnTimeline({
  turns,
  items,
  sessionUsage,
  loadState,
  error = null,
  nowSeconds,
}: TurnTimelineProps) {
  const [clock, setClock] = useState(() => nowSeconds ?? Math.floor(Date.now() / 1_000));
  const active = turns.some((turn) => turn.status === "in_progress" || turn.status === "waiting");
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const item of items) next.set(item.turn_id, (next.get(item.turn_id) ?? 0) + 1);
    return next;
  }, [items]);
  const knownTurnIds = useMemo(() => new Set(turns.map((turn) => turn.id)), [turns]);
  const unassociatedItems = items.filter((item) => !knownTurnIds.has(item.turn_id)).length;

  useEffect(() => {
    if (nowSeconds !== undefined) {
      setClock(nowSeconds);
      return;
    }
    if (!active) return;
    setClock(Math.floor(Date.now() / 1_000));
    const interval = window.setInterval(() => setClock(Math.floor(Date.now() / 1_000)), 1_000);
    return () => window.clearInterval(interval);
  }, [active, nowSeconds]);

  return (
    <section className="turn-timeline" aria-label="Turn timeline" aria-busy={loadState === "loading" || undefined}>
      <header className="turn-timeline-heading">
        <div>
          <Activity size={14} strokeWidth={1.5} aria-hidden="true" />
          <strong>Turn timeline</strong>
        </div>
        <span>{loadState === "ready" || turns.length ? `${turns.length} observed ${turns.length === 1 ? "Turn" : "Turns"}` : "Core state"}</span>
      </header>

      <UsageGrid label="Session aggregate usage" usage={sessionUsage} landmark />

      {loadState === "loading" ? (
        <div className="turn-timeline-state">
          <Clock3 size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>{turns.length ? "Loading complete Turn history; live observations may already appear." : "Loading every Turn page…"}</span>
        </div>
      ) : null}

      {loadState === "failed" ? (
        <div className="turn-timeline-failure" role="alert">
          <strong>Couldn’t load Turn history</strong>
          <p>{error || "The Agent Core Turn read failed."}</p>
          {turns.length ? <small>The last observed Turn timeline remains visible.</small> : null}
        </div>
      ) : null}

      {loadState === "ready" && !turns.length ? (
        <div className="turn-timeline-state">
          <Clock3 size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>No Turns reported yet.</span>
        </div>
      ) : null}

      {turns.length ? (
        <ol className="turn-list">
          {turns.map((turn) => (
            <li key={turn.id}><TurnCard turn={turn} itemCount={counts.get(turn.id) ?? 0} now={clock} /></li>
          ))}
        </ol>
      ) : null}

      {unassociatedItems ? (
        <p className="turn-unassociated" role="status">
          {unassociatedItems} {unassociatedItems === 1 ? "Item is" : "Items are"} not associated with an observed Turn yet.
        </p>
      ) : null}
    </section>
  );
}
