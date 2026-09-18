import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FunctionCallAction } from "@agents-core-web/agents-client";

import {
  buildFunctionResultInput,
  createFunctionResultDraft,
  defaultFunctionRejection,
  FunctionActionPanel,
  functionResultDraftReducer,
  submitFunctionResultDraft,
  validFunctionResultDraft,
  type FunctionResultDraft,
} from "./FunctionActionPanel";

const action: FunctionCallAction = {
  type: "function_call",
  call_id: "call-1",
  turn_id: "turn-1",
  name: "lookup",
  arguments: { query: "alpha" },
};

function reduce(
  draft: FunctionResultDraft,
  ...actions: Parameters<typeof functionResultDraftReducer>[1][]
): FunctionResultDraft {
  return actions.reduce(functionResultDraftReducer, draft);
}

describe("FunctionActionPanel", () => {
  it("keeps the default successful result on the legacy string path", () => {
    const draft = reduce(
      createFunctionResultDraft(),
      { type: "set-text", value: "  plain result  " },
    );

    expect(validFunctionResultDraft(draft)).toBe(true);
    expect(buildFunctionResultInput(action, draft, true)).toEqual({
      callId: "call-1",
      turnId: "turn-1",
      success: true,
      output: "  plain result  ",
    });

    const html = renderToStaticMarkup(
      <FunctionActionPanel
        actions={[action]}
        agentName="Demo Agent"
        autoFocus={false}
        busy={false}
        onCancel={() => undefined}
        onSubmit={async () => undefined}
      />,
    );
    expect(html).toContain("Text result");
    expect(html).toContain("Structured result");
    expect(html).toContain('aria-label="Function result or error"');
    expect(html).toContain("Demo Agent is waiting for this function result.");
  });

  it("builds ordered mixed text and image content only in structured mode", () => {
    const draft = reduce(
      createFunctionResultDraft(),
      { type: "set-mode", mode: "structured" },
      { type: "add-part", part: { id: "first", type: "input_text", value: "" } },
      { type: "update-part", id: "first", value: "caption" },
      { type: "add-part", part: { id: "second", type: "input_image", value: "data:image/png;base64,AA==" } },
      { type: "add-part", part: { id: "third", type: "input_text", value: "tail" } },
    );

    expect(buildFunctionResultInput(action, draft, true)).toEqual({
      callId: "call-1",
      turnId: "turn-1",
      success: true,
      output: [
        { type: "input_text", text: "caption" },
        { type: "input_image", image_url: "data:image/png;base64,AA==" },
        { type: "input_text", text: "tail" },
      ],
    });
  });

  it("reorders and deletes parts without changing the remaining values", () => {
    const draft = reduce(
      { mode: "structured", text: "", parts: [
        { id: "one", type: "input_text", value: "one" },
        { id: "two", type: "input_image", value: "two" },
        { id: "three", type: "input_text", value: "three" },
      ] },
      { type: "move-part", id: "three", direction: -1 },
      { type: "remove-part", id: "one" },
    );

    expect(draft.parts).toEqual([
      { id: "three", type: "input_text", value: "three" },
      { id: "two", type: "input_image", value: "two" },
    ]);
  });

  it("preserves legacy explicit and default error payloads", () => {
    const explicit = reduce(createFunctionResultDraft(), { type: "set-text", value: "operator denied" });
    expect(buildFunctionResultInput(action, explicit, false)).toEqual({
      callId: "call-1",
      turnId: "turn-1",
      success: false,
      error: "operator denied",
    });
    expect(buildFunctionResultInput(action, createFunctionResultDraft(), false)).toEqual({
      callId: "call-1",
      turnId: "turn-1",
      success: false,
      error: defaultFunctionRejection,
    });
  });

  it("blocks success when a structured result has no parts or an empty part", () => {
    const empty = reduce(createFunctionResultDraft(), { type: "set-mode", mode: "structured" });
    const blankPart = reduce(
      empty,
      { type: "add-part", part: { id: "blank", type: "input_text", value: "  " } },
    );

    expect(validFunctionResultDraft(empty)).toBe(false);
    expect(validFunctionResultDraft(blankPart)).toBe(false);
    expect(buildFunctionResultInput(action, blankPart, true)).toBeNull();
  });

  it("disables result, error, and cancel controls while busy", () => {
    const html = renderToStaticMarkup(
      <FunctionActionPanel
        actions={[action]}
        agentName="Demo Agent"
        autoFocus={false}
        busy
        onCancel={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    expect(html).toMatch(/<fieldset[^>]+disabled=""/);
    expect(html).toMatch(/<textarea[^>]+disabled=""/);
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-label="Cancel active Turn"/);
  });

  it("does not mutate or retry a draft when onSubmit rejects", async () => {
    const draft = reduce(createFunctionResultDraft(), { type: "set-text", value: "keep me" });
    const snapshot = structuredClone(draft);
    const onSubmit = vi.fn(async () => {
      throw new Error("Core conflict");
    });

    await expect(submitFunctionResultDraft(action, draft, true, onSubmit))
      .rejects.toThrow("Core conflict");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(draft).toEqual(snapshot);
  });

  it("keys the editor by Turn and call so an action switch starts with a fresh draft", () => {
    const html = renderToStaticMarkup(
      <FunctionActionPanel
        actions={[{ ...action, call_id: "call-2", turn_id: "turn-2", name: "next" }]}
        agentName="Demo Agent"
        autoFocus={false}
        busy={false}
        onCancel={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    expect(createFunctionResultDraft()).toEqual({ mode: "text", text: "", parts: [] });
    expect(html).toContain('title="next"');
    expect(html).not.toContain("keep me");
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
  });
});
