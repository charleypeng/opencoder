import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import UserMessageContent from "./UserMessageContent";
import { clearActivityViewState } from "./activity/activityViewState";

beforeEach(() => clearActivityViewState());
afterEach(() => vi.restoreAllMocks());

it("collapses rendered tall text without losing its tail and restores expansion after remount", () => {
  const userText = "Skill instructions and the final line";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: 600,
    top: 0,
  } as DOMRect);
  const mount = () =>
    render(() => (
      <UserMessageContent messageKey="user:one">
        <p>{userText}</p>
      </UserMessageContent>
    ));
  const first = mount();
  expect(screen.getByTestId("user-message-content")).toHaveAttribute("data-collapsed", "true");
  screen.getByTestId("user-message-toggle").click();
  expect(screen.getByTestId("user-message-content")).toHaveAttribute("data-collapsed", "false");
  expect(screen.getByText(/final line/)).toBeInTheDocument();
  first.unmount();
  mount();
  expect(screen.getByTestId("user-message-toggle")).toHaveAttribute("aria-expanded", "true");
  screen.getByTestId("user-message-toggle").click();
  expect(screen.getByTestId("user-message-content")).toHaveAttribute("data-collapsed", "true");
});

it("does not add a fold control to a short message", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: 30,
  } as DOMRect);
  render(() => <UserMessageContent messageKey="user:short">Hello</UserMessageContent>);
  expect(screen.queryByTestId("user-message-toggle")).not.toBeInTheDocument();
});
