import { describe, expect, it } from "vitest";

import { createSSEDecoder } from "./sse";

describe("createSSEDecoder", () => {
  it("decodes split Agents API events and ignores keepalives", () => {
    const messages: Array<{ event?: string; data: string; id?: string }> = [];
    const decoder = createSSEDecoder((message) => messages.push(message));

    decoder.push(": connected\n\nevent: agent.session.turn.com");
    decoder.push("pleted\nid: evt_1\ndata: {\"type\":\"agent.session.turn.completed\"}\n\n");
    decoder.finish();

    expect(messages).toEqual([
      {
        event: "agent.session.turn.completed",
        id: "evt_1",
        data: '{"type":"agent.session.turn.completed"}',
      },
    ]);
  });

  it("joins multiline data and flushes a final unterminated block", () => {
    const messages: string[] = [];
    const decoder = createSSEDecoder((message) => messages.push(message.data));

    decoder.push("data: first\r\ndata: second");
    decoder.finish();

    expect(messages).toEqual(["first\nsecond"]);
  });

  it("normalizes all SSE line endings without mistaking a split CRLF for a blank line", () => {
    const messages: string[] = [];
    const decoder = createSSEDecoder((message) => messages.push(message.data));

    decoder.push("data: first\r");
    decoder.push("\ndata: second\r\rdata: third\r");
    decoder.push("\r");

    expect(messages).toEqual(["first\nsecond", "third"]);
  });

  it("ignores a leading UTF-8 BOM and accepts an empty data field", () => {
    const messages: Array<{ event?: string; data: string }> = [];
    const decoder = createSSEDecoder((message) => messages.push(message));

    decoder.push("\ufeffevent: empty\ndata:\n\n");

    expect(messages).toEqual([{ event: "empty", data: "", id: undefined }]);
  });
});
