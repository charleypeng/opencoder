// L2 tests for the standalone pet settings section.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PetSection from "./PetSection";

const { invokeMock, openMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), openMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  localStorage.clear();
  invokeMock.mockReset();
  openMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "pet_get_ignore_mouse") return Promise.resolve(false);
    if (cmd === "pet_pack_list") {
      return Promise.resolve([
        { id: "dev.opencoder.byte", name: "Byte", source: "bundled" },
        { id: "dev.opencoder.box-cat", name: "Box Cat", source: "bundled" },
      ]);
    }
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

  it("persists the selected pack, movement, size and opacity settings", async () => {
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() =>
      expect(screen.getByTestId("pet-pack-dev.opencoder.box-cat")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("pet-pack-dev.opencoder.box-cat"));
    fireEvent.change(screen.getByTestId("pet-movement-select"), { target: { value: "bottom" } });
    fireEvent.input(screen.getByTestId("pet-size-slider"), { target: { value: "190" } });
    fireEvent.input(screen.getByTestId("pet-opacity-slider"), { target: { value: "0.6" } });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("oc-pet") ?? "{}")).toMatchObject({
        selectedPackId: "dev.opencoder.box-cat",
        movement: "bottom",
        size: 190,
        opacity: 0.6,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("pet_set_size", { size: 190 });
    expect(invokeMock).toHaveBeenCalledWith("pet_set_opacity", { opacity: 0.6 });
  });

  it("renders pet packs as preview cards and filters them by name or id", async () => {
    render(() => <PetSection serverId="srv-pet" />);
    await waitFor(() => expect(screen.getByTestId("pet-pack-list")).toBeInTheDocument());
    expect(screen.getByTestId("pet-pack-preview-dev.opencoder.byte")).toBeInTheDocument();
    expect(screen.getByTestId("pet-pack-preview-dev.opencoder.box-cat")).toBeInTheDocument();

    fireEvent.input(screen.getByTestId("pet-pack-search"), { target: { value: "box-cat" } });
    expect(screen.queryByTestId("pet-pack-dev.opencoder.byte")).not.toBeInTheDocument();
    expect(screen.getByTestId("pet-pack-dev.opencoder.box-cat")).toBeInTheDocument();
  });

  it("imports a pack through the system picker and selects it after refreshing", async () => {
    openMock.mockResolvedValueOnce("/tmp/fox.opet");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pet_get_ignore_mouse") return Promise.resolve(false);
      if (cmd === "pet_pack_install") {
        return Promise.resolve({
          installed: true,
          pack: { id: "com.example.fox", name: "Fox", source: "installed" },
        });
      }
      if (cmd === "pet_pack_list") {
        return Promise.resolve([{ id: "com.example.fox", name: "Fox", source: "installed" }]);
      }
      return Promise.resolve(undefined);
    });
    render(() => <PetSection serverId="srv-pet" />);
    fireEvent.click(screen.getByTestId("pet-pack-import"));
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith({
        multiple: false,
        directory: false,
        filters: [{ name: "OpenCoder pet pack", extensions: ["opet"] }],
      }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pet_pack_install", {
        path: "/tmp/fox.opet",
        allowDowngrade: false,
      }),
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("oc-pet") ?? "{}")).toMatchObject({
        selectedPackId: "com.example.fox",
      }),
    );
  });

  it("explains that a bundled pack is already installed", async () => {
    openMock.mockResolvedValueOnce("/tmp/default.opet");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pet_get_ignore_mouse") return Promise.resolve(false);
      if (cmd === "pet_pack_install") {
        return Promise.reject("reservedPackId: dev.opencoder.byte");
      }
      if (cmd === "pet_pack_list") {
        return Promise.resolve([{ id: "dev.opencoder.byte", name: "Byte", source: "bundled" }]);
      }
      return Promise.resolve(undefined);
    });
    render(() => <PetSection serverId="srv-pet" />);
    fireEvent.click(screen.getByTestId("pet-pack-import"));
    await waitFor(() =>
      expect(screen.getByTestId("pet-error")).toHaveTextContent(
        "This built-in pet is already included with the app.",
      ),
    );
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
