// L2 tests for the standalone pet settings section.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PetSection from "./PetSection";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "pet_get_ignore_mouse") return Promise.resolve(false);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
  localStorage.clear();
});

describe("PetSection", () => {
  it("renders in its own section with the pet enabled by default", async () => {
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() => expect(screen.getByTestId("pet-show")).toBeInTheDocument());
    expect(screen.getByTestId("pet-section")).toBeInTheDocument();
    expect(screen.getByTestId("pet-show")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("pet-click-through")).toHaveAttribute("aria-checked", "false");
  });

  it("hides and shows the pet through the existing window actions", async () => {
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() => expect(screen.getByTestId("pet-show")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pet-show"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("pet_hide"));
    await waitFor(() =>
      expect(screen.getByTestId("pet-show")).toHaveAttribute("aria-checked", "false"),
    );
    fireEvent.click(screen.getByTestId("pet-show"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("pet_show"));
    await waitFor(() =>
      expect(screen.getByTestId("pet-show")).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("loads and toggles click-through state", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pet_get_ignore_mouse") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() =>
      expect(screen.getByTestId("pet-click-through")).toHaveAttribute("aria-checked", "true"),
    );
    fireEvent.click(screen.getByTestId("pet-click-through"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pet_set_ignore_mouse", { ignore: false }),
    );
    expect(screen.getByTestId("pet-click-through")).toHaveAttribute("aria-checked", "false");
  });

  it("persists character, movement, size and opacity settings", async () => {
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() => expect(screen.getByTestId("pet-type-select")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("pet-type-select"), { target: { value: "robot" } });
    fireEvent.change(screen.getByTestId("pet-movement-select"), { target: { value: "bottom" } });
    fireEvent.input(screen.getByTestId("pet-size-slider"), { target: { value: "190" } });
    fireEvent.input(screen.getByTestId("pet-opacity-slider"), { target: { value: "0.6" } });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("oc-pet") ?? "{}")).toMatchObject({
        petType: "robot",
        movement: "bottom",
        size: 190,
        opacity: 0.6,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("pet_set_size", { size: 190 });
    expect(invokeMock).toHaveBeenCalledWith("pet_set_opacity", { opacity: 0.6 });
  });
  it("keeps the applied state and shows an error when the pet action fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pet_hide") return Promise.reject("pet unavailable");
      return Promise.resolve(undefined);
    });
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() => expect(screen.getByTestId("pet-show")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pet-show"));
    await waitFor(() =>
      expect(screen.getByTestId("pet-error")).toHaveTextContent("pet unavailable"),
    );
    expect(screen.getByTestId("pet-show")).toHaveAttribute("aria-checked", "true");
  });
});
