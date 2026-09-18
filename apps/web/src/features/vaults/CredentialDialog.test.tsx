import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentCoreError } from "@agents-core-web/agents-client";

import { CredentialDialog, credentialStorageUnavailableMessage, safeCredentialMutationError } from "./CredentialDialog";

describe("Credential dialog", () => {
  it("renders a write-only uncontrolled password field without a value", () => {
    const html = renderToStaticMarkup(
      <CredentialDialog open onClose={() => undefined} onCreate={async () => undefined} />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html.match(/<input[^>]*type="password"[^>]*>/u)?.[0]).not.toContain("value=");
    expect(html).toContain("Write only");
  });

  it("maps storage and uncertain failures to fixed secret-safe copy", () => {
    expect(safeCredentialMutationError(new AgentCoreError("Agent Core Credential creation failed.", 503, "credential_write_failed")))
      .toBe(credentialStorageUnavailableMessage);
    expect(safeCredentialMutationError(new Error("private detail"))).not.toContain("private detail");
  });
});
