import { describe, expect, it, vi } from "vitest";

import type { CreateVaultInput } from "@agents-core-web/agents-client";

import { requestVaultCreate } from "./vault-operations";

const vault = {
  id: "11111111-1111-4111-8111-111111111111",
  object: "vault" as const,
  created_at: 1,
  name: "Runtime",
  metadata: { team: "core" },
};

describe("Vault create operation", () => {
  it("passes the validated metadata object to Core unchanged", async () => {
    const createVault = vi.fn(async (_input: CreateVaultInput) => vault);
    const metadata = { team: "core" };

    await expect(requestVaultCreate({ createVault }, "Runtime", metadata)).resolves.toEqual(vault);

    expect(createVault).toHaveBeenCalledOnce();
    expect(createVault).toHaveBeenCalledWith({ name: "Runtime", metadata });
    expect(createVault.mock.calls.at(0)?.[0].metadata).toBe(metadata);
  });

  it("does not retry a rejected or uncertain create request", async () => {
    const error = new Error("transport result unknown");
    const createVault = vi.fn(async (_input: CreateVaultInput) => { throw error; });

    await expect(requestVaultCreate({ createVault }, "Runtime", { team: "core" }))
      .rejects.toBe(error);
    expect(createVault).toHaveBeenCalledOnce();
  });

  it("fails closed when Core returns different metadata", async () => {
    const createVault = vi.fn(async (_input: CreateVaultInput) => ({ ...vault, metadata: { team: "other" } }));

    await expect(requestVaultCreate({ createVault }, "Runtime", { team: "core" }))
      .rejects.toThrow("Agent Core returned mismatched Vault metadata.");
    expect(createVault).toHaveBeenCalledOnce();
  });
});
