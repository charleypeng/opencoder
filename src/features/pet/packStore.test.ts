import { afterEach, describe, expect, it, vi } from "vitest";

const { listMock, revokeMock } = vi.hoisted(() => ({ listMock: vi.fn(), revokeMock: vi.fn() }));
vi.mock("../../services/petPacks.js", () => ({
  listPetPacks: listMock,
  revokePetPackAssetUrls: revokeMock,
}));

import {
  discardPetPackAssets,
  petPacks,
  petPacksLoading,
  refreshPetPacks,
  resolvedPetPackId,
} from "./packStore.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("pet pack store", () => {
  it("refreshes the registry and resolves a missing selection to the default pack", async () => {
    listMock.mockResolvedValueOnce([
      { id: "dev.opencoder.byte", name: "Byte" },
      { id: "com.example.fox", name: "Fox" },
    ]);
    const refresh = refreshPetPacks();
    expect(petPacksLoading()).toBe(true);
    await expect(refresh).resolves.toHaveLength(2);
    expect(petPacksLoading()).toBe(false);
    expect(petPacks()).toHaveLength(2);
    expect(resolvedPetPackId("missing.pack")).toBe("dev.opencoder.byte");
    expect(resolvedPetPackId("com.example.fox")).toBe("com.example.fox");
  });

  it("releases cached URLs when a pack is discarded", () => {
    discardPetPackAssets("com.example.fox");
    expect(revokeMock).toHaveBeenCalledWith("com.example.fox");
  });
});
