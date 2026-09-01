import { createEffect, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";
import type { PetAnimationState } from "../../services/pet.js";
import { getPetPackAssetUrl } from "../../services/petPacks.js";
import { SpriteRenderer } from "./renderers/SpriteRenderer.js";
import type { PetReaction, PetRendererInstance, SpritePackManifest } from "./renderers/types.js";

interface PetSurfaceProps {
  packId: string;
  state: PetAnimationState;
  intensity: number;
  size: number;
  reaction?: PetReaction | null;
}

const PetSurface: Component<PetSurfaceProps> = (props) => {
  let host: HTMLDivElement | undefined;
  let renderer: PetRendererInstance | undefined;
  let mountedPackId: string | undefined;
  let mountGeneration = 0;
  let disposed = false;

  async function mount(packId: string): Promise<void> {
    if (disposed || host === undefined) return;
    if (mountedPackId === packId) return;
    mountedPackId = packId;
    const generation = ++mountGeneration;
    renderer?.dispose();
    renderer = undefined;
    host.replaceChildren();
    try {
      const manifestUrl = await getPetPackAssetUrl(packId, "manifest.json");
      const manifest = (await fetch(manifestUrl).then((response) =>
        response.json(),
      )) as SpritePackManifest;
      if (manifest.renderer.type !== "sprite") throw new Error("unsupported renderer");
      if (generation !== mountGeneration || mountedPackId !== props.packId) return;
      const canvas = document.createElement("canvas");
      canvas.dataset.testid = "pet-sprite";
      host.append(canvas);
      renderer = new SpriteRenderer(canvas, packId, manifest);
      renderer.setState(props.state);
      renderer.setIntensity(props.intensity);
      renderer.setReaction(props.reaction ?? null);
      renderer.resize(props.size);
    } catch {
      if (generation !== mountGeneration || mountedPackId !== props.packId) return;
      host.replaceChildren();
      const fallback = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      fallback.setAttribute("viewBox", "0 0 100 100");
      fallback.setAttribute("data-testid", "pet-fallback");
      fallback.innerHTML =
        '<path d="M18 55 31 26h38l13 29-13 25H31Z" fill="#7aa47a" stroke="#1d2938" stroke-width="6"/><circle cx="39" cy="54" r="5" fill="#1d2938"/><circle cx="61" cy="54" r="5" fill="#1d2938"/><path d="M39 70h22" stroke="#1d2938" stroke-width="6" stroke-linecap="round"/>';
      host.append(fallback);
    }
  }

  onMount(() => void mount(props.packId));
  createEffect(() => {
    const state = props.state;
    renderer?.setState(state);
  });
  createEffect(() => {
    const intensity = props.intensity;
    renderer?.setIntensity(intensity);
  });
  createEffect(() => {
    const reaction = props.reaction ?? null;
    renderer?.setReaction(reaction);
  });
  createEffect(() => {
    const size = props.size;
    renderer?.resize(size);
  });
  createEffect(() => {
    const packId = props.packId;
    if (host !== undefined) void mount(packId);
  });
  onCleanup(() => {
    disposed = true;
    mountGeneration += 1;
    mountedPackId = undefined;
    renderer?.dispose();
    renderer = undefined;
  });

  return <div ref={host} data-testid="pet-surface" class="h-full w-full" />;
};

export default PetSurface;
