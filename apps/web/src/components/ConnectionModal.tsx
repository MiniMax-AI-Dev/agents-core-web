import { ExternalLink, Info, KeyRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  isLocalProxyBaseUrl,
  isValidDirectCoreBaseUrl,
  type CoreConnection,
} from "../lib/connection";
import {
  probeCore,
  type CoreProbeResult,
} from "../lib/core-probe";
import { Modal } from "./Modal";
import "./ConnectionModal.css";

interface ConnectionModalProps {
  connection: CoreConnection;
  open: boolean;
  proxyAuthEnabled?: boolean;
  onClose: () => void;
  onSave: (connection: CoreConnection) => void;
}

type ConnectionMode = "local" | "advanced";

export type ConnectionProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "complete"; result: CoreProbeResult };

const webBaseline = "f7cdf591396529880d80f8211fc7a0f4768fdf46";
const parsarBaseline = "0438880ab21aa16d05cb91a4c7f91cc0abc12358";
const operatorGuideUrl = `https://github.com/MiniMax-AI-Dev/agents-core-web/blob/${webBaseline}/docs/core-connection.md`;
const troubleshootingUrl = `${operatorGuideUrl}#troubleshooting`;
const parsarCoreSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/services/agents-api/README.md#standalone-http-service`;

function initialMode(connection: CoreConnection): ConnectionMode {
  return isLocalProxyBaseUrl(connection.baseUrl) ? "local" : "advanced";
}

function initialAdvancedDraft(connection: CoreConnection): CoreConnection {
  const direct = !isLocalProxyBaseUrl(connection.baseUrl);
  return {
    baseUrl: direct ? connection.baseUrl : "",
    token: direct ? connection.token : "",
  };
}

function resultCopy(result: CoreProbeResult): { title: string; detail: string } {
  switch (result.kind) {
    case "authenticated":
      return {
        title: "Core API authenticated",
        detail: "The read-only Agents API request returned a valid collection.",
      };
    case "invalid_configuration":
      return {
        title: "Core URL blocked",
        detail: "Remote Core URLs must use HTTPS. Plain HTTP is allowed only for an explicit loopback host.",
      };
    case "unauthorized":
      return {
        title: "Authentication failed",
        detail: "Core returned 401 invalid_api_key. Check the server-managed caller key or current-tab token.",
      };
    case "protocol_mismatch":
      return {
        title: "Agents API protocol mismatch",
        detail: "The endpoint did not accept the tested /v1/agents GET contract and OpenAI-Beta: agents=v1 header.",
      };
    case "http_error":
      return {
        title: `Core returned HTTP ${result.httpStatus ?? "error"}`,
        detail: "The basic Agents API read did not succeed. No Core resource was changed.",
      };
    case "unreachable":
      return {
        title: "Core unreachable",
        detail: "The browser could not reach Core. Check the local proxy target, network, or direct-mode CORS policy.",
      };
  }
}

export function ConnectionProbeStatus({ state }: { state: ConnectionProbeState }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className="connection-modal-probe-result loading" role="status" aria-live="polite">
        <strong>Testing Core connection…</strong>
        <p>Sending one read-only Agents API GET request.</p>
      </div>
    );
  }

  const copy = resultCopy(state.result);
  const failed = state.result.kind !== "authenticated";
  return (
    <div
      className={`connection-modal-probe-result ${failed ? "failed" : "succeeded"}`}
      role={failed ? "alert" : "status"}
      aria-live="polite"
    >
      <strong>{copy.title}</strong>
      <p>{copy.detail}</p>
      <small>Execution readiness: Unknown / not verified.</small>
    </div>
  );
}

export function ConnectionModal({
  connection,
  open,
  proxyAuthEnabled = import.meta.env.DEV && __AGENTS_CORE_WEB_DEV_PROXY_AUTH__,
  onClose,
  onSave,
}: ConnectionModalProps) {
  const modeName = useId();
  const [mode, setMode] = useState<ConnectionMode>(() => initialMode(connection));
  const [advancedDraft, setAdvancedDraft] = useState<CoreConnection>(() => initialAdvancedDraft(connection));
  const [probeState, setProbeState] = useState<ConnectionProbeState>({ status: "idle" });
  const probeControllerRef = useRef<AbortController | undefined>(undefined);
  const probeRevisionRef = useRef(0);
  const advancedUrlValid = isValidDirectCoreBaseUrl(advancedDraft.baseUrl);
  const draft = mode === "local"
    ? { baseUrl: "/v1", token: "" }
    : { baseUrl: advancedDraft.baseUrl.trim(), token: advancedDraft.token.trim() };

  useEffect(() => {
    setMode(initialMode(connection));
    setAdvancedDraft(initialAdvancedDraft(connection));
  }, [connection, open]);

  useEffect(() => {
    probeRevisionRef.current += 1;
    probeControllerRef.current?.abort();
    probeControllerRef.current = undefined;
    setProbeState({ status: "idle" });
  }, [advancedDraft.baseUrl, advancedDraft.token, mode, open, proxyAuthEnabled]);

  useEffect(() => () => probeControllerRef.current?.abort(), []);

  const testConnection = async () => {
    const controller = new AbortController();
    probeControllerRef.current?.abort();
    probeControllerRef.current = controller;
    const revision = ++probeRevisionRef.current;
    setProbeState({ status: "loading" });

    try {
      const result = await probeCore({
        baseUrl: draft.baseUrl,
        token: mode === "advanced" ? draft.token : undefined,
        signal: controller.signal,
      });
      if (probeRevisionRef.current !== revision || controller.signal.aborted) return;
      probeControllerRef.current = undefined;
      setProbeState({ status: "complete", result });
    } catch {
      if (probeRevisionRef.current !== revision || controller.signal.aborted) return;
      probeControllerRef.current = undefined;
      setProbeState({
        status: "complete",
        result: { kind: "unreachable", executionReadiness: "unknown" },
      });
    }
  };

  const testDisabled = probeState.status === "loading" || (mode === "advanced" && !advancedUrlValid);
  const applyDisabled = mode === "advanced" && !advancedUrlValid;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect an Agent Core"
      footer={
        <>
          <button className="button outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={applyDisabled}
            onClick={() => onSave(draft)}
          >
            Apply connection
          </button>
        </>
      }
    >
      <fieldset className="connection-modal-modes">
        <legend>Connection mode</legend>
        <label className={mode === "local" ? "selected" : ""}>
          <input
            type="radio"
            name={modeName}
            value="local"
            checked={mode === "local"}
            onChange={() => setMode("local")}
          />
          <span>
            <strong>Local Parsar Core</strong>
            <small>Default · zero input</small>
          </span>
        </label>
        <label className={mode === "advanced" ? "selected" : ""}>
          <input
            type="radio"
            name={modeName}
            value="advanced"
            checked={mode === "advanced"}
            onChange={() => setMode("advanced")}
          />
          <span>
            <strong>Other compatible Core</strong>
            <small>Advanced</small>
          </span>
        </label>
      </fieldset>

      {mode === "local" ? (
        <section className="connection-modal-local" aria-labelledby={`${modeName}-local-title`}>
          <div className="connection-guide-header">
            <KeyRound size={15} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <strong id={`${modeName}-local-title`}>Local `/v1` proxy</strong>
              <p>The Agents API base is fixed by this application. No URL is required.</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>API base</dt>
              <dd><code>/v1</code></dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>{proxyAuthEnabled ? "Server-managed key detected" : "Server-managed key not detected"}</dd>
            </div>
          </dl>
          <p className="connection-modal-local-note">
            {proxyAuthEnabled
              ? "The Vite proxy supplies its key server-side. No bearer credential is exposed to browser JavaScript."
              : "Configure the local proxy token file and restart Web. Local mode will not request a browser token."}
          </p>
        </section>
      ) : (
        <div className="form-stack connection-modal-advanced">
          <label className="field">
            <span>Compatible Core base URL</span>
            <input
              value={advancedDraft.baseUrl}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, baseUrl: event.target.value }))}
              placeholder="https://core.example/v1"
              inputMode="url"
              spellCheck={false}
              aria-invalid={Boolean(advancedDraft.baseUrl) && !advancedUrlValid}
              aria-describedby={
                `${modeName}-advanced-url-help${advancedDraft.baseUrl && !advancedUrlValid
                  ? ` ${modeName}-advanced-url-error`
                  : ""}`
              }
            />
            <small id={`${modeName}-advanced-url-help`}>
              Remote Core access requires HTTPS. Plain HTTP is allowed only for an explicit loopback host.
              The Core must allow this Web origin, GET/POST methods, Authorization, and OpenAI-Beta through CORS.
            </small>
            {advancedDraft.baseUrl && !advancedUrlValid ? (
              <small id={`${modeName}-advanced-url-error`} className="field-error" role="alert">
                Enter an HTTPS URL, or an HTTP loopback URL, without credentials, query parameters, or fragments.
              </small>
            ) : null}
          </label>
          <label className="field">
            <span className="field-label">
              Bearer token
              <span className="field-optional">Current tab only</span>
            </span>
            <input
              type="password"
              value={advancedDraft.token}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, token: event.target.value }))}
              placeholder="Compatible Core caller token"
              autoComplete="off"
              aria-describedby={`${modeName}-advanced-token-help`}
            />
            <small id={`${modeName}-advanced-token-help`}>
              Direct-mode fallback only. The token is kept in this tab&apos;s sessionStorage, never localStorage,
              URLs, or server-managed proxy configuration.
            </small>
          </label>
        </div>
      )}

      <section className="connection-modal-test" aria-labelledby={`${modeName}-test-title`}>
        <div>
          <strong id={`${modeName}-test-title`}>Connection test</strong>
          <p>Checks authenticated Agents API access with one GET. It never creates an Agent, Session, Turn, or Item.</p>
        </div>
        <button className="button outline" type="button" disabled={testDisabled} onClick={() => void testConnection()}>
          {probeState.status === "loading" ? "Testing…" : "Test connection"}
        </button>
      </section>
      <ConnectionProbeStatus state={probeState} />

      <section className="connection-guide" aria-labelledby={`${modeName}-guide-title`}>
        <div className="connection-guide-header">
          <Info size={15} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong id={`${modeName}-guide-title`}>Operator-owned setup</strong>
            <p>
              Core authentication and execution stay outside this browser. Use the operator guide for proxy,
              caller-key, daemon, and provider setup.
            </p>
          </div>
        </div>
        <div className="connection-guide-links">
          <a className="connection-guide-link" href={operatorGuideUrl} target="_blank" rel="noreferrer">
            Connection guide
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
          </a>
          <a className="connection-guide-link" href={troubleshootingUrl} target="_blank" rel="noreferrer">
            Troubleshooting
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
          </a>
          <a className="connection-guide-link" href={parsarCoreSetupUrl} target="_blank" rel="noreferrer">
            Parsar Core setup
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
          </a>
        </div>
      </section>
      <div className="notice neutral">
        <Info size={14} strokeWidth={1.5} aria-hidden="true" />
        Execution readiness remains Unknown / not verified. HTTP access does not prove a daemon, model, or provider is ready.
      </div>
    </Modal>
  );
}
