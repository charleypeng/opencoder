import { afterEach, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import AnimatedDisclosure from "./AnimatedDisclosure";

afterEach(() => vi.unstubAllGlobals());

it("keeps outgoing content until the close animation finishes and cancels interrupted motion", () => {
  const motions: { cancel: ReturnType<typeof vi.fn>; onfinish?: () => void }[] = [];
  const { container } = render(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <>
        <button onClick={() => setOpen(!open())}>toggle</button>
        <AnimatedDisclosure open={open()}>
          <p>Tool output</p>
        </AnimatedDisclosure>
      </>
    );
  });
  const body = container.querySelector<HTMLDivElement>(".chat-disclosure")!;
  body.animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), onfinish: undefined };
    motions.push(animation);
    return animation as unknown as Animation;
  });
  screen.getByText("toggle").click();
  expect(screen.getByText("Tool output")).toBeInTheDocument();
  screen.getByText("toggle").click();
  expect(motions[0].cancel).toHaveBeenCalled();
  expect(body).toHaveProperty("inert", true);
  expect(body).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("Tool output")).toBeInTheDocument();
  motions[1].onfinish?.();
  expect(screen.queryByText("Tool output")).not.toBeInTheDocument();
});

it("skips animation when reduced motion is requested", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const [open, setOpen] = createSignal(true);
  const { container } = render(() => (
    <AnimatedDisclosure open={open()}>Details</AnimatedDisclosure>
  ));
  const animate = vi.fn();
  container.querySelector<HTMLDivElement>(".chat-disclosure")!.animate = animate;
  setOpen(false);
  expect(animate).not.toHaveBeenCalled();
  expect(screen.queryByText("Details")).not.toBeInTheDocument();
});
