import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { AgentCoreError } from "@agents-core-web/agents-client";

import { Modal } from "../../components/Modal";

export const credentialStorageUnavailableMessage = "Credential encryption is not configured on this Core. Configure AGENTS_API_CREDENTIAL_KEY_FILE and restart Core before creating or replacing a token.";

export function safeCredentialMutationError(error: unknown): string {
  if (error instanceof AgentCoreError) {
    if (error.status === 503 && error.code === "credential_write_failed") {
      return credentialStorageUnavailableMessage;
    }
    if (error.status === 401) return "Core authentication failed. The Credential was not confirmed.";
    if (error.status === 404) return "The Vault or Credential is no longer available. Refresh before trying again.";
    if (error.status === 413) return "The Credential request exceeded Core's accepted size.";
    if (error.status === 400) return "Core rejected the Credential fields. Check the name, exact HTTPS URL, and token format.";
  }
  return "The Credential write outcome was not confirmed. The catalog was refreshed; review it before explicitly trying again.";
}

function executableCredentialURL(value: string): boolean {
  if (
    value !== value.trim() || /[\u0000-\u0020\u007f\\]/u.test(value) ||
    value.includes("?") || value.includes("#")
  ) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function executableBearerToken(value: string): boolean {
  return /^[A-Za-z0-9\-._~+/]+=*$/.test(value);
}

export function CredentialDialog({
  credentialName,
  open,
  onClose,
  onCreate,
  onReplace,
}: {
  credentialName?: string;
  open: boolean;
  onClose: () => void;
  onCreate?: (name: string, serverURL: string, token: string) => Promise<void>;
  onReplace?: (token: string) => Promise<void>;
}) {
  const formId = useId();
  const tokenRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [serverURL, setServerURL] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const replacing = Boolean(onReplace);

  useEffect(() => {
    if (!open) {
      if (tokenRef.current) tokenRef.current.value = "";
      return;
    }
    if (tokenRef.current) tokenRef.current.value = "";
    setName("");
    setServerURL("");
    setFieldError(null);
    setRequestError(null);
  }, [open, replacing]);

  const close = () => {
    if (tokenRef.current) tokenRef.current.value = "";
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const tokenInput = tokenRef.current;
    const token = tokenInput?.value ?? "";
    const trimmedName = name.trim();
    if (!executableBearerToken(token)) {
      setFieldError("Enter a non-empty RFC 6750 bearer token. Whitespace and other opaque storage-only values cannot execute in the current runtime.");
      return;
    }
    if (!replacing && (!trimmedName || new TextEncoder().encode(trimmedName).length > 256)) {
      setFieldError("Credential name must contain 1 to 256 UTF-8 bytes.");
      return;
    }
    if (!replacing && !executableCredentialURL(serverURL)) {
      setFieldError("Enter an exact HTTPS MCP URL without credentials, query parameters, fragments, whitespace, or backslashes.");
      return;
    }

    setSubmitting(true);
    setFieldError(null);
    setRequestError(null);
    try {
      const request = replacing
        ? onReplace?.(token)
        : onCreate?.(trimmedName, serverURL, token);
      // fetch receives its immutable request body synchronously. Clear the only
      // DOM-held copy immediately; retries always require deliberate re-entry.
      if (tokenInput) tokenInput.value = "";
      await request;
      onClose();
    } catch (error) {
      if (tokenInput) tokenInput.value = "";
      setRequestError(safeCredentialMutationError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={replacing ? `Replace token · ${credentialName ?? "Credential"}` : "Add static bearer Credential"}
      footer={(
        <>
          <button className="button outline" type="button" onClick={close} disabled={submitting}>Cancel</button>
          <button className="button primary" type="submit" form={formId} disabled={submitting}>
            {submitting ? "Saving…" : replacing ? "Replace token" : "Create Credential"}
          </button>
        </>
      )}
    >
      <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
        {requestError ? <div className="session-action-error" role="alert"><strong>Credential was not confirmed</strong><span>{requestError}</span></div> : null}
        {!replacing ? (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={256} disabled={submitting} placeholder="Internal MCP" />
            </label>
            <label className="field">
              <span>Exact MCP server URL</span>
              <input value={serverURL} onChange={(event) => setServerURL(event.target.value)} disabled={submitting} placeholder="https://mcp.example.com/endpoint" inputMode="url" spellCheck={false} />
              <small>The URL must exactly match the Agent MCP definition. Creating this resource makes no network request.</small>
            </label>
          </>
        ) : (
          <div className="notice warning" role="note">The old token is never read or shown. Running work may already hold it, and replacing it does not revoke the provider-side token.</div>
        )}
        <label className="field">
          <span>{replacing ? "New bearer token" : "Bearer token"}</span>
          <input ref={tokenRef} type="password" autoComplete="new-password" spellCheck={false} disabled={submitting} aria-describedby={`${formId}-token-help`} />
          <small id={`${formId}-token-help`}>Write only. It is sent once, immediately cleared, and never stored in browser state, metadata, previews, or logs.</small>
        </label>
        {fieldError ? <p className="field-error" role="alert">{fieldError}</p> : null}
      </form>
    </Modal>
  );
}
