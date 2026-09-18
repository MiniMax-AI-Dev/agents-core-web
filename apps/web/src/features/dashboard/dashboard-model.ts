import type {
  AgentSession,
  SavedAgent,
  SessionStatus,
  TokenUsage,
} from "@agents-core-web/agents-client";

import { isSupportedSelfHostedEnvironmentProjection } from "../sessions/environment/environment-launcher";
import { isSupportedOpenAIHostedEnvironmentProjection } from "../sessions/environment/environment-state";

export type DashboardCollectionState = "connecting" | "ready" | "failed";
export type DashboardEnvironmentProfile = "none" | "self_hosted" | "openai_hosted" | "unsupported";
export type DashboardSessionStatus = SessionStatus | "unknown";

export interface DashboardStatusCounts {
  idle: number;
  in_progress: number;
  requires_action: number;
  failed: number;
  unknown: number;
}

export interface DashboardSessionRow {
  id: string | null;
  title: string;
  agentLabel: string;
  model: string;
  status: DashboardSessionStatus;
  environmentProfile: DashboardEnvironmentProfile;
  lastActiveAt: number | null;
  totalTokens: number | null;
}

export interface DashboardUsageSummary {
  reportedSessionCount: number;
  totalTokens: number | null;
}

export interface DashboardSnapshot {
  loadedAgentCount: number;
  loadedSessionCount: number;
  statusCounts: DashboardStatusCounts;
  usage: DashboardUsageSummary;
  attentionSessions: DashboardSessionRow[];
  recentSessions: DashboardSessionRow[];
}

const sessionStatuses = new Set<SessionStatus>([
  "idle",
  "in_progress",
  "requires_action",
  "failed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function canonicalUsage(value: unknown): TokenUsage | null {
  const usage = record(value);
  const inputDetails = record(usage?.input_tokens_details);
  const outputDetails = record(usage?.output_tokens_details);
  if (!usage || !inputDetails || !outputDetails) return null;
  if (
    safeNonNegativeInteger(usage.input_tokens) === null ||
    safeNonNegativeInteger(usage.output_tokens) === null ||
    safeNonNegativeInteger(usage.total_tokens) === null ||
    safeNonNegativeInteger(inputDetails.cached_tokens) === null ||
    safeNonNegativeInteger(outputDetails.reasoning_tokens) === null
  ) return null;
  return value as TokenUsage;
}

function canonicalTimestamp(value: unknown): number | null {
  const seconds = safeNonNegativeInteger(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : seconds;
}

function canonicalStatus(value: unknown): DashboardSessionStatus {
  return typeof value === "string" && sessionStatuses.has(value as SessionStatus)
    ? value as SessionStatus
    : "unknown";
}

export function dashboardEnvironmentProfile(value: unknown): DashboardEnvironmentProfile {
  const environment = record(value);
  if (!environment) return "unsupported";
  if (environment.type === "none") return "none";
  if (
    environment.type === "self_hosted" &&
    isSupportedSelfHostedEnvironmentProjection(
      environment.id,
      environment.remote_url,
      environment.workspace_directory,
      environment.capability_directories,
    )
  ) return "self_hosted";
  if (isSupportedOpenAIHostedEnvironmentProjection(environment)) return "openai_hosted";
  return "unsupported";
}

function sessionTitle(value: unknown): string {
  const session = record(value);
  const metadata = record(session?.metadata);
  const agent = record(session?.agent);
  return nonEmptyString(metadata?.title)
    ?? nonEmptyString(agent?.name)
    ?? "Untitled Session";
}

function sessionAgentLabel(value: unknown): string {
  const session = record(value);
  const agent = record(session?.agent);
  return nonEmptyString(agent?.name)
    ?? nonEmptyString(agent?.model)
    ?? "Unavailable";
}

function sessionModel(value: unknown): string {
  const session = record(value);
  const agent = record(session?.agent);
  return nonEmptyString(agent?.model) ?? "Unavailable";
}

function toSessionRow(session: AgentSession): DashboardSessionRow {
  const usage = canonicalUsage(session.usage);
  return {
    id: nonEmptyString(session.id),
    title: sessionTitle(session),
    agentLabel: sessionAgentLabel(session),
    model: sessionModel(session),
    status: canonicalStatus(session.status),
    environmentProfile: dashboardEnvironmentProfile(session.environment),
    lastActiveAt: canonicalTimestamp(session.last_active_at),
    totalTokens: usage?.total_tokens ?? null,
  };
}

function compareSessionRows(left: DashboardSessionRow, right: DashboardSessionRow): number {
  if (left.lastActiveAt === null && right.lastActiveAt !== null) return 1;
  if (left.lastActiveAt !== null && right.lastActiveAt === null) return -1;
  if (left.lastActiveAt !== right.lastActiveAt) {
    return (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0);
  }
  return (left.id ?? "").localeCompare(right.id ?? "");
}

export function buildDashboardSnapshot(
  agents: readonly SavedAgent[],
  sessions: readonly AgentSession[],
  recentLimit = 8,
  attentionLimit = 5,
): DashboardSnapshot {
  const statusCounts: DashboardStatusCounts = {
    idle: 0,
    in_progress: 0,
    requires_action: 0,
    failed: 0,
    unknown: 0,
  };
  const rows = sessions.map((session) => {
    const row = toSessionRow(session);
    statusCounts[row.status] += 1;
    return row;
  }).sort(compareSessionRows);

  let reportedSessionCount = 0;
  let totalTokens = 0;
  let totalTokensKnown = true;
  for (const session of sessions) {
    const usage = canonicalUsage(session.usage);
    if (!usage) continue;
    reportedSessionCount += 1;
    const nextTotal = totalTokens + usage.total_tokens;
    if (!Number.isSafeInteger(nextTotal)) totalTokensKnown = false;
    else totalTokens = nextTotal;
  }

  return {
    loadedAgentCount: agents.length,
    loadedSessionCount: sessions.length,
    statusCounts,
    usage: {
      reportedSessionCount,
      totalTokens: reportedSessionCount > 0 && totalTokensKnown ? totalTokens : null,
    },
    attentionSessions: rows
      .filter((session) => session.status === "requires_action" || session.status === "failed")
      .slice(0, Math.max(0, attentionLimit)),
    recentSessions: rows.slice(0, Math.max(0, recentLimit)),
  };
}

export function dashboardStatusLabel(status: DashboardSessionStatus): string {
  switch (status) {
    case "idle": return "Idle";
    case "in_progress": return "In progress";
    case "requires_action": return "Requires action";
    case "failed": return "Failed";
    case "unknown": return "Unavailable";
  }
}

export function dashboardEnvironmentLabel(profile: DashboardEnvironmentProfile): string {
  switch (profile) {
    case "none": return "None";
    case "self_hosted": return "Self-hosted profile";
    case "openai_hosted": return "Managed hosted";
    case "unsupported": return "Unavailable";
  }
}

export function formatDashboardTimestamp(value: number | null): string {
  const seconds = canonicalTimestamp(value);
  if (seconds === null) return "Unknown";
  return `${new Date(seconds * 1_000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
