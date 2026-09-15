import { ExternalLink, Info, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { isLocalProxyBaseUrl, type CoreConnection } from "../lib/connection";
import { Modal } from "./Modal";

interface ConnectionModalProps {
  connection: CoreConnection;
  open: boolean;
  proxyAuthEnabled?: boolean;
  onClose: () => void;
  onSave: (connection: CoreConnection) => void;
}

const parsarBaseline = "0438880ab21aa16d05cb91a4c7f91cc0abc12358";
const coreSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/services/agents-api/README.md#standalone-http-service`;
const executorSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/services/agents-api/README.md#internal-execution-device-connection`;

export function ConnectionModal({
  connection,
  open,
  proxyAuthEnabled = import.meta.env.DEV && __AGENTS_CORE_WEB_DEV_PROXY_AUTH__,
  onClose,
  onSave,
}: ConnectionModalProps) {
  const [draft, setDraft] = useState(connection);
  const localProxyDraft = isLocalProxyBaseUrl(draft.baseUrl);
  const proxyOwnsDraft = proxyAuthEnabled && localProxyDraft;

  useEffect(() => setDraft(connection), [connection, open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect an Agent core"
      footer={
        <>
          <button className="button outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={() => onSave(draft)}>
            Apply connection
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span>Agents API base URL</span>
          <input
            value={draft.baseUrl}
            onChange={(event) => setDraft((value) => ({ ...value, baseUrl: event.target.value }))}
            placeholder="/v1"
            spellCheck={false}
          />
          <small>
            Use `/v1` with the local same-origin proxy. A direct URL requires a CORS-enabled compatible Core;
            never enter a daemon socket URL.
          </small>
        </label>
        <label className="field">
          <span className="field-label">
            Bearer token
            <span className="field-optional">{proxyOwnsDraft ? "Server key active" : "Current-tab fallback"}</span>
          </span>
          <input
            type="password"
            value={draft.token}
            onChange={(event) => setDraft((value) => ({ ...value, token: event.target.value }))}
            placeholder={proxyOwnsDraft ? "Using the server-managed Core key" : "Execution tenant token"}
            autoComplete="off"
          />
          <small>
            {proxyOwnsDraft
              ? "The local /v1 proxy supplies its server-side key. Manual auth is only for a CORS-enabled compatible Core."
              : localProxyDraft
                ? "Manual fallback only: held in this tab's sessionStorage, never localStorage. Configure the proxy token file to keep the key server-side."
                : "Direct fallback only: held in this tab's sessionStorage, never localStorage, and usable only with a CORS-enabled compatible Core."}
          </small>
        </label>
      </div>
      <section className={`connection-guide ${proxyOwnsDraft ? "connected" : ""}`} aria-labelledby="core-key-guide-title">
        <div className="connection-guide-header">
          <KeyRound size={15} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong id="core-key-guide-title">
              {proxyOwnsDraft
                ? "Server-managed Core key active"
                : localProxyDraft
                  ? "Connect the local proxy key"
                  : "Use a current-tab token"}
            </strong>
            <p>
              {proxyOwnsDraft
                ? "Requests through /v1 receive the execution-tenant bearer on the server."
                : localProxyDraft
                  ? "Configure the local proxy to read the bearer without exposing it to browser JavaScript."
                  : "A direct URL bypasses the local proxy and its key file."}
            </p>
          </div>
        </div>
        <ol>
          <li>
            Generate the plaintext caller key with <code>openssl rand -hex 32</code>; Core does not issue it
            automatically.
          </li>
          <li>
            Put its SHA-256 digest plus the tenant, organization, project, and subject binding in Core{" "}
            <code>keys.json</code>.
          </li>
          <li>
            Start Core with <code>AGENTS_API_KEYS_FILE</code>; {localProxyDraft ? (
              <>
                point Web at the plaintext file with <code>AGENTS_API_PROXY_TOKEN_FILE</code>.
              </>
            ) : (
              <>paste the plaintext caller bearer above. The proxy token file does not apply to direct URLs.</>
            )}
          </li>
          <li>
            To chat, enable <code>AGENTS_API_DAEMON_WS_URL</code> and connect a same-tenant{" "}
            <code>parsar-daemon</code> executor.
          </li>
        </ol>
        <div className="connection-guide-links">
          <a className="connection-guide-link" href={coreSetupUrl} target="_blank" rel="noreferrer">
            Agent Core setup
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
          </a>
          <a className="connection-guide-link" href={executorSetupUrl} target="_blank" rel="noreferrer">
            Executor setup
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
          </a>
        </div>
      </section>
      <div className="notice neutral">
        <Info size={14} strokeWidth={1.5} aria-hidden="true" />
        Parsar Core runs independently. This Web only connects through the Agents HTTP/SSE protocol.
      </div>
    </Modal>
  );
}
