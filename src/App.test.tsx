// L2 tests for the App platform switch (TASK-M7-03): the servers home is
// the landing page on every platform, and opening a server mounts the
// shell for the detected platform — DesktopShell on desktop, MobileShell
// on mobile (src/platform). The shells are stubbed so the test focuses on
// the switch itself.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import App from "./App";
import { refreshPlatform } from "./platform";

vi.mock("./features/servers/ServerHome", () => ({
  default: (props: { onSelect: (server: { id: string }) => void }) => (
    <button type="button" data-testid="server-home" onClick={() => props.onSelect({ id: "srv-1" })}>
      Home
    </button>
  ),
}));
vi.mock("./shells/desktop/DesktopShell", () => ({
  default: () => <div data-testid="desktop-shell-mock" />,
}));
vi.mock("./shells/mobile/MobileShell", () => ({
  default: () => <div data-testid="mobile-shell-mock" />,
}));

const ORIGINAL_UA = window.navigator.userAgent;

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", { value: ORIGINAL_UA, configurable: true });
  delete window.webkit;
  refreshPlatform();
});

describe("App platform switch", () => {
  it("mounts ServerHome first, then DesktopShell on a desktop platform", async () => {
    // jsdom default environment: Linux UA, no webkit -> desktop.
    refreshPlatform();
    render(() => <App />);
    const home = await screen.findByTestId("server-home");
    fireEvent.click(home);
    await screen.findByTestId("desktop-shell-mock");
    expect(screen.queryByTestId("mobile-shell-mock")).not.toBeInTheDocument();
  });

  it("mounts MobileShell instead on a mobile platform", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      configurable: true,
    });
    refreshPlatform();
    render(() => <App />);
    const home = await screen.findByTestId("server-home");
    fireEvent.click(home);
    await screen.findByTestId("mobile-shell-mock");
    expect(screen.queryByTestId("desktop-shell-mock")).not.toBeInTheDocument();
  });
});
