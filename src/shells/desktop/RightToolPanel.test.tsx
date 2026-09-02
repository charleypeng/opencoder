// L2 tests for the right workspace tools: the three tool tabs, collapse and
// maximize controls, keyboard/pointer splitter interaction, and the browser
// URL hand-off all stay available without mounting the server-backed views.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import RightToolPanel from "./RightToolPanel";

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../../features/vcs/VcsPanel", () => ({
  default: () => <div data-testid="right-tools-review-pane">Review content</div>,
}));
vi.mock("../../features/files/FileViewer", () => ({
  default: () => <div data-testid="file-viewer-mock">File content</div>,
}));

beforeEach(() => {
  localStorage.removeItem("oc-right-tools-width");
  openUrlMock.mockClear();
});

function renderPanel(overrides: Partial<Parameters<typeof RightToolPanel>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onMaximizedChange = vi.fn();
  render(() => (
    <RightToolPanel
      serverId="srv-tools"
      open={true}
      onOpenChange={onOpenChange}
      onMaximizedChange={onMaximizedChange}
      {...overrides}
    />
  ));
  return { onOpenChange, onMaximizedChange };
}

describe("RightToolPanel", () => {
  it("renders review, files, and browser tools with review selected", () => {
    renderPanel();
    expect(screen.getByTestId("right-tool-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("right-tools-review-pane")).toBeInTheDocument();
    expect(screen.getByTestId("right-tools-review")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("right-tools-files"));
    expect(screen.getByTestId("right-tools-files-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("right-tools-review-pane")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("right-tools-browser"));
    expect(screen.getByTestId("right-tools-browser-pane")).toBeInTheDocument();
  });

  it("collapses and restores the tool panel", () => {
    const { onOpenChange } = renderPanel();
    fireEvent.click(screen.getByTestId("right-tools-collapse"));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    const { onOpenChange: collapsedOnOpenChange } = renderPanel({ open: false });
    const collapsedPanel = screen.getAllByTestId("right-tool-panel").slice(-1)[0];
    expect(collapsedPanel).toHaveAttribute("data-collapsed", "true");
    fireEvent.click(screen.getAllByTestId("right-tools-expand").slice(-1)[0]);
    expect(collapsedOnOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("maximizes and restores through the panel action", () => {
    const { onMaximizedChange } = renderPanel();
    const panel = screen.getByTestId("right-tool-panel");
    fireEvent.click(screen.getByTestId("right-tools-maximize"));
    expect(panel).toHaveAttribute("data-maximized", "true");
    expect(onMaximizedChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("right-tools-maximize")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("right-tools-maximize"));
    expect(panel).toHaveAttribute("data-maximized", "false");
    expect(onMaximizedChange).toHaveBeenLastCalledWith(false);
  });

  it("resizes with the splitter and keyboard arrows", () => {
    renderPanel();
    const handle = screen.getByTestId("right-tools-resize-handle");
    expect(handle).toHaveAttribute("aria-valuenow", "360");

    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 60 });
    expect(handle).toHaveAttribute("aria-valuenow", "400");
    expect(localStorage.getItem("oc-right-tools-width")).toBe("400");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "384");
  });

  it("normalizes a URL for the embedded browser and supports an external fallback", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("right-tools-browser"));
    fireEvent.input(screen.getByTestId("right-tools-browser-url"), {
      target: { value: "example.com/docs" },
    });
    fireEvent.submit(screen.getByTestId("right-tools-browser-url").closest("form")!);
    expect(screen.getByTestId("right-tools-browser-frame")).toHaveAttribute(
      "src",
      "https://example.com/docs",
    );
    expect(openUrlMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("right-tools-browser-external"));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://example.com/docs"));
  });
});
