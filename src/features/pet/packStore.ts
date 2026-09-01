import { createSignal } from "solid-js";
import { listPetPacks, revokePetPackAssetUrls } from "../../services/petPacks.js";
import { DEFAULT_PET_PACK_ID, type PetPackSummary } from "./packTypes.js";

const [petPacks, setPetPacks] = createSignal<readonly PetPackSummary[]>([]);
const [petPacksLoading, setPetPacksLoading] = createSignal(false);

export { petPacks, petPacksLoading };

export async function refreshPetPacks(): Promise<readonly PetPackSummary[]> {
  setPetPacksLoading(true);
  try {
    const packs = await listPetPacks();
    setPetPacks(packs);
    return packs;
  } finally {
    setPetPacksLoading(false);
  }
}

export function resolvedPetPackId(selectedPackId: string | undefined): string {
  const available = petPacks();
  if (available.some((pack) => pack.id === selectedPackId)) return selectedPackId as string;
  if (available.some((pack) => pack.id === DEFAULT_PET_PACK_ID)) return DEFAULT_PET_PACK_ID;
  return available[0]?.id ?? DEFAULT_PET_PACK_ID;
}

export function discardPetPackAssets(id: string): void {
  revokePetPackAssetUrls(id);
}
