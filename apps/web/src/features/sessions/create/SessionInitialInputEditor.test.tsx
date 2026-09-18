import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionInitialInputEditor } from "./SessionInitialInputEditor";
import { createSessionInitialInputDraft, type SessionInitialInputDraft } from "./session-initial-input";

function render(draft: SessionInitialInputDraft, disabled = false, showTextField = true): string {
  return renderToStaticMarkup(
    <SessionInitialInputEditor
      draft={draft}
      disabled={disabled}
      showTextField={showTextField}
      onChange={() => undefined}
    />,
  );
}

describe("SessionInitialInputEditor", () => {
  it("defaults to the exact-string Text editor and explains the bounded content model", () => {
    const html = render(createSessionInitialInputDraft("  preserve me\n"));

    expect(html).toContain("Initial input");
    expect(html).toContain("User text only");
    expect(html).toContain("Assistant messages and images are not supported here");
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="text"/);
    expect(html).toContain("First user message");
    expect(html).toContain("  preserve me\n");
    expect(html).toContain("Nonblank input is preserved exactly");
  });

  it("renders ordered messages and text parts with accessible reordering controls", () => {
    const html = render({
      mode: "messages",
      text: "inactive",
      messages: [
        {
          id: "first-message",
          parts: [
            { id: "first-part", text: "alpha" },
            { id: "second-part", text: "beta" },
          ],
        },
        {
          id: "second-message",
          parts: [{ id: "third-part", text: "gamma" }],
        },
      ],
    });

    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="messages"/);
    expect(html).toContain("Ordered user messages");
    expect(html).toContain("User message 1");
    expect(html).toContain("User message 2");
    expect(html).toContain("Text part 1");
    expect(html).toContain("Text part 2");
    expect(html).toContain('aria-label="Move user message 2 up"');
    expect(html).toContain('aria-label="Move text part 2 of user message 1 up"');
    expect(html).toContain("Add message");
    expect(html).toContain("Add text part");
    expect(html).toContain("Only the selected format is submitted");
  });

  it("moves the simple text field to the basic Session form without duplicating it", () => {
    const html = render(createSessionInitialInputDraft("basic text"), false, false);

    expect(html).toContain("The basic First message field is active");
    expect(html).not.toContain("First user message");
    expect(html).not.toContain("basic text");
    expect(html).toContain("Message array");
  });

  it("renders strict array validation and disables every control when requested", () => {
    const html = render({
      mode: "messages",
      text: "",
      messages: [{ id: "message", parts: [{ id: "part", text: "\u0085" }] }],
    }, true);

    expect(html).toContain('role="alert"');
    expect(html).toContain("User message 1 needs nonblank text across its parts.");
    expect(html).toContain("disabled=\"\"");
  });
});
