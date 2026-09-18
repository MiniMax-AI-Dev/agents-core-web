import { RefreshCw } from "lucide-react";

import { StatusIcon, type StatusKind } from "../../components/StatusIcon";
import type { CoreConnectionState } from "../../lib/connection";
import type { SourceFilesOperations } from "./SourceFilesPanel";

import "./SystemView.css";

function stateKind(state: CoreConnectionState): StatusKind {
  if (state === "ready") return "completed";
  if (state === "failed") return "failed";
  return "running";
}

function stateLabel(state: CoreConnectionState): string {
  if (state === "ready") return "Available";
  if (state === "failed") return "Unavailable";
  return "Checking…";
}

export function safeCoreBaseUrlLabel(value: string): string {
  const candidate = value.trim() || "/v1";
  if (candidate.startsWith("/")) return candidate;
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "Configured Core";
  }
}

interface SystemStatusCard {
  detail: string;
  label: string;
  status: StatusKind;
  value: string;
}

export function SystemView({
  coreState,
  coreBaseUrl,
  selfHostedEnabled,
  vaultCollectionState,
  vaultSupported,
  refreshing,
  onRefresh,
}: {
  coreState: CoreConnectionState;
  coreBaseUrl: string;
  selfHostedEnabled: boolean;
  sourceFilesOperations?: SourceFilesOperations;
  vaultCollectionState: CoreConnectionState;
  vaultSupported: boolean | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const vaultStatus: SystemStatusCard = vaultSupported === false
    ? {
        label: "Vaults",
        status: "interrupted",
        value: "Unavailable",
        detail: "This Core does not expose the Vaults API.",
      }
    : vaultCollectionState === "failed"
      ? {
          label: "Vaults",
          status: "failed",
          value: vaultSupported === true ? "Refresh failed" : "Check failed",
          detail: vaultSupported === true
            ? "The latest Vault catalog request failed."
            : "The Vaults API check failed.",
        }
      : vaultSupported === true && vaultCollectionState === "ready"
        ? {
            label: "Vaults",
            status: "completed",
            value: "Available",
            detail: "Vault catalog loaded.",
          }
        : {
          label: "Vaults",
          status: "running",
          value: "Checking…",
          detail: vaultSupported === true
            ? "Refreshing the Vault catalog."
            : "Checking whether this Core exposes the Vaults API.",
        };

  const cards: SystemStatusCard[] = [
    {
      label: "Core API",
      status: stateKind(coreState),
      value: stateLabel(coreState),
      detail: `${safeCoreBaseUrlLabel(coreBaseUrl)} · ${
        coreState === "ready"
          ? "confirmed by an Agent or Session API request"
          : coreState === "failed"
            ? "Agent and Session API requests failed"
            : "checking Agent and Session APIs"
      }.`,
    },
    vaultStatus,
    {
      label: "Self-hosted",
      status: selfHostedEnabled ? "completed" : "interrupted",
      value: selfHostedEnabled ? "Enabled" : "Disabled",
      detail: selfHostedEnabled
        ? "This Web build allows self-hosted Session creation. Runtime is not verified here."
        : "Self-hosted Session creation is disabled in this Web build.",
    },
    {
      label: "Runtime status",
      status: "interrupted",
      value: "Cannot be pre-checked",
      detail: "Runtime availability is verified when a Session executes.",
    },
  ];

  return (
    <section className="page-section architecture-page system-page" aria-labelledby="system-heading">
      <header className="page-header">
        <h1 id="system-heading">System <span>Connection status</span></h1>
        <div className="page-actions">
          <button
            className="button outline"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={refreshing ? "Refreshing System status" : "Refresh System status"}
          >
            <RefreshCw className={refreshing ? "refresh-spinning" : undefined} size={14} strokeWidth={1.5} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="system-summary" role="list" aria-label="System connection status" aria-live="polite" aria-busy={refreshing}>
        {cards.map((card) => (
          <div className="system-summary-cell" role="listitem" key={card.label}>
            <span><StatusIcon status={card.status} />{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
