import { createPortal } from "react-dom";
import type { ComponentProps } from "react";

import { Modal } from "../../../components/Modal";
import { EnvironmentPanel } from "./EnvironmentPanel";

export interface EnvironmentDialogProps extends ComponentProps<typeof EnvironmentPanel> {
  open: boolean;
  onClose: () => void;
  defaultLauncherGuideOpen?: boolean;
}

export function EnvironmentDialog({
  open,
  onClose,
  environment,
  observation,
  connectionActions,
  dockerGuideProfile,
  defaultLauncherGuideOpen,
}: EnvironmentDialogProps) {
  const panelProps = {
    environment,
    observation,
    connectionActions,
    dockerGuideProfile,
    defaultLauncherGuideOpen,
  };
  const dialog = (
    <div className="environment-dialog">
      <Modal
        open={open}
        title="Environment"
        onClose={onClose}
        footer={
          <button className="button primary" type="button" onClick={onClose}>
            Done
          </button>
        }
      >
        <EnvironmentPanel {...panelProps} />
      </Modal>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
