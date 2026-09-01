import type { PetAnimationState } from "../../../services/pet.js";
import { getPetPackAssetUrl } from "../../../services/petPacks.js";
import type { PetRendererInstance, SpritePackManifest } from "./types.js";

export class SpriteRenderer implements PetRendererInstance {
  private state: PetAnimationState = "idle";
  private intensity = 0;
  private size = 160;
  private disposed = false;
  private image: HTMLImageElement | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly packId: string,
    private readonly manifest: SpritePackManifest,
  ) {
    canvas.style.imageRendering = manifest.renderer.pixelated ? "pixelated" : "auto";
    this.resize(this.size);
    void this.loadCurrentImage();
  }

  setState(state: PetAnimationState): void {
    if (this.state === state) return;
    this.state = state;
    void this.loadCurrentImage();
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.min(100, Math.max(0, intensity));
    this.draw();
  }

  resize(size: number): void {
    this.size = size;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    this.image = undefined;
  }

  private async loadCurrentImage(): Promise<void> {
    const animation =
      this.manifest.renderer.states[this.state] ?? this.manifest.renderer.states.idle;
    const url = await getPetPackAssetUrl(this.packId, animation.asset);
    const image = new Image();
    image.src = url;
    await image.decode();
    if (this.disposed) return;
    this.image = image;
    this.draw();
  }

  private draw(): void {
    const context = this.canvas.getContext("2d");
    if (context === null || this.image === undefined) return;
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, this.size, this.size);
    const image = this.image;
    const scale = Math.min(this.size / image.width, this.size / image.height);
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const bob = this.state === "working" ? Math.round((this.intensity / 100) * 4) : 0;
    context.drawImage(
      image,
      Math.round((this.size - width) / 2),
      Math.round((this.size - height) / 2) - bob,
      width,
      height,
    );
  }
}
