import { createSignal } from "solid-js";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { openUrl } from "@tauri-apps/plugin-opener";
import RightToolPanel, {
  clampRightToolPanelWidth,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from "./RightToolPanel";
import { openTab, resetServer, viewer } from "../../stores/viewer";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../../features/vcs/VcsPanel", () => ({
  default: () => <div data-testid="review-content">Review</div>,
}));
vi.mock("../../features/vcs/DiffView", () => ({
  default: (props: { messageId: string }) => <div>{props.messageId}</div>,
}));
vi.mock("../../features/files/FileViewer", () => ({
  default: (props: { activePath: string }) => (
    <div data-testid="file-content">{props.activePath}</div>
  ),
}));

beforeEach(() => {
  localStorage.removeItem("oc-right-tools-width");
  resetServer("tools-test");
  vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
  defaults.onOpenChange.mockClear();
  defaults.onMaximizedChange.mockClear();
});
const defaults = {
  serverId: "tools-test",
  open: true,
  onOpenChange: vi.fn(),
  onMaximizedChange: vi.fn(),
};
function add(kind: "browser" | "files" | "review") {
  fireEvent.click(screen.getByTestId("right-tools-add-tab"));
  fireEvent.click(screen.getByTestId(`right-tools-add-${kind}`));
}
function currentPane() {
  return document.querySelector('[role="tabpanel"]:not([hidden])') as HTMLElement;
}

describe("tabbed desktop workspace", () => {
  it("selects and focuses the left neighbor when closing the active rightmost tab", async () => {
    render(() => <RightToolPanel {...defaults} />);
    add("browser");
    add("browser");
    const [first, second] = screen.getAllByTestId("right-tools-browser");
    expect(second).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(second!, { key: "Delete" });
    await Promise.resolve();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveFocus();
    expect(screen.getByTestId("right-tools-review")).toHaveAttribute("aria-selected", "false");
  });
  it("keeps the selected tab unchanged when closing an inactive neighbor", async () => {
    render(() => <RightToolPanel {...defaults} />);
    add("browser");
    add("browser");
    const [first, second] = screen.getAllByTestId("right-tools-browser");
    fireEvent.keyDown(first!, { key: "Delete" });
    await Promise.resolve();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toBeInTheDocument();
  });
  it("collapses through the owner and resets maximized state", () => {
    render(() => <RightToolPanel {...defaults} />);
    fireEvent.click(screen.getByTestId("right-tools-maximize"));
    expect(screen.getByTestId("right-tool-panel")).toHaveAttribute("data-maximized", "true");
    fireEvent.click(screen.getByTestId("right-tools-collapse"));
    expect(defaults.onOpenChange).toHaveBeenCalledWith(false);
    expect(defaults.onMaximizedChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("right-tool-panel")).toHaveAttribute("data-maximized", "false");
  });
  it("delegates recovery from a controlled zero width without overriding its owner", () => {
    const onWidthChange = vi.fn();
    const onWidthCommit = vi.fn();
    render(() => (
      <RightToolPanel
        {...defaults}
        width={0}
        onWidthChange={onWidthChange}
        onWidthCommit={onWidthCommit}
      />
    ));
    expect(screen.getByTestId("right-tool-panel")).toHaveAttribute("data-collapsed", "true");
    fireEvent.keyDown(screen.getByTestId("right-tools-resize-handle"), { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenCalledWith(16);
    expect(onWidthCommit).toHaveBeenCalledWith(16);
    expect(screen.getByTestId("right-tool-panel")).toHaveStyle({ width: "0px" });
    expect(localStorage.getItem("oc-right-tools-width")).toBeNull();
  });
  it("maximizes and restores with the splitter available only in split mode", () => {
    render(() => <RightToolPanel {...defaults} />);
    const panel = screen.getByTestId("right-tool-panel");
    const toggle = screen.getByTestId("right-tools-maximize");
    expect(screen.getByTestId("right-tools-resize-handle")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(panel).toHaveStyle({ width: "100%" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("right-tools-resize-handle")).not.toBeInTheDocument();
    expect(defaults.onMaximizedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(toggle);
    expect(panel).toHaveStyle({ width: "464px" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("right-tools-resize-handle")).toBeInTheDocument();
    expect(defaults.onMaximizedChange).toHaveBeenLastCalledWith(false);
  });
  it("clamps keyboard resizing and persists discrete adjustments and default recovery", () => {
    render(() => <RightToolPanel {...defaults} />);
    const handle = screen.getByTestId("right-tools-resize-handle");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "448");
    expect(localStorage.getItem("oc-right-tools-width")).toBe("448");
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(handle).toHaveAttribute("aria-valuenow", "512");
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "0");
    expect(localStorage.getItem("oc-right-tools-width")).toBe("0");
    fireEvent.keyDown(handle, { key: "End" });
    const limit = handle.getAttribute("aria-valuemax");
    expect(handle).toHaveAttribute("aria-valuenow", limit);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", limit);
    expect(localStorage.getItem("oc-right-tools-width")).toBe(limit);
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", "464");
    expect(localStorage.getItem("oc-right-tools-width")).toBe("464");
  });
  it("normalizes browser URLs and retains embedded content if external opening fails", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("No system browser"));
    render(() => <RightToolPanel {...defaults} />);
    add("browser");
    const input = screen.getByTestId("right-tools-browser-url");
    fireEvent.input(input, { target: { value: "example.com/docs" } });
    fireEvent.submit(input.closest("form")!);
    const frame = screen.getByTestId("right-tools-browser-frame");
    expect(input).toHaveValue("https://example.com/docs");
    expect(frame).toHaveAttribute("src", "https://example.com/docs");
    expect(openUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("right-tools-browser-external"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/docs"));
    await Promise.resolve();
    expect(screen.getByTestId("right-tools-browser-frame")).toBe(frame);
    expect(frame).toHaveAttribute("src", "https://example.com/docs");
  });
  it("exposes a valid tablist including close controls and the empty state", async () => {
    const { container } = render(() => <RightToolPanel {...defaults} />);
    const audit = async () => {
      const result = await axe.run(container, {
        runOnly: { type: "rule", values: ["aria-required-children", "aria-required-parent"] },
      });
      expect(
        result.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => ({
            html: node.html,
            failureSummary: node.failureSummary,
          })),
        })),
      ).toEqual([]);
    };
    await audit();
    add("browser");
    await audit();
    fireEvent.keyDown(screen.getByTestId("right-tools-browser"), { key: "Delete" });
    fireEvent.keyDown(screen.getByTestId("right-tools-review"), { key: "Delete" });
    await audit();
  });
  it("keeps selected file chrome and visible pane aligned after controlled navigation", async () => {
    openTab("tools-test", "README.md");
    openTab("tools-test", "PromptBox.tsx");
    const [view, setView] = createSignal<"review" | "files" | "browser">("files");
    render(() => (
      <RightToolPanel {...defaults} view={view()} onViewChange={setView} requestVersion={1} />
    ));
    const readme = screen.getByRole("tab", { name: "README.md" });
    const prompt = screen.getByRole("tab", { name: "PromptBox.tsx" });
    fireEvent.click(readme);
    await Promise.resolve();
    expect(readme).toHaveAttribute("aria-selected", "true");
    expect(within(currentPane()).getByTestId("file-content")).toHaveTextContent("README.md");
    fireEvent.click(prompt);
    fireEvent(window, new Event("resize"));
    await Promise.resolve();
    expect(prompt).toHaveAttribute("aria-selected", "true");
    expect(readme).toHaveAttribute("aria-selected", "false");
    expect(within(currentPane()).getByTestId("file-content")).toHaveTextContent("PromptBox.tsx");
  });
  it("uses a useful default and bounds width", () => {
    expect(RIGHT_PANEL_DEFAULT_WIDTH).toBe(464);
    expect(clampRightToolPanelWidth(900, 600)).toBe(600);
    expect(clampRightToolPanelWidth(-1, 600)).toBe(0);
    render(() => <RightToolPanel {...defaults} />);
    expect(screen.getByTestId("right-tool-panel")).toHaveStyle({ width: "464px" });
  });
  it("retains separate browser frames through switching and panel hiding, releases closed content", () => {
    const [open, setOpen] = createSignal(true);
    render(() => <RightToolPanel {...defaults} open={open()} />);
    add("browser");
    let pane = within(currentPane());
    fireEvent.input(pane.getByTestId("right-tools-browser-url"), {
      target: { value: "example.com" },
    });
    fireEvent.submit(pane.getByTestId("right-tools-browser-url").closest("form")!);
    const frame = pane.getByTestId("right-tools-browser-frame");
    add("browser");
    pane = within(currentPane());
    expect(pane.getByTestId("right-tools-browser-url")).toHaveValue("");
    fireEvent.input(pane.getByTestId("right-tools-browser-url"), {
      target: { value: "second.example" },
    });
    fireEvent.submit(pane.getByTestId("right-tools-browser-url").closest("form")!);
    fireEvent.click(screen.getAllByTestId("right-tools-browser")[0]!);
    expect(within(currentPane()).getByTestId("right-tools-browser-frame")).toBe(frame);
    expect(frame).toHaveAttribute("src", "https://example.com");
    setOpen(false);
    setOpen(true);
    expect(within(currentPane()).getByTestId("right-tools-browser-frame")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Close tab: example.com" }));
    expect(frame).not.toBeInTheDocument();
  });
  it("integrates file tabs and closes the viewer store tab", () => {
    openTab("tools-test", "src/first.ts");
    openTab("tools-test", "src/second.ts");
    render(() => <RightToolPanel {...defaults} view="files" />);
    expect(within(currentPane()).getByTestId("file-content")).toHaveTextContent("src/second.ts");
    fireEvent.click(screen.getByRole("button", { name: "Close tab: second.ts" }));
    expect(viewer["tools-test"]!.tabs.map((tab) => tab.path)).toEqual(["src/first.ts"]);
    expect(within(currentPane()).getByTestId("file-content")).toHaveTextContent("src/first.ts");
  });
  it("clears browser state on directory changes", () => {
    const [directory, setDirectory] = createSignal("/first");
    render(() => <RightToolPanel {...defaults} directory={directory()} />);
    add("browser");
    setDirectory("/second");
    expect(screen.queryByTestId("right-tools-browser-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("right-tools-review")).toHaveAttribute("aria-selected", "true");
  });
  it("quarantines stale files when the directory changes before viewer reset", () => {
    openTab("tools-test", "old/private.ts");
    const [directory, setDirectory] = createSignal("/first");
    render(() => <RightToolPanel {...defaults} directory={directory()} view="files" />);
    expect(screen.getByRole("tab", { name: "private.ts" })).toBeInTheDocument();
    setDirectory("/second");
    expect(screen.queryByRole("tab", { name: "private.ts" })).not.toBeInTheDocument();
    resetServer("tools-test");
    openTab("tools-test", "new/public.ts");
    expect(screen.getByRole("tab", { name: "public.ts" })).toBeInTheDocument();
  });
  it("does not recreate a closed diff and refocuses it on an explicit reopen", () => {
    const [request, setRequest] = createSignal(0);
    render(() => (
      <RightToolPanel
        {...defaults}
        view="review"
        reviewSessionId="session"
        reviewMessageId="message"
        requestVersion={request()}
      />
    ));
    const diff = currentPane();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Session diff/ }), { key: "Delete" });
    expect(diff).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Session diff/ })).not.toBeInTheDocument();
    setRequest(1);
    expect(screen.getByRole("tab", { name: /Session diff/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("supports roving keyboard focus and leaves an empty state after closing the last tab", () => {
    render(() => <RightToolPanel {...defaults} view="review" />);
    add("browser");
    fireEvent.keyDown(screen.getByTestId("right-tools-browser"), { key: "Home" });
    expect(screen.getByTestId("right-tools-review")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("right-tools-review"), { key: "Delete" });
    fireEvent.keyDown(screen.getByTestId("right-tools-browser"), { key: "Delete" });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("right-tools-add-tab")).toBeInTheDocument();
  });
  it("batches resize updates and persists only when released", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const onWidthChange = vi.fn();
    const onWidthCommit = vi.fn();
    render(() => (
      <RightToolPanel {...defaults} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} />
    ));
    fireEvent.pointerDown(screen.getByTestId("right-tools-resize-handle"), {
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(window, { clientX: 90 });
    fireEvent.pointerMove(window, { clientX: 60 });
    expect(onWidthChange).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]!(0);
    expect(onWidthChange).toHaveBeenCalledWith(504);
    expect(localStorage.getItem("oc-right-tools-width")).toBeNull();
    fireEvent.pointerUp(window);
    expect(onWidthCommit).toHaveBeenCalledWith(504);
    expect(localStorage.getItem("oc-right-tools-width")).toBe("504");
    vi.restoreAllMocks();
  });
});
