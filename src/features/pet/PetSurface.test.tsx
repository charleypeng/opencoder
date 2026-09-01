import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import PetSurface from "./PetSurface";

const { getPetPackAssetUrlMock, SpriteRendererMock } = vi.hoisted(() => ({
  getPetPackAssetUrlMock: vi.fn(),
  SpriteRendererMock: vi.fn(function () {
    return {
      setState: vi.fn(),
      setIntensity: vi.fn(),
      setReaction: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock("../../services/petPacks.js", () => ({
  getPetPackAssetUrl: getPetPackAssetUrlMock,
}));
vi.mock("./renderers/SpriteRenderer.js", () => ({ SpriteRenderer: SpriteRendererMock }));

beforeEach(() => {
  getPetPackAssetUrlMock.mockResolvedValue("blob:manifest");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        renderer: {
          type: "sprite",
          pixelated: false,
          canvas: { width: 256, height: 256 },
          states: { idle: { asset: "idle.png", frames: 1, fps: 1, loop: true } },
        },
      }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PetSurface", () => {
  it("mounts one renderer canvas when the initial effects run", async () => {
    render(() => <PetSurface packId="dev.opencoder.byte" state="idle" intensity={0} size={160} />);

    await waitFor(() => expect(screen.getByTestId("pet-sprite")).toBeInTheDocument());
    expect(screen.getByTestId("pet-surface").querySelectorAll("canvas")).toHaveLength(1);
    expect(getPetPackAssetUrlMock).toHaveBeenCalledTimes(1);
    expect(SpriteRendererMock).toHaveBeenCalledTimes(1);
  });

  it("forwards later size changes after the async renderer mount", async () => {
    const [size, setSize] = createSignal(160);
    render(() => (
      <PetSurface packId="dev.opencoder.byte" state="idle" intensity={0} size={size()} />
    ));

    await waitFor(() => expect(SpriteRendererMock).toHaveBeenCalledTimes(1));
    const renderer = SpriteRendererMock.mock.results[0]?.value as {
      resize: ReturnType<typeof vi.fn>;
    };
    setSize(200);
    await waitFor(() => expect(renderer.resize).toHaveBeenLastCalledWith(200));
  });
});
