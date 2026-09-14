export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
}

export interface SSEDecoder {
  push(chunk: string): void;
  finish(): void;
}

function parseBlock(block: string): SSEMessage | null {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "data") data.push(value);
  }

  if (data.length === 0) return null;
  return { event, data: data.join("\n"), id };
}

/**
 * Incremental SSE decoder. It deliberately ignores retry/Last-Event-ID because
 * the Agents API stream is live-only; callers recover through durable reads.
 */
export function createSSEDecoder(onMessage: (message: SSEMessage) => void): SSEDecoder {
  let buffer = "";
  let pendingCarriageReturn = false;
  let atStart = true;

  const append = (input: string, flush: boolean) => {
    let chunk = input;
    if (atStart && chunk.length > 0) {
      atStart = false;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }

    if (pendingCarriageReturn) {
      buffer += "\n";
      if (chunk.startsWith("\n")) chunk = chunk.slice(1);
      pendingCarriageReturn = false;
    }

    if (!flush && chunk.endsWith("\r")) {
      pendingCarriageReturn = true;
      chunk = chunk.slice(0, -1);
    }

    buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // A pending CR following an already-complete line ending is necessarily
    // the blank line delimiter. Dispatch now; a following LF is harmless and
    // will be consumed as an extra empty line on the next push.
    if (pendingCarriageReturn && buffer.endsWith("\n")) {
      buffer += "\n";
      pendingCarriageReturn = false;
    }
  };

  const drain = (flush: boolean) => {
    while (buffer.length > 0) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        if (!flush) return;
        const final = parseBlock(buffer);
        buffer = "";
        if (final) onMessage(final);
        return;
      }

      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const message = parseBlock(block);
      if (message) onMessage(message);
    }
  };

  return {
    push(chunk) {
      append(chunk, false);
      drain(false);
    },
    finish() {
      append("", true);
      drain(true);
    },
  };
}
