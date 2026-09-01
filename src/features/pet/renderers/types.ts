import type { PetAnimationState } from "../../../services/pet.js";

export interface SpriteAnimation {
  asset: string;
  frames: number;
  fps: number;
  loop: boolean;
}

export interface SpritePackManifest {
  renderer: {
    type: "sprite";
    pixelated: boolean;
    canvas: { width: number; height: number };
    states: Partial<Record<PetAnimationState, SpriteAnimation>> & { idle: SpriteAnimation };
  };
}

export interface PetRendererInstance {
  setState(state: PetAnimationState): void;
  setIntensity(intensity: number): void;
  resize(size: number): void;
  dispose(): void;
}
