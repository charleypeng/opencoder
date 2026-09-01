import type { PetAnimationState } from "../../../services/pet.js";

export interface SpriteAnimation {
  asset: string;
  frames: number;
  fps: number;
  loop: boolean;
}

export type PetReaction = "tap" | "hover" | "press" | "dragStart" | "drop";

export type SpriteReaction =
  { state: PetAnimationState } | { asset: string; startFrame: number; frames: number; fps: number };

export interface SpritePackManifest {
  renderer: {
    type: "sprite";
    pixelated: boolean;
    canvas: { width: number; height: number };
    states: Partial<Record<PetAnimationState, SpriteAnimation>> & { idle: SpriteAnimation };
    reactions?: Partial<Record<PetReaction, SpriteReaction>>;
  };
}

export interface PetRendererInstance {
  setState(state: PetAnimationState): void;
  setIntensity(intensity: number): void;
  setReaction(reaction: PetReaction | null): void;
  resize(size: number): void;
  dispose(): void;
}
