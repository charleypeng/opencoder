import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  Object.defineProperties(URL, {
    createObjectURL: { value: vi.fn(() => "blob:pet"), configurable: true },
    revokeObjectURL: { value: vi.fn(), configurable: true },
  });
});

afterEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
  Object.defineProperties(URL, {
    createObjectURL: { value: undefined, configurable: true },
    revokeObjectURL: { value: undefined, configurable: true },
  });
  vi.clearAllMocks();
});

describe("pet pack facade", () => {
  it("uses the bundled test inventory outside the desktop runtime", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
    const packs = await import("./petPacks.js");
    await expect(packs.listPetPacks()).resolves.toHaveLength(2);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the Rust registry commands with camel-cased args", async () => {
    const packs = await import("./petPacks.js");
    invokeMock.mockResolvedValueOnce([]);
    await expect(packs.listPetPacks()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("pet_pack_list");

    invokeMock.mockResolvedValueOnce({ installed: true, pack: {} });
    await packs.installPetPack("/tmp/new.opet", true);
    expect(invokeMock).toHaveBeenCalledWith("pet_pack_install", {
      path: "/tmp/new.opet",
      allowDowngrade: true,
    });

    await packs.removePetPack("com.example.pet", "dev.opencoder.byte");
    expect(invokeMock).toHaveBeenCalledWith("pet_pack_remove", {
      id: "com.example.pet",
      selectedPackId: "dev.opencoder.byte",
    });
  });

  it("caches and revokes binary asset URLs", async () => {
    const packs = await import("./petPacks.js");
    invokeMock.mockResolvedValueOnce([82, 73, 70, 70]);
    await expect(packs.getPetPackAssetUrl("dev.opencoder.byte", "preview.webp")).resolves.toBe(
      "blob:pet",
    );
    await expect(packs.getPetPackAssetUrl("dev.opencoder.byte", "preview.webp")).resolves.toBe(
      "blob:pet",
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    packs.revokePetPackAssetUrls("dev.opencoder.byte");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pet");
  });

  it("turns stable Rust errors into typed errors", async () => {
    const packs = await import("./petPacks.js");
    invokeMock.mockRejectedValueOnce("invalidAsset: preview.webp");
    await expect(packs.listPetPacks()).rejects.toMatchObject({
      code: "invalidAsset",
      detail: "preview.webp",
    });
  });
});
