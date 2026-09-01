import { createEffect, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";
import type { PetAnimationState } from "../../services/pet.js";
import { getPetPackAssetUrl } from "../../services/petPacks.js";
import { SpriteRenderer } from "./renderers/SpriteRenderer.js";
import type { PetRendererInstance, SpritePackManifest } from "./renderers/types.js";

interface PetSurfaceProps {
  packId: string;
  state: PetAnimationState;
  intensity: number;
  size: number;
}

const PetSurface: Component<PetSurfaceProps> = (props) => {
  let host: HTMLDivElement | undefined;
  let renderer: PetRendererInstance | undefined;

  async function mount(): Promise<void> {
    if (host === undefined) return;
    renderer?.dispose();
    host.replaceChildren();
    try {
      const manifestUrl = await getPetPackAssetUrl(props.packId, "manifest.json");
      const manifest = (await fetch(manifestUrl).then((response) =>
        response.json(),
      )) as SpritePackManifest;
      if (manifest.renderer.type !== "sprite") throw new Error("unsupported renderer");
      const canvas = document.createElement("canvas");
      canvas.dataset.testid = "pet-sprite";
      host.append(canvas);
      renderer = new SpriteRenderer(canvas, props.packId, manifest);
      renderer.setState(props.state);
      renderer.setIntensity(props.intensity);
      renderer.resize(props.size);
    } catch {
      host.replaceChildren();
      const fallback = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      fallback.setAttribute("viewBox", "0 0 100 100");
      fallback.setAttribute("data-testid", "pet-fallback");
      fallback.innerHTML =
        '<path d="M18 55 31 26h38l13 29-13 25H31Z" fill="#7aa47a" stroke="#1d2938" stroke-width="6"/><circle cx="39" cy="54" r="5" fill="#1d2938"/><circle cx="61" cy="54" r="5" fill="#1d2938"/><path d="M39 70h22" stroke="#1d2938" stroke-width="6" stroke-linecap="round"/>';
      host.append(fallback);
    }
  }

  onMount(() => void mount());
  createEffect(() => renderer?.setState(props.state));
  createEffect(() => renderer?.setIntensity(props.intensity));
  createEffect(() => renderer?.resize(props.size));
  createEffect(() => {
    void props.packId;
    void mount();
  });
  onCleanup(() => renderer?.dispose());

  return <div ref={host} data-testid="pet-surface" class="h-full w-full" />;
};

export default PetSurface;
