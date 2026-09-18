import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  createVaultSubmissionGate,
  submitVaultCreateDraft,
  VaultCreateForm,
  vaultCreateFailureMessage,
} from "./VaultCreateForm";

describe("VaultCreateForm", () => {
  it("renders name and public string-map metadata guidance", () => {
    const html = renderToStaticMarkup(
      <VaultCreateForm onCreate={async () => undefined} />,
    );

    expect(html).toContain(">Name</span>");
    expect(html).toContain("Metadata");
    expect(html).toContain("JSON object with string values");
    expect(html).toContain("metadata is public");
    expect(html).toContain("secrets, tokens, passwords");
    expect(html).not.toContain("Edit Vault");
  });

  it("honors the external disabled state", () => {
    const html = renderToStaticMarkup(
      <VaultCreateForm disabled onCreate={async () => undefined} />,
    );

    expect(html.match(/ disabled=""/gu)?.length).toBe(3);
  });

  it("passes normalized input once and clears the draft only after success", async () => {
    const onCreate = vi.fn(async () => undefined);
    const draft = { name: "  Runtime  ", metadata: '{"team":"core"}' };
    const result = await submitVaultCreateDraft(createVaultSubmissionGate(), draft, onCreate);

    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith("Runtime", { team: "core" });
    expect(result).toEqual({ kind: "success", draft: { metadata: "", name: "" } });
  });

  it("retains the complete draft after a failed or uncertain write", async () => {
    const onCreate = vi.fn(async () => { throw new Error("private transport detail"); });
    const draft = { name: "Runtime", metadata: "{\n  \"team\": \"core\"\n}" };
    const result = await submitVaultCreateDraft(createVaultSubmissionGate(), draft, onCreate);

    expect(onCreate).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: "failure", draft, message: vaultCreateFailureMessage });
    expect(vaultCreateFailureMessage).not.toContain("private transport detail");
  });

  it("locks duplicate submits while the first request is unresolved", async () => {
    let resolveCreate: (() => void) | undefined;
    const pendingCreate = new Promise<void>((resolve) => { resolveCreate = resolve; });
    const onCreate = vi.fn(() => pendingCreate);
    const gate = createVaultSubmissionGate();
    const draft = { name: "Runtime", metadata: "" };

    const first = submitVaultCreateDraft(gate, draft, onCreate);
    const duplicate = await submitVaultCreateDraft(gate, draft, onCreate);

    expect(duplicate).toEqual({ kind: "ignored", draft });
    expect(onCreate).toHaveBeenCalledOnce();

    resolveCreate?.();
    await expect(first).resolves.toEqual({ kind: "success", draft: { metadata: "", name: "" } });
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
