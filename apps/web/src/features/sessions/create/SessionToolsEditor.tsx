import { Plus, Trash2 } from "lucide-react";

import type { VaultCatalog } from "../../vaults/vault-catalog";
import { vaultName } from "../../vaults/vault-catalog";
import type { AgentToolDraft } from "../../agents/agent-form";

export interface SessionToolsEditorProps {
  catalog: VaultCatalog | null;
  disabled?: boolean;
  label: string;
  onChange: (tools: AgentToolDraft[]) => void;
  tools: AgentToolDraft[];
}

export function SessionToolsEditor({
  catalog,
  disabled = false,
  label,
  onChange,
  tools,
}: SessionToolsEditorProps) {
  const update = (index: number, tool: AgentToolDraft) => {
    onChange(tools.map((candidate, position) => position === index ? tool : candidate));
  };
  const remove = (index: number) => {
    onChange(tools.filter((_, position) => position !== index));
  };

  return (
    <section className="agent-form-section agent-tools-section" aria-label={label}>
      <div className="agent-form-section-heading">
        <h3>{label}</h3>
        <span>Whole replacement · Core-owned execution</span>
      </div>
      <p className="agent-form-capability-note">
        Only non-deferred Functions and service-origin HTTP MCP are accepted. Web Search, tool search,
        programmatic calling, headers, OAuth, stdio, and client-origin MCP remain unavailable.
      </p>
      <div className="agent-tools-list">
        {tools.map((tool, index) => tool.kind === "read-only" ? (
          <article className="agent-tool-card agent-tool-read-only" key={`read-only-${index}`} aria-label="Unsupported inherited tool">
            <header>
              <div><strong>Unsupported inherited tool</strong><span>{tool.label}</span></div>
              <button className="icon-button danger" type="button" aria-label={`Remove unsupported tool ${index + 1}`} onClick={() => remove(index)} disabled={disabled}><Trash2 size={14} /></button>
            </header>
            <small>Remove this entry or choose “Clear all tools”; it cannot be copied into an executable Session override.</small>
          </article>
        ) : tool.kind === "function" ? (
          <article className="agent-tool-card" key={`function-${index}`}>
            <header>
              <strong>Function</strong>
              <button className="button outline" type="button" onClick={() => remove(index)} disabled={disabled}>Remove</button>
            </header>
            <div className="agent-tool-grid">
              <label className="field"><span>Name</span><input value={tool.name} onChange={(event) => update(index, { ...tool, name: event.target.value })} placeholder="lookup_customer" disabled={disabled} /></label>
              <label className="field"><span>Description</span><input value={tool.description} onChange={(event) => update(index, { ...tool, description: event.target.value })} placeholder="Look up a customer record" disabled={disabled} /></label>
            </div>
            <label className="field">
              <span>Parameters JSON Schema</span>
              <textarea value={tool.parameters} onChange={(event) => update(index, { ...tool, parameters: event.target.value })} rows={6} spellCheck={false} disabled={disabled} />
              <small>JSON object only. Functions are always non-deferred; at most 64 unique names, each at most 512 UTF-8 bytes.</small>
            </label>
          </article>
        ) : (
          <article className="agent-tool-card" key={`mcp-${index}`}>
            <header>
              <strong>{tool.credentialId ? "Vault bearer HTTP MCP" : "HTTP MCP"}</strong>
              <button className="button outline" type="button" onClick={() => remove(index)} disabled={disabled}>Remove</button>
            </header>
            <div className="agent-tool-grid">
              <label className="field">
                <span>Server label</span>
                <input value={tool.serverLabel} onChange={(event) => update(index, { ...tool, serverLabel: event.target.value })} placeholder="docs" disabled={disabled} />
              </label>
              <label className="field">
                <span>Authentication</span>
                <select
                  value={tool.credentialId ?? ""}
                  onChange={(event) => {
                    const credentialId = event.target.value || null;
                    const credential = credentialId
                      ? catalog?.credentials.find((candidate) => candidate.id === credentialId)
                      : null;
                    update(index, {
                      ...tool,
                      credentialId,
                      serverUrl: credential?.auth.mcp_server_url ?? tool.serverUrl,
                    });
                  }}
                  disabled={disabled}
                >
                  <option value="">Selected Vaults may resolve implicitly</option>
                  {catalog?.vaults.map((vault) => {
                    const credentials = catalog.credentials.filter((credential) => credential.vault_id === vault.id);
                    return credentials.length ? (
                      <optgroup label={vaultName(vault)} key={vault.id}>
                        {credentials.map((credential) => (
                          <option value={credential.id} key={credential.id}>
                            {credential.name} · {credential.auth.mcp_server_url}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                <small>
                  Explicit Credentials lock their exact URL and owning Vault. Without one, only manually selected Vaults participate in implicit matching.
                </small>
              </label>
              <label className="field">
                <span>Server URL</span>
                <input value={tool.serverUrl} onChange={(event) => update(index, { ...tool, serverUrl: event.target.value })} placeholder="https://mcp.example/tools" inputMode="url" spellCheck={false} readOnly={Boolean(tool.credentialId)} disabled={disabled} />
              </label>
            </div>
            <fieldset className="agent-mcp-allowed-tools" disabled={disabled}>
              <legend>Allowed tools</legend>
              <label><input type="radio" checked={tool.allowedToolsMode === "all"} onChange={() => update(index, { ...tool, allowedToolsMode: "all", allowedToolsValue: null })} /> All advertised tools</label>
              <label><input type="radio" checked={tool.allowedToolsMode === "list"} onChange={() => update(index, { ...tool, allowedToolsMode: "list" })} /> Only the listed tools</label>
              {tool.allowedToolsMode === "list" ? (
                <textarea value={tool.allowedTools} onChange={(event) => update(index, { ...tool, allowedTools: event.target.value })} rows={4} placeholder={"search\nread_document"} spellCheck={false} aria-label={`Allowed tools for ${tool.serverLabel || "MCP server"}`} />
              ) : null}
              <small>Omitted or null allows every advertised tool; an empty list allows none.</small>
            </fieldset>
            <label className="agent-mcp-required">
              <input type="checkbox" checked={tool.required === true} onChange={(event) => update(index, { ...tool, required: event.target.checked })} disabled={disabled} />
              Require this server for Core execution
            </label>
          </article>
        ))}
      </div>
      <div className="agent-tool-actions">
        <button className="button outline" type="button" onClick={() => onChange([...tools, { kind: "function", name: "", description: "", parameters: "{\n  \"type\": \"object\"\n}" }])} disabled={disabled}>
          <Plus size={13} /> Add Function
        </button>
        <button className="button outline" type="button" onClick={() => onChange([...tools, { kind: "mcp", serverLabel: "", serverUrl: "", allowedToolsMode: "all", allowedTools: "", allowedToolsValue: null, required: false, credentialId: null }])} disabled={disabled}>
          <Plus size={13} /> Add HTTP MCP
        </button>
      </div>
    </section>
  );
}
