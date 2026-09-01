import type { PetAnimationState } from "../../../services/pet.js";
import { getPetPackAssetUrl } from "../../../services/petPacks.js";
import type {
  PetReaction,
  PetRendererInstance,
  SpriteAnimation,
  SpritePackManifest,
  SpriteReaction,
} from "./types.js";

interface ActiveAnimation extends SpriteAnimation {
  startFrame: number;
  sheetFrames: number;
}

const MAX_FRAME_DELTA_MS = 250;

function isStateReaction(reaction: SpriteReaction): reaction is { state: PetAnimationState } {
  return "state" in reaction;
}

/**
 * Draws a data-only horizontal sprite sheet and its optional reactions.
 * Animation is kept inside this instance so each pet window can be paused,
 * replaced, or disposed without leaking a global timer.
 */
export class SpriteRenderer implements PetRendererInstance {
  private state: PetAnimationState = "idle";
  private intensity = 0;
  private reaction: PetReaction | null = null;
  private size = 160;
  private frame = 0;
  private frameElapsedMs = 0;
  private lastFrameTime: number | undefined;
  private disposed = false;
  private image: HTMLImageElement | undefined;
  private imageAsset: string | undefined;
  private animationToken = 0;
  private animationFrame: number | undefined;
  private readonly imagePromises = new Map<string, Promise<HTMLImageElement>>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly packId: string,
    private readonly manifest: SpritePackManifest,
  ) {
    canvas.style.imageRendering = manifest.renderer.pixelated ? "pixelated" : "auto";
    canvas.style.display = "block";
    this.resize(this.size);
    void this.loadCurrentAnimation();
  }

  setState(state: PetAnimationState): void {
    if (this.state === state) return;
    this.state = state;
    this.resetAnimation();
    void this.loadCurrentAnimation();
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.min(100, Math.max(0, intensity));
    this.draw();
    this.ensureAnimationLoop();
  }

  setReaction(reaction: PetReaction | null): void {
    if (this.reaction === reaction) return;
    this.reaction = reaction;
    this.resetAnimation();
    void this.loadCurrentAnimation();
  }

  resize(size: number): void {
    this.size = Math.max(1, size);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.draw();
    this.ensureAnimationLoop();
  }

  dispose(): void {
    this.disposed = true;
    this.animationToken += 1;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.image = undefined;
    this.imageAsset = undefined;
    this.imagePromises.clear();
  }

  private resetAnimation(): void {
    this.frame = 0;
    this.frameElapsedMs = 0;
    this.lastFrameTime = undefined;
    this.image = undefined;
    this.imageAsset = undefined;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.draw();
  }

  private activeAnimation(): ActiveAnimation {
    const states = this.manifest.renderer.states;
    const reaction =
      this.reaction === null ? undefined : this.manifest.renderer.reactions?.[this.reaction];
    if (reaction !== undefined) {
      if (isStateReaction(reaction)) {
        const stateAnimation = states[reaction.state] ?? states.idle;
        return {
          ...stateAnimation,
          startFrame: 0,
          sheetFrames: this.sheetFramesForAsset(stateAnimation.asset, stateAnimation.frames),
        };
      }
      return {
        ...reaction,
        loop: false,
        sheetFrames: this.sheetFramesForAsset(
          reaction.asset,
          reaction.startFrame + reaction.frames,
        ),
      };
    }
    const stateAnimation = states[this.state] ?? states.idle;
    return {
      ...stateAnimation,
      startFrame: 0,
      sheetFrames: this.sheetFramesForAsset(stateAnimation.asset, stateAnimation.frames),
    };
  }

  private sheetFramesForAsset(asset: string, fallback: number): number {
    let total = fallback;
    for (const animation of Object.values(this.manifest.renderer.states)) {
      if (animation?.asset === asset) total = Math.max(total, animation.frames);
    }
    for (const reaction of Object.values(this.manifest.renderer.reactions ?? {})) {
      if (reaction !== undefined && !isStateReaction(reaction) && reaction.asset === asset) {
        total = Math.max(total, reaction.startFrame + reaction.frames);
      }
    }
    return total;
  }

  private effectiveFps(animation: ActiveAnimation): number {
    const multiplier = this.state === "working" ? 1 + this.intensity / 100 : 1;
    return Math.min(30, Math.max(1, animation.fps * multiplier));
  }

  private async loadCurrentAnimation(): Promise<void> {
    const token = ++this.animationToken;
    const animation = this.activeAnimation();
    try {
      const image = await this.loadImage(animation.asset);
      if (this.disposed || token !== this.animationToken) return;
      this.image = image;
      this.imageAsset = animation.asset;
      this.frame = animation.startFrame;
      this.frameElapsedMs = 0;
      this.lastFrameTime = undefined;
      this.draw();
      this.ensureAnimationLoop();
    } catch {
      // PetSurface owns the non-emoji fallback when a pack asset is broken.
    }
  }

  private loadImage(asset: string): Promise<HTMLImageElement> {
    const cached = this.imagePromises.get(asset);
    if (cached !== undefined) return cached;
    const promise = getPetPackAssetUrl(this.packId, asset).then(async (url) => {
      const image = new Image();
      image.src = url;
      if (typeof image.decode === "function") await image.decode();
      return image;
    });
    this.imagePromises.set(asset, promise);
    return promise;
  }

  private ensureAnimationLoop(): void {
    if (this.disposed || this.animationFrame !== undefined || this.image === undefined) return;
    if (this.prefersReducedMotion()) return;
    const animation = this.activeAnimation();
    if (animation.frames <= 1) return;
    if (!animation.loop && this.frame >= animation.startFrame + animation.frames - 1) return;
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (timestamp: number): void => {
    this.animationFrame = undefined;
    if (this.disposed || this.image === undefined) return;
    const animation = this.activeAnimation();
    if (this.imageAsset !== animation.asset) return;
    if (this.lastFrameTime === undefined) this.lastFrameTime = timestamp;
    this.frameElapsedMs += Math.min(MAX_FRAME_DELTA_MS, timestamp - this.lastFrameTime);
    this.lastFrameTime = timestamp;
    const frameDuration = 1000 / this.effectiveFps(animation);
    const lastFrame = animation.startFrame + animation.frames - 1;
    while (this.frameElapsedMs >= frameDuration) {
      this.frameElapsedMs -= frameDuration;
      if (this.frame < lastFrame) this.frame += 1;
      else if (animation.loop) this.frame = animation.startFrame;
      else {
        this.frameElapsedMs = 0;
        break;
      }
    }
    this.draw();
    this.ensureAnimationLoop();
  };

  private prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  private draw(): void {
    const context = this.canvas.getContext("2d");
    if (context === null) return;
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, this.size, this.size);
    const image = this.image;
    const animation = this.activeAnimation();
    if (image === undefined || this.imageAsset !== animation.asset) return;
    const frameWidth = image.width / animation.sheetFrames;
    if (!Number.isFinite(frameWidth) || frameWidth <= 0) return;
    const frame = Math.min(
      animation.startFrame + animation.frames - 1,
      Math.max(animation.startFrame, this.frame),
    );
    const scale = Math.min(this.size / frameWidth, this.size / image.height);
    const width = Math.round(frameWidth * scale);
    const height = Math.round(image.height * scale);
    const bob = this.state === "working" ? Math.round((this.intensity / 100) * 4) : 0;
    context.drawImage(
      image,
      frame * frameWidth,
      0,
      frameWidth,
      image.height,
      Math.round((this.size - width) / 2),
      Math.round((this.size - height) / 2) - bob,
      width,
      height,
    );
  }
}
