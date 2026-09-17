import {
  Bot,
  Clock3,
  FileJson,
  Search,
  Settings2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type {
  AgentSession,
  AgentTurn,
  SessionItem,
} from "@agents-core-web/agents-client";

import { MessageMarkdown } from "../../../components/MessageMarkdown";
import { StatusIcon, type StatusKind } from "../../../components/StatusIcon";
import { ApplyPatchDiffViewer } from "../items/ApplyPatchDiffViewer";
import { parseParsarApplyPatch } from "../items/apply-patch";
import type { SessionDetailState } from "../SessionsView";
import type { TurnTimelineLoadState } from "../turns/TurnTimeline";
import {
  buildTraceModel,
  filterTraceModel,
  type TraceGroup,
  type TraceRow,
  type TraceValue,
} from "./trace-model";

interface TraceViewProps {
  id: string;
  labelledBy: string;
  session: AgentSession;
  turns: AgentTurn[];
  items: SessionItem[];
  detailState: SessionDetailState;
  detailError: string | null;
  turnState: TurnTimelineLoadState;
  turnError: string | null;
}

type DetailTab = "summary" | "preview" | "payload" | "result" | "schema" | "timing" | "raw";

interface DetailTabDefinition {
  id: DetailTab;
  label: string;
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "Unavailable";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unavailable";
  }
}

function formatDuration(milliseconds: number): string {
  const value = Math.max(0, milliseconds);
  if (value < 1_000) return `${value.toLocaleString("en-US")} ms`;
  const seconds = value / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 && !Number.isInteger(seconds) ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatTimestamp(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0) return "Unknown";
  const timestamp = new Date(seconds * 1_000);
  return Number.isNaN(timestamp.getTime())
    ? "Unknown"
    : `${timestamp.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function itemStatusKind(status: TraceRow["status"]): StatusKind {
  if (status === "in_progress") return "running";
  if (status === "failed") return "failed";
  if (status === "incomplete") return "interrupted";
  return status === "completed" ? "completed" : "queued";
}

function turnStatusKind(status: unknown): StatusKind | null {
  if (status === "in_progress" || status === "waiting") return "running";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  return status === "queued" ? "queued" : null;
}

function titleCase(value: unknown): string {
  return typeof value === "string"
    ? value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase())
    : "Unknown";
}

function rowIcon(row: TraceRow): ReactNode {
  if (row.kind === "configured_instructions") return <Settings2 size={14} strokeWidth={1.5} aria-hidden="true" />;
  if (row.kind === "user_message") return <UserRound size={14} strokeWidth={1.5} aria-hidden="true" />;
  if (row.kind === "assistant_message") return <Bot size={14} strokeWidth={1.5} aria-hidden="true" />;
  if (row.kind === "tool_call" || row.kind === "tool_result") return <Wrench size={14} strokeWidth={1.5} aria-hidden="true" />;
  return <FileJson size={14} strokeWidth={1.5} aria-hidden="true" />;
}

function valueLabel<T>(value: TraceValue<T>, format: (available: T) => string = String): string {
  if (value.state === "available" && value.value !== null) return format(value.value);
  return value.state === "unknown" ? "Unknown" : "Unavailable";
}

function rowExcerpt(row: TraceRow): string {
  if (row.text.state === "available" && row.text.value) return row.text.value;
  if (row.tool?.payload.state === "available") return "Payload available";
  if (row.tool?.result.state === "available") return "Result available";
  return row.text.state === "unknown" ? "Unknown" : "No preview available";
}

function applyPatchItem(row: TraceRow): SessionItem | null {
  if (row.kind !== "tool_call" || row.tool?.type !== "function_call") return null;
  return row.sourceItems.find((candidate) => candidate.type === "function_call" && candidate.name === "apply_patch") ?? null;
}

function traceTabs(row: TraceRow): DetailTabDefinition[] {
  const tabs: DetailTabDefinition[] = [{ id: "summary", label: "Summary" }];
  if (row.text.state === "available" || applyPatchItem(row)) tabs.push({ id: "preview", label: "Preview" });
  if (row.tool) {
    tabs.push({ id: "payload", label: "Payload" }, { id: "result", label: "Result" });
    if (row.tool.configuredFunction.state === "available") tabs.push({ id: "schema", label: "Schema" });
  }
  if (row.kind !== "configured_instructions") tabs.push({ id: "timing", label: "Timing" });
  tabs.push({ id: "raw", label: "Raw" });
  return tabs;
}

function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? []);
  const index = tabs.indexOf(event.currentTarget);
  if (index < 0) return;
  const target = event.key === "ArrowRight"
    ? tabs[(index + 1) % tabs.length]
    : event.key === "ArrowLeft"
      ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs[tabs.length - 1]
          : null;
  if (!target) return;
  event.preventDefault();
  target.click();
  target.focus();
}

function ValuePanel({ value }: { value: TraceValue<unknown> }) {
  if (value.state !== "available") {
    return <p className="trace-detail-unavailable">{value.state === "unknown" ? "Unknown" : "Unavailable from the current Core contract."}</p>;
  }
  return <pre className="trace-detail-code">{pretty(value.value)}</pre>;
}

function TraceSummaryPanel({ row, group, session }: { row: TraceRow; group: TraceGroup; session: AgentSession }) {
  const rawUsage = group.turn?.usage as unknown;
  const turnUsage = rawUsage !== null && typeof rawUsage === "object"
    && Number.isSafeInteger((rawUsage as Record<string, unknown>).input_tokens)
    && Number.isSafeInteger((rawUsage as Record<string, unknown>).output_tokens)
    && Number.isSafeInteger((rawUsage as Record<string, unknown>).total_tokens)
    ? rawUsage as AgentTurn["usage"]
    : null;
  const configuredModel = typeof session.agent.model === "string" ? session.agent.model : "Unknown";
  return (
    <div className="trace-detail-summary">
      <dl>
        <div><dt>Source</dt><dd>{row.kind === "configured_instructions" ? "Agent configuration snapshot" : "Durable Item snapshot"}</dd></div>
        <div><dt>Status</dt><dd>{row.status ? titleCase(row.status) : "Not applicable"}</dd></div>
        <div><dt>Group</dt><dd>{group.title}</dd></div>
        <div><dt>Configured model</dt><dd><code>{configuredModel}</code></dd></div>
        <div><dt>Item timing</dt><dd>Unavailable</dd></div>
        {row.durationMs.state === "available" && row.durationMs.value !== null ? (
          <div><dt>Tool-reported duration</dt><dd>{formatDuration(row.durationMs.value)}</dd></div>
        ) : null}
      </dl>
      {turnUsage ? (
        <section className="trace-detail-usage" aria-label="Turn-scoped token usage">
          <strong>Turn-scoped tokens</strong>
          <dl>
            <div><dt>Input</dt><dd>{turnUsage.input_tokens.toLocaleString("en-US")}</dd></div>
            <div><dt>Output</dt><dd>{turnUsage.output_tokens.toLocaleString("en-US")}</dd></div>
            <div><dt>Total</dt><dd>{turnUsage.total_tokens.toLocaleString("en-US")}</dd></div>
          </dl>
        </section>
      ) : null}
      <p className="trace-detail-boundary">This view reports Core resource scope. It does not infer a model span, provider, request step, or subagent relationship.</p>
    </div>
  );
}

function TracePreviewPanel({ row }: { row: TraceRow }) {
  if (applyPatchItem(row)) return <ApplyPatchPreview row={row} />;
  if (row.text.state !== "available" || row.text.value === null) return <p className="trace-detail-unavailable">Unavailable from the current Core contract.</p>;
  if (row.kind === "assistant_message") return <div className="trace-detail-preview"><MessageMarkdown content={row.text.value} /></div>;
  return <pre className="trace-detail-text">{row.text.value}</pre>;
}

function TraceTimingPanel({ row, group }: { row: TraceRow; group: TraceGroup }) {
  return (
    <div className="trace-detail-timing">
      <dl>
        <div><dt>Turn started</dt><dd>{formatTimestamp(group.turn?.started_at)}</dd></div>
        <div><dt>Turn completed</dt><dd>{formatTimestamp(group.turn?.completed_at)}</dd></div>
        <div><dt>Turn wall clock</dt><dd>{valueLabel(group.turnWallClockDurationMs, formatDuration)}</dd></div>
        <div><dt>Item started</dt><dd>Unavailable</dd></div>
        <div><dt>Item completed</dt><dd>Unavailable</dd></div>
        <div><dt>Tool-reported duration</dt><dd>{valueLabel(row.durationMs, formatDuration)}</dd></div>
      </dl>
      <p>Turn timestamps are server resources. Tool duration has no public absolute start, so it is not positioned on a time-scaled waterfall.</p>
    </div>
  );
}

function ApplyPatchPreview({ row }: { row: TraceRow }) {
  const item = applyPatchItem(row);
  const patch = item ? parseParsarApplyPatch(item.arguments) : null;
  if (!item || !patch) return null;
  const result = row.tool?.result.state === "available" ? row.tool.result.value : undefined;
  const effectiveItem = row.status ? { ...item, status: row.status } : item;
  return <ApplyPatchDiffViewer item={effectiveItem} patch={patch} result={result} />;
}

function TraceDetailPanel({
  row,
  group,
  session,
  activeTab,
}: {
  row: TraceRow;
  group: TraceGroup;
  session: AgentSession;
  activeTab: DetailTab;
}) {
  if (activeTab === "summary") return <TraceSummaryPanel row={row} group={group} session={session} />;
  if (activeTab === "preview") return <TracePreviewPanel row={row} />;
  if (activeTab === "payload") return <ValuePanel value={row.tool?.payload ?? { state: "unavailable", value: null }} />;
  if (activeTab === "result") return <ValuePanel value={row.tool?.result ?? { state: "unavailable", value: null }} />;
  if (activeTab === "schema") return <ValuePanel value={row.tool?.configuredFunction ?? { state: "unavailable", value: null }} />;
  if (activeTab === "timing") return <TraceTimingPanel row={row} group={group} />;
  return <pre className="trace-detail-code">{pretty(row.safeRaw.length === 1 ? row.safeRaw[0] : row.safeRaw)}</pre>;
}

export function TraceView({
  id,
  labelledBy,
  session,
  turns,
  items,
  detailState,
  detailError,
  turnState,
  turnError,
}: TraceViewProps) {
  const [query, setQuery] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("summary");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const model = useMemo(() => buildTraceModel({ turns, items, agent: session.agent }), [items, session.agent, turns]);
  const filtered = useMemo(() => filterTraceModel(model, query), [model, query]);
  const selectedRow = selectedRowId ? model.rows.find((row) => row.id === selectedRowId) ?? null : null;
  const selectedGroup = selectedRow ? model.groups.find((group) => group.id === selectedRow.groupId) ?? null : null;
  const tabs = selectedRow ? traceTabs(selectedRow) : [];

  useEffect(() => {
    setQuery("");
    setSelectedRowId(null);
    setActiveTab("summary");
  }, [session.id]);

  useEffect(() => {
    if (!selectedRow) return;
    setActiveTab((current) => traceTabs(selectedRow).some((tab) => tab.id === current) ? current : "summary");
  }, [selectedRow]);

  useEffect(() => {
    if (!selectedRow) return;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedRow?.id]);

  const selectRow = (row: TraceRow, trigger: HTMLButtonElement) => {
    lastTriggerRef.current = trigger;
    setSelectedRowId(row.id);
    setActiveTab("summary");
  };

  const closeDetails = () => {
    setSelectedRowId(null);
    const trigger = lastTriggerRef.current;
    window.requestAnimationFrame(() => {
      const fallback = searchInputRef.current?.isConnected
        ? searchInputRef.current
        : document.getElementById(labelledBy);
      const target = trigger?.isConnected ? trigger : fallback;
      target?.focus({ preventScroll: true });
    });
  };

  const orderedRows = filtered.rows.filter((row) => row.kind !== "configured_instructions");
  const sequenceColumns = Math.max(orderedRows.length, 1);
  const sequenceStyle = {
    gridTemplateColumns: `50px repeat(${sequenceColumns}, minmax(18px, 1fr))`,
    minWidth: `${50 + sequenceColumns * 20}px`,
  } satisfies CSSProperties;
  const detailPanelId = `${id}-detail-panel`;
  const detailContentId = `${id}-detail-content`;
  const activeDetailTabId = `${id}-detail-tab-${activeTab}`;
  const knownTime = model.summary.turnsWithKnownWallClock
    ? `${formatDuration(model.summary.knownTurnWallClockDurationMs)}${model.summary.turnsWithUnknownWallClock ? ` · ${model.summary.turnsWithUnknownWallClock} unknown` : ""}`
    : model.summary.turnCount ? "Unknown" : "Unavailable";

  return (
    <section
      className={`trace-workbench ${selectedRow ? "has-detail" : ""}`}
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        if (event.key === "Escape" && selectedRow) {
          event.stopPropagation();
          closeDetails();
        }
      }}
    >
      <header className="trace-toolbar">
        <dl className="trace-metrics">
          <div><dt>Known Turn time</dt><dd>{knownTime}</dd></div>
          <div><dt>Turns</dt><dd>{model.summary.turnCount}</dd></div>
          <div><dt>Tool calls</dt><dd>{model.summary.toolCallCount}</dd></div>
        </dl>
        <label className="trace-search">
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Search trace</span>
          <input ref={searchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trace" />
        </label>
      </header>

      <section className="trace-order-overview" aria-label="Durable execution order">
        <header>
          <strong>Durable order</strong>
          <span>Equal-width sequence · not time-scaled</span>
        </header>
        <div className="trace-order-scroll">
          <div className="trace-order-grid" style={sequenceStyle}>
            {(["input", "model", "tools"] as const).map((lane, laneIndex) => (
              <Fragment key={lane}>
                <span style={{ gridColumn: 1, gridRow: laneIndex + 1 }}>{lane === "tools" ? "Tools" : lane.charAt(0).toUpperCase() + lane.slice(1)}</span>
                {orderedRows.map((row, index) => row.lane === lane ? (
                <button
                  type="button"
                  className={`trace-order-item trace-order-item-${lane}`}
                  style={{ gridColumn: index + 2, gridRow: laneIndex + 1 }}
                  aria-label={`Open ${row.label.toLowerCase()} trace item: ${row.title}`}
                  aria-pressed={selectedRow?.id === row.id}
                  aria-expanded={selectedRow?.id === row.id}
                  aria-controls={detailPanelId}
                  title={`${row.label} · ${row.title}`}
                  key={row.id}
                  onClick={(event) => selectRow(row, event.currentTarget)}
                />
                ) : null)}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <div className="trace-contract-note" role="note">
        <Clock3 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>Per-item timing is unavailable. The overview preserves Core order and does not imply model, tool, or first-token timing.</span>
      </div>

      {turnState === "loading" || detailState === "loading" ? (
        <p className="trace-load-state" role="status">Loading complete durable Turn and Item history…</p>
      ) : null}
      {turnState === "failed" ? (
        <div className="trace-load-error" role="alert"><strong>Turn history is incomplete</strong><span>{turnError || "The Core Turn read failed."}</span></div>
      ) : null}
      {detailState === "failed" ? (
        <div className="trace-load-error" role="alert"><strong>Item history is incomplete</strong><span>{detailError || "The Core Item read failed."}</span></div>
      ) : null}

      <div className="trace-workspace">
        <div className="trace-ledger" aria-label="Trace items">
          {filtered.groups.length ? filtered.groups.map((group) => {
            const groupStatusKind = group.turn ? turnStatusKind(group.turn.status) : null;
            return (
            <section className={`trace-group trace-group-${group.kind}`} key={group.id} aria-labelledby={`${group.id}-title`}>
              <header className="trace-group-header">
                <strong id={`${group.id}-title`}>{group.title}</strong>
                {group.turn && groupStatusKind ? <StatusIcon status={groupStatusKind} title={`Turn status: ${titleCase(group.turn.status)}`} /> : null}
                {group.turn ? <span>{titleCase(group.turn.status)}</span> : null}
                <span className="trace-group-duration">{valueLabel(group.turnWallClockDurationMs, formatDuration)}</span>
              </header>
              {group.rows.length ? (
                <ol>
                  {group.rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={`trace-ledger-row trace-ledger-row-${row.lane}`}
                        aria-pressed={selectedRow?.id === row.id}
                        aria-expanded={selectedRow?.id === row.id}
                        aria-controls={detailPanelId}
                        onClick={(event) => selectRow(row, event.currentTarget)}
                      >
                        <span className={`trace-row-icon trace-row-icon-${row.lane}`}>{rowIcon(row)}</span>
                        <span className="trace-row-label">{row.label}</span>
                        <span className="trace-row-copy">
                          <strong>{row.title}</strong>
                          <small>{rowExcerpt(row)}</small>
                        </span>
                        {row.status ? <StatusIcon status={itemStatusKind(row.status)} title={`Item status: ${titleCase(row.status)}`} /> : null}
                        <span className="trace-row-duration">{valueLabel(row.durationMs, formatDuration)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : <p className="trace-group-empty">No durable Items reported for this Turn.</p>}
            </section>
            );
          }) : (
            <div className="trace-empty"><Search size={18} strokeWidth={1.5} aria-hidden="true" /><p>No trace rows match this search.</p></div>
          )}
        </div>

        {selectedRow && selectedGroup ? (
          <aside className="trace-detail" id={detailPanelId} aria-label="Trace item details">
            <header className="trace-detail-header">
              <span className={`trace-row-label trace-row-label-${selectedRow.lane}`}>{selectedRow.label}</span>
              <div><strong>{selectedRow.title}</strong><small>{selectedGroup.title}</small></div>
              <button ref={closeButtonRef} className="icon-button ghost" type="button" aria-label="Close trace details" onClick={closeDetails}>
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </header>
            <div className="trace-detail-tabs" role="tablist" aria-label="Trace detail view">
              {tabs.map((tab) => (
                <button
                  id={`${id}-detail-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-controls={detailContentId}
                  aria-selected={activeTab === tab.id}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={onTabKeyDown}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              className="trace-detail-content"
              id={detailContentId}
              role="tabpanel"
              aria-labelledby={activeDetailTabId}
              tabIndex={0}
            >
              <TraceDetailPanel row={selectedRow} group={selectedGroup} session={session} activeTab={activeTab} />
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
