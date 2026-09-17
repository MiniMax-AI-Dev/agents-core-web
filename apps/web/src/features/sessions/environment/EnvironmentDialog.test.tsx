import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentEnvironment } from "@agents-core-web/agents-client";

import { EnvironmentDialog } from "./EnvironmentDialog";
import { EnvironmentPanel } from "./EnvironmentPanel";

const environment: AgentEnvironment = {
  type: "self_hosted",
  id: "0f745b0d-b545-49cd-8d7e-4c31c80dc564",
  remote_url: "http://127.0.0.1:8091",
  workspace_directory: "/workspace/project",
  capability_directories: [],
};

function props() {
  return {
    open: true,
    onClose: vi.fn(),
    environment,
    observation: null,
    connectionActions: [{
      type: "environment_connection" as const,
      environment_id: "0f745b0d-b545-49cd-8d7e-4c31c80dc564",
    }],
    dockerGuideProfile: null,
  };
}

describe("EnvironmentDialog", () => {
  it("presents Environment details in a clearly labelled closable dialog", () => {
    const html = renderToStaticMarkup(<EnvironmentDialog {...props()} />);

    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain(">Environment</h2>");
    expect(html).toContain('aria-label="Close dialog"');
    expect(html).toContain(">Done</button>");
    expect(html).toContain('aria-label="Environment and Workspace status"');
    expect(html).toContain("Connection required");
  });

  it("does not expose dialog content while closed", () => {
    const html = renderToStaticMarkup(<EnvironmentDialog {...props()} open={false} />);

    expect(html).toBe('<div class="environment-dialog"></div>');
  });

  it("wires both close controls to the supplied callback", () => {
    const onClose = vi.fn();
    const element = EnvironmentDialog({ ...props(), onClose });
    const modal = element.props.children;

    expect(modal.props.onClose).toBe(onClose);
    expect(modal.props.footer.props.onClick).toBe(onClose);
  });

  it("passes the launcher default-open preference through to the panel", () => {
    const element = EnvironmentDialog({ ...props(), defaultLauncherGuideOpen: true });
    const panel = element.props.children.props.children;

    expect(panel.type).toBe(EnvironmentPanel);
    expect(panel.props.defaultLauncherGuideOpen).toBe(true);
  });
});
