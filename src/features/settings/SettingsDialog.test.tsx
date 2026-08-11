// SettingsDialog tests (TASK-UI-01 settings center): the modal overlay
// keeps a FIXED size on desktop — switching sections must not resize the
// dialog (each section scrolls inside its own pane), and the mobile sheet
// close button stays icon-only with an accessible label.

import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import SettingsDialog from "./SettingsDialog";

const SERVER = "srv-settings";

function renderDialog(mobile = false) {
  const props = { serverId: SERVER, onClose: vi.fn(), mobile };
  render(() => <SettingsDialog {...props} />);
  return props;
}

describe("SettingsDialog", () => {
  it("renders the desktop panel with a fixed height", () => {
    renderDialog(false);

    // The dialog root holds the backdrop first, then the panel.
    const panel = screen.getByTestId("settings-dialog").children[1];
    expect(panel).not.toBeNull();
    // The dialog must not shrink/grow with the active section's content.
    expect(panel!.className).toContain("h-[min(640px,85vh)]");
    expect(panel!.className).toContain("w-[min(880px,92vw)]");
    expect(panel!.className).not.toContain("max-h-[85vh]");
  });

  it("keeps the mobile close button icon-only with an accessible label", () => {
    const props = renderDialog(true);

    const button = screen.getByTestId("settings-dialog-close");
    expect(button).toHaveTextContent("✕");
    expect(button.textContent?.replace(/\s/g, "")).toBe("✕");
    expect(button.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click and Escape", () => {
    const props = renderDialog(false);

    fireEvent.click(screen.getByTestId("settings-dialog-backdrop"));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
