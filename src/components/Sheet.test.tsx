// L2 tests for the bottom sheet base (TASK-M7-05): renders the scrim +
// handle + panel and springs to the snap position (25% / 60% / 95% of the
// viewport height), scrim click / Esc / downward drag past the threshold
// and fast downward flicks close it, a partial drag settles to the nearest
// snap without closing, reduced motion swaps the spring for a 0ms linear
// transition, the body scroll locks while open, focus moves to the panel
// and returns on close, and the dismissible flag makes every close trigger
// a no-op (the permission/question sheets pin it).

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import Sheet from "./Sheet";

const VH = window.innerHeight || 768;
// translateY for the three snaps: leaves 95/60/25% visible of a 95vh panel.
const snapPx = (pct: number) => Math.round((VH * (95 - pct)) / 100);

const originalMatchMedia = window.matchMedia;

function Harness(props: {
  dismissible?: boolean;
  snap?: "low" | "mid" | "high";
  onInnerClick?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button data-testid="sheet-trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet
        open={open()}
        onClose={() => setOpen(false)}
        snap={props.snap}
        title="Test sheet"
        dismissible={props.dismissible}
      >
        <button data-testid="sheet-inner" onClick={() => props.onInnerClick?.()}>
          Inner button
        </button>
      </Sheet>
    </>
  );
}

afterEach(() => {
  // Restore any matchMedia stub (jsdom has none by default).
  if (originalMatchMedia !== undefined) {
    Object.defineProperty(window, "matchMedia", { value: originalMatchMedia, configurable: true });
  } else {
    delete (window as unknown as { matchMedia?: MediaQueryList }).matchMedia;
  }
});

describe("Sheet", () => {
  it("renders the scrim, handle and title and springs to the mid snap", async () => {
    render(() => <Harness />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));

    expect(screen.getByTestId("sheet-scrim")).toBeInTheDocument();
    expect(screen.getByTestId("sheet-handle")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Test sheet");
    const panel = screen.getByTestId("sheet");
    expect(panel).toHaveAttribute("data-snap", "mid");
    // The panel settles to the 60% snap with the spring transition.
    await waitFor(() => {
      expect(panel.style.transform).toBe(`translateY(${snapPx(60)}px)`);
      expect(panel.style.transition).toContain("var(--ease-spring)");
    });
  });

  it("starts the panel off-screen and fades the scrim in (no flicker path)", async () => {
    render(() => <Harness snap="high" />);
    // Before the settle frame the panel is parked below the viewport.
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    expect(panel.style.transform).toBe(`translateY(${VH}px)`);
    expect(screen.getByTestId("sheet-scrim").style.opacity).toBe("0");

    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));
    expect(screen.getByTestId("sheet-scrim").style.opacity).toBe("1");
  });

  it("closes on a scrim click", async () => {
    render(() => <Harness />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("sheet-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(() => <Harness />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when dragged down past the threshold", async () => {
    render(() => <Harness snap="high" />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));

    fireEvent.pointerDown(panel, { clientY: 100, button: 0 });
    // 200px of downward drag (threshold is 120px).
    fireEvent.pointerMove(window, { clientY: 300 });
    fireEvent.pointerUp(window, { clientY: 300 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a fast downward flick", async () => {
    render(() => <Harness snap="high" />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));

    fireEvent.pointerDown(panel, { clientY: 100, button: 0 });
    // A quick 30px downward jab: velocity >> 0.8 px/ms.
    fireEvent.pointerMove(window, { clientY: 130 });
    fireEvent.pointerUp(window, { clientY: 130 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("settles to the nearest snap when the drag does not close", async () => {
    render(() => <Harness snap="mid" />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(60)}px)`));

    // Drag up from mid (269px) by ~200px -> 69px: nearest snap is high.
    fireEvent.pointerDown(panel, { clientY: 300, button: 0 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window, { clientY: 100 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));
  });

  it("disables the transition while dragging and re-enables it after", async () => {
    render(() => <Harness snap="high" />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));

    fireEvent.pointerDown(panel, { clientY: 100, button: 0 });
    expect(panel.style.transition).toBe("none");
    fireEvent.pointerMove(window, { clientY: 140 });
    expect(panel.style.transform).toBe(`translateY(${snapPx(95) + 40}px)`);
    fireEvent.pointerUp(window, { clientY: 140 });
    await waitFor(() => expect(panel.style.transition).toContain("var(--ease-spring)"));
  });

  it("locks the body scroll while open and restores it on close", async () => {
    document.body.style.overflow = "";
    render(() => <Harness />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByTestId("sheet-scrim"));
    expect(document.body.style.overflow).toBe("");
  });

  it("moves focus to the panel on open and returns it on close", async () => {
    render(() => <Harness />);
    const trigger = screen.getByTestId("sheet-trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByTestId("sheet"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("replaces the spring with a 0ms linear transition under reduced motion", async () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true }),
      configurable: true,
    });
    render(() => <Harness snap="high" />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));

    const panel = screen.getByTestId("sheet");
    expect(panel).toHaveAttribute("data-reduced-motion", "true");
    expect(panel.style.transition).toBe("transform 0ms linear");
    // Settles without the rAF handoff.
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));
  });

  it("does not close on scrim, Esc or drag when dismissible is false", async () => {
    render(() => <Harness dismissible={false} />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(60)}px)`));

    fireEvent.click(screen.getByTestId("sheet-scrim"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(panel, { clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientY: 400 });
    fireEvent.pointerUp(window, { clientY: 400 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not activate a button underneath the drag", async () => {
    const onInnerClick = vi.fn();
    render(() => <Harness snap="high" onInnerClick={onInnerClick} />);
    fireEvent.click(screen.getByTestId("sheet-trigger"));
    const panel = screen.getByTestId("sheet");
    await waitFor(() => expect(panel.style.transform).toBe(`translateY(${snapPx(95)}px)`));

    const inner = screen.getByTestId("sheet-inner");
    fireEvent.pointerDown(inner, { clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientY: 160 });
    fireEvent.pointerUp(window, { clientY: 160 });
    // The post-drag click is swallowed at the window capture phase.
    fireEvent.click(inner);
    expect(onInnerClick).not.toHaveBeenCalled();
  });
});
