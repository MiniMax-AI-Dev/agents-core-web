import { describe, expect, it } from "vitest";

import {
  parseVaultMetadata,
  VAULT_METADATA_MAX_BYTES,
  VaultMetadataValidationError,
} from "./vault-metadata";

const bytes = (value: string) => new TextEncoder().encode(value).length;

describe("Vault metadata", () => {
  it("normalizes omitted and blank editor input to an empty map", () => {
    expect(parseVaultMetadata()).toEqual({});
    expect(parseVaultMetadata("")).toEqual({});
    expect(parseVaultMetadata(" \n\t ")).toEqual({});
  });

  it("accepts a JSON string map without coercing values", () => {
    expect(parseVaultMetadata('{"team":"runtime","tier":"test"}')).toEqual({
      team: "runtime",
      tier: "test",
    });
  });

  it.each([
    ["invalid JSON", "{"],
    ["null", "null"],
    ["array", "[]"],
    ["string root", '"value"'],
    ["number root", "1"],
    ["numeric value", '{"key":1}'],
    ["boolean value", '{"key":true}'],
    ["null value", '{"key":null}'],
    ["array value", '{"key":[]}'],
    ["nested value", '{"key":{"nested":"value"}}'],
  ])("rejects %s", (_label, source) => {
    expect(() => parseVaultMetadata(source)).toThrow(VaultMetadataValidationError);
  });

  it("enforces the inclusive 64 KiB boundary using UTF-8 JSON bytes", () => {
    const emptyEncodingBytes = bytes(JSON.stringify({ value: "" }));
    const remaining = VAULT_METADATA_MAX_BYTES - emptyEncodingBytes;
    const multibyteCharacters = Math.floor(remaining / 3);
    const asciiCharacters = remaining - multibyteCharacters * 3;
    const exactValue = "界".repeat(multibyteCharacters) + "x".repeat(asciiCharacters);
    const exactSource = JSON.stringify({ value: exactValue });

    expect(bytes(exactSource)).toBe(VAULT_METADATA_MAX_BYTES);
    expect(parseVaultMetadata(exactSource)).toEqual({ value: exactValue });

    const tooLargeSource = JSON.stringify({ value: `${exactValue}x` });
    expect(bytes(tooLargeSource)).toBe(VAULT_METADATA_MAX_BYTES + 1);
    expect(() => parseVaultMetadata(tooLargeSource)).toThrowError(
      "Metadata must be at most 64 KiB after UTF-8 JSON encoding.",
    );
  });
});
