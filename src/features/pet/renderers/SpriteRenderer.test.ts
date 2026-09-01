import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPetPackAssetUrl } from "../../../services/petPacks.js";
import { SpriteRenderer } from "./SpriteRenderer";
import type { SpritePackManifest } from "./types";

vi.mock("../../../services/petPacks.js", () => ({
  getPetPackAssetUrl: vi.fn(),
}));

const assetUrlMock = vi.mocked(getPetPackAssetUrl);

const manifest: SpritePackManifest = {
  renderer: {
    type: "sprite",
    pixelated: true,
    canvas: { width: 160, height: 160 },
    states: {
      idle: { asset: "assets/idle-frames.png", frames: 4, fps: 4, loop: true },
      working: { asset: "assets/working-frames.png", frames: 3, fps: 8, loop: true },
    },
    reactions: {
      tap: { asset: "assets/idle-frames.png", startFrame: 3, frames: 1, fps: 8 },
    },
  },
};

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
};

let animationCallbacks: Array<(time: number) => void>;

beforeEach(() => {
  assetUrlMock.mockResolvedValue("blob:pet-asset");
  context.setTransform.mockClear();
  context.clearRect.mockClear();
  context.drawImage.mockClear();
  animationCallbacks = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  vi.stubGlobal(
    "Image",
    class {
      width = 2172;
      height = 724;
      src = "";

      decode = vi.fn(async () => undefined);
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: (time: number) => void) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flushImageLoad(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SpriteRenderer", () => {
  it("plays horizontal state frames and speeds up working animation with intensity", async () => {
    const canvas = document.createElement("canvas");
    const renderer = new SpriteRenderer(canvas, "dev.opencoder.byte", manifest);
    await flushImageLoad();

    expect(assetUrlMock).toHaveBeenCalledWith("dev.opencoder.byte", "assets/idle-frames.png");
    expect(context.drawImage).toHaveBeenCalled();
    expect(animationCallbacks).toHaveLength(1);
    animationCallbacks.shift()?.(1);
    animationCallbacks.shift()?.(301);
    expect(context.drawImage.mock.calls[context.drawImage.mock.calls.length - 1]?.[1]).toBe(543);

    renderer.setState("working");
    renderer.setIntensity(100);
    await flushImageLoad();
    expect(assetUrlMock).toHaveBeenCalledWith("dev.opencoder.byte", "assets/working-frames.png");
    renderer.dispose();
  });

  it("plays a reaction frame from the shared sprite sheet without stretching it", async () => {
    const canvas = document.createElement("canvas");
    const renderer = new SpriteRenderer(canvas, "dev.opencoder.byte", manifest);
    await flushImageLoad();
    renderer.setReaction("tap");
    await flushImageLoad();

    const lastDraw = context.drawImage.mock.calls[context.drawImage.mock.calls.length - 1];
    expect(lastDraw?.[1]).toBe(1629);
    expect(lastDraw?.[3]).toBe(543);
    renderer.dispose();
  });
});
