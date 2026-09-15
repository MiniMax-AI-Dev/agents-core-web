import { createPortal } from "react-dom";
import type { ComponentProps } from "react";

import { Modal } from "../../components/Modal";

export function AgentDialog(props: ComponentProps<typeof Modal>) {
  const dialog = <div className="agent-dialog"><Modal {...props} /></div>;
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
