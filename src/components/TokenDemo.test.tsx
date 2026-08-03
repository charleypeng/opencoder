import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import TokenDemo from "./TokenDemo";

describe("TokenDemo", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("renders all token sections", () => {
    render(() => <TokenDemo />);
    for (const heading of [
      "Design tokens",
      "Colors",
      "Type scale",
      "Radii",
      "Motion",
      "Density",
      "Glass",
      "Fonts",
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("renders every design token from the spec", () => {
    render(() => <TokenDemo />);
    const required = [
      "--bg-base",
      "--bg-elevated",
      "--bg-sunken",
      "--fg-primary",
      "--fg-secondary",
      "--fg-faint",
      "--accent",
      "--accent-soft",
      "--success",
      "--warning",
      "--danger",
      "--glass-bg",
      "--glass-border",
      "--glass-blur",
      "--text-xs",
      "--text-sm",
      "--text-md",
      "--text-lg",
      "--r-sm",
      "--r-md",
      "--r-lg",
      "--r-xl",
      "--ease-spring",
      "--dur-fast",
      "--dur-med",
      "--density",
      "--font-ui",
      "--font-code",
    ];
    for (const token of required) {
      expect(document.querySelector(`[data-token="${token}"]`), token).not.toBeNull();
    }
  });

  it("switches data-theme and persists the choice", () => {
    render(() => <TokenDemo />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("theme-label")).toHaveTextContent("Current theme: dark");

    const toggle = screen.getByTestId("theme-toggle");
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("oc-theme")).toBe("light");
    expect(screen.getByTestId("theme-label")).toHaveTextContent("Current theme: light");

    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("oc-theme")).toBe("dark");
  });

  it("restores the persisted theme on mount", () => {
    localStorage.setItem("oc-theme", "light");
    render(() => <TokenDemo />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
